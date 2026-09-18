# Three-minute demo

## The one-line pitch

> "Everyone knows what's wrong on their street. Almost nobody knows what to do
> about it. CivicSOS turns a sentence into a plan — and then makes sure you
> actually follow it through."

---

## Before you start

**Setup (2 minutes, done in advance):**

```bash
npm run dev          # or open the deployed Amplify URL
```

- Open two tabs: the app, and the [architecture diagram](ARCHITECTURE.md#2-system-architecture).
- Click **Try the demo** once beforehand, then sign out. This warms the Lambda
  and confirms the demo path works.
- Have this sentence on your clipboard:

  > `There has been garbage outside my apartment for 4 days and it smells terrible now.`

- Zoom the browser to ~110% so the timeline is legible on a recording.

**Do not** narrate the technology during the first half. Judges see a working
product or they don't; the architecture slide comes at the end and takes 25
seconds.

---

## The script

### 0:00 — 0:20 · The problem

> "This is a real problem I have had, and so has everyone in this room.
> There's garbage outside my building. I know exactly what's wrong. I have no
> idea which department handles it, what they'll ask me for, what to write, or
> what to do when nothing happens."

Land on the home page. One large input, one question: **What problem are you
facing?**

> "No forms. No department names to look up. Just tell it what happened."

---

### 0:20 — 0:50 · Describe → understand

Paste the sentence. Click **Help me solve this**.

While it works (~1–2 seconds):

> "It's sending that text to Gemini — but only after stripping out phone numbers,
> emails and ID numbers. The model never sees who reported it."

The plan appears. Point at, in order:

- **Category badge** — "Garbage & sanitation. It worked that out itself."
- **Who handles this** — "Municipal corporation, sanitation and solid waste."
- **The "Generic guidance" badge** — pause here, it matters:

> "And look at this badge. CivicSOS does **not** ship a verified directory of
> city offices, so it says so. It will never invent a phone number for your city.
> What it does give you is the real national channel — the Swachhata app, marked
> 'Official channel' — which routes to your own urban local body."

---

### 0:50 — 1:20 · The differentiator

Scroll to **What happens next**.

> "This is the part that doesn't exist anywhere else. Not a chatbot answer — a
> dated plan."

Point at the timeline:

> "What's done. What to do **now** — exactly one step is highlighted. What the
> authority does next. When acknowledgement is due. When to follow up. And the
> escalation ladder if you're ignored: ward inspector at 14 days, CPGRAMS at 30."

Then scroll to the complaint letter:

> "And a complaint letter, ready to submit. Notice these" — point at a `[[TOKEN]]`
> — "CivicSOS leaves a blank rather than inventing your name or the date. It
> doesn't guess."

---

### 1:20 — 1:50 · The AI honesty beat

This is the beat that separates the project from a wrapper. **Say it plainly:**

> "Here's the design decision the whole thing rests on. Gemini does four narrow
> things: picks one of our fixed categories, writes the summary, tidies the prose,
> and notices what you forgot to mention.
>
> It decides **nothing** else. Not which authority. Not what evidence is needed.
> Not the response windows, the follow-up date, the escalation policy, or who's
> allowed to see what. All of that is a deterministic rules engine, because
> letting a language model route a sewage complaint is a liability, not a feature.
>
> If Gemini is down, rate-limited, or returns garbage — you still get this exact
> plan. It just says so."

**Optional, if the moment is going well** — show it rather than claim it. In a
terminal:

```bash
curl -s -X POST localhost:3000/api/cases/analyze \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"description":"There has been garbage outside my apartment for 4 days.","skipAi":true}' \
  | python3 -c 'import sys,json;a=json.load(sys.stdin)["analysis"];print(a["categoryId"],"|",a["plan"]["authority"]["name"])'
```

> "Same category. Same authority. Same plan. No AI involved."

---

### 1:50 — 2:25 · Tracking, reminders, escalation

Click **Create my case**, then **My cases**.

> "Now it's tracked. But a case you forget about is a case that doesn't get
> fixed — so watch this."

Open **"Uncollected garbage outside an apartment gate for six days"** (the seeded
overdue case).

> "This one is 20 days past submission. CivicSOS knows that."

Point at:

- The amber **"This is past its follow-up date"** banner.
- **"Escalate to step 2"** — an active button, not a greyed-out one.
- The timeline: five steps done, **"Escalate if still unresolved — Do this now"**.

> "A daily EventBridge sweep found this, put a reminder in the citizen's inbox,
> and unlocked escalation step 2 — but only because 20 days have actually passed.
> Try to escalate on day one and the rules engine refuses, and tells you why.
> Escalating early weakens your position."

Point at the **Demo data** badge:

> "And every seeded case is labelled. Demo data is never mistaken for real data
> — it's counted separately in the admin dashboard too."

---

### 2:25 — 2:50 · The architecture

Switch to the architecture diagram. Do not read it out.

> "All of it is serverless and inside the free tier. Amplify hosts the Next.js
> app. API Gateway throttles at 10 requests a second — that's the cost ceiling.
> One Lambda on Graviton runs the API. DynamoDB, single table, three indexes, no
> table scan in any flow. S3 holds evidence privately: the browser uploads
> straight to it with a pre-signed URL, so file bytes never touch our compute.
> Cognito for accounts. EventBridge for the daily sweep. Secrets in Parameter
> Store — free, unlike Secrets Manager.
>
> The business logic package imports no AWS SDK at all. That's why 131 tests run
> in under a second, and why the whole product runs locally with no AWS account."

---

### 2:50 — 3:00 · Close

> "CivicSOS doesn't file your complaint for you, and it says so on every screen.
> What it does is remove the reason most civic problems never get reported:
> nobody knows what to do. Tell it what happened. It figures out what you should
> do next."

---

## Screens in order

| Time | Screen | The point |
| --- | --- | --- |
| 0:00 | Home | One question, no form |
| 0:35 | Analysis result | Category, authority, honesty badge |
| 0:55 | "What happens next" | The differentiator |
| 1:10 | Complaint letter | Ready to submit, blanks not guesses |
| 1:20 | (talking) | The AI boundary |
| 1:55 | My cases | Tracking, overdue banner |
| 2:05 | Overdue case detail | Reminder + escalation unlocked |
| 2:30 | Architecture diagram | AWS, 25 seconds |

---

## Recording tips

- **Trim the waiting.** Cut any dead air while analysis runs.
- **Highlight, don't describe.** Cursor on the badge you are talking about.
- **Don't scroll fast.** The timeline is the best thing in the product; let it
  sit on screen for three seconds.
- **Keep the browser chrome plain.** No bookmarks bar, no extensions visible.
- **Record at 1440×900 or larger** and crop; the layout is mobile-first, so it
  reflows beautifully, but a desktop capture reads better in a video.

---

## If something goes wrong on stage

| Problem | What to do |
| --- | --- |
| Analysis is slow | It is time-boxed to 8 seconds, then falls back. Say: *"and that's the fallback — no AI, same plan."* It is a better demo than the happy path. |
| Demo session won't start | The guest secret is missing. Run against local (`npm run dev`), where one is generated automatically. |
| No internet | Local mode needs none. The whole journey works offline against in-memory adapters. |
| Deployed API is down | Switch to `localhost:3000`. It is the same code. |

---

## The questions judges actually ask

**"Isn't this just a ChatGPT wrapper?"**
> No — and you can prove it. `skipAi: true` produces an identical plan. The model
> contributes the summary and the prose. The authority, evidence, timings and
> escalation policy come from a knowledge layer you can read in one file and a
> rules engine that is pure functions. Remove Gemini entirely and the product
> still works; there are tests that assert exactly that.

**"How do you know the government information is right?"**
> We are explicit that we don't, for city-level offices. Those records are marked
> as generic templates in the data and rendered with a "Generic guidance" badge in
> the UI. We never invent a phone number or a city portal URL. The channels we
> mark "Official" are a small set of genuinely national ones — CPGRAMS, the
> Swachhata app, 112, the NHAI helpline. The `AuthorityRecord` shape already
> carries `isSample` and `sourceNote` so a verified directory can be loaded later
> with no code change.

**"What stops someone running up your AWS bill?"**
> Four layers: API Gateway throttles at 10 rps, a per-user limit of 10 analyses a
> minute on the only endpoint that costs money, a 64 KB body cap checked before
> parsing, and an AWS Budget with alerts at 50% actual and 100% forecast. Plus
> there is no `Scan` anywhere, 7-day log retention, and TTLs on everything
> disposable. See COST.md.

**"Why one Lambda instead of microservices?"**
> The modular boundary that matters is in the code — router, services, rules,
> knowledge, ports — and it's already there. Splitting the deployment would add a
> dozen cold starts, roles, and log groups for isolation this product doesn't
> need. The two functions that *are* separate — the event consumer and the daily
> scheduler — are separate because they have genuinely different failure
> semantics, retries and triggers.

**"What's the weakest part?"**
> Tokens live in browser storage rather than httpOnly cookies, and the page CSP
> still needs `'unsafe-inline'` because of Next's inline bootstrap. Both are named
> in SECURITY.md §10 along with six other known limitations, rather than glossed
> over.

**"What would you build next?"**
> Replace the generic authority templates with a verified, city-level directory —
> the data model is already shaped for it. Then SES-backed email reminders, which
> we skipped because they cost money and an unread in-app reminder is at least
> honest about what happened.
