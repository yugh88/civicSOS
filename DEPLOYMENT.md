# Deployment

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Local development](#2-local-development)
3. [Deploy the backend](#3-deploy-the-backend)
4. [Create the two secrets](#4-create-the-two-secrets)
5. [Deploy the frontend](#5-deploy-the-frontend)
6. [Verify the deployment](#6-verify-the-deployment)
7. [Create an admin user](#7-create-an-admin-user)
8. [Environment variables](#8-environment-variables)
9. [AWS resources created](#9-aws-resources-created)
10. [Rollback](#10-rollback)
11. [Teardown](#11-teardown)
12. [CI/CD](#12-cicd)
13. [Operations](#13-operations)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Prerequisites

| Requirement | Notes |
| --- | --- |
| Node.js 20+ | `node -v` |
| AWS CLI v2 | `brew install awscli`, then `aws configure` |
| An AWS account | Free tier is sufficient. See [COST.md](COST.md) |
| A Gemini API key | Optional. Free tier only — do **not** enable billing |
| A GitHub repository | Only needed for Amplify's Git-driven builds |

You do not need the CDK CLI installed globally; it is a dev dependency of
`@civicsos/infra`.

### Configure AWS credentials

```bash
aws configure
# AWS Access Key ID, Secret Access Key, region (e.g. ap-south-1), output: json
aws sts get-caller-identity   # should print your account id
```

Pick a region close to your users. `ap-south-1` (Mumbai) is the sensible default
for an Indian civic service.

### Bootstrap CDK (once per account and region)

```bash
npx --yes cdk@2 bootstrap "aws://$(aws sts get-caller-identity --query Account --output text)/$(aws configure get region)"
```

This creates the small S3 bucket and roles CDK uses to stage assets. It costs
effectively nothing.

---

## 2. Local development

The whole product runs with no AWS account and no API key:

```bash
npm install
npm run dev
```

Open <http://localhost:3000> and click **Try the demo**.

In local mode the Next.js server runs the *same* router, services and rules as
the deployed Lambda, against in-memory adapters. The local API is automatically
disabled the moment `NEXT_PUBLIC_API_BASE_URL` is set, so there is exactly one
active API per environment.

Optional local configuration — `apps/web/.env.local` (git-ignored):

```bash
# Enables real AI locally. Server-side only: NOT prefixed NEXT_PUBLIC_.
GEMINI_API_KEY=your-free-tier-key
GEMINI_MODEL=gemini-2.0-flash
LOG_LEVEL=debug

# Optional: a stable guest-session secret so demo tokens survive a restart.
# One is generated per process if omitted.
GUEST_SESSION_SECRET=at-least-32-characters-of-random-text
```

Useful during development:

```bash
npm test                    # 131 tests, sub-second
npm run verify              # typecheck + test + production build
curl -X POST http://localhost:3000/api/dev/sweep   # run the reminder sweep now
```

---

## 3. Deploy the backend

**Build the shared package first.** The CDK stack bundles the Lambda entry points
from `packages/aws/src`, which import `@civicsos/core`:

```bash
npm run build -w @civicsos/core
```

Check what will be created before creating it:

```bash
npm run cdk -w @civicsos/infra -- diff \
  -c stage=dev \
  -c allowedOrigins=http://localhost:3000
```

Deploy:

```bash
npm run deploy:infra -- \
  -c stage=dev \
  -c allowedOrigins=http://localhost:3000 \
  -c alertEmail=you@example.com \
  -c monthlyBudgetUsd=5 \
  --outputs-file infra-outputs.json
```

| Context value | Required | Purpose |
| --- | --- | --- |
| `stage` | yes | Resource name prefix. `prod` enables PITR and retains data on delete |
| `allowedOrigins` | yes | Comma-separated exact browser origins for CORS. `http://localhost:3000` is added automatically for non-prod |
| `alertEmail` | no | Creates the AWS Budget with 50%/100% alerts. **Strongly recommended** |
| `monthlyBudgetUsd` | no | Budget ceiling, default 5 |

The first deploy takes 3–5 minutes. Outputs you will need:

```
ApiBaseUrl                 https://abc123.execute-api.ap-south-1.amazonaws.com
UserPoolId                 ap-south-1_XXXXXXXXX
UserPoolClientId           1a2b3c4d5e6f7g8h9i0j
TableName                  civicsos-dev-main
EvidenceBucketName         civicsos-dev-evidence-123456789012
EventBusName               civicsos-dev-events
GeminiKeyParameterName     /civicsos/dev/gemini-api-key
GuestSecretParameterName   /civicsos/dev/guest-session-secret
```

> **Note on `allowedOrigins`.** You will not know your Amplify URL until after the
> frontend is deployed. Deploy the backend with `http://localhost:3000`, deploy
> the frontend, then re-run the backend deploy with the real origin added. This
> also updates the S3 bucket's CORS rules, which is why it matters for evidence
> uploads.

---

## 4. Create the two secrets

**These are not created by CloudFormation**, deliberately: CFN cannot create
SecureString parameters, and a secret should be written by a human with the CLI
rather than passed through a template where it would appear in the stack's event
history.

### The guest-session secret (required for the demo)

Generate and store it in one command — the value never touches your shell history
or a file:

```bash
aws ssm put-parameter \
  --name /civicsos/dev/guest-session-secret \
  --type SecureString \
  --value "$(openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48)" \
  --description "HMAC secret for CivicSOS guest demo session tokens" \
  --overwrite
```

If this parameter is missing or shorter than 32 characters, the runtime **disables
demo sessions** rather than signing weak tokens, and logs an error.

### The Gemini API key (optional)

```bash
aws ssm put-parameter \
  --name /civicsos/dev/gemini-api-key \
  --type SecureString \
  --value 'PASTE_YOUR_KEY_HERE' \
  --description "Gemini free-tier API key for CivicSOS classification" \
  --overwrite
```

Without it, CivicSOS runs on deterministic classification only. The product works
completely; the prose is a little more generic.

> Secrets are cached per Lambda container at cold start. After changing one, force
> new containers by touching the function configuration:
> ```bash
> aws lambda update-function-configuration \
>   --function-name civicsos-dev-api \
>   --description "reload secrets $(date -u +%FT%TZ)"
> ```

Confirm they exist (this prints names, not values):

```bash
aws ssm describe-parameters \
  --parameter-filters "Key=Name,Option=BeginsWith,Values=/civicsos/dev/" \
  --query 'Parameters[].[Name,Type]' --output table
```

---

## 5. Deploy the frontend

### Amplify Hosting (recommended)

1. Push the repository to GitHub.
2. AWS Console → **Amplify** → **Create new app** → **GitHub**, authorise, pick
   the repository and branch. *(This step needs a browser: it is an OAuth grant
   that cannot be scripted.)*
3. Amplify detects `amplify.yml` in the repository root — no build settings to
   type in.
4. Set these environment variables in **App settings → Environment variables**:

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_API_BASE_URL` | the `ApiBaseUrl` output |
   | `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | the `UserPoolId` output |
   | `NEXT_PUBLIC_COGNITO_CLIENT_ID` | the `UserPoolClientId` output |

   All three are public identifiers by design. **Never** put the Gemini key here —
   a `NEXT_PUBLIC_` variable is embedded in the browser bundle.

5. Deploy. Note the app URL, e.g. `https://main.d1a2b3c4d5e6f7.amplifyapp.com`.

6. **Re-run the backend deploy** with that origin, so CORS on both API Gateway and
   the S3 bucket accepts it:

   ```bash
   npm run deploy:infra -- \
     -c stage=dev \
     -c allowedOrigins=https://main.d1a2b3c4d5e6f7.amplifyapp.com \
     -c alertEmail=you@example.com
   ```

### Alternative: any Node host

The app is a standard Next.js 15 application — `npm run build -w @civicsos/web`
then `npm run start -w @civicsos/web`. Set the same three variables.

---

## 6. Verify the deployment

```bash
API=$(python3 -c "import json;print(json.load(open('infra-outputs.json'))['CivicSos-dev']['ApiBaseUrl'])")

# 1. Health, and whether the Gemini key was picked up
curl -s "$API/health"
# {"status":"ok","stage":"dev","time":"...","aiConfigured":true}

# 2. Public knowledge endpoint
curl -s "$API/knowledge/categories" | head -c 200

# 3. Private endpoints must refuse anonymous access
curl -s -o /dev/null -w '%{http_code}\n' "$API/cases"        # expect 401
curl -s -o /dev/null -w '%{http_code}\n' "$API/admin/overview" # expect 401

# 4. Demo session, end to end
TOKEN=$(curl -s -X POST "$API/auth/guest" -H 'content-type: application/json' -d '{}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

curl -s "$API/cases" -H "authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(len(d["cases"]),"demo cases")'

# 5. The core endpoint
curl -s -X POST "$API/cases/analyze" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"description":"There has been garbage outside my apartment for 4 days and it smells terrible."}' \
  | python3 -c 'import sys,json;a=json.load(sys.stdin)["analysis"];print(a["categoryId"],a["plan"]["authority"]["name"],"fallback:",a["usedFallback"])'

# 6. Cross-user isolation: a second guest must not see the first one's case
T2=$(curl -s -X POST "$API/auth/guest" -H 'content-type: application/json' -d '{}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
CID=$(curl -s "$API/cases" -H "authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["cases"][0]["caseId"])')
curl -s -o /dev/null -w '%{http_code}\n' "$API/cases/$CID" -H "authorization: Bearer $T2"  # expect 404

# 7. S3 must not be publicly readable
BUCKET=$(python3 -c "import json;print(json.load(open('infra-outputs.json'))['CivicSos-dev']['EvidenceBucketName'])")
aws s3api get-public-access-block --bucket "$BUCKET" \
  --query 'PublicAccessBlockConfiguration' --output table   # all four true
```

Then exercise the reminder sweep without waiting for 02:30 UTC:

```bash
aws lambda invoke --function-name civicsos-dev-scheduler \
  --payload '{}' --cli-binary-format raw-in-base64-out /dev/stdout

aws logs tail /aws/lambda/civicsos-dev-scheduler --since 5m --format short
```

Finally, open the Amplify URL in a browser, click **Try the demo**, and walk the
journey in [DEMO.md](DEMO.md).

---

## 7. Create an admin user

Roles come from Cognito group membership, never from anything the client sends.

```bash
POOL=$(python3 -c "import json;print(json.load(open('infra-outputs.json'))['CivicSos-dev']['UserPoolId'])")

# Sign up through the app first so the account exists and is verified, then:
aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$POOL" --username 'you@example.com' --group-name ADMIN

# AUTHORITY is read-only oversight:
aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$POOL" --username 'staff@example.com' --group-name AUTHORITY
```

Sign out and back in — group claims are baked into the ID token at sign-in.

---

## 8. Environment variables

### Lambda (set by the CDK stack; you do not edit these by hand)

| Variable | Value |
| --- | --- |
| `STAGE` | Deployment stage |
| `TABLE_NAME` | DynamoDB table |
| `EVIDENCE_BUCKET` | S3 bucket |
| `EVENT_BUS_NAME` | EventBridge bus |
| `USER_POOL_ID`, `USER_POOL_CLIENT_ID` | Cognito, for token verification |
| `GEMINI_API_KEY_PARAM` | SSM parameter **name**, not the key |
| `GUEST_SESSION_SECRET_PARAM` | SSM parameter **name**, not the secret |
| `GEMINI_MODEL` | `gemini-2.0-flash` |
| `ALLOWED_ORIGINS` | Comma-separated CORS allow-list |
| `SIGNED_URL_TTL_SECONDS` | 300 |
| `ANALYZE_RATE_LIMIT` | 10 per user per minute |
| `DEMO_ENABLED` | `false` disables guest sessions entirely |
| `LOG_LEVEL` | `info` |

### Frontend (you set these in Amplify)

| Variable | Secret? | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | No | Deployed API. When unset, the app serves its own in-memory API for local dev |
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | No | Public identifier |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | No | Public identifier |
| `GEMINI_API_KEY` | **Yes** | Local development only. Server-side; never `NEXT_PUBLIC_` |

---

## 9. AWS resources created

Stack `CivicSos-<stage>`:

| Resource | Name | Notes |
| --- | --- | --- |
| DynamoDB table | `civicsos-<stage>-main` | On-demand, TTL on `ttl`, 3 GSIs |
| S3 bucket | `civicsos-<stage>-evidence-<account>` | Private, SSE-S3, lifecycle rules |
| Cognito user pool | `civicsos-<stage>-users` | + web client, ADMIN and AUTHORITY groups |
| EventBridge bus | `civicsos-<stage>-events` | + domain-event rule, + daily schedule |
| Lambda × 3 | `civicsos-<stage>-{api,events,scheduler}` | arm64, Node 22 |
| Log groups × 3 | `/aws/lambda/civicsos-<stage>-*` | 7-day retention |
| HTTP API | `civicsos-<stage>-api` | 10 rps / 20 burst |
| Alarms × 3 | `civicsos-<stage>-{api-errors,scheduler-errors,api-unusual-volume}` | |
| Budget | `civicsos-<stage>-monthly` | Only when `alertEmail` is given |

Created outside the stack, by you: two SSM SecureString parameters under
`/civicsos/<stage>/`.

`prod` differs in two ways: point-in-time recovery is enabled, and data resources
are retained rather than destroyed on stack deletion.

---

## 10. Rollback

### Roll back the backend

CloudFormation rolls back automatically on a failed deploy. To undo a *successful*
deploy, redeploy the previous commit:

```bash
git checkout <previous-good-commit>
npm ci && npm run build -w @civicsos/core
npm run deploy:infra -- -c stage=dev -c allowedOrigins=<origins>
```

For a Lambda-only regression, the fastest path is to shift the alias/version or
re-deploy the prior code. To see what CloudFormation did:

```bash
aws cloudformation describe-stack-events --stack-name CivicSos-dev \
  --max-items 25 --query 'StackEvents[].[Timestamp,LogicalResourceId,ResourceStatus,ResourceStatusReason]' \
  --output table
```

### Roll back the frontend

Amplify keeps every build. Console → the app → the branch → pick an earlier
successful build → **Redeploy this version**. This is the fastest rollback in the
system, and it is independent of the backend.

### Data

DynamoDB writes are not versioned. `prod` has point-in-time recovery, so restore
to a timestamp:

```bash
aws dynamodb restore-table-to-point-in-time \
  --source-table-name civicsos-prod-main \
  --target-table-name civicsos-prod-main-restored \
  --restore-date-time 2026-09-17T18:00:00Z
```

Restoring creates a *new* table; repoint `TABLE_NAME` at it rather than deleting
the original.

### Compatibility rules

- Adding a field is always safe: readers ignore unknown attributes.
- Removing or renaming a field needs two deploys — stop writing it, then stop
  reading it.
- Adding a GSI is an online operation; existing items are backfilled.
- Changing a key pattern is a migration, not a deploy.

---

## 11. Teardown

Non-production stages delete cleanly, including bucket contents:

```bash
npm run cdk -w @civicsos/infra -- destroy -c stage=dev -c allowedOrigins=http://localhost:3000
```

Then remove the parameters, which the stack does not manage:

```bash
aws ssm delete-parameter --name /civicsos/dev/gemini-api-key
aws ssm delete-parameter --name /civicsos/dev/guest-session-secret
```

And delete the Amplify app from the console.

`prod` retains the table and bucket by design; delete them explicitly if you
really mean to.

---

## 12. CI/CD

`.github/workflows/ci.yml` runs on every push and pull request, with **no AWS
credentials**:

typecheck every workspace → run the test suite → build core and aws → production
build the web app → lint → `cdk synth` → confirm `docs/openapi.json` is current →
fail if a credential-shaped string is committed.

`.github/workflows/deploy.yml` is **manual only** (`workflow_dispatch`). On a
free-tier account, deploying on every merge is a good way to get a surprise bill,
so deployment is a deliberate act. It re-runs the tests before deploying.

To enable it, configure the repository with:

- `vars.AWS_REGION`
- `secrets.AWS_DEPLOY_ROLE_ARN` — an IAM role trusting GitHub's OIDC provider
  (preferred over long-lived access keys)
- `secrets.ALERT_EMAIL`

Minimal trust policy for that role:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::<ACCOUNT>:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike": { "token.actions.githubusercontent.com:sub": "repo:<OWNER>/<REPO>:*" }
    }
  }]
}
```

Attach a permissions policy that allows CloudFormation plus the CDK bootstrap
roles. For a hackathon account `PowerUserAccess` plus `iam:*` scoped to the
stack's roles is the pragmatic choice; for anything long-lived, scope it down.

---

## 13. Operations

### Logs

Structured JSON, one object per line, every field redacted for PII.

```bash
aws logs tail /aws/lambda/civicsos-dev-api --follow --format short

# Errors only
aws logs filter-log-events --log-group-name /aws/lambda/civicsos-dev-api \
  --filter-pattern '{ $.level = "error" }' --max-items 20

# Trace one request end to end
aws logs filter-log-events --log-group-name /aws/lambda/civicsos-dev-api \
  --filter-pattern '{ $.requestId = "req_0mu5wvo7uv3wnz9g4" }'
```

Useful Logs Insights queries:

```sql
-- How often does the AI fall back, and why?
fields @timestamp, reason, status
| filter message like /ai analysis unavailable|ai output rejected/
| stats count() by reason

-- Slowest routes
fields @timestamp, route, durationMs
| filter ispresent(durationMs)
| stats avg(durationMs), max(durationMs), count() by route

-- Authorization denials
fields @timestamp, code, route
| filter code in ["FORBIDDEN", "UNAUTHENTICATED", "RATE_LIMITED"]
| stats count() by code, route
```

### The audit trail

```bash
aws dynamodb query --table-name civicsos-dev-main \
  --key-condition-expression 'pk = :d' \
  --expression-attribute-values "{\":d\":{\"S\":\"AUDIT#$(date -u +%F)\"}}" \
  --max-items 20
```

### Alarms

```bash
aws cloudwatch describe-alarms --alarm-name-prefix civicsos-dev \
  --query 'MetricAlarms[].[AlarmName,StateValue]' --output table
```

---

## 14. Troubleshooting

**`aws: command not found`** — `brew install awscli` (macOS) or see the AWS docs.

**`Need to perform AWS CDK bootstrap`** — run the bootstrap command in §1.

**`Module not found: Can't resolve '@civicsos/core'` during a CDK deploy** — run
`npm run build -w @civicsos/core` first. The Lambda bundler needs it built.

**`No allowed origins configured`** — pass `-c allowedOrigins=...`. This is a
deliberate hard failure; defaulting to `*` on a credentialed API would be unsafe.

**CORS errors in the browser** — the Amplify origin must be in `allowedOrigins`
and the backend re-deployed. Both API Gateway and the S3 bucket take their CORS
rules from it; the bucket's rules are what evidence upload depends on.

**`aiConfigured: false` on `/health`** — the Gemini parameter is missing or the
container is still running with the old cached value. Check
`aws ssm get-parameter --name /civicsos/dev/gemini-api-key --with-decryption` and
then force new containers as shown in §4.

**Demo sessions return 403** — the guest secret is missing or under 32 characters.
The runtime disables the demo rather than signing weak tokens; check the API
Lambda's logs for `guest session secret missing or too short`.

**Sign-up emails not arriving** — Cognito's default sender is limited to about 50
a day. For more, configure SES (see [COST.md](COST.md) for why it is not wired up
by default).

**Evidence uploads fail with 403 from S3** — the pre-signed PUT must be sent with
*exactly* the headers the API returned; they are part of the signature. Also check
the bucket's CORS `allowedOrigins`.

**`Cannot read properties of undefined` piping JSON in zsh** — use
`printf '%s'`, not `echo`. zsh's builtin `echo` interprets `\n` inside JSON
strings and corrupts the payload.
