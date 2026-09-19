# Security

CivicSOS holds people's complaints about their own neighbourhoods, photographs of
their streets, and sometimes their names and phone numbers. The data is not
high-value to an attacker, but it is personal, and a civic tool that leaks it
would do real harm to the people most willing to use it.

This document states what is protected, how, and — as importantly — what is not.

---

## 1. Threat model

| Threat | Mitigation | Verified by |
| --- | --- | --- |
| Reading another citizen's case | Server-side ownership check on every path; 404 not 403 | `security.test.ts` — every read and write path |
| Enumerating case ids to discover cases | 404 for someone else's case; ids are time-ordered + 8 random base36 chars | `security.test.ts` |
| Calling the API with no credentials | Every route except `/health` and the category catalogue requires a token | `security.test.ts` — all 11 private endpoints |
| Forging a demo session | Guest tokens are HMAC-SHA256 signed, constant-time compared, 6-hour expiry | `security.test.ts` — tamper, wrong secret, expiry |
| Escalating one's own role | Role read from `cognito:groups` only; a role in a request body is ignored | `security.test.ts` |
| Reaching the admin dashboard | `requireRole(ADMIN)`; `AUTHORITY` is refused too | `security.test.ts` |
| Rewriting someone else's complaint as staff | `AUTHORITY` may read, never write | `security.test.ts` |
| Prompt injection via the complaint text | Scrub, fence, strict output schema, narrow output surface | `sanitize.test.ts`, `ai.test.ts` |
| Leaking PII to a third-party model | Phone, email, government id and house number stripped before the call | `sanitize.test.ts` |
| PII in operational logs | Every log field passes through `redactForLogs` | `sanitize.test.ts` |
| Path traversal through an id or filename | Strict id pattern; storage keys derived from ids only | `security.test.ts`, `evidence.test.ts` |
| Reading evidence directly from S3 | Bucket blocks all public access; only pre-signed URLs, 5-minute TTL | Stack configuration |
| Uploading something other than what was declared | Content type and length are part of the pre-signed signature | `evidence.test.ts` |
| Using the service as free object storage | 8 MB per file, 6 files per case, upload only into your own case | `evidence.test.ts` |
| Denial of wallet (running up an AWS bill) | Gateway throttle, per-user AI limit, 64 KB bodies, budget alarms | `security.test.ts` (limiter), [COST.md](COST.md) |
| Duplicate case creation from a retry | Conditional `TransactWriteItems` on an idempotency key | `workflow.test.ts` |
| Minting Civic Points by replaying a request | Ledger dedupe key `<reason>#<caseId>`, written conditionally | `points.test.ts` |
| Farming points with duplicate reports | Award keyed to the case id; case creation is itself idempotent | `points.test.ts` |
| Setting your own points balance | Amounts are server-calculated; `PATCH /me` rewrites server-owned counters | `points.test.ts` |
| Redeeming a reward you cannot afford or are not eligible for | Server-side balance and level checks before any debit | `points.test.ts` |
| Losing an award to a concurrent write | `UpdateItem ADD`, an atomic increment rather than read-modify-write | Adapter design |
| Skipping the workflow (e.g. resolve a draft) | Explicit status machine, validated server-side | `workflow.test.ts` |
| Agent submitting without the citizen's approval | Every acting action refused unless `approve: true` is on the request | `agent.test.ts` |
| Agent submitting the same complaint twice | Policy refuses on an already-submitted case | `agent.test.ts` |
| Agent acting on someone else's case | Same ownership check as every other path; 404, not 403 | `agent.test.ts` |
| A simulated submission passing as a real one | `CS-DEMO-` reference, `submissionMode: 'SIMULATED'`, on-screen notice | `agent.test.ts` |
| A demo run reaching a real government portal | The submission path is a pure function — no HTTP client, no URL | Code structure |
| A model inventing an authority, channel or reference | None of those come from model output; all are read from the knowledge layer | `agent.test.ts` |
| Leaking internals through an error | Every error becomes a safe envelope; internals only in logs | `responses.ts`, `security.test.ts` |
| XSS through complaint text | React escapes on render; control and invisible characters stripped at storage; strict CSP | `sanitize.test.ts` |
| Cross-site request from another origin | Exact-origin CORS allow-list, never `*` | `security.test.ts` |

