# Household Replenishment Assistant — Build-Ready v1 Spec Pack

## 1) MVP System Architecture

```text
[Next.js Web App]
  ├─ Auth (Google OAuth)
  ├─ Suggestions Feed UI (Buy now / Soon / Watch)
  ├─ Feedback Actions
  └─ Settings (merchant filters, privacy controls)
          |
          v
[API Layer (Next.js route handlers or backend service)]
  ├─ Ingestion Control Endpoints
  ├─ Suggestions Endpoints
  ├─ Feedback Endpoints
  └─ Admin/Debug Endpoints
          |
          v
[Supabase Postgres + pgvector]
  ├─ Core relational data (users, orders, items)
  ├─ Normalized product catalog
  ├─ Consumption patterns
  ├─ Suggestions + feedback
  └─ Ingestion/parsing job tables
          |
          +-----------------------------+
          |                             |
          v                             v
[Gmail Ingestion Worker]          [AI Normalization Worker]
  ├─ Query Gmail API               ├─ Canonicalization
  ├─ Pull target emails            ├─ Embeddings (product names)
  ├─ Parse merchant templates      ├─ Category inference
  └─ Store extracted orders        └─ Confidence scoring
          |
          v
[Replenishment Engine Worker]
  ├─ Compute reorder intervals
  ├─ Depletion probabilities
  └─ Suggestion generation/ranking
```

### Design principles
- Async ingestion and scoring jobs; never block UI on parsing.
- Probabilistic depletion state, not exact stock counts.
- Transparent confidence labels for trust-building.
- Privacy-first: store extracted structured data, avoid retaining full raw emails by default.

---

## 2) Database Schema (Supabase/Postgres)

```sql
-- Extensions
create extension if not exists pgcrypto;
create extension if not exists vector;

-- Users
create table app_user (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

-- OAuth tokens (encrypted at app layer before insert)
create table oauth_connection (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  provider text not null check (provider = 'google'),
  scope text not null,
  encrypted_access_token text not null,
  encrypted_refresh_token text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Merchants
create table merchant (
  id smallserial primary key,
  code text not null unique, -- knuspr, zooplus, amazon, dm, rewe, lidl, edeka
  display_name text not null
);

-- Email source records (minimal retention)
create table source_email (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  merchant_id smallint references merchant(id),
  gmail_message_id text not null,
  gmail_thread_id text,
  received_at timestamptz,
  subject text,
  from_address text,
  parse_status text not null default 'pending' check (parse_status in ('pending','parsed','failed')),
  parse_error text,
  extracted_hash text,
  created_at timestamptz not null default now(),
  unique(user_id, gmail_message_id)
);

-- Orders
create table "order" (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  merchant_id smallint not null references merchant(id),
  source_email_id uuid references source_email(id) on delete set null,
  order_external_id text,
  order_date date not null,
  currency text not null default 'EUR',
  total_price numeric(10,2),
  created_at timestamptz not null default now()
);

create index idx_order_user_date on "order"(user_id, order_date desc);

-- Raw order items
create table order_item (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references "order"(id) on delete cascade,
  raw_name text not null,
  raw_quantity numeric(10,3),
  raw_unit text,
  unit_price numeric(10,2),
  line_total numeric(10,2),
  created_at timestamptz not null default now()
);

-- Canonical products
create table product_canonical (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  category text,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index idx_product_embedding on product_canonical using ivfflat (embedding vector_cosine_ops);

-- Mapping raw items to canonical products
create table product_mapping (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  order_item_id uuid not null references order_item(id) on delete cascade,
  product_canonical_id uuid not null references product_canonical(id),
  confidence numeric(5,4) not null,
  mapping_method text not null check (mapping_method in ('rule','embedding','llm','manual')),
  created_at timestamptz not null default now(),
  unique(order_item_id)
);

-- Consumption patterns
create table consumption_pattern (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  product_canonical_id uuid not null references product_canonical(id),
  avg_reorder_days numeric(8,3) not null,
  reorder_stddev_days numeric(8,3),
  seasonality_factor numeric(8,3),
  confidence_score numeric(5,4) not null,
  last_purchase_date date not null,
  sample_size int not null,
  updated_at timestamptz not null default now(),
  unique(user_id, product_canonical_id)
);

-- Suggestions feed
create table suggestion (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  product_canonical_id uuid not null references product_canonical(id),
  state text not null check (state in ('buy_now','soon','watch')),
  depletion_probability numeric(5,4) not null,
  confidence_score numeric(5,4) not null,
  reason text,
  generated_at timestamptz not null default now(),
  expires_at timestamptz
);

create index idx_suggestion_user_state on suggestion(user_id, state, generated_at desc);

-- Feedback actions
create table suggestion_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  suggestion_id uuid not null references suggestion(id) on delete cascade,
  action text not null check (action in ('buy_soon','already_bought','stop_suggesting','consume_slower','consume_faster','finished')),
  created_at timestamptz not null default now()
);

-- Async jobs
create table ingest_job (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id) on delete cascade,
  job_type text not null check (job_type in ('gmail_fetch','parse_email','normalize_items','recompute_patterns','generate_suggestions')),
  status text not null check (status in ('queued','running','succeeded','failed')),
  payload jsonb,
  error text,
  run_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

---

## 3) Gmail Ingestion Service Design

### OAuth scope
- `https://www.googleapis.com/auth/gmail.readonly`

