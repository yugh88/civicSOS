CIVICSOS — AUTONOMOUS HACKATHON BUILD PROMPT

You are the lead architect, senior full-stack engineer, DevOps engineer, security engineer, QA engineer, and UX engineer for this project.

Your job is to BUILD, TEST, DEBUG, DOCUMENT, and DEPLOY the complete production-quality MVP described below.

Do not merely give me instructions or code snippets. Work through the project yourself and modify/create the files directly whenever your environment allows it.

Optimize your token usage: inspect efficiently, avoid repeating information, don’t explain routine work, and make decisions yourself. Only ask me something when it requires an account, credential, browser confirmation, physical action, or another action you genuinely cannot perform.

⸻

1. PRODUCT

Name: CivicSOS

Core promise:

“Tell CivicSOS what happened. It figures out what you should do next.”

CivicSOS solves a real public problem: citizens often know WHAT happened but don’t know:

* which authority handles it
* what evidence is required
* what process to follow
* how to submit the complaint
* what happens afterward
* when to follow up
* what escalation path exists

CivicSOS should NOT be just an AI chatbot.

The product flow is:

Citizen problem
→ understand/classify
→ identify location
→ identify responsible authority/process
→ determine required evidence
→ generate actionable complaint
→ provide official submission pathway
→ create case
→ track status
→ reminders
→ escalation guidance
→ resolution

Initial supported categories:

1. Roads / potholes
2. Garbage / sanitation
3. Streetlights
4. Water / sewerage
5. Public safety hazards

Architect the system so additional categories can be added through configuration/data rather than major code rewrites.

⸻

2. HACKATHON CONTEXT

Hackathon: WeMakeDevs + AWS First Commit / Bharat Builds Tour.

Judging emphasizes:

* real-world impact
* AWS usage
* learning
* execution / working product
* 3-minute recorded demo

AWS usage is mandatory for prize eligibility.

The project must therefore use AWS meaningfully, not artificially.

We are targeting the deployed/Ship It track.

Do NOT waste AWS credits.

Assume we have a very limited/free-tier budget.

⸻

3. NON-NEGOTIABLE COST POLICY

Use free-tier or no-cost options wherever possible.

Preferred architecture:

* Next.js
* TypeScript
* AWS Amplify Hosting
* API Gateway
* AWS Lambda
* DynamoDB
* S3
* Cognito
* EventBridge
* CloudWatch
* Gemini API free tier

Avoid unless absolutely necessary:

* EC2
* RDS
* ElastiCache / Redis
* ECS
* EKS
* NAT Gateway
* OpenSearch
* continuously running infrastructure
* paid SaaS
* paid APIs
* paid AI models
* unnecessary AWS services

DO NOT introduce technology merely because it sounds advanced.

Every infrastructure component must have a clear architectural reason.

Before deployment, create/configure cost controls and billing alerts where possible.

Never intentionally create infrastructure that can generate significant recurring charges.

⸻

4. GEMINI

Gemini may be used for natural-language understanding where it genuinely improves the product.

Use ONLY a free Gemini API tier.

Do not enable paid billing.

Do not use paid grounding/search/maps/features.

The API key must NEVER be committed to Git.

Use environment variables / secret configuration.

Expected flow:

User input
→ PII minimization
→ Gemini
→ structured validated JSON
→ deterministic backend validation
→ rules engine
→ application action

Gemini must NOT independently control:

* authorization
* security
* database permissions
* escalation policy
* critical business rules
* final routing decisions without validation

The application must remain functional if Gemini temporarily fails.

Implement graceful fallback.

⸻

5. IMPORTANT HUMAN-ACTION RULE

You should autonomously perform everything you can.

Only stop and ask me for help when an action genuinely requires me, such as:

* AWS account login
* accepting an AWS confirmation
* adding/verifying a payment method if AWS explicitly requires it
* creating/copying an API key
* entering a secret credential
* OAuth/browser approval
* CAPTCHA
* domain ownership verification
* physical device confirmation

When this happens:

1. Tell me exactly what is required.
2. Tell me exactly where to obtain it.
3. Tell me exactly where I need to paste/provide it.
4. Use a clearly named placeholder/environment variable.
5. Continue all other work without waiting if possible.

