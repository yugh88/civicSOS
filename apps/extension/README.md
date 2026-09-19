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
| Fill only fields listed in a verified mapping for that exact origin | Guess at selectors, or touch a field it was not configured for |
| Pause and wait when a login, OTP or CAPTCHA appears | Solve, bypass or automate any of them |
| Stop before the final Submit, every time | Click Submit, ever |
| Offer evidence links for the citizen to attach | Upload files on their behalf |
| Keep the payload in memory for the tab's lifetime | Store credentials, or persist the payload |

**It never handles a government login.** There is no credential field in the
payload type, no storage of one, and no code that reads a password input.

## Field mappings

`src/mappings.ts` maps a portal origin to CSS selectors. It ships **empty of
unverified entries on purpose**: writing selectors for a government site without
inspecting that site would be inventing them, and a wrong selector typing a
complaint into the wrong box is worse than no autofill at all.

Adding a portal is a data change — origin, a selector per supported field, and
the selector that marks "you are logged in". Until a mapping exists for the
current site, the assistant falls back to a **review panel**: the prepared
fields with one-click copy, which works on any portal and requires no selector
knowledge.

## Install (unpacked, for development)

```bash
npm run build -w @civicsos/extension
```

Then in Chrome: **Extensions → Developer mode → Load unpacked →** select
`apps/extension/dist`.

The extension is not published, and it is not required: the CivicSOS web app
works completely without it. Without the extension, "Continue on official
website" opens the verified channel and shows the copy-ready complaint.