---

## 2. Authentication

Two identity sources produce the same `AuthContext`, so there is no separate
"demo mode" code path that could drift out of security parity.

### Cognito accounts

- Email plus password, **SRP** authentication — the password is never transmitted.
- Password policy: 12 characters minimum, upper case, lower case and a digit.
- Email verification by code, using Cognito's own free sender.
- `preventUserExistenceErrors` on, so a failed sign-in does not reveal whether an
  account exists.
- ID token and access token live 1 hour; refresh token 30 days.

Tokens are verified with `aws-jwt-verify`, which checks the signature against the
pool's JWKS (cached), the issuer, the audience, the expiry, and `token_use`. That
last check matters: an **access** token is refused where an **ID** token is
required, because only the ID token carries the group claims roles are derived
from.

### Guest demo sessions

`POST /auth/guest` mints a token for a fresh `guest_<random>` identity and seeds
that identity's **own private copy** of the demo cases.

- Payload is `{ userId, exp }`, base64url-encoded, signed HMAC-SHA256.
- Signature comparison is constant-time.
- 6-hour expiry, enforced on every request.
- The secret must be at least 32 characters; issuing refuses otherwise, and the
  runtime disables the demo entirely rather than signing weak tokens.
- Demo data cannot touch real data: a guest is an ordinary user id subject to the
  same ownership checks, and two guests cannot see each other's cases.
- Guest rows carry a 2-day DynamoDB TTL and a matching S3 lifecycle rule.

### Development headers

A local `x-dev-user` / `x-dev-role` header pair is accepted **only** when
explicitly enabled *and* the stage is literally `local`. Requesting it on any
other stage is refused and logged at error level. The deployed runtime passes
`devHeaders: { enabled: false }` explicitly, so the guard is visible in the code
rather than implied. Both behaviours are tested.

---

## 3. Authorization

Every rule lives in `packages/core/src/services/authorization.ts` and is called
from the service layer, which every HTTP route goes through. There is no code path
that reaches data without passing one.

```
CITIZEN    own cases only: read, write, upload, resolve
AUTHORITY  read any case (oversight). No writes to citizen content.
ADMIN      read any case; may change status for moderation; admin dashboard.
           Every admin action is audited.
```

### 404, not 403

Requesting a case owned by someone else returns **404**. A 403 would confirm the
id exists, which tells an attacker enumerating ids exactly which cases are real.

### The frontend is not a security boundary

The UI hides an action it believes is unavailable, but the server decides. Every
service method re-checks ownership and role on the data it just loaded. The
client-side role from the ID token drives navigation only.

### Fields a client cannot set

`ownerId`, `isDemo` and `classifiedBy` are staff-only. Urgency is re-derived
server-side from the description — a client claiming `CRITICAL` cannot jump the
reminder cadence. The profile endpoint writes `role` from the token, never from
the payload.

---

## 4. Input handling

| Control | Value |
| --- | --- |
| Request body cap | 64 KB, checked **before** parsing |
| Description | 12–4000 characters |
| Complaint body | 6000 characters |
| Evidence file | 8 MB, and one of JPEG / PNG / WebP / HEIC / PDF |
| Evidence per case | 6 |
| Id pattern | `^[A-Za-z0-9_-]{3,80}$` |
| Content type | `application/json` required for bodies |
| Analyze rate limit | 10 per user per minute (per container) |
| API Gateway throttle | 10 rps sustained, 20 burst |

Validation and normalization are the same step. Every zod string field sanitizes
during parsing, so a handler cannot forget to sanitize: `sanitizeText` strips
control characters, strips zero-width and bidi-override characters, collapses
runaway whitespace and enforces a hard length.

Storage does **not** HTML-escape. React escapes on render, and escaping at the
storage boundary would double-encode text the user later edits in a textarea.
`escapeHtml` exists for any future code path that builds raw HTML.

Coordinates are rounded to two decimal places (~1 km) inside the location schema
— at the trust boundary — so no downstream code can persist a citizen's precise
position even by accident.

---

## 5. Evidence storage

