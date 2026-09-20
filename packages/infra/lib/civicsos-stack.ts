import * as path from 'node:path';
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { StatusCheckWorker } from './worker-construct';

/**
 * CivicSOS infrastructure.
 *
 * Every resource here is serverless and scale-to-zero. There is no EC2, no RDS,
 * no NAT gateway, no load balancer, no container platform and nothing that bills
 * by the hour — so an idle deployment of this stack costs essentially nothing.
 * COST.md explains the reasoning service by service.
 */

/** Lambda entry points live in the sibling @civicsos/aws package. */
const awsPackage = path.resolve(__dirname, '../../aws/src');

export interface CivicSosStackProps extends StackProps {
  /** Deployment stage, used in resource names and in log output. */
  stage: string;
  /** Exact browser origins allowed to call the API. */
  allowedOrigins: string[];
  /** Optional email for budget and error alarms. */
  alertEmail?: string;
  /**
   * WAF web ACL ARN from the us-east-1 edge stack. When absent the API is
   * still fronted by CloudFront, just without WAF.
   */
  webAclArn?: string;
  /**
   * Whether to place CloudFront in front of the API.
   *
   * Switchable because a brand-new AWS account cannot create CloudFront
   * distributions until AWS verifies it, and the rest of the platform should
   * not be held hostage to a support ticket. With this off the API is served
   * straight from API Gateway — which still has stage throttling, TLS and the
   * application's own limiter, just no WAF or edge cache.
   */
  enableEdge?: boolean;
  /**
   * Builds and deploys the containerised status-check worker.
   *
   * Off by default: it is the only part of the stack that needs Docker on the
   * machine running `cdk deploy`, and the only part that creates a VPC. An
   * existing deployment is entirely unaffected while this is false.
   */
  enableWorker?: boolean;
  /** Monthly budget ceiling in USD for the cost alarm. */
  monthlyBudgetUsd?: number;
}

export class CivicSosStack extends Stack {
  constructor(scope: Construct, id: string, props: CivicSosStackProps) {
    super(scope, id, props);

    const { stage } = props;
    const prefix = `civicsos-${stage}`;
    // Keeping non-production stages destroyable is itself a cost control.
    const isProd = stage === 'prod';
    const removalPolicy = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    /* ------------------------------------------------------------ */
    /* Data                                                         */
    /* ------------------------------------------------------------ */

    /**
     * Single-table design. On-demand billing means we pay per request rather
     * than for provisioned capacity sitting idle, which is both cheaper at this
     * scale and impossible to accidentally over-provision.
     */
    const table = new dynamodb.Table(this, 'MainTable', {
      tableName: `${prefix}-main`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // Guest demo data, idempotency markers and notifications expire on their own.
      timeToLiveAttribute: 'ttl',
      // Point-in-time recovery is a real cost per GB; enabled only for prod.
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: isProd },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy,
    });

