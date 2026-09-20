# Cost

**Design goal: an idle deployment costs approximately nothing, and a mistake
cannot quietly become a large bill.**

Every component is serverless and scales to zero. There is no hourly billing
anywhere in the stack — no EC2, no RDS, no load balancer, no NAT gateway, no
container platform, no managed search cluster, no always-on cache.

---

## 1. Why each service was chosen

### AWS Amplify Hosting — the frontend

Chosen because it gives Git-driven builds, a CDN, TLS certificates and preview
branches with no infrastructure to manage. Free tier covers 1,000 build minutes a
month, 15 GB served and 5 GB stored.

*Rejected:* S3 + CloudFront by hand (more moving parts for the same result, and
Next.js SSR needs a compute layer anyway); EC2 or a container (hourly billing for
a site that is idle most of the time).

### API Gateway — HTTP API, not REST API

HTTP API costs roughly **one third** of REST API per million requests ($1.00 vs
$3.50) and provides everything needed here: routing, CORS, and — the important
part — **stage-level throttling**, which is the primary defence against a runaway
client becoming a bill. Free tier: 1M requests/month for 12 months.

*Rejected:* REST API (3.5× the price for features unused); an Application Load
Balancer (~$16/month just to exist); a Lambda function URL (no throttling, which
is exactly the control that matters most).

### Lambda — all compute

Scales to zero; an idle deployment costs nothing. Configured on **arm64
(Graviton)**, which is about 20% cheaper per GB-second than x86 with the same
free tier. Free tier: 1M requests and 400,000 GB-seconds a month, and it does not
expire.

Memory and timeouts are deliberately modest: API 512 MB / 25 s, events and
scheduler 256 MB / 15 s and 2 min. The 25 s API timeout exists only because the
analyze endpoint waits on Gemini, which is itself capped at 8 s.

*Rejected:* Fargate or EC2 (hourly billing); provisioned concurrency (a fixed
monthly cost to shave a cold start nobody is complaining about).

### DynamoDB — all persistence

On-demand billing means paying per request rather than for provisioned capacity
sitting idle, and it makes over-provisioning impossible. Free tier: 25 GB storage
and 25 provisioned WCU/RCU, with on-demand priced per request beyond that.

The **single-table design is itself a cost control**: every access pattern is a
`GetItem` or a `Query` against a key or an index. There is no `Scan` in any
normal flow, and a scan is the usual way a DynamoDB bill surprises someone. The
one broad read — the reminder sweep — queries a *sparse, day-partitioned* index
and is bounded both by a 14-day lookback and a 100-case batch cap.

Other cost decisions in the table:
- **Point-in-time recovery is off for non-production stages.** PITR is billed per
  GB-month of continuous backup, and a dev stage does not need it.
- **TTL does the cleanup**, free of charge: guest demo data expires after 2 days,
  idempotency markers after 24 hours, notifications after 60 days, audit records
  after 400 days. No cleanup Lambda, no scheduled deletes, no storage creep.
- **`ProjectionType.ALL` on all three GSIs** is a deliberate storage-for-requests
  trade: case rows are small, and the alternative — projecting keys only — would
  mean a second read per row on every list view.

*Rejected:* RDS (from ~$15/month for the smallest instance, plus it would need a
VPC and therefore a NAT gateway for Lambda to reach anything else — see below);
Aurora Serverless v2 (0.5 ACU minimum is still a real monthly floor).

### S3 — evidence storage

Free tier: 5 GB, 20,000 GETs, 2,000 PUTs a month.

The cost-relevant design choice is that **file bytes never pass through Lambda**.
Uploads go browser → S3 directly with a pre-signed PUT, and downloads come
straight from S3 with a pre-signed GET. Proxying an 8 MB photo through Lambda
would burn compute time for no benefit — and API Gateway caps payloads at 10 MB
anyway.

Lifecycle rules prevent silent storage growth:
- Incomplete multipart uploads are aborted after 1 day. An abandoned upload would
  otherwise be billed indefinitely.
- Objects under `cases/guest_` expire after 2 days, matching the DynamoDB TTL on
  guest rows, so demo traffic cleans up after itself.