Do NOT ask me for information you can determine yourself.

Do NOT expose secrets in source code.

⸻

6. ARCHITECTURE

Design and implement a clean serverless architecture.

Baseline:

Frontend:
Next.js + TypeScript

Hosting:
AWS Amplify

API:
API Gateway

Compute:
Lambda

Database:
DynamoDB

Files/evidence:
S3

Authentication:
Cognito

Async events:
EventBridge

Monitoring:
CloudWatch

AI:
Gemini free API

Use a modular backend rather than one giant Lambda.

Suggested bounded services:

* Auth
* Complaint/Case
* Classification
* Resolution Guidance
* Authority/Process Knowledge
* Evidence
* Notifications/Reminders
* Escalation
* Audit
* Admin

Do not over-engineer into dozens of microservices.

Use a pragmatic modular serverless architecture.

⸻

7. DATA MODEL

Design DynamoDB carefully.

Entities should include at minimum:

User
Case
CaseEvent
Evidence
Authority
ResolutionPath
Category
Notification
AuditEvent

Use appropriate partition/sort keys and indexes.

Avoid table scans in normal application flows.

Document:

* access patterns
* keys
* GSIs
* retention considerations
* expected scale

Use timestamps consistently.

Use immutable audit events where appropriate.

⸻

8. SECURITY

Implement production-quality basic security.

Requirements:

* Cognito authentication
* role-based authorization
* least-privilege IAM
* private S3 bucket
* signed URLs for evidence
* server-side validation
* request size limits
* input sanitization
* rate limiting where appropriate
* CORS correctly configured
* secure headers
* no secrets in Git
* no PII in logs
* audit trail
* safe error messages
* Gemini input minimization

Roles:

CITIZEN
ADMIN
AUTHORITY

Do not allow users to access another user’s cases.

Validate authorization server-side.

Never rely on frontend authorization.

⸻

9. UX/UI

The UI is extremely important.

ONLY LIGHT MODE.

No dark mode.

Visual direction:

* clean white background
* subtle gray surfaces
* subtle blue/indigo accent
* restrained green/amber/red status colors
* generous whitespace
* rounded cards
* excellent typography
* accessible contrast
* mobile-first
* responsive
* simple
* trustworthy
* friendly
* modern
* not visually overloaded

Think “high-quality civic utility”, not “hackathon dashboard”.

The user should never need to understand the technology.

⸻

10. HOME PAGE

Primary message:

“What problem are you facing?”

Large input.

Example:

“There has been garbage outside my apartment for 4 days.”

Primary CTA:

“Help me solve this”

Also allow:

* optional photo
* optional location
* category selection if AI cannot determine it

Do NOT make users fill long forms initially.

Progressively collect information.

⸻

11. CORE USER JOURNEY

Implement this end-to-end:

1. User opens CivicSOS.
2. User describes a problem.
3. System analyzes it.
4. Category is identified.
5. Location is requested/confirmed.
6. Relevant authority/process is determined.
7. Required evidence is shown.
8. Complaint is generated.
9. User reviews and edits it.
10. User receives official submission guidance/link.
11. User creates a CivicSOS case.
12. Case appears in dashboard.
13. Status can be tracked.
14. Follow-up date is calculated/displayed.
15. Reminder event can be generated.
16. Escalation guidance is shown if unresolved.
17. Case can be marked resolved.
18. Full history remains visible.

The experience should feel extremely simple.

⸻

12. “WHAT HAPPENS NEXT?” FEATURE

This is a core differentiator.

Every case should clearly show:

* What happened
* Who handles it
* What I need
* What I should do now
* What happens after submission
* Expected response window
* When to follow up
* What to do if unresolved

Represent it visually as a simple timeline/checklist.

⸻

13. KNOWLEDGE / RESOLUTION ENGINE

Do NOT depend entirely on Gemini for civic knowledge.

Create a structured resolution knowledge layer.

Example:

Category:
ROAD_DAMAGE

Authority:
configured authority

Required evidence:
photo
location

Recommended action:
submit complaint through official pathway

Expected response:
configured value

Escalation:
configured steps

Gemini helps understand the user’s natural language.

The deterministic knowledge/rules layer controls the actual workflow.

Make knowledge records easy to extend.

