#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { CivicSosStack } from '../lib/civicsos-stack';

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

const stack = new CivicSosStack(app, `CivicSos-${stage}`, {
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
Tags.of(stack).add('Project', 'CivicSOS');
Tags.of(stack).add('Stage', stage);
Tags.of(stack).add('ManagedBy', 'cdk');