    // "My cases", newest first.
    table.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
      // Case rows are small and the list view needs most fields.
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Staff queues and admin aggregates by status.
    table.addGlobalSecondaryIndex({
      indexName: 'gsi2',
      partitionKey: { name: 'gsi2pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi2sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    /**
     * Sparse follow-up index for the daily reminder sweep. Only open cases with
     * a follow-up date carry gsi3 keys, and the partition key is the due *day*,
     * so the sweep is a handful of small queries rather than a table scan.
     */
    table.addGlobalSecondaryIndex({
      indexName: 'gsi3',
      partitionKey: { name: 'gsi3pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi3sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    /**
     * Evidence bucket. Completely private: uploads and downloads happen only
     * through short-lived pre-signed URLs issued after a server-side
     * authorization check.
     */
    const evidenceBucket = new s3.Bucket(this, 'EvidenceBucket', {
      bucketName: `${prefix}-evidence-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: false,
      removalPolicy,
      autoDeleteObjects: !isProd,
      // Browsers PUT directly to S3, so the bucket needs its own CORS rules;
      // the API's CORS configuration does not apply to these requests.
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: props.allowedOrigins,
          allowedHeaders: ['content-type', 'content-length', 'x-amz-server-side-encryption'],
          exposedHeaders: ['etag'],
          maxAge: 600,
        },
      ],
      lifecycleRules: [
        {
          // Abandoned uploads would otherwise be billed indefinitely.
          id: 'abort-incomplete-uploads',
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
        {
          // Demo-session evidence is disposable; the matching DynamoDB rows
          // expire via TTL on the same schedule.
          id: 'expire-guest-demo-evidence',
          prefix: 'cases/guest_',
          expiration: Duration.days(2),
        },
      ],
    });

    /* ------------------------------------------------------------ */
    /* Identity                                                     */
    /* ------------------------------------------------------------ */

    /**
     * Cognito user pool. Email/password with a verification code sent by
     * Cognito's own free email sender — no SES setup and no cost, at the price
     * of a low daily send limit, which is documented in DEPLOYMENT.md.
     */
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${prefix}-users`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: false } },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
        tempPasswordValidity: Duration.days(3),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // Advanced security features are a paid tier; the free deterrents are
      // the password policy and API Gateway throttling.
      removalPolicy,
    });

    const userPoolClient = userPool.addClient('WebClient', {
      userPoolClientName: `${prefix}-web`,
      // Public browser client, so no secret and SRP rather than plain password.
      generateSecret: false,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      idTokenValidity: Duration.hours(1),
      accessTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });

    // Roles come from group membership, assigned by an administrator.
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'ADMIN',
      description: 'Full administrative access to the CivicSOS admin dashboard.',
      precedence: 1,
    });
    new cognito.CfnUserPoolGroup(this, 'AuthorityGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'AUTHORITY',
      description: 'Read-only oversight of case queues for authority staff.',
      precedence: 5,
    });

    /* ------------------------------------------------------------ */
    /* Events                                                       */
    /* ------------------------------------------------------------ */

    const eventBus = new events.EventBus(this, 'EventBus', { eventBusName: `${prefix}-events` });

    /* ------------------------------------------------------------ */
    /* Compute                                                      */
    /* ------------------------------------------------------------ */

    const geminiKeyParam = `/civicsos/${stage}/gemini-api-key`;
    const guestSecretParam = `/civicsos/${stage}/guest-session-secret`;

    const sharedEnvironment: Record<string, string> = {
      STAGE: stage,
      TABLE_NAME: table.tableName,
      EVIDENCE_BUCKET: evidenceBucket.bucketName,
      EVENT_BUS_NAME: eventBus.eventBusName,
      USER_POOL_ID: userPool.userPoolId,
      USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
      // Parameter *names*, not values: secrets are read from Parameter Store at
      // cold start so they never appear in a template or in Lambda config.
      GEMINI_API_KEY_PARAM: geminiKeyParam,
      GUEST_SESSION_SECRET_PARAM: guestSecretParam,
      GEMINI_MODEL: 'gemini-2.0-flash',
      ALLOWED_ORIGINS: props.allowedOrigins.join(','),
      SIGNED_URL_TTL_SECONDS: '300',
      ANALYZE_RATE_LIMIT: '10',
      LOG_LEVEL: 'info',
      // Trims a little cold-start latency on every SDK call.
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      NODE_OPTIONS: '--enable-source-maps',
    };

    const makeFunction = (name: string, entry: string, overrides: Partial<lambda.FunctionProps> = {}) =>
      new NodejsFunction(this, name, {
        functionName: `${prefix}-${name.toLowerCase()}`,
        entry: path.join(awsPackage, entry),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        // Graviton: same free tier, around 20% cheaper per GB-second beyond it.
        architecture: lambda.Architecture.ARM_64,
        memorySize: 512,
        timeout: Duration.seconds(20),
        environment: sharedEnvironment,
        // A week is plenty for debugging and keeps log storage negligible.
        logGroup: new logs.LogGroup(this, `${name}LogGroup`, {
          logGroupName: `/aws/lambda/${prefix}-${name.toLowerCase()}`,
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
        bundling: {
          minify: true,
          sourceMap: true,
          target: 'node22',
          format: undefined,
          // The SDK v3 clients we use are not in the Lambda runtime image, so
          // they are bundled; esbuild tree-shakes to just the commands used.
          externalModules: [],
        },
        ...overrides,
      });

    const apiFunction = makeFunction('Api', 'lambda/api.ts', {
      // The analyze endpoint waits on Gemini, which is time-boxed to 8 seconds.
      timeout: Duration.seconds(25),
      description: 'CivicSOS HTTP API: cases, analysis, evidence, admin.',
    });

    const eventsFunction = makeFunction('Events', 'lambda/events.ts', {
      timeout: Duration.seconds(15),
      memorySize: 256,
      description: 'Consumes CivicSOS domain events for notifications and audit.',
    });

    const schedulerFunction = makeFunction('Scheduler', 'lambda/scheduler.ts', {
      timeout: Duration.minutes(2),
      memorySize: 256,
      description: 'Daily follow-up and escalation sweep.',
    });

    /* ------------------------------------------------------------ */
    /* Least-privilege IAM                                          */
    /* ------------------------------------------------------------ */

    // The API reads and writes case data; it never needs to delete a table or
    // read another stage's data.
    table.grantReadWriteData(apiFunction);
    table.grantReadWriteData(eventsFunction);
    table.grantReadWriteData(schedulerFunction);

    // Only the API issues pre-signed URLs, so only the API touches the bucket.
    evidenceBucket.grantReadWrite(apiFunction);
    eventBus.grantPutEventsTo(apiFunction);

    const secretsPolicy = new iam.PolicyStatement({
      actions: ['ssm:GetParameters', 'ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/civicsos/${stage}/*`,
      ],
    });
    // SecureString parameters are encrypted with the AWS-managed SSM key.
    const decryptPolicy = new iam.PolicyStatement({
      actions: ['kms:Decrypt'],
      resources: ['*'],
      conditions: { StringEquals: { 'kms:ViaService': `ssm.${this.region}.amazonaws.com` } },
    });
    for (const fn of [apiFunction, eventsFunction, schedulerFunction]) {
      fn.addToRolePolicy(secretsPolicy);
      fn.addToRolePolicy(decryptPolicy);
    }

    /* ------------------------------------------------------------ */
    /* Event routing                                                */
    /* ------------------------------------------------------------ */

    new events.Rule(this, 'DomainEventsRule', {
      eventBus,
      ruleName: `${prefix}-domain-events`,
      description: 'Routes CivicSOS domain events to the async consumer.',
      // `civicsos.worker` is the containerised status checker publishing an
      // observation. Same consumer, same retry policy — it is just another
      // domain event, and treating it specially would mean two code paths.
      eventPattern: { source: ['civicsos.app', 'civicsos.worker'] },
      targets: [
        new targets.LambdaFunction(eventsFunction, {
          // Two retries then give up: these are enhancements, not the user's
          // transaction, and an endless retry loop would burn free-tier budget.
          retryAttempts: 2,
          maxEventAge: Duration.hours(1),
        }),
      ],
    });

    new events.Rule(this, 'DailySweepRule', {
      ruleName: `${prefix}-daily-sweep`,
      description: 'Runs the follow-up and escalation sweep once a day.',
      // 02:30 UTC is 08:00 IST — reminders land at the start of the day for the
      // intended users, and off-peak for AWS.
      schedule: events.Schedule.cron({ minute: '30', hour: '2' }),
      targets: [new targets.LambdaFunction(schedulerFunction, { retryAttempts: 1 })],
    });

    /* ------------------------------------------------------------ */
    /* Status-check worker (optional)                               */
    /* ------------------------------------------------------------ */

    /**
     * The one containerised component, and the only one that is not a Lambda.
     *
     * Outbound, the scheduler starts a single Fargate task carrying the whole
     * batch — an EventBridge rule with an ECS target would launch one Chromium
     * per complaint, which is the wrong shape for a cold start that costs
     * seconds. Inbound, the worker publishes onto the same bus as everything
     * else and the existing events consumer applies the result, so fan-in goes
     * through EventBridge exactly as the rest of the system does.
     */
    if (props.enableWorker) {
      const worker = new StatusCheckWorker(this, 'StatusCheckWorker', {
        prefix,
        stage,
        eventBus,
        practiceBaseUrl: props.allowedOrigins[0] ?? '',
        logRetention: logs.RetentionDays.ONE_WEEK,
      });

      worker.grantRunTask(schedulerFunction);

      schedulerFunction.addEnvironment('WORKER_CLUSTER_ARN', worker.cluster.clusterArn);
      schedulerFunction.addEnvironment('WORKER_TASK_ARN', worker.taskDefinition.taskDefinitionArn);
      schedulerFunction.addEnvironment('WORKER_CONTAINER_NAME', worker.containerName);
      schedulerFunction.addEnvironment(
        'WORKER_SUBNET_IDS',
        worker.vpc.publicSubnets.map((subnet) => subnet.subnetId).join(','),
      );
      schedulerFunction.addEnvironment('WORKER_SECURITY_GROUP_ID', worker.securityGroup.securityGroupId);

      new CfnOutput(this, 'WorkerClusterArn', { value: worker.cluster.clusterArn });
      new CfnOutput(this, 'WorkerTaskArn', { value: worker.taskDefinition.taskDefinitionArn });
    }

    /* ------------------------------------------------------------ */
    /* HTTP API                                                     */
    /* ------------------------------------------------------------ */

    /**
     * HTTP API rather than REST API: about a third of the price per million
     * requests, and everything this project needs. Authorization is done inside
     * the Lambda (one place, fully testable) rather than with a JWT authorizer,
     * because guest demo tokens and Cognito tokens share one code path.
     */
    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: `${prefix}-api`,
      description: 'CivicSOS public API.',
      corsPreflight: {
        allowOrigins: props.allowedOrigins,
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PATCH,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['content-type', 'authorization', 'x-request-id'],
        allowCredentials: true,
        maxAge: Duration.minutes(10),
      },
      // Everything routes to the single API function; the router inside decides.
      defaultIntegration: new apigwv2Integrations.HttpLambdaIntegration('ApiIntegration', apiFunction, {
        payloadFormatVersion: apigwv2.PayloadFormatVersion.VERSION_2_0,
      }),
    });

    /**
     * Account-level throttling on the stage. This is the real global rate limit
     * and the main defence against a runaway client turning into a bill; the
     * per-user limiter inside the Lambda is a second, finer-grained guard.
     */
    const defaultStage = httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage | undefined;
    if (defaultStage) {
      defaultStage.defaultRouteSettings = {
        throttlingBurstLimit: 20,
        throttlingRateLimit: 10,
        detailedMetricsEnabled: false,
      };
    }

    /* ------------------------------------------------------------ */
    /* Edge: CloudFront + WAF                                       */
    /* ------------------------------------------------------------ */

    /**
     * CloudFront in front of the HTTP API.
     *
     * Three things it buys, in order of how much they matter here:
     *
     *  1. **It is the only way to put WAF on this API.** AWS WAF does not
     *     support API Gateway HTTP APIs. The alternative was migrating to a
     *     REST API at 3.5× the request price.
     *  2. **Shield Standard and TLS at the edge**, so a volumetric flood is
     *     absorbed at CloudFront rather than turning into Lambda invocations.
     *  3. **Edge caching for the two public, identical-for-everyone
     *     endpoints** — the health check and the category catalogue. Everything
     *     else is per-citizen and explicitly not cached.
     */
    const edgeEnabled = props.enableEdge !== false;

    const apiOrigin = new origins.HttpOrigin(`${httpApi.apiId}.execute-api.${this.region}.amazonaws.com`, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      originShieldEnabled: false,
    });

