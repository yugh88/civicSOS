# Architecture

## Contents

1. [The organising idea](#1-the-organising-idea)
2. [System architecture](#2-system-architecture)
3. [Synchronous request flow](#3-synchronous-request-flow)
4. [Asynchronous flow](#4-asynchronous-flow)
5. [Data model](#5-data-model)
6. [The knowledge and rules layer](#6-the-knowledge-and-rules-layer)
7. [The AI boundary](#7-the-ai-boundary)
8. [Security model](#8-security-model)
9. [Failure handling](#9-failure-handling)
10. [Scalability](#10-scalability)
11. [Tradeoffs](#11-tradeoffs)
12. [Extending the knowledge layer](#12-extending-the-knowledge-layer)

---

## 1. The organising idea

One decision shapes everything else: **the model helps with language; the rules
engine owns the workflow.**

A civic tool that lets a language model decide which government department
handles a sewage overflow is not a product, it is a liability. So the system is
built as a deterministic core with a narrow, optional AI seam bolted to its front:

```
        ┌─────────────────────────────────────────────┐
        │  Deterministic core                         │
        │  · category knowledge                       │
        │  · authority + resolution paths             │
        │  · evidence requirements                    │
        │  · response windows, follow-up dates        │
        │  · escalation policy                        │
        │  · status machine                           │
        │  · authorization                            │
        └───────────────▲─────────────────────────────┘
                        │ validated, reconciled facts
        ┌───────────────┴─────────────────────────────┐
        │  AI seam (optional, time-boxed, replaceable)│
        │  · which of our fixed categories            │
        │  · a neutral one-line summary               │
        │  · tidier prose for the letter              │
        │  · what the citizen forgot to mention       │
        └─────────────────────────────────────────────┘
```

Remove the AI seam entirely and CivicSOS still works. That is the test the
architecture is designed to pass, and it is enforced by tests rather than by
good intentions.

The second organising decision is **ports and adapters**. `@civicsos/core`
contains the whole application — domain, validation, knowledge, rules, services,
HTTP router — and imports no AWS SDK. Infrastructure implements interfaces the
core declares.

```
packages/infra  ──depends on──▶  packages/aws  ──depends on──▶  packages/core
apps/web        ────────────────────────────depends on────────▶  packages/core
```

Consequences worth the cost:

- The whole test suite runs in under a second against in-memory adapters, with
  no mocking framework and no emulator.
- `npm run dev` serves a fully working product with no AWS account.
- The Lambda handler is ~60 lines of event translation.
- Swapping DynamoDB for something else is an adapter, not a rewrite.

---

## 2. System architecture

```
 ┌──────────────┐
 │   Browser    │  Next.js 15 App Router, React 18, Tailwind v4
 │              │  light mode only, mobile-first
 └──────┬───────┘
        │  ① Cognito SRP sign-in (password never transmitted)
        │     or POST /auth/guest for a demo session
        │  ② all API calls: Authorization: Bearer <token>
        ▼
 ┌──────────────────────────────────┐
 │  AWS Amplify Hosting             │  static + SSR, CDN, TLS
 └──────────────────────────────────┘
        │
        ▼
 ┌──────────────────────────────────┐
 │  API Gateway — HTTP API          │  CORS allow-list, 10 rps / 20 burst
 └──────────────┬───────────────────┘
                ▼
 ┌────────────────────────────────────────────────────────┐
 │  Lambda: civicsos-<stage>-api      arm64, Node 22      │
 │                                                        │
 │   createRouter()            ← cross-cutting concerns   │
 │     ├─ correlation id                                  │
 │     ├─ body size cap (64 KB) before parsing            │
 │     ├─ JSON parse + content-type check                 │
 │     ├─ auth resolution (Cognito JWT | guest HMAC)      │
 │     ├─ route match                                     │
 │     └─ error → safe envelope + security headers        │
 │                                                        │
 │   buildRoutes()             ← per-route zod validation │
 │     └─ CaseService / EvidenceService / AdminService    │
 │          └─ authorization → rules engine → ports       │
 └───┬──────────────┬──────────────┬─────────────────────┘
     │              │              │
     ▼              ▼              ▼
 DynamoDB       S3 bucket     EventBridge bus
 single table   private       civicsos-<stage>-events
 3 GSIs         SSE-S256           │
 TTL enabled    lifecycle          ├──▶ Lambda: events    (notifications, audit)
                rules              └──▶ Lambda: scheduler (daily 02:30 UTC sweep)

 SSM Parameter Store (SecureString)  ← read once per container at cold start
 Gemini free tier                    ← 8 s budget, 1 retry, schema-constrained
 CloudWatch Logs + 3 alarms
```

### Why one API Lambda rather than one per route

The modular boundary that matters is in the code — router, services, rules,
knowledge, ports — and it is already there. Splitting the deployment into a
dozen functions would add a dozen cold starts, a dozen IAM roles, a dozen log
groups and a dozen sets of environment configuration, in exchange for no
additional isolation that this product needs. The two functions that *are*
separate are separate for real reasons: the event consumer and the scheduler have
different failure semantics, different retry behaviour, different timeouts and a
different trigger.

---

## 3. Synchronous request flow

Worked example: `POST /cases/analyze`, the most interesting path.

```
1  Browser      POST /cases/analyze  { description, location? }
                Authorization: Bearer <token>
                x-request-id: <optional, validated against ^[A-Za-z0-9_-]{6,64}$>

2  API Gateway  CORS preflight already answered from the allow-list.
                Stage throttle: 10 rps sustained, 20 burst, account-wide.

3  Router       · correlation id: inbound if well-formed, else generated
                · reject >64 KB before allocating a parse
                · require application/json
                · resolve identity:
                    guest token?   HMAC-SHA256 verify, constant-time compare
                    Cognito token? aws-jwt-verify: signature, iss, aud, exp,
                                   token_use=id (an access token is refused —
                                   it carries no group claims)
                  → AuthContext { userId, role, email?, requestId }
                · match route  →  POST /cases/analyze

4  Validation   analyzeRequestSchema (zod). Parsing and normalization are the
                same step: every string field sanitizes during parse, so a
                handler cannot forget to sanitize. Coordinates are rounded to
                ~1 km at this boundary, so nothing downstream can persist a
                precise position.

5  Service      CaseService.analyze
                · per-user rate limit (10/min) — this is the only endpoint that
                  can cost money, so it carries its own allowance on top of the
                  gateway throttle. A denial is audited.
                · runAnalysis(...)

6  AI pipeline  · scrubInjection   → neutralize override phrases
                · minimizeForAi    → strip phone/email/gov-id/house number
                · classifyDeterministic (always runs: fallback AND cross-check)
                · Gemini, 8 s budget, ≤2 attempts, temperature 0.1,
                  responseMimeType=application/json + responseSchema
                · parseAiAnalysis  → balanced-brace extraction, then zod
                · reconcileCategory → see §7
                · urgency = max(rules, model)

7  Rules        buildResolutionPlan(...)  — authority, evidence checklist,
                timeline with exactly one CURRENT step, response windows,
                follow-up date, escalation ladder, submission channels,
                disclaimer.
                buildComplaintDraft(...) — deterministic template; unknown
                values remain visible [[TOKENS]] rather than being invented.

8  Audit        One immutable record: actor, action, resource, outcome,
                requestId. Best-effort: a failed audit write is logged at error
                level but never fails the citizen's request.

9  Response     200 + { analysis, meta }.
                `meta` carries only honest, non-sensitive diagnostics — enough
                for the UI to say "AI unavailable, used our own rules" and to
                show which PII classes were stripped.
                Security headers on every response, `cache-control: no-store`
                because responses are per-user.
```

Every other endpoint is the same shape with a different service call. The
cross-cutting concerns exist exactly once.

### Evidence: the three-step upload

File bytes never pass through Lambda or API Gateway. This is a cost decision (no
compute time spent proxying megabytes, and API Gateway caps payloads at 10 MB
anyway) and a security decision (the pre-signed policy pins content type and
length).

```
1  POST /cases/{id}/evidence
     → authorization check, per-case cap (6 files), size cap (8 MB)
     → storage key derived server-side from ids only:
         cases/{ownerId}/{caseId}/{evidenceId}.{ext}
       The client's filename never reaches the key, so it cannot traverse paths
       or collide. A file named "../../../etc/passwd" is stored as
       "cases/<owner>/<case>/ev_xxx.png" — verified by test.
     → pre-signed PUT (ContentType + ContentLength signed), 5 min
     → row written with confirmed: false

2  PUT <pre-signed URL>          browser → S3 directly
     The signature covers the headers, so the upload must match what the server
     approved.

3  POST /cases/{id}/evidence/confirm
     → HeadObject: does it actually exist? wrong size ⇒ delete and reject
     → confirmed: true, evidenceCount recomputed, timeline event, domain event

Reads: GET /cases/{id}/evidence issues a fresh 5-minute pre-signed GET per item,
after the case-level authorization check. The storage key is never returned to
the client.
```

---

## 4. Asynchronous flow

The rule: **nothing the citizen is waiting for happens asynchronously, and
nothing asynchronous can fail their request.**

```
CaseCreated ─────────▶ EventBridge ─────▶ Lambda: events
                       (civicsos bus)      └─ in-app "we'll remind you" notification

CaseSubmitted   ─┐
CaseStatusChanged├───▶ EventBridge ─────▶ Lambda: events
EvidenceAdded    │                         └─ immutable audit record (actor: system)
CaseResolved     │
EscalationAvailable ─┘

EventBridge schedule ─▶ Lambda: scheduler ─▶ ReminderService.sweep()
cron(30 2 * * ? *)                            · query the sparse follow-up index
02:30 UTC = 08:00 IST                          · notification + timeline event
                                               · escalation suggestion if unlocked
                                               · push followUpAt forward
```

### Why a daily sweep rather than a timer per case

A per-case schedule (EventBridge Scheduler, Step Functions, or a DynamoDB TTL
trigger) means one schedule per case: thousands of resources, each of which can
drift out of sync with the case it refers to when the case is edited or resolved.

One scheduled invocation per day plus a bounded query is ~365 invocations a year
instead of one per case, and — more importantly — the due set is **derived from
the cases themselves on every run**, so it cannot go stale. Resolving a case
clears `followUpAt`, which removes it from the sparse index, which means a
resolved case can never generate another reminder. That is an invariant, not a
cleanup job.

### Idempotency of the sweep

Each swept case has its follow-up date pushed forward (2–10 days depending on
urgency), so re-running the sweep the same day does nothing. Verified by test.
A single failing case is logged and skipped; the sweep continues.

### Why in-app notifications only

Email needs SES (domain verification, a sandbox exit request) and SMS costs real
money per message. Neither is free, and an unread in-app reminder is honest about
what actually happened. `NotificationRecord` carries a DynamoDB TTL so the table
cannot grow without bound.

---

## 5. Data model

**One DynamoDB table.** Every access pattern the application needs is a `GetItem`
or a `Query`. There is no `Scan` in any normal flow.

### Key layout

| Entity | PK | SK | Notes |
| --- | --- | --- | --- |
| Case | `CASE#<caseId>` | `META` | |
| CaseEvent | `CASE#<caseId>` | `EVT#<eventId>` | append-only |
| Evidence | `CASE#<caseId>` | `EVD#<evidenceId>` | |
| User | `USER#<userId>` | `PROFILE` | |
| Notification | `USER#<userId>` | `NTF#<notificationId>` | TTL |
| Idempotency | `IDEMP#<owner>#<key>` | `META` | TTL 24 h |
| Audit | `AUDIT#<YYYY-MM-DD>` | `<auditId>` | TTL 400 d, immutable |
| PointsEntry | `USER#<userId>` | `PTS#<entryId>` | Ledger |
| PointsDedupe | `USER#<userId>` | `PTSKEY#<dedupeKey>` | Award idempotency marker |
| Redemption | `USER#<userId>` | `RDM#<redemptionId>` | |

A case and everything belonging to it share a partition, so the case detail
screen — case, timeline, evidence — is a handful of queries against one
partition rather than a fan-out across tables.

### Indexes

| Index | PK | SK | Serves |
| --- | --- | --- | --- |
| `gsi1` | `OWNER#<ownerId>` | `<createdAt>#<caseId>` | "My cases", newest first |
| `gsi2` | `STATUS#<status>` | `<createdAt>#<caseId>` | Staff queues, admin aggregates |
| `gsi3` | `FOLLOWUP#<dueDay>` | `<followUpAt>#<caseId>` | The daily reminder sweep |

`gsi3` is the one worth explaining. It is **sparse**: index keys are written only
for cases that are open *and* have a follow-up date. A resolved case has its
`gsi3` attributes explicitly removed, not left stale.

It is also partitioned by **due day**, not by a constant. A single `DUE`
partition would be a textbook hot partition and would grow unboundedly. Keying
on the due date spreads writes across days and makes the sweep a small number of
small queries: it walks back at most 14 days from now, stopping early once the
batch limit is reached. The lookback exists only to survive missed schedules —
because each sweep pushes dates forward, a case cannot normally sit more than a
day past due.

### Access patterns

| Pattern | Operation | Cost |
| --- | --- | --- |
| Get a case | `GetItem` PK=`CASE#id` SK=`META` | 1 RCU |
| Case timeline | `Query` PK=`CASE#id`, `begins_with(sk,'EVT#')` | 1 partition |
| Case evidence | `Query` PK=`CASE#id`, `begins_with(sk,'EVD#')` | 1 partition |
| My cases (paged) | `Query` gsi1, `ScanIndexForward=false` | 1 partition |
| My cases filtered by status | same + `FilterExpression` | filter on an already-narrow partition |
| Staff queue by status | `Query` gsi2 | 1 partition |
| Admin aggregates | 7 bounded `Query` on gsi2 (50 each) | bounded, never a scan |
| Cases due for follow-up | ≤15 bounded `Query` on gsi3 | bounded |
| My notifications | `Query` PK=`USER#id`, `begins_with(sk,'NTF#')` | 1 partition |
| My points ledger | `Query` PK=`USER#id`, `begins_with(sk,'PTS#')` | 1 partition |
| My redemptions | `Query` PK=`USER#id`, `begins_with(sk,'RDM#')` | 1 partition |
| Award points | `TransactWriteItems` (entry + marker) + `UpdateItem ADD` | 3 WCU |
| Audit for a day | `Query` PK=`AUDIT#<day>` | 1 partition |
| Create case idempotently | `TransactWriteItems` (case + marker), both conditional | 2 WCU |

The admin dashboard is deliberately an *approximation* built from bounded pages,
and the UI says so. An exact global count would need either a scan or a counter
aggregate; neither is worth its cost for a dashboard nobody bills on.

### Idempotency

Case creation writes the case row and an idempotency marker in a single
`TransactWriteItems`, each with `attribute_not_exists(pk)`. A retry — a
double-tapped button, a client retry after a timeout — fails the condition, at
which point the marker is read and the existing case is returned with
`created: false`. There is no window in which a marker exists without its case.

The client supplies the key; the web app derives a stable one from the
description text, so two taps on "Create my case" for the same problem cannot
produce two cases.

### Civic Points

Points are the one feature where the obvious implementation is wrong. A balance
held as a single mutable number invites two failures: a replayed request awards
twice, and two concurrent awards race and lose one. Both are exploitable.

The design instead treats points as an append-only ledger with a cached balance:

```
award(reason, caseId)
  ├─ TransactWriteItems, both conditional on not existing:
  │    · PTS#<entryId>          the ledger entry
  │    · PTSKEY#<reason>#<case> the dedupe marker
  │  → condition fails ⇒ already awarded ⇒ return, bump nothing
  └─ UpdateItem  ADD civicPoints :d, lifetimePoints :d
       atomic increment, not read-modify-write
```

Three consequences worth stating:

- **A reason can be earned at most once per case.** The dedupe key is
  `<reason>#<caseId>`, so however many times the triggering request is replayed,
  the marker already exists.
- **Duplicate reports cannot mint points.** Case creation is already idempotent
  on the client's key, and the award is keyed to the resulting case id — so
  resubmitting the same report returns the same case and awards nothing.
- **Spending never demotes.** `civicPoints` is the spendable balance;
  `lifetimePoints` only ever increases and is what drives the citizen level.

Amounts live in `rules/points.ts` and are never read from a request body. The
profile endpoint explicitly re-writes the server-owned counters when handling a
`PATCH /me`, so a client cannot set its own balance through a profile edit —
there is a test for exactly that.

The reward catalogue is knowledge-layer data with the same honesty flag pattern
as the authority records: `isSampleCatalog: true` on every shipped entry,
rendered as a visible "Demo catalogue" notice, with redemption issuing an
obviously-fake `DEMO-` code. A real deployment replaces the records and one
`issueCode` function; no commerce API is involved at any point.

### Guest data lifecycle

Demo sessions write real rows. The DynamoDB adapter — not the domain model —
stamps a 2-day TTL on any row whose owner id starts with `guest_`, and S3 has a
matching lifecycle rule on the `cases/guest_` prefix. Demo traffic therefore
cleans itself up and cannot accumulate cost. Keeping this policy in the adapter
is deliberate: a `ttl` field has no business in the domain model.

### Timestamps and retention

All persisted timestamps are ISO-8601 UTC strings; TTLs are Unix seconds because
DynamoDB requires that. Case event ids are `<ISO timestamp>#<sequence><random>`,
where the sequence is a process-monotonic counter — without it, two events
appended in the same millisecond would sort by a random suffix and a timeline
could render "resolved" before "escalated". That was a real bug, caught by the
workflow test, and the counter is the fix.

Retention: audit records 400 days, notifications 60 days, guest data 2 days
(ledger and redemptions included), idempotency markers 24 hours, CloudWatch logs
7 days. Real citizen cases are
kept until deleted — a case history is the artefact a citizen quotes back to an
authority, so expiring it would defeat the product.

### Expected scale

Sized for a hackathon deployment and a plausible first year: single-digit
thousands of cases, tens of thousands of requests a month. Every figure is
comfortably inside the DynamoDB on-demand and Lambda free tiers. Nothing in the
design changes shape at 100× — the same queries, the same partitions — except
that `gsi2`'s per-status partitions would eventually want date-based sharding for
the admin view.

---

## 6. The knowledge and rules layer

Four files hold everything CivicSOS claims to know, and none of them contains
application logic:

- `knowledge/categories.ts` — categories, keywords, strong signals, hazard
  signals, default urgency.
- `knowledge/authorities.ts` — authority templates and submission channels, each
  flagged `isSample` with a `sourceNote`.
- `knowledge/resolution-paths.ts` — per category: the requested action, evidence
  requirements, acknowledgement and resolution windows, the escalation ladder,
  what happens after submission, and the complaint template.
- `rules/` — pure functions over that data.

### The rules

| Module | Responsibility |
| --- | --- |
| `classify.ts` | Keyword scoring with whole-word matching, urgency assessment, reconciliation with the model |
| `complaint.ts` | Template filling; unknown values stay as visible `[[TOKENS]]` |
| `followup.ts` | Follow-up dates, escalation availability, next-escalation dates |
| `resolution.ts` | Assembles the full plan and the timeline |
| `status.ts` | The status machine |

All pure, all synchronous, all trivially testable. `computeFollowUpDate(case)`
given the same case always returns the same date — which matters because a
citizen quoting a deadline needs it to be defensible, not generated.

### Two invariants worth naming

**Urgency can only go up.** `urgency = max(deterministic, model)`. A complaint
mentioning a live wire comes out `CRITICAL` whatever any model says. Tested.

**The timeline is monotonic.** A step is `DONE` only if it and every step before
it are done; the first incomplete step is `CURRENT`; the rest are `UPCOMING`.
Without this invariant a case could show "do this now" on step 2 while steps 3
and 4 showed as complete — which it did, until the test that now enforces it.

### The status machine

```
DRAFT ──────────▶ READY_TO_SUBMIT ──▶ SUBMITTED ──▶ AWAITING_RESPONSE ──▶ ESCALATED
  │                     │                 │                 │                 │
  └─────────────────────┴─────────────────┴─────────────────┴─────────────────┤
                                                                              ▼
                                                        RESOLVED / CLOSED_UNRESOLVED
```

Explicit transitions, validated server-side on every write. `RESOLVED` is
terminal. `CLOSED_UNRESOLVED` can only reopen into `ESCALATED` — a citizen who
gave up may later escalate, but cannot rewind to a draft.

Draft promotion is derived, not asserted: filling the last `[[TOKEN]]` in a
complaint moves `DRAFT → READY_TO_SUBMIT`, and the placeholder list is
recomputed on every edit, so "ready to submit" is never a lie.

---

## 7. The AI boundary

### The contract

Gemini is asked for a JSON object with a fixed shape and nothing else. It is
constrained three ways: `responseMimeType: application/json`, a
`responseSchema`, and `temperature: 0.1`. Output is then parsed defensively —
code-fence stripping, then a balanced-brace scan that respects strings and
escapes — and validated with zod, where every string field sanitizes during
parsing.

What the schema deliberately does **not** contain: authority, evidence
requirements, response windows, escalation policy, permissions, status. A model
cannot influence those because there is nowhere for it to say anything about
them.

### Reconciliation

| Keyword classifier | Model | Outcome |
| --- | --- | --- |
| Confident, agrees | agrees | Use it, confidence boosted |
| Found nothing | says X | Trust the model (this is what it is good at) |
| Confident | says `OTHER` | Keep the keyword category |
| Confident (≥0.6) | disagrees | Keep the keyword category, **ask the citizen to confirm** |
| Not confident | disagrees | Use the model's, **ask the citizen to confirm** |

Routing a sewage complaint to the roads department is worse than one extra tap.

### Injection resistance, in layers

1. **Neutralize** known override phrases in the user's text (`[removed]`), before
   PII minimization — so a redaction token cannot be used to smuggle a payload.
2. **Strip** zero-width and bidi-override characters, the classic way to hide
   instructions inside innocent-looking text.
3. **Fence** the citizen's text in `<citizen_report>` tags, with any attempt to
   close the tag early removed.
4. **Instruct** the model that the fenced block is untrusted data.
5. **Validate** the output against the schema regardless.
6. **Constrain** what the output can influence at all.

Layers 1–4 are best-effort. Layers 5 and 6 are the actual guarantee: the worst a
successful injection achieves is a wrong category — which reconciliation is
likely to catch and the citizen can correct — and it can never reach
authorization, the database, escalation policy, or another user's data.

### Failure modes, all tested

| Failure | Behaviour |
| --- | --- |
| No API key | Deterministic classification; the UI never mentions AI |
| Timeout (>8 s) | One retry, then deterministic; `usedFallback: true` |
| 429 rate limit | One retry with backoff, then deterministic |
| 5xx | One retry, then deterministic |
| Non-JSON prose | Rejected by the parser, deterministic |
| Truncated JSON | Rejected by the parser, deterministic |
| Invented category | Rejected by zod, deterministic |
| Safety block | Deterministic |
| Urgency downgrade attempt | Overruled by `max()` |

The UI shows an honest amber note when a fallback happened. Silent degradation
would be worse than the failure.

---

## 8. Security model

Full treatment in [SECURITY.md](SECURITY.md). The architectural shape:

- **Two identity sources, one `AuthContext`.** Cognito ID tokens for accounts;
  short-lived HMAC-signed guest tokens for the demo. Everything downstream is
  identical, so there is no "demo mode" code path to get wrong.
- **Roles come from `cognito:groups`,** set by an administrator. A role in a
  request body is ignored — the profile endpoint writes the role from the token,
  never from the payload. Tested.
- **Authorization lives in one module** (`services/authorization.ts`) and is
  called from the service layer, which every HTTP route goes through. There is no
  path to data that skips it.
- **Another user's case returns 404, not 403.** A 403 would confirm the id
  exists, leaking the existence of other citizens' cases to anyone enumerating.
- **Least-privilege IAM.** The API function is the only one with S3 access and
  the only one that can publish events. SSM read is scoped to
  `/civicsos/<stage>/*`, and `kms:Decrypt` is conditioned on
  `kms:ViaService = ssm.<region>.amazonaws.com`.
- **The evidence bucket is fully private:** block-all-public-access, TLS
  enforced, bucket-owner-enforced ownership, SSE-S3, no website hosting. Access
  is only ever a short-lived pre-signed URL issued after an authorization check.
- **Logs are scrubbed at the logger,** not at each call site: every field passes
  through `redactForLogs`, so `logger.info('x', { case })` cannot leak an email.

---

## 9. Failure handling

| Failure | Blast radius | Behaviour |
| --- | --- | --- |
| Gemini unavailable | None | Deterministic fallback, honest UI note |
| DynamoDB throttled | The one request | SDK retries, then a safe 500 with a request id |
| Case vanished mid-update | The one request | Conditional update fails → 404 "no longer exists" |
| S3 upload abandoned | None | Never confirmed, never counted; lifecycle reaps the object |
| EventBridge publish fails | None | Logged at error level, request still succeeds |
| Events consumer fails | Notification is late | EventBridge retries twice, then the alarm fires |
| Scheduler fails | Reminders late by a day | Alarm fires; the next sweep's 14-day lookback catches up |
| SSM unavailable at cold start | Degraded, not down | Deterministic-only mode, demo disabled, error logged |
| Bad guest secret | Demo disabled | Refused at init rather than signing weak tokens |
| Unhandled exception | The one request | Generic 500 + request id; full detail only in logs |

Two principles run through that table. **Async work is never part of the
citizen's transaction** — publishing, auditing and notifying are best-effort and
swallow their own failures. And **the request path fails closed but informative**:
the client gets a message safe to display and a request id to quote; the internals
go to CloudWatch.

---

## 10. Scalability

| Component | Behaviour under load | First ceiling |
| --- | --- | --- |
| Amplify Hosting | CDN-cached | None practical |
| API Gateway | Throttled at 10 rps / 20 burst | Raise the stage limits |
| Lambda API | Concurrent scaling | Account concurrency; reserve if needed |
| DynamoDB | On-demand adapts | `gsi2`'s per-status partitions would want date sharding |
| S3 | Effectively unbounded | None |
| Gemini free tier | Quota-limited | Per-user limiter + graceful fallback already absorb it |
| Reminder sweep | 100 cases per run | Raise the cap, or shard the sweep by day |

The deliberate bottleneck is API Gateway throttling, and it is there because on a
free-tier account an unthrottled endpoint is a billing risk long before it is a
capacity problem.

The per-user AI rate limiter is **per Lambda container**, not global — each
container has its own memory. That is a known and accepted approximation: the
gateway throttle is the global control, and this is a cheap extra guard on the
one endpoint with an external quota. A global limiter would need a DynamoDB
counter on the hot path, which costs a write per analyze request to solve a
problem the gateway already bounds.

---

## 11. Tradeoffs

**Single-table DynamoDB over relational.** Bought: no idle cost, no connection
pooling from Lambda, no VPC, no NAT gateway, predictable single-digit-ms reads.
Paid: keys and indexes must be designed up front, and ad-hoc queries are not
possible. Right call — the access patterns are few and known, and RDS or a NAT
gateway would each cost more per month than everything else here combined.

**One API Lambda over one per route.** Bought: one cold start, one role, one log
group, tiny bundle. Paid: no per-route isolation or per-route scaling. Right
call for this size; the code is modular where modularity pays.

**Authorization in the Lambda, not a JWT authorizer.** Bought: one fully-tested
code path for both Cognito and guest tokens, and 404-not-403 semantics that a
gateway authorizer cannot express. Paid: every request pays JWT verification
(cached JWKS, so microseconds after the first).

**In-memory adapters for local dev.** Bought: the product runs with no AWS
account, and the test suite is sub-second. Paid: a second implementation of each
port. Mitigated by making them enforce the same constraints as the real ones —
idempotency, conditional updates, pagination, grant expiry, content-type checks —
so a bug shows up locally rather than only after deployment.

**Guest demo sessions with their own data.** Bought: a judge sees the entire
product in one click, with zero risk of touching real data. Paid: extra seeding
writes per session. Bounded by the 2-day TTL.

**Browser-stored tokens.** The guest token is in `sessionStorage` (dies with the
tab); Cognito's refresh token is in `localStorage` where its library puts it, and
the ID token is held in memory. Properly, these belong in httpOnly cookies behind
a server session layer. That is a real, named gap in [SECURITY.md](SECURITY.md)
rather than a pretence.

**`'unsafe-inline'` in the page CSP.** Next injects inline critical CSS and a
bootstrap script. Moving to a nonce-based policy needs middleware and is noted as
future work; the policy is otherwise strict — `object-src 'none'`,
`base-uri 'none'`, `frame-ancestors 'none'`, and a `connect-src` allow-list.
Development additionally allows `'unsafe-eval'` because the dev bundler evaluates
modules with `eval`; production never gets it.

**In-app notifications only.** Email needs SES and a sandbox exit; SMS costs per
message. Both were out of scope for a free-tier build, and an unread in-app
reminder does not pretend to be an email that was never sent.

**Gamification kept deliberately quiet.** Points, one progress bar and four level
names — no streaks, no badge wall, no confetti. The risk with rewarding civic
reporting is incentivising volume over usefulness, so the largest award is for a
problem being *resolved*, not for filing one. A tool that turns complaints into a
scoring game would flood authorities and discredit the genuine reports.

**A placeholder reward catalogue rather than real partners.** Naming brands that
have not agreed to anything would be the single most damaging thing this project
could ship, so the catalogue is fictional, flagged in the data, badged in the UI,
and issues codes prefixed `DEMO-`.

**Approximate admin aggregates.** Bounded queries instead of exact counts. The
dashboard says so on the page.

---

## 12. Extending the knowledge layer

Adding a category is a data change:

1. Add a `CategoryRecord` to `knowledge/categories.ts` — label, description,
   emoji, keywords, strong signals, default urgency, hazard signals.
2. Add the id to `CATEGORY_IDS` in `domain/types.ts`. Because the AI schema is
   generated from that array, the model can now return it — and still cannot
   return anything else.
3. Add a `ResolutionPath` to `knowledge/resolution-paths.ts` — authority,
   requested action, evidence, windows, escalation ladder, after-submission
   steps, complaint template.
4. Add an `AuthorityRecord` if no existing one fits, respecting the honesty
   policy documented at the top of that file: generic templates are marked
   `isSample: true`; only genuinely official channels are marked `false`.

No changes to services, routes, the UI, or the infrastructure. The category
picker, the classifier, the plan builder and the admin breakdown all read from
the same records.

**Replacing the generic templates with a verified directory** is the obvious next
step for a real deployment. The `AuthorityRecord` shape already carries
`isSample` and `sourceNote` for exactly this: load verified city-level records
into the Authority table, mark them `isSample: false`, and the UI's "Generic
guidance" badge becomes "Official channel" with no code change.
