# Log Ingestion and Query Service

I built this as my final project for the Foothill Technology Solutions (Boot.dev) training program. It's a simplified version of a tool like Datadog or Grafana Loki: applications send it logs, and it makes those logs searchable and summarizable, even with over a million logs stored and under a heavy, sustained write load.

It runs under a fixed resource limit: **0.5 CPU / 256MB** for the application, and **1 CPU / 1GB** for PostgreSQL, which is the only datastore — there's no cache or secondary database.

## Contents

- [Setup and usage](#setup-and-usage)
- [API documentation](#api-documentation)
- [Schema design](#schema-design)
- [Index design](#index-design)
- [Attribute storage strategy](#attribute-storage-strategy)
- [Retention strategy](#retention-strategy)
- [Load-test methodology](#load-test-methodology)
- [Measured performance results](#measured-performance-results)
- [Known limitations](#known-limitations)
- [AI usage acknowledgement](#ai-usage-acknowledgement)

## Setup and usage

**Requirements:** Docker, Docker Compose and optionally Postman for testing the API. Node.js 22+ only if you want to run outside Docker.

```bash
git clone https://github.com/ahmadjoba96/fts-log-ingestion-service.git
cd fts-log-ingestion-service
docker compose up
```

That's it — no configuration file or environment variables are required. This starts:
- The application, listening on `localhost:8080`
- PostgreSQL
- pgAdmin at `localhost:5050`, for optionally browsing the database by hand

Database migrations run automatically on startup. `GET /health` only reports healthy once the database connection is established, migrations have finished, and the service is ready to accept logs.

To reset everything, including stored data:
```bash
docker compose down -v
```

If you do want to override defaults (retention settings, database credentials), copy `.env.example` to `.env` — see the table below.

**Environment variables:**

| Variable | Default | What it does |
|---|---|---|
| `POSTGRES_USER` | `loguser` | Database username |
| `POSTGRES_PASSWORD` | `logpassword` | Database password |
| `POSTGRES_DB` | `logs` | Database name |
| `DATABASE_URL` | — | Full connection string the app uses |
| `RETENTION_DAYS` | `30` | Logs older than this get deleted |
| `RETENTION_INTERVAL_MINUTES` | `60` | How often the cleanup job runs |
| `RETENTION_BATCH_SIZE` | `5000` | Max logs deleted per cleanup round |

## API documentation

### `GET /health`

Returns `200 OK` once the database is connected, migrations are applied, and the service can accept logs.

### `POST /logs` — ingest logs

Always accepts a batch (a batch of one is valid).

```bash
curl -X POST http://localhost:8080/logs \
  -H "Content-Type: application/json" \
  -d '{"logs":[{"timestamp":"2026-08-22T12:00:00.000Z","level":"info","service":"checkout","message":"payment declined","attributes":{"user_id":"42","region":"eu-west","retries":3}}]}'
```

**Validation rules**, per entry:
- `timestamp` — required, valid ISO 8601, not more than 5 minutes in the future
- `level` — required, one of `debug` / `info` / `warn` / `error`
- `service` — required, non-empty string
- `message` — required, non-empty string
- `attributes` — optional, flat object only (no nesting or arrays), values must be string/number/boolean

An invalid entry doesn't fail the whole batch. I return which entries were accepted and, for each rejected entry, its index and the reason:
```json
{ "accepted": 9, "rejected": [{ "index": 3, "reason": "invalid level: 'critical'" }] }
```
Returns `200` if at least one entry is accepted. Returns `400` if every entry is rejected, or the request body itself is malformed.

### `GET /logs` — search logs

All parameters are optional and can be freely combined:

| Parameter | Meaning | Example |
|---|---|---|
| `service` | Exact service match | `service=checkout` |
| `level` | Exact level match | `level=error` |
| `since` | Start of time range (inclusive) | `since=2026-07-20T14:00:00Z` |
| `until` | End of time range (exclusive) | `until=2026-07-20T15:00:00Z` |
| `attr.<key>` | Attribute equality | `attr.user_id=42` |
| `q` | Case-insensitive substring match on message | `q=declined` |
| `limit` | Max results, default 100, max 1000 | `limit=500` |
| `cursor` | Opaque cursor from a previous response | `cursor=eyJpZCI6...` |

Results are sorted by `timestamp` descending, with `id` as a tiebreaker so the order is always deterministic, even when logs share a timestamp.

```json
{
  "logs": [{ "id": "1", "timestamp": "...", "level": "error", "service": "checkout", "message": "...", "attributes": {} }],
  "next_cursor": "eyJpZCI6..."
}
```
`next_cursor` is `null` when there's nothing more to page through.

Invalid parameters (bad timestamps, `until` before `since`, unsupported level, non-numeric or out-of-range `limit`, invalid cursor) return `400`:
```json
{ "error": "<description>" }
```

### `GET /logs/aggregate` — summarize logs

Same filters as `GET /logs` (`service`, `level`, `attr.<key>`, `q`), plus:

| Parameter | Required | Meaning |
|---|---|---|
| `since` | Yes | Start of range (inclusive) |
| `until` | Yes | End of range (exclusive) |
| `bucket` | Yes | `1m`, `5m`, `1h`, or `1d` |
| `group_by` | No | `service` or `level` |

```json
{ "buckets": [{ "start": "2026-07-20T14:00:00Z", "group": "checkout", "count": 118 }] }
```
One row per bucket/group combination, ordered by bucket start time ascending. `group` is `null` when `group_by` isn't given. Invalid parameters return `400` in the same format as `GET /logs`.

## Schema design

One table, `logs`:

| Column | Type | Notes |
|---|---|---|
| `id` | `bigserial` | Primary key, also used as a pagination tiebreaker |
| `timestamp` | `timestamptz` | When the log occurred |
| `level` | `text` | `debug` / `info` / `warn` / `error` |
| `service` | `text` | Which service produced the log |
| `message` | `text` | The log message |
| `attributes` | `jsonb` | Arbitrary key/value metadata, nullable |

I kept this deliberately simple: one table, no joins. With the scale and access patterns this service needs (mostly filtered scans over a time range), a single well-indexed table is easier to reason about and faster than normalizing attributes into their own table, which would need a join on every query.

## Index design
 
Four indexes support the query patterns above:
 
1. `(timestamp DESC, id DESC)` — cursor pagination for `GET /logs`.
2. `(service, level, timestamp)` — composite index covering combined service+level+time filters.
3. `(service, timestamp)` — dedicated index for the aggregation query, which filters by service and time but not level.
4. GIN index on `attributes` — see attribute storage strategy below.
## Attribute storage strategy
 
I store `attributes` as a single `jsonb` column rather than a separate key/value table, keeping ingestion simple (one row per log) and matching how the data is queried (`attr.<key>=<value>` filters via `attributes ->> 'key' = 'value'`).
 
**Known limitation:** the GIN index on `attributes` is built for containment queries (`@>`), not the `->>` equality filters currently used, so it doesn't yet accelerate attribute lookups as intended. A future improvement would be to switch to containment-based filtering or add targeted expression indexes for specific keys.

## Retention strategy
 
A background job (`retention.ts`) runs on a timer (`RETENTION_INTERVAL_MINUTES`, default 60) and deletes logs older than `RETENTION_DAYS` (default 30), in batches (`RETENTION_BATCH_SIZE`, default 5000) to avoid holding a long-running lock during active ingestion.
## Load-test methodology

I used the load-testing CLI provided for this project (`logs-benchmark-cli`), which:
1. Seeds 1,000,000 log rows before testing
2. Runs four scenarios in sequence — load, stress, spike, and breakpoint — targeting between roughly 9,750 and 30,000 logs/second depending on the scenario
3. Sends logs in batches of 100 per request
4. Simultaneously fires aggregation queries at 4 requests/second throughout every scenario
5. Checks that aggregated counts reflect ingested logs within a 20-second window

I ran this **4 times back-to-back with identical settings** to check for consistent, trustworthy results rather than relying on a single run, after finding that my local Windows/WSL2 environment was initially producing unreliable, degrading numbers across repeated runs (see below).

```bash
docker compose down -v
npx --yes github:Ahmad-Abbas-Foothill/logs-benchmark-cli --compose ./docker-compose.yml --full --seed 6122026 --runner docker --json benchmark-report.json --generator-cpus 6
```

## Measured performance results

**Test environment:** Windows 11, WSL2, Docker Desktop, 10 CPUs / 6GB RAM allocated to Docker. The benchmark tool measured my machine at roughly **0.25x** the speed of its reference hardware — about 4x slower — so these numbers should be read with that in mind; the same code on faster hardware would likely score higher. The application and database themselves are capped at 0.5 CPU/256MB and 1 CPU/1GB regardless of host machine, per the project's fixed resource limits.

**Dataset size:** 1,000,000 rows seeded before each test.
**Batch size:** 100 logs per ingestion request.
**Ingestion rate:** scenarios target 9,750–30,000 logs/second; I sustained roughly **6,900 logs/second on average** (best single run: 7,657/second) — short of the 15,000/second target.
**Query rate:** 4 aggregation requests/second, sustained throughout ingestion.

**Query latency percentiles (average across 4 runs):**
| Metric | Result |
|---|---|
| Ingestion p95 | ~3.7 seconds |
| Aggregation query p95 | ~13.7 seconds (target: under 1 second) |

**Resource usage:** capped at 0.5 CPU/256MB (app) and 1 CPU/1GB (database) for every run, per the project's fixed limits.

**Overall benchmark score (average of 4 runs, range 59.9–60.8):**
| Category | Result |
|---|---|
| Correctness | 15 / 15, every run |
| Reliability | 20 / 20, every run — no dropped requests, no crashes |
| Performance | ~24 / 50 |
| Queries (aggregate correctness within 20s) | 0–1.5 / 15 |
| **Total** | **~60 / 100** |


## AI usage acknowledgement

I used AI tools (Claude) during development, primarily to accelerate debugging and research — for example, analyzing benchmark output, reviewing my code for potential issues, and researching Docker/WSL2 configuration problems.

All code changes were written and reviewed by me, tested against real before-and-after benchmark results, and reverted when they didn't hold up.