    /**
     * Forwards everything the API needs, except Host.
     *
     * Host must NOT be forwarded: API Gateway routes on its own domain, and a
     * forwarded viewer Host makes it reject the request outright. AWS ships a
     * managed policy for precisely this case — and CloudFront refuses to let
     * `Authorization` sit in a custom origin-request policy at all, since that
     * header belongs to the cache key discussion rather than the forwarding one.
     *
     * Forwarding is not the same as caching: the cache key comes from the cache
     * policy below, so the public routes still cache even though every header
     * reaches the origin.
     */
    const originRequestPolicy = cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER;

    /**
     * Cache policy for the public endpoints.
     *
     * Short TTL: the catalogue changes only on deploy, but a stale health check
     * would be actively misleading during an incident, so a minute is the
     * ceiling. Authorization is deliberately NOT in the cache key — these
     * routes are anonymous, and including it would make the cache useless.
     */
    const publicCachePolicy = new cloudfront.CachePolicy(this, 'PublicCachePolicy', {
      cachePolicyName: `${prefix}-public`,
      defaultTtl: Duration.seconds(60),
      minTtl: Duration.seconds(0),
      maxTtl: Duration.seconds(300),
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList('Origin'),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const distribution = edgeEnabled
      ? new cloudfront.Distribution(this, 'ApiDistribution', {
      comment: `CivicSOS ${stage} API edge`,
      defaultBehavior: {
        origin: apiOrigin,
        // Every other route is per-citizen and carries a bearer token. Caching
        // any of it would be a data leak between users.
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT,
      },
      additionalBehaviors: {
        '/health': {
          origin: apiOrigin,
          cachePolicy: publicCachePolicy,
          originRequestPolicy,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        },
        '/knowledge/*': {
          origin: apiOrigin,
          cachePolicy: publicCachePolicy,
          originRequestPolicy,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        },
      },
      // PRICE_CLASS_ALL would add edges the users of this service never touch.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
          enableLogging: false,
          webAclId: props.webAclArn,
        })
      : undefined;

    /* ------------------------------------------------------------ */
    /* Observability                                                */
    /* ------------------------------------------------------------ */

    const errorAlarms = [
      new cloudwatch.Alarm(this, 'ApiErrorsAlarm', {
        alarmName: `${prefix}-api-errors`,
        alarmDescription: 'The API Lambda is throwing errors.',
        metric: apiFunction.metricErrors({ period: Duration.minutes(5) }),
        threshold: 5,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
      new cloudwatch.Alarm(this, 'SchedulerErrorsAlarm', {
        alarmName: `${prefix}-scheduler-errors`,
        alarmDescription: 'The daily reminder sweep failed.',
        metric: schedulerFunction.metricErrors({ period: Duration.hours(24) }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
      // A spike in requests is the early warning for an unexpected bill.
      new cloudwatch.Alarm(this, 'ApiVolumeAlarm', {
        alarmName: `${prefix}-api-unusual-volume`,
        alarmDescription: 'Unusually high API traffic — possible abuse or a loop.',
        metric: apiFunction.metricInvocations({ period: Duration.minutes(5) }),
        threshold: 2000,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    ];

    /* ------------------------------------------------------------ */
    /* Cost controls                                                */
    /* ------------------------------------------------------------ */

    if (props.alertEmail) {
      /**
       * AWS Budgets: the first two budgets per account are free. Notifications
       * fire at 50% and 100% of forecast, so a mistake is visible long before
       * it becomes a real charge.
       */
      new budgets.CfnBudget(this, 'MonthlyBudget', {
        budget: {
          budgetName: `${prefix}-monthly`,
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: props.monthlyBudgetUsd ?? 5, unit: 'USD' },
        },
        notificationsWithSubscribers: [
          {
            notification: {
              notificationType: 'ACTUAL',
              comparisonOperator: 'GREATER_THAN',
              threshold: 50,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ subscriptionType: 'EMAIL', address: props.alertEmail }],
          },
          {
            notification: {
              notificationType: 'FORECASTED',
              comparisonOperator: 'GREATER_THAN',
              threshold: 100,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ subscriptionType: 'EMAIL', address: props.alertEmail }],
          },
        ],
      });
    }

    /* ------------------------------------------------------------ */
    /* Outputs                                                      */
    /* ------------------------------------------------------------ */

    new CfnOutput(this, 'ApiBaseUrl', {
      value: distribution ? `https://${distribution.distributionDomainName}` : httpApi.apiEndpoint,
      description: 'Set this as NEXT_PUBLIC_API_BASE_URL in the web app.',
    });
    new CfnOutput(this, 'ApiOriginUrl', {
      value: httpApi.apiEndpoint,
      description: 'The API Gateway endpoint. Behind CloudFront when the edge is enabled.',
    });
    new CfnOutput(this, 'EdgeEnabled', {
      value: distribution ? `yes (WAF: ${props.webAclArn ? 'attached' : 'none'})` : 'no',
    });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    new CfnOutput(this, 'EvidenceBucketName', { value: evidenceBucket.bucketName });
    new CfnOutput(this, 'EventBusName', { value: eventBus.eventBusName });
    new CfnOutput(this, 'GeminiKeyParameterName', {
      value: geminiKeyParam,
      description: 'Create this SecureString parameter to enable Gemini.',
    });
    new CfnOutput(this, 'GuestSecretParameterName', {
      value: guestSecretParam,
      description: 'Create this SecureString parameter to enable demo sessions.',
    });
    new CfnOutput(this, 'AlarmNames', { value: errorAlarms.map((alarm) => alarm.alarmName).join(',') });
  }
}