- Versioning is **off**. Versioning on an evidence bucket means paying for every
  overwritten object forever.

### Cognito — authentication

Free tier: 50,000 monthly active users for user-pool sign-in. Realistically free
forever at this scale.

Verification emails use **Cognito's own default sender**, which is free but
limited to ~50 emails a day. This is a conscious trade: SES would lift the limit
but requires domain verification and a sandbox-exit request, and still costs per
email. The limit is documented in [DEPLOYMENT.md](DEPLOYMENT.md) so nobody is
surprised by it.

Cognito's **advanced security features are not enabled** — they are a paid tier
billed per MAU. The free deterrents in place are a 12-character password policy,
`preventUserExistenceErrors`, and API Gateway throttling.

*Rejected:* Auth0 or Clerk (paid beyond small free tiers, and an external
dependency for the one thing that must not be unavailable); hand-rolled auth
(cheaper in dollars, far more expensive in risk).

### EventBridge — asynchronous work

Custom event buses are **free for AWS-sourced and custom events** — you pay only
for cross-account or third-party events, which this project does not use.
Scheduled rules are free.

The architectural choice that saves money here: **one daily scheduled sweep
rather than a timer per case.** A per-case schedule would mean thousands of
resources and one invocation per case. The sweep is ~365 invocations a year plus
a bounded query, and — more importantly — it derives the due set from the cases
themselves, so it cannot drift.

Event targets are configured with `retryAttempts: 2` and a 1-hour max event age.
An unbounded retry loop on a permanently failing target is a genuine way to burn
free-tier Lambda invocations.

*Rejected:* SQS + a poller (a poller is either always-on or another schedule, and
the fan-out here is trivially small); Step Functions (state transitions are
billed, and there is no state machine here worth orchestrating); EventBridge
Scheduler one-shot schedules per case (thousands of resources that can go stale).

### CloudWatch — logs and alarms

Free tier: 5 GB of log ingestion, 10 alarms, 1M API requests.

- **Log retention is 7 days** on every function. This is the single most
  effective CloudWatch cost control: the default is "never expire", and
  indefinitely retained logs are how a small project ends up paying for storage
  it forgot about.
- **Three alarms**, inside the 10 free: API errors, scheduler errors, and
  unusually high API invocation volume. That last one is a cost alarm disguised
  as an operational one — a traffic spike is the earliest warning of an
  unexpected bill.
- **No custom metrics** (billed per metric per month) and **no dashboard**
  (3 free, then $3/month each). Structured JSON logs plus Logs Insights queries —
  which are free within the free-tier scan allowance — cover the same need.
- **X-Ray is off.** Useful, but billed per trace, and the structured logs carry
  request ids, durations and outcomes already.

### SSM Parameter Store — secrets

**Standard parameters are free**, and SecureString parameters are encrypted with
the AWS-managed SSM KMS key, which is also free to use. Parameters are fetched
once per Lambda container at cold start and cached for its lifetime — a handful
of API calls a day.

*Rejected:* **Secrets Manager**, which costs about **$0.40 per secret per month**
plus API calls. Two secrets would be ~$10/year for functionality Parameter Store
provides free. Also rejected: plain Lambda environment variables (free, but the
values are visible to anyone with console read access).

### AWS Budgets — the backstop

The **first two budgets per account are free.** The stack creates one monthly cost
budget (default $5) with notifications at **50% of actual** and **100% of
forecast** spend. Forecast alerting matters: it warns while the month is young
enough to do something about it.

### The agent — zero marginal cost

Worth stating because "autonomous agent" usually implies a bill: CivicSOS's
agent makes **no AI calls at all**. Every step it runs is a deterministic
function over the persisted case and the knowledge layer, executing inside the
same API Lambda invocation that the citizen's request already paid for. There is
no agent loop, no planner model, no tool-calling round trips, and no retry
storm — the plan is a fixed ordered constant.

A full submission run is one Lambda invocation, one DynamoDB write for the case,
a handful of small writes for the timeline, and one EventBridge event. The
submission itself is a pure function with no network call, so it costs nothing
and cannot fail in a way that burns retries.

### Gemini — free tier only

