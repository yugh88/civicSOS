# API reference

Base URL: the API Gateway endpoint from the stack outputs, or `http://localhost:3000/api`
in local development.

A generated OpenAPI 3.1 document lives at [docs/openapi.json](docs/openapi.json).
It is produced from the server's own route table (`npm run openapi`), and CI fails
if it is stale — so it cannot drift from the implementation.

---

## Conventions

### Authentication

Every endpoint except `GET /health`, `GET /knowledge/categories` and
`POST /auth/guest` requires:

```
Authorization: Bearer <token>
```

where the token is either a Cognito **ID** token (not an access token — it carries
no group claims) or a guest demo token from `POST /auth/guest`.

### Correlation

Send `x-request-id` (matching `^[A-Za-z0-9_-]{6,64}$`) to correlate your logs with
the server's. If you don't, one is generated and returned in error bodies.

### Errors

Every non-2xx response has exactly this shape:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Some details need fixing before we can continue.",
    "issues": [{ "field": "description", "message": "Tell us a little more — at least a sentence about what happened." }],
    "requestId": "req_0mu5wvo7uv3wnz9g4"
  }
}
```

`message` is always safe to show an end user. Internal detail never crosses the
boundary; it goes to CloudWatch against `requestId`.

| Code | Status | Meaning |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | Malformed request, or an unsupported method for that path |
| `UNAUTHENTICATED` | 401 | No token, or the token is invalid or expired |
| `FORBIDDEN` | 403 | Authenticated but not permitted |
| `NOT_FOUND` | 404 | No such resource — **also returned for a resource owned by another user** |
| `CONFLICT` | 409 | The action is not valid in the current state |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Body was not declared `application/json` |
| `PAYLOAD_TOO_LARGE` | 413 | Body over 64 KB, or a file over 8 MB |
| `VALIDATION_FAILED` | 422 | Schema validation failed; `issues` names the fields |
| `RATE_LIMITED` | 429 | Per-user allowance exceeded |
| `INTERNAL` | 500 | Unexpected failure |

> **404 vs 403.** Another user's case returns 404. A 403 would confirm the id
> exists, disclosing the existence of other citizens' cases to anyone enumerating.

### Limits

| Limit | Value |
| --- | --- |
| Request body | 64 KB |
| Description | 12–4000 characters |
| Complaint body | 6000 characters |
| Evidence file | 8 MB; JPEG, PNG, WebP, HEIC or PDF |
| Evidence per case | 6 |
| `POST /cases/analyze` | 10 per user per minute |
| Gateway throttle | 10 rps sustained, 20 burst |

---

## Endpoints

### `GET /health` · public

```json
{ "status": "ok", "stage": "dev", "time": "2026-09-17T19:13:36.404Z", "aiConfigured": true }
```

### `GET /knowledge/categories` · public

Category catalogue, status labels with citizen-facing hints, and the knowledge
disclaimer. Used by the category picker.

### `POST /auth/guest` · public · 201

Starts a sandboxed demo session with its own private copy of the demo cases.
Returns 403 when the demo is disabled or no guest secret is configured.

```json
{
  "token": "eyJ1c2VySWQiOi...",
  "userId": "guest_1QogjZuoc2UDXJgm",
  "expiresAt": "2026-09-18T01:13:46.000Z",
  "expiresInSeconds": 21600,
  "seededCases": 4,
  "isDemo": true
}
```

---

### `POST /cases/analyze`

The core endpoint: understand a described problem and return a complete
resolution plan. Rate-limited, because this is the only endpoint that can cost
money.

```json
{
  "description": "There has been garbage outside my apartment for 4 days and it smells terrible.",
  "location": { "locality": "12th Main, Indiranagar", "city": "Bengaluru" },
  "categoryId": "GARBAGE_SANITATION",
  "hasPhoto": false,
  "skipAi": false
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `description` | yes | 12–4000 characters |
| `location` | no | `locality`, `city`, `state`, `pincode`, `lat`, `lng`, `source`. Coordinates are rounded to ~1 km on receipt |
| `categoryId` | no | Set when the citizen picked it; treated as authoritative |
| `hasPhoto` | no | Pre-satisfies the photo requirement in the checklist |
| `skipAi` | no | Forces the deterministic path. Useful for demos and tests |

Response:

```json
{
  "analysis": {
    "categoryId": "GARBAGE_SANITATION",
    "categoryLabel": "Garbage & sanitation",
    "urgency": "MEDIUM",
    "summary": "Uncollected household waste has been accumulating outside a residential building for several days.",
    "missingInformation": ["the street name", "the ward number"],
    "suggestedEvidence": ["a wide photo showing a nearby landmark"],
    "complaint": {
      "subject": "Complaint: uncollected garbage at 12th Main, Indiranagar, Bengaluru",
      "body": "To the Sanitation / Solid Waste Management Department,\n...",
      "placeholders": ["SINCE_WHEN", "YOUR_NAME", "YOUR_CONTACT"],
      "provenance": "AI_ASSISTED",
      "editedByUser": false
    },
    "plan": { "...": "see below" },
    "classifiedBy": "AI_ASSISTED",
    "usedFallback": false,
    "needsCategoryConfirmation": false
  },
  "meta": {
    "usedFallback": false,
    "aiAttempted": true,
    "piiRemoved": ["phone number"],
    "injectionDetected": false
  }
}
```

**`placeholders`** are `[[TOKEN]]` markers left deliberately in the letter. CivicSOS
does not invent a value it was not given; the UI highlights them for the citizen
to fill in.

**`usedFallback: true`** means the AI was unavailable or returned something
unusable and the deterministic rules produced this plan instead. The plan is
complete either way; the UI shows an honest note.

**`needsCategoryConfirmation: true`** means the classifier and the model disagreed,
or neither was confident. Ask the citizen rather than routing the complaint to the
wrong department.

#### The `plan` object

The "What happens next?" answer:

| Field | Meaning |
| --- | --- |
| `authority` | `{ name, jurisdictionLevel, scope, channels[], isSample, sourceNote }` |
| `requestedAction` | What the citizen is asking the authority to do |
| `evidence[]` | `{ key, label, description, required, satisfied }` |
| `steps[]` | Timeline: `{ key, title, detail, owner, status, dueAt? }`. `status` is `DONE`/`CURRENT`/`UPCOMING`, monotonic, with exactly one `CURRENT` |
| `expectedAcknowledgementDays` | Typical acknowledgement window (guidance, not a legal guarantee) |
| `expectedResolutionDays` | Typical resolution window |
| `followUpAt` | Computed follow-up date |
| `afterSubmission[]` | What happens once it is filed |
| `escalation[]` | Remaining ladder: `{ level, title, detail, afterDays, authorityHint? }` |
| `submissionChannels[]` | `{ kind, label, url?, value?, isSample, note? }` |
| `disclaimer` | The honesty statement shown with every plan |

> **`isSample`** is the honesty flag. `true` means a generic template describing
> the *type* of body that handles this — no invented phone number or city URL.
> `false` means a genuinely official, nationally available channel. The UI renders
> these as "Generic guidance" and "Official channel".

---

### `POST /cases` · 201

Create a tracked case.

```json
{
  "description": "The street light outside our gate has not worked for three weeks.",
  "summary": "Optional one-liner for list views",
  "categoryId": "STREETLIGHT",
  "location": { "locality": "Sector 21", "city": "Gurugram" },
  "complaint": { "subject": "...", "body": "..." },
  "facts": {
    "sinceWhen": "three weeks",
    "reporterName": "Alice",
    "reporterContact": "alice@example.invalid"
  },
  "idempotencyKey": "draft-1f2a9c"
}
```

- `location` is required. `complaint` is optional — omit it and the deterministic
  template is used, filled from `facts`.
- **`idempotencyKey`** (3–80 chars of `[A-Za-z0-9_-]`) makes creation safe to
  retry. The same key from the same user returns the existing case with
  `created: false`.
- `urgency` in the body is ignored for citizens; it is re-derived from the
  description server-side.

```json
{
  "case": { "caseId": "case_0mu5wvurdb530vm2n", "status": "READY_TO_SUBMIT", "...": "..." },
  "created": true,
  "pointsAwarded": 60,
  "awards": [{ "reason": "REPORT_CREATED", "delta": 50 }, { "reason": "COMPLETE_INFORMATION", "delta": 10 }]
}
```

A replayed creation returns `created: false` and `pointsAwarded: 0` — the
idempotency key prevents both a duplicate case and a duplicate award.

Status is `READY_TO_SUBMIT` when the complaint has no remaining placeholders,
otherwise `DRAFT`.

### `GET /cases`

The signed-in citizen's own cases, newest first.

Query: `status`, `limit` (1–50, default 20), `cursor`, `includeDemo`.

```json
{ "cases": [{ "...": "..." }], "cursor": "eyJwayI6..." }
```

`cursor` is opaque — pass it back verbatim; do not parse it.

### `GET /cases/{caseId}`

Case detail, including the live plan recomputed against the current time.

```json
{
  "case": { "...": "..." },
  "plan": { "...": "..." },
  "escalation": {
    "availableLevel": 2,
    "step": { "level": 2, "title": "Escalate to the ward sanitary inspector / health officer", "...": "..." },
    "ageDays": 20,
    "followUpOverdue": true,
    "reason": "It has been 20 days since submission with no resolution, so escalation step 2 now applies."
  },
  "nextEscalationStep": { "...": "..." },
  "timeline": [{ "eventId": "...", "type": "CASE_CREATED", "message": "...", "createdAt": "..." }],
  "outstandingPlaceholders": []
}
```

`escalation.reason` is written for display — when `availableLevel` is 0 it
explains *when* escalation becomes appropriate, rather than leaving a disabled
button unexplained.

### `PATCH /cases/{caseId}`

Update a case. At least one field is required.

```json
{
  "status": "SUBMITTED",
  "categoryId": "ROAD_DAMAGE",
  "location": { "city": "Pune" },
  "officialReference": "SWM-12345",
  "complaint": { "subject": "...", "body": "..." },
  "note": "Added the ward number"
}
```

- `status` changes are validated against the status machine; an invalid
  transition is a 409.
- Changing `categoryId` recomputes the authority, resolution path and follow-up
  date, because re-routing changes every timing with it.
- Editing the complaint recomputes `placeholders`, and promotes
  `DRAFT → READY_TO_SUBMIT` when the last one is filled.
- `note` appends a timeline entry.

### `GET /cases/{caseId}/timeline`

```json
{ "timeline": [{ "eventId": "2026-09-17T19:15:23.989Z#000001ab3f", "type": "MARKED_SUBMITTED", "message": "Submitted through City portal.", "actor": "guest_...", "createdAt": "..." }] }
```

Append-only. Event ids sort chronologically and break millisecond ties by a
monotonic sequence, so ordering is stable.

### `POST /cases/{caseId}/submitted`

Record that *you* submitted the complaint through the official channel. CivicSOS
never files on a citizen's behalf, so this is the citizen asserting it happened.

```json
{ "officialReference": "SWM-12345", "channel": "Swachhata app", "submittedAt": "2026-09-17T10:00:00.000Z" }
```

All fields optional. Sets `status: SUBMITTED` and recomputes `followUpAt` from
the submission date.

### `POST /cases/{caseId}/follow-up`

Log a follow-up, or escalate.

```json
{ "note": "Called the helpline, told it is in process.", "escalate": false, "officialReference": "SWM-12345" }
```

- Without `escalate`, a `SUBMITTED` case becomes `AWAITING_RESPONSE`.
- With `escalate: true`, the case moves to `ESCALATED` at the available level —
  **but only if the waiting window has elapsed.** Escalating too early returns
  409 with the reason, because escalating prematurely weakens the citizen's
  position.
- 409 if the case is closed, or if it was never recorded as submitted (every
  deadline is measured from the filing date).

Returns the full case detail, so the client does not need a second request.

### `POST /cases/{caseId}/resolve`

```json
{ "outcome": "FIXED", "resolutionNote": "Cleared and collection restarted." }
```

```json
{ "case": { "...": "..." }, "pointsAwarded": 100, "levelUp": "Silver Citizen" }
```

`outcome` is `FIXED` (→ `RESOLVED`) or `CLOSED_WITHOUT_FIX` (→
`CLOSED_UNRESOLVED`). Both clear `followUpAt`, which removes the case from the
reminder index — so a closed case can never generate another reminder. Only
`FIXED` awards points; `levelUp` is present when the award crossed a level
boundary.

---

### The agent

#### `POST /cases/{caseId}/agent/submit`

Runs the submission plan. **Requires explicit approval**; without it the policy
layer refuses and nothing is written.

```json
{ "approve": true }
```

```json
{
  "runId": "run_...",
  "steps": [
    { "action": "resolve_jurisdiction", "title": "Understanding the problem", "detail": "Municipal corporation — sanitation & solid waste management for 12th Main, Bengaluru.", "status": "OK", "completedAt": "..." },
    { "action": "validate_evidence", "title": "Checking your evidence", "detail": "1 photo and a location — everything the department asks for.", "status": "OK", "completedAt": "..." },
    { "action": "find_official_channel", "...": "..." },
    { "action": "generate_complaint", "...": "..." },
    { "action": "prepare_submission", "...": "..." },
    { "action": "submit_complaint", "...": "..." },
    { "action": "verify_submission", "...": "..." },
    { "action": "capture_reference", "...": "..." },
    { "action": "notify_user", "...": "..." }
  ],
  "completed": true,
  "reference": "CS-DEMO-87073",
  "submissionMode": "SIMULATED",
  "simulated": true,
  "case": { "...": "..." },
  "phase": "SUBMITTED",
  "phaseLabel": "Submitted",
  "phaseMessage": "You're done. We'll keep watching this one."
}
```

> **`simulated: true` is not decoration.** The submission ran against the
> CivicSOS demo environment — a pure function with no HTTP client and no URL.
> Nothing reached any authority. The `CS-DEMO-` prefix and
> `case.submissionMode: "SIMULATED"` carry the same fact, and the UI renders a
> notice saying so. Never present this as a real government submission.

Refusals, all 409 with an explanation safe to display:

| Condition | Message |
| --- | --- |
| `approve` absent | CivicSOS needs your approval before it submits anything. |
| Already submitted | This complaint has already been submitted. |
| Complaint has placeholders | The complaint still has blanks that need filling in. |
| Case closed | This case is already closed. |

Another citizen's case returns **404**, as everywhere else.

#### `POST /cases/{caseId}/agent/follow-up`

Without `approve`, this is a **dry run**: it returns the prepared message and
stops before `send_follow_up`, so the citizen reads exactly what would go out
before anything does.

```json
{ "approve": false }
```

```json
{
  "steps": [
    { "action": "check_case_status", "detail": "20 day(s) since submission, no response recorded.", "status": "OK", "...": "..." },
    { "action": "prepare_follow_up", "status": "OK", "...": "..." },
    { "action": "send_follow_up", "detail": "CivicSOS needs your approval before it sends a follow-up.", "status": "BLOCKED", "...": "..." }
  ],
  "completed": false,
  "draft": "Subject: Follow-up on complaint CS-DEMO-87073\n\nSir / Madam,\n...",
  "simulated": true
}
```

With `approve: true` it sends, advances the case to `AWAITING_RESPONSE`,
recomputes the follow-up date and evaluates escalation. 409 if the complaint was
never submitted.

#### Case phase

`GET /cases`, `GET /cases/{id}` and both agent endpoints return `phase`,
`phaseLabel` and `phaseMessage`. The phase is **derived** from the status and
the clock — `PREPARING`, `AWAITING_APPROVAL`, `SUBMITTED`, `MONITORING`,
`FOLLOW_UP_READY`, `ESCALATION_READY`, `RESOLVED`, `CLOSED` — so it can never
contradict the record. `CaseStatus` remains the persisted state machine.

### Evidence

#### `POST /cases/{caseId}/evidence` · 201

Reserve a slot and get a short-lived pre-signed upload URL.

```json
{ "fileName": "pothole.jpg", "contentType": "image/jpeg", "sizeBytes": 250000, "label": "The pothole" }
```

```json
{
  "evidenceId": "ev_0mu5wt9edwukmi4cv",
  "uploadUrl": "https://civicsos-dev-evidence-....s3.amazonaws.com/cases/...?X-Amz-...",
  "headers": { "content-type": "image/jpeg", "content-length": "250000", "x-amz-server-side-encryption": "AES256" },
  "expiresInSeconds": 300,
  "maxBytes": 8388608
}
```

`fileName` is used only for the label; the storage key is derived from ids
server-side.

#### Upload

`PUT` the file to `uploadUrl` with **exactly** the `headers` returned. They are
part of the signature — a mismatch fails.

#### `POST /cases/{caseId}/evidence/confirm`

```json
{ "evidenceId": "ev_0mu5wt9edwukmi4cv" }
```

Verifies the object exists before recording it. 409 if the upload never landed.
Idempotent.

#### `GET /cases/{caseId}/evidence`

Confirmed evidence with fresh 5-minute download URLs. The storage key is never
returned.

```json
{ "evidence": [{ "evidenceId": "...", "contentType": "image/jpeg", "sizeBytes": 250000, "label": "The pothole", "uploadedAt": "...", "confirmed": true, "downloadUrl": "https://..." }] }
```

---

### Civic Points and rewards

#### `GET /rewards`

Catalogue plus the signed-in citizen's balance, level and past redemptions.
Affordability and eligibility are decided server-side; `lockedReason` is written
for display so the UI can explain a lock rather than show a dead button.

```json
{
  "balance": 220,
  "lifetimePoints": 220,
  "level": { "level": { "id": "BRONZE", "label": "Bronze Citizen", "minPoints": 0, "blurb": "..." },
             "next": { "id": "SILVER", "label": "Silver Citizen", "minPoints": 250, "blurb": "..." },
             "pointsToNext": 30, "progress": 0.88 },
  "rewards": [{
    "rewardId": "voucher-local-cafe", "partner": "Corner Chai Co. (demo partner)",
    "name": "₹100 café voucher", "category": "VOUCHER", "pointsRequired": 150,
    "emoji": "☕", "isSampleCatalog": true,
    "affordable": true, "eligible": true, "pointsShort": 0
  }],
  "redemptions": [],
  "disclaimer": "This is a demo catalogue...",
  "isSampleCatalog": true
}
```

> **`isSampleCatalog`** is the honesty flag. The catalogue shipped with the
> project uses fictional partners and issues `DEMO-` codes with no monetary
> value. CivicSOS claims no sponsor relationships.

#### `POST /rewards/{rewardId}/redeem` · 201

Debits the balance through the points ledger and records the redemption.

```json
{
  "redemption": {
    "redemptionId": "rdm_...", "rewardId": "voucher-local-cafe",
    "rewardName": "₹100 café voucher", "pointsSpent": 150,
    "code": "DEMO-VOU-9ECFAB", "createdAt": "..."
  },
  "balance": 70
}
```

- 403 when the citizen has not reached a level-gated reward's minimum level.
- 409 when the balance is insufficient, with the shortfall in the message.
- 404 for an unknown reward id.

Spending reduces `balance` but never `lifetimePoints`, so redeeming cannot
demote a citizen's level.

#### How points are earned

Amounts are fixed server-side and never read from a request body.

| Reason | Points | Awarded |
| --- | --- | --- |
| `REPORT_CREATED` | 50 | On case creation |
| `COMPLETE_INFORMATION` | 10 | When the complaint has no remaining placeholders and a location |
| `EVIDENCE_PROVIDED` | 10 | On the first confirmed evidence upload for a case |
| `CASE_RESOLVED` | 100 | On `outcome: FIXED` only |

Each reason is awarded **at most once per case**, enforced by a ledger dedupe key
of `<reason>#<caseId>` written conditionally. `POST /cases` and
`POST /cases/{id}/resolve` return `pointsAwarded` — the amount actually written
to the ledger, so a client can display it without computing anything itself.

### Profile

#### `GET /me`

```json
{
  "profile": {
    "userId": "...", "email": "...", "displayName": "Alice", "role": "CITIZEN",
    "defaultLocation": { "city": "Pune" },
    "civicPoints": 220, "lifetimePoints": 220, "casesReported": 4, "casesResolved": 1
  },
  "role": "CITIZEN",
  "notifications": [{ "notificationId": "...", "caseId": "...", "kind": "FOLLOW_UP_DUE", "title": "Time to follow up", "body": "...", "read": false, "createdAt": "..." }],
  "unreadCount": 2,
  "level": { "level": { "id": "BRONZE", "label": "Bronze Citizen" }, "next": { "id": "SILVER", "label": "Silver Citizen" }, "pointsToNext": 30, "progress": 0.88 },
  "impact": { "casesReported": 4, "casesResolved": 1, "civicPoints": 220, "lifetimePoints": 220 },
  "pointsHistory": [{ "entryId": "pts_...", "reason": "CASE_RESOLVED", "delta": 100, "label": "Problem resolved", "caseId": "case_...", "createdAt": "..." }]
}
```

Notification `kind` is one of `FOLLOW_UP_DUE`, `ESCALATION_AVAILABLE`,
`CASE_CREATED`, `POINTS_EARNED` or `REWARD_AVAILABLE`.

#### `PATCH /me`

```json
{ "displayName": "Alice Fernandes", "defaultLocation": { "locality": "12th Main", "city": "Bengaluru" } }
```

`role` in the body is ignored — it always comes from the token. So are
`civicPoints`, `lifetimePoints`, `casesReported` and `casesResolved`: those are
server-owned counters, and a profile edit is not a way to rewrite them.

#### `POST /me/notifications/{notificationId}/read`

```json
{ "ok": true }
```

#### `POST /me/notifications/read-all`

Marks every unread reminder as read.

```json
{ "ok": true }
```

---

### Admin

#### `GET /admin/overview` · ADMIN only

Aggregates, overdue cases and today's audit trail. Counts come from bounded pages
per status — never a table scan — so the figures are an approximation and the UI
says so. Demo and real cases are counted separately.

```json
{
  "stage": "dev",
  "generatedAt": "2026-09-17T19:18:10.414Z",
  "totals": {
    "byStatus": { "DRAFT": 1, "SUBMITTED": 2, "RESOLVED": 1, "...": 0 },
    "byCategory": { "ROAD_DAMAGE": 1, "GARBAGE_SANITATION": 2, "...": 0 },
    "open": 7, "resolved": 1, "demo": 8, "real": 1
  },
  "overdue": [{ "caseId": "...", "summary": "...", "status": "AWAITING_RESPONSE", "followUpAt": "...", "isDemo": true }],
  "recentAudit": [{ "action": "CASE_CREATE", "actorRole": "CITIZEN", "resource": "case/case_...", "outcome": "ALLOW", "createdAt": "..." }]
}
```

#### `GET /admin/queue/{status}` · AUTHORITY or ADMIN

One status queue, 25 per page. Query: `cursor`.

---

## Local development endpoints

Active only when no deployed API is configured (`NEXT_PUBLIC_API_BASE_URL` unset),
and refused otherwise.

| Endpoint | Purpose |
| --- | --- |
| `PUT /api/local-storage?grant=...` | Stand-in for a pre-signed S3 PUT, with real grant expiry and content-type enforcement |
| `GET /api/local-storage?grant=...` | Stand-in for a pre-signed S3 GET |
| `POST /api/dev/sweep` | Runs the reminder sweep on demand instead of waiting for the daily schedule |

---

## Worked example

```bash
BASE=http://localhost:3000/api

# 1. Start a demo session
TOKEN=$(curl -s -X POST $BASE/auth/guest -H 'content-type: application/json' -d '{}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')

# 2. Analyze a problem
curl -s -X POST $BASE/cases/analyze \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"description":"There has been garbage outside my apartment for 4 days and it smells terrible.",
       "location":{"locality":"12th Main","city":"Bengaluru"}}'

# 3. Create the case
CASE=$(curl -s -X POST $BASE/cases \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"description":"There has been garbage outside my apartment for 4 days and it smells terrible.",
       "categoryId":"GARBAGE_SANITATION",
       "location":{"locality":"12th Main","city":"Bengaluru"},
       "facts":{"sinceWhen":"4 days","reporterName":"Alice","reporterContact":"alice@example.invalid"},
       "idempotencyKey":"demo-key-001"}')
CID=$(printf '%s' "$CASE" | python3 -c 'import sys,json; print(json.load(sys.stdin)["case"]["caseId"])')

# 4. Record that you submitted it officially
curl -s -X POST $BASE/cases/$CID/submitted \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"officialReference":"SWM-12345","channel":"Swachhata app"}'

# 5. Follow up
curl -s -X POST $BASE/cases/$CID/follow-up \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"note":"Called the helpline, told it is in process."}'

# 6. Resolve
curl -s -X POST $BASE/cases/$CID/resolve \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"outcome":"FIXED","resolutionNote":"Cleared and collection restarted."}'
```

Note: use `printf '%s'` rather than `echo` when piping JSON in zsh — its builtin
`echo` interprets `\n` inside the string and will corrupt the payload.
