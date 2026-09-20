#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { CivicSosStack } from '../lib/civicsos-stack';
import { EdgeStack } from '../lib/edge-stack';

/**
 * CDK entry point.
 *
 * Configuration comes from CDK context or the environment so the same stack can
 * be deployed to a dev stage and a prod stage without editing code:
 *
 *   npm run deploy -w @civicsos/infra -- -c stage=dev \
 *     -c allowedOrigins=https://main.d123.amplifyapp.com \
 *     -c alertEmail=you@example.com
 */

const app = new App();

const stage = app.node.tryGetContext('stage') ?? process.env.STAGE ?? 'dev';

const originsContext: string = app.node.tryGetContext('allowedOrigins') ?? process.env.ALLOWED_ORIGINS ?? '';
const allowedOrigins = originsContext
  .split(',')
  .map((origin: string) => origin.trim())
  .filter((origin: string) => origin.length > 0);

// Local development always needs to be able to call a dev deployment.
if (stage !== 'prod' && !allowedOrigins.includes('http://localhost:3000')) {
  allowedOrigins.push('http://localhost:3000');
}

if (allowedOrigins.length === 0) {
  throw new Error(
    'No allowed origins configured. Pass -c allowedOrigins=https://your-app-domain (comma separated).',
  );
}

const alertEmail = app.node.tryGetContext('alertEmail') ?? process.env.ALERT_EMAIL;
const budgetContext = app.node.tryGetContext('monthlyBudgetUsd') ?? process.env.MONTHLY_BUDGET_USD;

/**
 * The WAF web ACL must live in us-east-1 — an AWS constraint for CloudFront
 * scope, regardless of where everything else runs. `crossRegionReferences`
 * lets the main stack read its ARN without a manual copy-paste step.
 */
const edge = new EdgeStack(app, `CivicSos-${stage}-edge`, {
  stage,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  crossRegionReferences: true,
  description: `CivicSOS ${stage} — WAF web ACL for the API edge.`,
});

/**
 * A new AWS account cannot create CloudFront distributions until AWS verifies
 * it. Deploy with `-c enableEdge=false` to bring everything else up, then flip
 * it back on once verification lands.
 */
const enableEdge = app.node.tryGetContext('enableEdge') !== 'false';

/**
 * The containerised status-check worker is opt-in.
 *
 * It needs Docker running locally to build the image, and it is the only thing
 * in the stack that creates a VPC. Deploy with `-c enableWorker=true` when you
 * want it; leaving it off changes nothing about an existing deployment.
 */
const enableWorker = app.node.tryGetContext('enableWorker') === 'true';

const stack = new CivicSosStack(app, `CivicSos-${stage}`, {
  webAclArn: enableEdge ? edge.webAclArn : undefined,
  enableEdge,
  enableWorker,
  crossRegionReferences: true,
  stage,
  allowedOrigins,
  alertEmail,
  monthlyBudgetUsd: budgetContext ? Number(budgetContext) : 5,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: `CivicSOS ${stage} — serverless civic complaint resolution platform.`,
});

// Tags make per-project cost attribution possible in Cost Explorer.
for (const target of [stack, edge]) {
  Tags.of(target).add('Project', 'CivicSOS');
  Tags.of(target).add('Stage', stage);
  Tags.of(target).add('ManagedBy', 'cdk');
}