The bucket:

- `BlockPublicAccess.BLOCK_ALL`
- `enforceSSL: true`
- `objectOwnership: BUCKET_OWNER_ENFORCED` (ACLs disabled entirely)
- SSE-S3 encryption
- No website hosting, no public policy, no CloudFront origin
- CORS restricted to the deployed app's exact origins
- Lifecycle: abort incomplete multipart uploads after 1 day; expire
  `cases/guest_*` after 2 days

The three-step upload (reserve → PUT → confirm) means file bytes never pass
through Lambda, and nothing is recorded as evidence until `HeadObject` confirms
the object exists at the expected size. An abandoned upload leaves no
half-recorded evidence.

Storage keys are `cases/{ownerId}/{caseId}/{evidenceId}.{ext}` — derived from
server-generated ids only. The client's filename never reaches the key, so a file
named `../../../etc/passwd` is stored as `cases/<owner>/<case>/ev_xxx.png`.
Tested.

Downloads are fresh 5-minute pre-signed GETs, issued per request after the
case-level authorization check. The storage key is never returned to the client.
Because each listing re-issues URLs, an old URL cannot be shared for long — and a
test asserts URLs are re-issued rather than cached.

---

## 6. AI safety

Detail in [ARCHITECTURE.md §7](ARCHITECTURE.md#7-the-ai-boundary). The security
summary:

**PII minimization before any external call.** Emails, phone numbers (8–15 digit
runs, grouped or not), Aadhaar-shaped numbers, PAN-shaped strings and house/flat
designations are replaced with tokens. Redaction is deliberately aggressive — a
false positive costs a little context, a false negative leaks a citizen's phone
number to a third party. The house-number pattern requires a digit in the
designation, so "apartment for 4 days" is left alone while "Flat 4B" is not.

**The API key never reaches the browser.** It is a SecureString in SSM Parameter
Store, read once per Lambda container, and sent in the `x-goog-api-key` header
rather than a query string — so it cannot land in an access log, a referrer, or
an error message. The web app's variable is `GEMINI_API_KEY`, not
`NEXT_PUBLIC_GEMINI_API_KEY`; the prefix rule means a mistake here is a build-time
mistake, not a silent leak.

**No paid or high-risk model features.** No grounding, no search tool, no file
API, no code execution. One plain HTTPS request with an explicit timeout, written
by hand rather than through an SDK, so no client library can silently enable a
billable feature.

**The model's blast radius is a wrong category.** It cannot influence
authorization, the database, escalation policy, response windows, status
transitions, or another user's data, because there is nowhere in its output schema
to express any of those.

---

## 7. Secrets

- Nothing secret in Git. `.gitignore` covers `.env*`, `*.pem`,
  `amplify_outputs.json` and `infra-outputs.json`, and CI fails on a
  credential-shaped string.
- Secrets live in SSM Parameter Store as **SecureString** parameters under
  `/civicsos/<stage>/`, encrypted with the AWS-managed SSM key.
- They are **not** created by CloudFormation — CFN cannot create SecureStrings,
  and a secret should be written by a human with the CLI rather than passed
  through a template. Lambda's environment holds parameter *names*, never values,
  so the console shows nothing sensitive.
- IAM read access is scoped to `/civicsos/<stage>/*`, and `kms:Decrypt` is
  conditioned on `kms:ViaService = ssm.<region>.amazonaws.com`.
- A missing Gemini key degrades to deterministic mode. A missing or weak guest
  secret disables the demo. Neither takes the service down, and both log loudly.

---

## 8. Logging and audit

### Logs

Structured JSON, one object per line, so CloudWatch Logs Insights can query
fields. Redaction happens **at the logger**, not at each call site: every field
passes through `redactForLogs`, which blanks keys matching
`password|secret|token|authorization|apikey|credential|cookie|session|email|phone|aadhaar|otp|signature`
and rewrites emails, phone numbers and id-shaped strings found inside free text.
A careless `logger.info('x', { case: caseRecord })` therefore cannot leak a
citizen's email.

Logged: request id, route, method, HTTP status, role, latency, category, urgency,
whether the AI fell back, AI latency, whether injection was detected, error name
and message, six stack frames.

Never logged: passwords, tokens, API keys, complaint text, evidence content,
precise locations.

### Audit trail

One immutable record per security-relevant action — analyze, create, update,
submit, follow-up, escalate, resolve, evidence reserve/confirm/list, admin views
— with actor id, role, resource, `ALLOW`/`DENY`/`ERROR`, and the request id.
Partitioned by calendar day so it is queryable without a scan; written with a
condition that prevents replacing an existing record; 400-day TTL. Denials are
recorded too, including rate-limit rejections.

Auditing is best-effort by design: a failed audit write is logged at error level
but never fails a citizen's request.

---

## 9. Transport and headers

Every API response carries:

```
x-content-type-options: nosniff
x-frame-options: DENY
referrer-policy: no-referrer
content-security-policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'
cross-origin-resource-policy: same-origin
permissions-policy: geolocation=(self), camera=(), microphone=(), payment=()
strict-transport-security: max-age=31536000; includeSubDomains
cache-control: no-store
```

The API's CSP is maximally restrictive because the API returns only JSON; it
exists to neutralize any attempt to get a browser to render a response as a
document. `no-store` is there because every response is per-user and caching one
in a shared cache would be a data leak.

The page CSP (Next.js config) is stricter than most: `object-src 'none'`,
`base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'self'` and an explicit
`connect-src` allow-list.

CORS is an exact-origin allow-list, never `*` — the API is credentialed, and a
wildcard with credentials is both invalid and unsafe. A test asserts no wildcard
is ever returned.

---

## 10. Known limitations

Stated plainly, because a security document that claims completeness is not
trustworthy.

1. **Tokens in browser storage.** The guest token is in `sessionStorage`; Cognito's
   refresh token is in `localStorage` where its library puts it; the ID token is
   held in memory. Under a successful XSS, these are reachable. The correct fix is
   httpOnly cookies behind a server session layer. Mitigations today: strict CSP,
   React's escaping, character stripping at the storage boundary, 1-hour ID
   tokens, and a 6-hour cap on demo sessions.

2. **`'unsafe-inline'` in the page CSP.** Next injects inline critical CSS and a
   bootstrap script. A nonce-based policy needs middleware and is the next
   hardening step. Development also allows `'unsafe-eval'` because the dev bundler
   evaluates modules with `eval`; production never gets it.

3. **The rate limiter is per-container.** Lambda gives each container its own
   memory, so the 10-per-minute AI allowance is per container, not global. API
   Gateway throttling is the global control. A truly global limiter would need a
   DynamoDB counter on the hot path, which costs a write per request to solve a
   problem the gateway already bounds.

4. **No CAPTCHA on guest session creation.** Demo sessions are cheap to create and
   each seeds four rows. Bounded by the gateway throttle and the 2-day TTL, but a
   determined actor could create many. A real deployment should put a challenge in
   front of `POST /auth/guest`, or disable the demo with `DEMO_ENABLED=false`.

5. **No Cognito advanced security features.** Adaptive authentication and
   compromised-credential detection are a paid tier. The free deterrents in place
   are the password policy, `preventUserExistenceErrors`, and gateway throttling.

6. **No account deletion or data export endpoint.** A production civic service
   handling personal data needs both. They are not implemented.

7. **Points are not protected against a determined multi-account attacker.** One
   person can create several accounts and file several genuine-looking reports.
   The ledger stops replay and duplicate-report abuse, and the largest award
   requires a *resolution* that a real authority has to deliver, which is hard to
   fake — but a real rewards programme would need per-account verification and
   moderation before anything of value was attached to it. Today nothing of value
   is: the catalogue is a placeholder.

8. **Evidence is not scanned for malware.** Files are type- and size-restricted
   and are only ever served to their own owner behind a short-lived URL with
   `nosniff` and `content-disposition: inline`, but no antivirus scan happens.

9. **No field-level encryption.** Complaint text is encrypted at rest by DynamoDB
   and in transit by TLS, but not encrypted per-record with a customer key. For
   the sensitivity of this data that is a reasonable position; for a service
   handling, say, whistleblower reports it would not be.

10. **The authority directory is unverified by design.** See the honesty policy in
   `knowledge/authorities.ts`. This is a correctness limitation rather than a
   security one, but it is the one most likely to cause real-world harm if
   misrepresented, which is why it is surfaced in the UI on every plan.

---

## 11. The agent

CivicSOS acts on a citizen's behalf toward a public body. That is precisely the
place where "the model decided" is not an acceptable answer, so the agent is
built to be boring and checkable.

**A closed action set.** Thirteen named actions (`AGENT_ACTIONS`), and nothing
else can run. There is no dynamic dispatch, no tool the model can name, and no
free-text command path.

**A policy gate in front of every action.** `checkAction` reads only the
persisted case and the knowledge layer. No parameter it consults can be
influenced by model output. Acting steps — `prepare_submission`,
`submit_complaint`, `send_follow_up` — are refused unless:

- the request carries explicit approval from the citizen,
- the case is open,
- the complaint has no remaining placeholders, and
- the case has not already been submitted.

**No network path to a real portal.** The submission step runs against the
CivicSOS demo environment, which is a pure function returning strings. It has no
HTTP client, no URL and no credentials. A demo run cannot reach a government
system because there is no code by which it could. Building brittle browser
automation against a live government website — with its CAPTCHAs, OTPs and
availability — would also have been unreliable and, done without permission,
inappropriate.

**Three independent markers on every simulated submission.** The reference is
prefixed `CS-DEMO-`, the case is stamped `submissionMode: 'SIMULATED'`, and the
UI renders a notice saying it is not a government portal. A test asserts all
three. Presenting a simulation as a real government action would be the single
most damaging thing this product could do, so it is defended in depth rather
than by convention.

**Everything it did is on the timeline**, attributed to `agent` rather than to
the citizen, so the record of who did what stays honest.

### The official hand-off and the browser assistant

The second submission path prepares a complaint for a **verified** official
channel and hands it to the citizen. It is deliberately the *less* automated
path, and the limits are enforced rather than promised:

- **It never submits.** `prepareOfficial` writes no submission state: the case
  keeps `submittedAt: undefined` and is only marked submitted when the citizen
  records the reference the authority actually gave them. A test asserts this.
- **It refuses an unverified destination.** Only a channel already marked
  verified in the knowledge layer with a real URL is offered. A generic template
  is never dressed up as an official destination.
- **The payload carries no credentials.** There is no credential field in the
  type, and a test greps the serialised payload for `password`, `otp`,
  `captcha`, `token`, `secret` and `credential`.

The browser assistant (`apps/extension`) exists because a web page cannot touch
another origin's DOM — which is the protection that stops any site filling your
bank form. It is scoped accordingly:

- **It fills only fields in a verified mapping for that exact origin.** The
  mapping registry ships **empty**: writing selectors for a portal nobody has
  inspected would be inventing them, and a wrong selector typing a complaint
  into the wrong box is worse than no autofill. With no mapping it shows a
  review panel with copy buttons, which works anywhere.
- **It refuses credential fields structurally.** `isCredentialField` rejects
  password inputs, `one-time-code` autocomplete, and anything named like an OTP,
  CAPTCHA, PIN or CVV — even if a mapping mistakenly pointed at one.
- **It waits rather than acting** when a login or challenge is on screen. There
  is no code that attempts either.
- **It never clicks Submit.** The submit selector is recorded in the mapping
  precisely so it can be excluded.
- **Nothing is persisted.** The service worker holds a hand-off in memory for at
  most five minutes, delivers it once to a tab whose origin matches, and drops
  it. `externally_connectable` restricts which origins may reach it at all.

The extension is optional. Without it the official path still works — the web
app shows the prepared complaint with copy buttons.

### What this does not cover

A deployment that gains a genuine machine-to-machine submission channel replaces
one function and sets a new submission mode. Before that ships it would need its
own review: credential handling for the channel, rate limiting against the
authority, and a way for a citizen to revoke the agent's authority to act. None
of that exists today, because nothing today actually submits.

---

## 12. Reporting a vulnerability

This is a hackathon project, not a funded service. If you find something, open an
issue describing the class of problem without a working exploit, and it will be
addressed or documented here.