`gemini-2.0-flash` on the free tier. Chosen over a paid model because
classification of short text does not need a frontier model, and the free tier's
rate limits are absorbed by design rather than paid around.

Cost controls specific to the AI path:
- **No billing enabled** on the Google Cloud project. This is the hard ceiling.
- **No paid features**: no grounding, no search tool, no file API, no code
  execution. The client is a hand-written `fetch` call rather than an SDK
  precisely so no client library can silently enable a billable feature.
- `maxOutputTokens: 900` and `temperature: 0.1` — bounded, cheap, deterministic.
- **8-second timeout, at most 2 attempts.** A retry storm against a rate-limited
  API wastes both quota and Lambda time.
- **Per-user rate limit of 10/minute** on the only endpoint that calls the model.
- **Graceful degradation**, so exhausting the quota makes the product slightly
  less eloquent rather than broken — which removes the incentive to ever upgrade
  to a paid tier for availability reasons.

---

## 2. What was deliberately not built

| Rejected | Why |
| --- | --- |
| EC2 / EKS / ECS-on-EC2 | Hourly billing for a workload that is idle most of the time. **Fargate is the one exception** — see the status-check worker below: it is on-demand, scale-to-zero, and runs a browser, which genuinely does not fit Lambda |
| RDS / Aurora | ~$15+/month floor, plus a VPC, plus the NAT gateway below |
| **NAT Gateway** | ~$32/month *before any traffic*. Would silently be the single largest line item. Avoided entirely: Lambda stays out of a VPC (DynamoDB, S3, EventBridge and SSM are all reached over public AWS endpoints with IAM auth), and the worker's VPC has `natGateways: 0` — its tasks sit in a public subnet with a per-second public IP instead |
| ElastiCache / Redis | An always-on node for a workload with no hot key problem |
| OpenSearch | Cheapest viable cluster is tens of dollars a month; DynamoDB queries answer every question asked |
| Secrets Manager | ~$0.40/secret/month for what Parameter Store does free |
| CloudFront (separate) | Amplify Hosting already fronts the app with a CDN |
| Route 53 + custom domain | $0.50/month per hosted zone plus registration. The Amplify URL is fine for a hackathon |
| SES / SNS for notifications | SES needs domain verification and a sandbox exit; SNS SMS costs per message. In-app reminders are honest about what actually happened |
| Kafka / MSK / Kinesis | Buzzword infrastructure for an event volume EventBridge handles for free |
| Step Functions | Billed per state transition, for a workflow with no orchestration need |
| X-Ray | Billed per trace; structured logs already carry what is needed |
| CloudWatch dashboards | 3 free then $3/month each; Logs Insights covers it |
| Provisioned concurrency | A fixed monthly charge to remove a cold start nobody complained about |
| WAF | ~$5/month for the web ACL plus per-rule and per-request charges. Gateway throttling is the free control that matters here |
| A paid Maps API | Locality text plus optional coarse browser geolocation is sufficient, and storing less location data is better for privacy anyway |
| Paid AI models or grounding | Free-tier flash is more than adequate for classifying a sentence |

---

## 3. Estimated monthly cost

Assuming a hackathon deployment and light real usage — say 5,000 API requests,
500 analyses, 200 cases, 100 evidence uploads, 30 daily sweeps:

| Service | Usage | Cost |
| --- | --- | --- |
| Amplify Hosting | ~30 build minutes, <1 GB served | **$0.00** (free tier) |
| API Gateway | 5,000 requests | **$0.00** (1M free) |
| Lambda | ~5,100 invocations, ~600 GB-s | **$0.00** (1M / 400k GB-s free) |
| DynamoDB | ~15,000 reads, ~3,000 writes, <100 MB | **$0.00** (free tier) |
| S3 | 100 PUTs, ~500 GETs, <1 GB | **$0.00** (free tier) |
| Cognito | <50 MAU | **$0.00** (50k free) |
| EventBridge | ~1,000 custom events, 30 scheduled | **$0.00** (custom events free) |
| CloudWatch | <100 MB logs, 3 alarms | **$0.00** (free tier) |
| SSM Parameter Store | 2 standard SecureStrings | **$0.00** |
| AWS Budgets | 1 budget | **$0.00** (2 free) |
| Gemini | ~500 classifications | **$0.00** (free tier) |
| Fargate (status worker, opt-in) | 30 runs × ~3 min @ 0.5 vCPU / 1 GB | **≈ $0.04** |
| Public IPv4 (worker, while running) | ~1.5 hours/month @ $0.005/hr | **≈ $0.01** |
| ECR storage (Playwright image) | ~2 GB, 3 images retained | **≈ $0.20** |
| **Total** | | **≈ $0.25** |