Clearly mark demo/sample jurisdictional information.

Do not fabricate government contacts or claim unofficial information is official.

Where possible, provide links to official government channels.

⸻

14. LOCATION

Do not unnecessarily build a complex maps platform.

For MVP, allow:

* user-entered locality/city
* browser location permission where available
* manual correction

Store only what is necessary.

Do not add a paid Maps API.

⸻

15. ASYNC ARCHITECTURE

Use EventBridge where asynchronous behavior genuinely helps.

Example:

CaseCreated
→ EventBridge
→ reminder scheduling
→ audit event
→ notification

CasePastFollowUpDate
→ escalation evaluation

Keep synchronous request paths fast.

⸻

16. AI DESIGN

Create a strict structured schema for Gemini output.

For example:

{
category,
summary,
urgency,
location_hint,
missing_information,
suggested_evidence,
complaint_draft
}

Validate all output with a runtime schema.

If Gemini returns malformed output:

* retry safely if appropriate
* fallback to deterministic classification
* ask the user for clarification

Never trust raw LLM output.

Implement prompt injection resistance for user-generated content.

⸻

17. API DESIGN

Create clean REST APIs.

At minimum:

POST /cases/analyze
POST /cases
GET /cases
GET /cases/{id}
PATCH /cases/{id}
POST /cases/{id}/evidence
GET /cases/{id}/timeline
POST /cases/{id}/resolve
POST /cases/{id}/follow-up

Admin endpoints as required.

Use consistent:

* HTTP status codes
* error format
* validation
* authentication
* authorization

Generate OpenAPI documentation.

⸻

18. FRONTEND STRUCTURE

Suggested screens:

1. Landing
2. Report problem
3. Analysis/result
4. Resolution plan
5. Complaint review
6. Case created
7. My cases
8. Case details/timeline
9. Profile/settings
10. Admin dashboard (minimal but functional)

Do not create unnecessary screens.

⸻

19. UX DETAILS

Include:

* loading states
* skeleton states where appropriate
* empty states
* clear error messages
* retry actions
* confirmation states
* accessible forms
* keyboard accessibility
* mobile responsiveness
* optimistic UI only where safe
* clear CTAs
* no confusing jargon

Never display raw backend errors to users.

⸻

20. DEMO MODE

Because this is a hackathon, create a safe demo path using seeded/sample data.

But clearly distinguish:

DEMO DATA

from

REAL USER DATA.

The demo must work reliably without depending on a live government portal.

The 3-minute demo should show:

1. Real problem entered.
2. AI understanding.
3. Correct resolution path.
4. Evidence requirement.
5. Complaint generation.
6. Case creation.
7. Tracking.
8. Follow-up/escalation.
9. AWS architecture visibly demonstrated.

⸻

21. TESTING

Do not stop after implementation.

Implement and run:

* unit tests
* API tests
* validation tests
* authorization tests
* critical frontend tests where practical
* AI malformed-response tests
* fallback tests
* integration tests
* production build

Test:

* unauthenticated access
* cross-user access
* malformed input
* missing fields
* Gemini failure
* duplicate requests
* unauthorized admin access
* invalid case IDs
* S3 access
* expired/invalid signed URLs

Fix discovered issues yourself.

⸻

22. OBSERVABILITY

Implement useful structured logging.

Track:

* request ID
* case ID
* Lambda errors
* latency
* AI failure
* major state transitions

Never log:

* passwords
* tokens
* API keys
* unnecessary personal information

Add basic CloudWatch monitoring.

⸻

23. DEPLOYMENT

Build locally first.

Only deploy once the production build passes.

Deployment should be reproducible.

Prefer infrastructure-as-code.

Use AWS SAM/CDK/Terraform only if it materially improves the project and does not add unnecessary complexity.

Document:

* deployment commands
* environment variables
* AWS resources
* rollback process
* cost controls

Use GitHub Actions for CI/CD if practical.

⸻

24. DOCUMENTATION

Create:

README.md
ARCHITECTURE.md
SECURITY.md
API.md
DEPLOYMENT.md
COST.md
DEMO.md

README must clearly explain:

* problem
* solution
* architecture
* AWS services
* Gemini role
* setup
* deployment
* demo

ARCHITECTURE.md must contain:

