# CivicSOS browser assistant

A small Manifest V3 extension that fills **supported fields on verified official
complaint portals** with a complaint the citizen has already approved in
CivicSOS.

## What it does, and what it refuses to do

A normal web page cannot read or write another origin's DOM, which is exactly
the protection that stops a site filling in your bank form. So the official
autofill path needs an extension. That extension is deliberately narrow:

| It does | It does not |
| --- | --- |
| Receive a payload the citizen approved in CivicSOS | Fetch anything from CivicSOS on its own |
| Fill only fields listed in a verified mapping for that exact page | Guess at selectors, or touch a field it was not configured for |
| Pause and wait when a login, OTP or CAPTCHA appears | Solve, bypass or automate any of them |
| Stop before the final Submit, every time | Click Submit, ever |
| Offer evidence links for the citizen to attach | Upload files on their behalf |
| Keep the payload in memory for the tab's lifetime | Store credentials, or persist the payload |

**It never handles a government login.** There is no credential field in the
payload type, no storage of one, and no code that reads a password input.

## Field mappings

`src/mappings.ts` maps a portal to CSS selectors. It ships with **no unverified
entries**: writing selectors for a government site without inspecting that site
would be inventing them, and a wrong selector typing a complaint into the wrong
box is worse than no autofill at all.

Adding a portal is a data change — origin, a selector per supported field, the
selector that marks "you are logged in", and the Submit selector the assistant
records so it can be certain never to click it. Add the origin to
`manifest.json` too; a mapping alone does nothing, because the content script
only runs where the manifest says it may. Until a mapping exists for the current
site, the assistant falls back to a **review panel**: the prepared fields with
one-click copy, which works on any portal and requires no selector knowledge.

### The practice portal

One mapping ships verified: the CivicSOS **practice portal** at
`/practice-portal`, which the web app serves itself
(`apps/web/src/app/practice-portal/page.tsx`). It is not a government website,
it is labelled as such at the top of the page, and it submits nothing anywhere.

It exists because the assistant's value is mostly in what it refuses to do, and
a refusal you cannot watch is just a claim. On the practice portal you can see
the assistant fill the seven supported fields, stop at the sign-in gate, stop
again at the CAPTCHA gate, and leave the Submit button alone — without pointing
an untested autofill at a real government form. Reach it from the "Continue on
official website" screen, under **See what the assistant does first**.

Because CivicSOS writes that page, its selectors are verifiable by construction
rather than by trust, and `build.mjs` checks every one of them against the page
on each build. Rename an id in `page.tsx` and the build fails instead of the
assistant quietly reporting a "verified" fill that filled nothing.

## Install (unpacked, for development)

```bash
npm run build -w @civicsos/extension
```

Then in Chrome: **Extensions → Developer mode → Load unpacked →** select
`apps/extension/dist`.

Chrome assigns the unpacked extension an ID on load. The web app only offers the
payload to IDs it has been told about, so copy that ID into the web app's
environment:

```bash
# apps/web/.env.local
NEXT_PUBLIC_ASSISTANT_EXTENSION_ID=<the id Chrome shows>
```

An extension ID is public, not a secret — it is configuration, and no secret
store is involved. Without it the app skips the hand-off entirely and shows the
copy-ready view, which is the path that always works.

The extension is not published, and it is not required: the CivicSOS web app
works completely without it. Without the extension, "Continue on official
website" opens the verified channel and shows the copy-ready complaint.