Beyond the free tier the marginal cost stays small: roughly **$1.00 per million**
API Gateway requests, **$0.20 per million** Lambda requests plus GB-seconds,
**$1.25 per million** DynamoDB writes and **$0.25 per million** reads, and
**$0.023 per GB-month** of S3.

The status-check worker is the only component that is not free, and it is
opt-in (`-c enableWorker=true`). Its cost is dominated by ECR image storage
rather than compute: the task itself runs for about three minutes a day. There
is no cluster charge, no NAT gateway and nothing billing by the hour — an idle
deployment with the worker enabled still costs only the ~$0.20 of stored image.

The realistic worst case is a traffic spike. At the configured throttle of 10 rps
sustained, a full month of saturated traffic is ~26M requests — about **$26 of
API Gateway** plus a few dollars of Lambda and DynamoDB. That is the ceiling the
throttle sets, and the volume alarm fires long before it is approached.

---

## 4. Cost controls, in layers

1. **API Gateway stage throttle** — 10 rps sustained, 20 burst. The hard ceiling
   on request-driven spend.
2. **Per-user rate limit** — 10 analyses/minute on the only endpoint with an
   external dependency.
3. **Request body cap** — 64 KB, checked before parsing.
4. **Evidence caps** — 8 MB per file, 6 files per case, uploads only into your own
   case.
5. **Bounded queries everywhere** — no `Scan`; the reminder sweep is capped at 100
   cases with a 14-day lookback; admin aggregates use bounded pages.
6. **TTL on everything disposable** — guest data 2 days, idempotency 24 hours,
   notifications 60 days, audit 400 days.
7. **S3 lifecycle rules** — abort incomplete uploads after 1 day; expire guest
   evidence after 2 days.
8. **7-day log retention** on every function.
9. **Bounded event retries** — 2 attempts, 1-hour max age, so a failing target
   cannot loop.
10. **Volume alarm** — an invocation spike is the early warning for a bill.
11. **The agent makes no AI calls** — it is deterministic, so agent usage cannot
    drive model spend.
12. **AWS Budget** — 50% actual and 100% forecast email alerts.
13. **`removalPolicy: DESTROY` on non-production stages** — a dev stage can be
    deleted completely, with nothing orphaned and still billing. Production
    retains data, on purpose.
14. **Cost allocation tags** — `Project`, `Stage`, `ManagedBy` on every resource,
    so Cost Explorer can attribute spend precisely.
15. **No billing on the Gemini project** — the hard ceiling on AI spend.

### Verifying it

```bash
# What is actually deployed
aws cloudformation describe-stack-resources --stack-name CivicSos-dev \
  --query 'StackResources[].ResourceType' --output text | tr '\t' '\n' | sort -u

# Confirm the budget exists
aws budgets describe-budgets --account-id "$(aws sts get-caller-identity --query Account --output text)"

# Confirm log retention is set (should be 7 everywhere)
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/civicsos \
  --query 'logGroups[].[logGroupName,retentionInDays]' --output table

# Month-to-date spend
aws ce get-cost-and-usage --time-period Start="$(date -u +%Y-%m-01)",End="$(date -u +%Y-%m-%d)" \
  --granularity MONTHLY --metrics UnblendedCost
```

### Tearing it down

A non-production stage deletes cleanly, including the bucket contents:

```bash
npm run cdk -w @civicsos/infra -- destroy -c stage=dev -c allowedOrigins=http://localhost:3000
```

The two SSM parameters are not managed by the stack, so remove them separately:

```bash
aws ssm delete-parameter --name /civicsos/dev/gemini-api-key
aws ssm delete-parameter --name /civicsos/dev/guest-session-secret
```
