# CivicSOS status-check worker

A containerised Chromium that runs **on demand** as an ECS Fargate task, reads a
public *track-your-complaint* page for a case the citizen has already filed, and
reports what it saw.

It is the only part of CivicSOS that is not a Lambda, and the only part that
drives a browser server-side.

## The gap it closes

Until now, a case with a real reference number sat in CivicSOS with the app
openly admitting it: *"CivicSOS takes your word for it — it cannot see the
official site."* The nightly sweep could tell a citizen that a follow-up was
due, but never whether anything had actually happened.

This worker makes that answer real. It looks, and the deterministic rules in
`@civicsos/core` decide what the answer means.

## What it does, and what it refuses to do

| It does | It does not |
| --- | --- |
| Visit a URL from the verified target registry | Accept a URL — it takes a `targetId`, so nothing upstream can redirect it |
| Type the citizen's own complaint reference | Type anything else; there is no code path that fills a second field |
| Press the lookup control | Press a submit control; the registry has no concept of one |
| Stop at a login wall or CAPTCHA and report `NEEDS_HUMAN` | Solve, bypass or automate either |
| Report an observation | Decide what a case's status becomes |
| Identify itself honestly in its User-Agent | Disguise its traffic as a person |

**It files nothing, changes nothing and submits nothing.** A status lookup is a
read: it creates no record at the authority, which is exactly why this is the
job a server-side browser is allowed to do. Filing a complaint would require a
government login, a CAPTCHA and a Submit click — all three of which CivicSOS
refuses by design, on screen and in code.

Its IAM task role permits exactly one action: `events:PutEvents` on the CivicSOS
bus. No DynamoDB, no S3, no API credential, no secret. A browser driving a page
it does not control is the least predictable component in the system, so it is
also the one with the least power.

## How it fits

```
DailySweepRule (02:30 UTC)
  └─ scheduler Lambda
       ├─ ReminderService.sweep()          reminders + escalation, as before
       └─ StatusCheckService.sweep()       picks cases worth looking up
            └─ ecs:RunTask ───────────────► ONE Fargate task, whole batch
                                              └─ Playwright reads each page
                                                   └─ PutEvents
                                                        │
  EventBridge  ◄────────────────────────────────────────┘
       └─ DomainEventsRule (civicsos.app | civicsos.worker)
            └─ events Lambda
                 └─ StatusCheckService.applyResult()   deterministic rules
```

One task per *batch*, not per case: a container cold start costs seconds, so
launching a dozen Chromiums to read a dozen references would turn a cheap
nightly job into an expensive one. The return path is EventBridge, where fan-in
is what you actually want, and the worker's results land on the same bus and the
same consumer as every other domain event.

## The target registry

`packages/core/src/status-check/targets.ts` ships with **no real government
entries**, for the same reason the extension's `PORTAL_MAPPINGS` does. Here the
stakes are if anything higher: a wrong selector does not mistype a complaint, it
reports a *status the portal never gave*, and a citizen told "resolved" stops
chasing a problem that is still there.

The one entry is the CivicSOS practice portal at `/practice-portal/status`,
whose markup lives in this repository — so its selectors are verifiable by
construction, and `build.mjs` re-checks every one of them against the page on
each build. Rename an id and the build fails rather than the worker reporting a
status it never read.

A case whose authority has no verified status page is simply never scheduled.
Nothing degrades; the citizen keeps the manual follow-up they already had.

Adding a real target requires someone to have actually:

1. Opened the portal's public track-your-complaint page.
2. Confirmed it needs no login to read a status.
3. Recorded the reference input, the lookup button and the result selector.
4. Recorded how that page spells "resolved" and "in progress".
5. Checked the site's terms permit an automated read of your own complaint.

## Reading the page

Classification is deterministic and deliberately not a language model.
`classifyStatusText` matches only against the target's own recorded vocabulary,
and handles negation explicitly — *"your complaint has not been resolved"*
contains the word "resolved", and a substring match alone would tell a citizen
their problem was fixed when the page said the opposite. A page that matches
nothing is `UNREADABLE`, never optimistically `IN_PROGRESS`.

## What an observation is allowed to change

Only one transition: `SUBMITTED → AWAITING_RESPONSE`, when the portal shows the
complaint as open.

It **cannot resolve a case**. "The portal says closed" and "the problem is
actually fixed" are different claims, and only the person standing in front of
the uncollected rubbish can make the second one. A `RESOLVED` reading notifies
the citizen and points out that a closed ticket on an unfixed problem is the
strongest evidence an escalation can have — but the case stays open until they
say otherwise.

## Politeness

These are public services with real running costs, read on behalf of citizens
who already have a right to the answer. So: one case at a time, a two-second gap
between page loads, at most 25 checks per sweep, at most one check per case per
20 hours, and an honest User-Agent that a site operator can see in their logs
and block if they want to.

## Running it

```bash
# Build the bundle (also re-verifies the practice selectors)
npm run build:worker

# Build the image — context is the repo root
docker build -f apps/worker/Dockerfile -t civicsos-worker .

# Run one batch against a locally running practice portal
docker run --rm \
  -e PRACTICE_BASE_URL=http://host.docker.internal:3000 \
  -e STATUS_CHECK_BATCH='[{"caseId":"case_1","ownerId":"u1","targetId":"CIVICSOS_PRACTICE","officialReference":"SWM/2026/118472"}]' \
  civicsos-worker
```

With no `EVENT_BUS_NAME` set it reads the pages and logs the outcomes without
publishing, which is the useful shape for local work.

## Deploying

Opt-in, because it is the only part of the stack that needs Docker on the
machine running `cdk deploy` and the only part that creates a VPC:

```bash
npm run cdk -- deploy CivicSos-dev -c enableWorker=true
```

Leaving the flag off changes nothing about an existing deployment.