* system architecture
* request flow
* async flow
* data model
* security model
* failure handling
* scalability
* tradeoffs

COST.md must explain why each AWS service was selected and how unnecessary costs are prevented.

⸻

25. SYSTEM DESIGN QUALITY

Apply strong engineering principles:

* separation of concerns
* SOLID where appropriate
* DRY without over-abstraction
* explicit interfaces
* typed contracts
* deterministic business rules
* idempotency where required
* graceful failure
* observability
* least privilege
* secure defaults
* scalability
* maintainability

But avoid premature abstraction.

The hackathon MVP must remain understandable.

⸻

26. WHAT NOT TO DO

Do NOT:

* build a generic chatbot
* build fake AI features
* add Redis/Kafka/MCP just for buzzwords
* add unnecessary microservices
* use paid APIs
* use paid Gemini
* create expensive AWS infrastructure
* hardcode secrets
* fabricate government information
* claim a complaint was submitted when it wasn’t
* pretend demo data is real
* make users complete huge forms
* create a cluttered dashboard
* use dark mode
* spend time polishing low-value features before the core flow works

⸻

27. PRIORITY ORDER

If time becomes limited, follow this order:

P0:
Core complaint → resolution workflow

P0:
AWS deployment

P0:
Authentication + security

P0:
Working Gemini integration + deterministic fallback

P0:
Case tracking

P0:
Excellent mobile/light UI

P1:
Evidence upload

P1:
Timeline

P1:
Reminder/escalation

P1:
Admin view

P2:
Advanced analytics

P2:
Extra categories

P2:
Nice-to-have animations

Never sacrifice P0 for P2.

⸻

28. AUTONOMOUS EXECUTION LOOP

Follow this loop continuously:

PLAN
→ INSPECT
→ IMPLEMENT
→ TEST
→ DEBUG
→ REVIEW
→ OPTIMIZE
→ DEPLOY
→ VERIFY
→ DOCUMENT

Do not repeatedly ask for confirmation.

Make reasonable engineering decisions yourself.

When you encounter an issue, investigate and fix it.

If blocked by a credential/account action, isolate that blocker and continue everything else.

⸻

29. HUMAN ACTION OUTPUT FORMAT

When something genuinely requires me, use exactly:

HUMAN ACTION REQUIRED

What:
Why:
Where:
<exact console/page/provider>

Value:
After you do this:
<what I should tell you / what you can continue doing>

Do not ask for credentials in normal chat if a safer environment-variable/secret mechanism exists.

Never ask me to paste a secret into source code.

⸻

30. FINAL QUALITY BAR

Before declaring completion, verify:

[ ] Core flow works end-to-end
[ ] AWS architecture is genuinely used
[ ] Deployment works
[ ] Free-tier/cost constraints respected
[ ] No paid external services
[ ] Gemini is free-tier only
[ ] Secrets are protected
[ ] Authentication works
[ ] Authorization works
[ ] Users cannot access other users’ data
[ ] AI failure has fallback
[ ] Structured AI output is validated
[ ] DynamoDB access patterns are sound
[ ] S3 is private
[ ] Async events work
[ ] Audit trail exists
[ ] UI is light mode only
[ ] Mobile UX is excellent
[ ] Empty/error/loading states exist
[ ] Demo data is clearly identified
[ ] No fabricated official claims
[ ] Tests pass
[ ] Production build passes
[ ] Documentation exists
[ ] Architecture is explainable in a hackathon judging session
[ ] 3-minute demo flow is ready

⸻

31. START NOW

First inspect the available workspace/environment.

Then:

1. Determine whether an existing project exists.
2. If not, initialize the project.
3. Create the architecture.
4. Implement the P0 functionality.
5. Test it.
6. Fix issues.
7. Implement P1 functionality.
8. Build the UI to the specified quality.
9. Configure AWS.
10. Deploy.
11. Verify the live application.
12. Create documentation.
13. Prepare the 3-minute demo flow.
14. Only interrupt me when a genuine human-only credential/account action is required.

Do not spend tokens explaining every implementation step.

Work like a senior engineer responsible for shipping the product.

The goal is not to produce a large amount of code.

The goal is to ship a small, extremely polished, genuinely useful, secure, well-architected, deployed product.