### Merchant query (MVP)
```text
(from:(knuspr.de OR zooplus.de) subject:(Bestellung OR order OR Rechnung))
```

### Ingestion flow
1. User connects Google account.
2. Create `gmail_fetch` job.
3. Worker calls Gmail `users.messages.list` with query + pagination.
4. For each message ID:
   - fetch metadata/body (`users.messages.get`)
   - upsert `source_email`
   - enqueue `parse_email` job
5. Parser extracts structured fields and creates `order` + `order_item`.
6. Enqueue `normalize_items` and then `recompute_patterns` + `generate_suggestions`.

### Idempotency
- Unique constraint `(user_id, gmail_message_id)` avoids duplicates.
- Order dedupe key: `(user_id, merchant_id, order_external_id, order_date)` where available.

### Failure handling
- `parse_status=failed` with machine-readable error code.
- Retry policy: exponential backoff with max 3 retries.
- Dead-letter queue via `ingest_job.status='failed'` + admin review endpoint.

---

## 4) Parser Contract + Fallback Extraction

### Parser output contract
```json
{
  "merchant": "knuspr",
  "order_external_id": "KNU-12345",
  "order_date": "2026-05-20",
  "currency": "EUR",
  "total_price": 64.20,
  "items": [
    {
      "raw_name": "Bio Banane",
      "quantity": 6,
      "unit": "piece",
      "unit_price": 0.39,
      "line_total": 2.34
    }
  ]
}
```

### Parser strategy
1. Merchant-specific deterministic extractor (CSS selectors / regex patterns).
2. If mandatory fields missing, fallback LLM structured extraction.
3. Validate schema and numeric/date parsing.
4. If still invalid, mark failed and log parser diagnostics.

### Confidence
- Deterministic parser: base confidence 0.9+
- LLM fallback: base confidence 0.6–0.8 depending on field completeness.

---

## 5) Replenishment Scoring (Probabilistic, not inventory)

For each `(user, canonical_product)`:

- Purchase dates sorted descending: `d1, d2, ... dn`
- Intervals: `Δi = d(i-1) - d(i)` in days
- `avg = mean(Δ)`
- `std = stddev(Δ)` (fallback to fixed prior when few samples)
- Days since last purchase: `t`

### Depletion probability (simple MVP)
Use logistic curve centered on `avg`:

```text
z = (t - avg) / max(std, min_std)
p_depleted = sigmoid(z)
```

Where:
- `min_std = 3` days to prevent overconfidence
- `sigmoid(x)=1/(1+e^-x)`

### State thresholds
- `buy_now`: `p_depleted >= 0.70`
- `soon`: `0.45 <= p_depleted < 0.70`
- `watch`: `0.25 <= p_depleted < 0.45`
- below 0.25: not shown

### Pattern confidence score
Weighted by sample size and interval stability:

```text
confidence = clamp(0,1,
  0.55 * min(sample_size/8, 1)
+ 0.45 * (1 - min(std/(avg+0.01), 1))
)
```

---

## 6) Suggestion Ranking Logic

Sort suggestions by:
1. Higher `state` priority (`buy_now` > `soon` > `watch`)
2. Higher `depletion_probability`
3. Higher `confidence_score`
4. Recency of last feedback (prefer untouched items)

### Suggestion explanation template
- “You usually reorder **{product}** every **{low}-{high} days**. Last purchase was **{t} days** ago.”

Where:
- `low=max(1, round(avg-std))`
- `high=round(avg+std)`

### Feedback learning hooks
- `already_bought`: suppress for 5 days and trigger ingestion refresh.
- `stop_suggesting`: hard mute canonical product until manually re-enabled.
- `consume_faster/slower`: shift effective avg interval by ±10% until enough new data.

---

## 7) API Surface (MVP)

### Auth/connection
- `POST /api/auth/google/start`
- `GET /api/auth/google/callback`
- `POST /api/connections/google/disconnect`

### Ingestion
- `POST /api/ingest/run` (manual trigger)
- `GET /api/ingest/status`

### Feed
- `GET /api/suggestions?state=buy_now|soon|watch`
- `GET /api/suggestions/summary`

### Feedback
- `POST /api/suggestions/{id}/feedback`
  - body: `{ action: 'buy_soon' | 'already_bought' | 'stop_suggesting' | 'consume_slower' | 'consume_faster' | 'finished' }`

### Diagnostics (internal)
- `GET /api/debug/failed-parses`
- `POST /api/debug/reparse/{source_email_id}`

---

## 8) Phase 1 Tickets (Execution-ready)

### Ticket 1 — Project bootstrap
- Initialize Next.js + Tailwind + Supabase client.
- Add env management and typed config.
- Definition of done: local app runs, health route works.

### Ticket 2 — Google OAuth + account linking
- Implement Google login and token persistence (encrypted at app layer).
- Minimal connected/disconnected UI state.
- DoD: user can connect Gmail with read-only scope.

### Ticket 3 — Gmail fetch worker
- Implement fetch job with merchant query and pagination.
- Persist `source_email` records idempotently.
- DoD: repeated runs do not duplicate emails.

### Ticket 4 — Knuspr parser v1
- Deterministic parser for top known template variants.
- Persist `order` + `order_item`.
- DoD: parse precision >=85% on test set.

### Ticket 5 — Zooplus parser v1
- Same as ticket 4 for Zooplus.
- DoD: parse precision >=85% on test set.

### Ticket 6 — Normalization MVP
- Canonical mapping pipeline: deterministic rules + embeddings fallback.
- Store mapping confidence and method.
- DoD: top recurring items deduplicate correctly in pilot data.

### Ticket 7 — Replenishment engine MVP
- Compute intervals, confidence, depletion probability.
- Generate suggestions table states.
- DoD: feed items generated for pilot users.

### Ticket 8 — Suggestions feed UI
- Implement sections Buy now / Soon / Watch.
- Display reasons + confidence badges.
- DoD: feed loads <2s with seeded data.

### Ticket 9 — Feedback actions
- Add quick actions + API wiring.
- Apply suppression/mute rules.
- DoD: feedback changes subsequent feed output.

### Ticket 10 — Observability + error handling
- Job status dashboard, parse failure list, retry controls.
- DoD: failed jobs are visible and recoverable.

---

## 9) MVP Exit Criteria (to validate value quickly)

- Gmail connected and first parsed order visible in under 5 minutes.
- Parser precision at/above 85% for Knuspr + Zooplus pilot set.
- At least 60% acceptance/usefulness on `buy_now` suggestions.
- Median feed response time under 2 seconds.
- Fewer than 10% hard-dismiss (`stop_suggesting`) on recurring suggestions over first 2 weeks.

