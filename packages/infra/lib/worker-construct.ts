import * as path from 'node:path';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import type * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * The status-check worker: a containerised Chromium that runs on demand.
 *
 * WHY THIS IS NOT A LAMBDA
 *
 * Chromium does not fit Lambda comfortably — the layer gymnastics, the 250MB
 * unzipped limit and the /tmp constraints are all solvable, and all solved
 * badly. A container is the right shape for a browser, and Fargate lets it stay
 * scale-to-zero: the task exists only while a batch is being checked.
 *
 * WHY THIS DOES NOT BREAK THE COST POSTURE
 *
 * The VPC has **no NAT gateway** (`natGateways: 0`). Tasks run in a public
 * subnet with a public IP, which is billed per second alongside the task rather
 * than at ~$32/month for an idle gateway. Nothing here bills by the hour:
 *
 *   - VPC, subnets, route tables, security group: free.
 *   - ECS cluster: free. Fargate bills only while a task runs.
 *   - One 0.5 vCPU / 1GB task for ~3 minutes a day: a few cents a month.
 *   - ECR storage for the Playwright image: a lifecycle rule keeps 3 images.
 *
 * WHY THE WORKER HAS ALMOST NO PERMISSIONS
 *
 * Its task role can do exactly one thing: `events:PutEvents` onto the CivicSOS
 * bus. No DynamoDB, no S3, no API credential, no secret. A browser driving a
 * page it does not control is the least predictable component in the system, so
 * it is also the one with the least power — it reports what it saw and the
 * deterministic core decides what that means.
 */

export interface WorkerConstructProps {
  prefix: string;
  stage: string;
  /** The bus the worker publishes observations onto. */
  eventBus: events.IEventBus;
  /** Where the practice portal lives, for the one target in the registry. */
  practiceBaseUrl: string;
  logRetention: logs.RetentionDays;
}

export class StatusCheckWorker extends Construct {
  readonly cluster: ecs.Cluster;
  readonly taskDefinition: ecs.FargateTaskDefinition;
  readonly securityGroup: ec2.SecurityGroup;
  readonly vpc: ec2.Vpc;
  readonly containerName = 'status-check';

  constructor(scope: Construct, id: string, props: WorkerConstructProps) {
    super(scope, id);

    /**
     * Public subnets only, in two AZs.
     *
     * Two AZs because Fargate capacity in a single AZ can be temporarily
     * unavailable and a nightly job should not fail for that; no private
     * subnets because a private subnet without a NAT gateway cannot reach the
     * internet, and reaching the internet is this task's entire purpose.
     */
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `${props.prefix}-worker-vpc`,
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      ],
      // Nothing in this VPC should be reachable from outside it.
      restrictDefaultSecurityGroup: true,
    });

    /** Egress only. The worker accepts no inbound traffic of any kind. */
    this.securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: this.vpc,
      description: 'CivicSOS status-check worker. Outbound only.',
      allowAllOutbound: true,
    });

    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: this.vpc,
      clusterName: `${props.prefix}-workers`,
      // No EC2 capacity and no Container Insights: the former would bill by the
      // hour, the latter is a per-metric charge for a task that runs once a day
      // and already emits structured logs.
      containerInsightsV2: ecs.ContainerInsights.DISABLED,
    });

    /**
     * The image, built from apps/worker/Dockerfile with the repo root as
     * context so the bundle can reach `packages/core` and the practice page.
     */
    const image = new ecr_assets.DockerImageAsset(this, 'Image', {
      directory: path.resolve(__dirname, '../../..'),
      file: 'apps/worker/Dockerfile',
      // Fargate runs x86_64 by default; pinning avoids a surprise when this is
      // built on an Apple Silicon machine, where the default would be arm64.
      platform: ecr_assets.Platform.LINUX_AMD64,
      // `cdk.out` is the one that bites: CDK stages this context *into*
      // packages/infra/cdk.out, so without excluding it the copy recurses into
      // its own output until the filesystem rejects the path length. The root
      // .dockerignore carries the same list for manual `docker build`.
      exclude: [
        'cdk.out',
        '**/cdk.out',
        'node_modules',
        '**/node_modules',
        'dist',
        '**/dist',
        '.next',
        '**/.next',
        '.git',
      ],
    });

    const logGroup = new logs.LogGroup(this, 'Logs', {
      logGroupName: `/aws/ecs/${props.prefix}-status-check`,
      retention: props.logRetention,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    /**
     * 0.5 vCPU / 1GB.
     *
     * Chromium is memory-hungry rather than CPU-hungry for this workload — it
     * loads a page, waits, and reads one element. 1GB is the smallest size that
     * does not risk an OOM on a heavy portal page; 512MB does.
     */
    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'Task', {
      family: `${props.prefix}-status-check`,
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    this.taskDefinition.addContainer(this.containerName, {
      image: ecs.ContainerImage.fromDockerImageAsset(image),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'status-check', logGroup }),
      environment: {
        EVENT_BUS_NAME: props.eventBus.eventBusName,
        PRACTICE_BASE_URL: props.practiceBaseUrl,
        STAGE: props.stage,
      },
      // A batch that has not finished in ten minutes has gone wrong. Stopping
      // is cheaper than investigating a task that bills while it hangs.
      stopTimeout: Duration.minutes(10),
      essential: true,
      readonlyRootFilesystem: false, // Chromium needs a writable profile dir.
    });

    // The entire permission set. Note the resource scope: this bus, nothing else.
    this.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [props.eventBus.eventBusArn],
      }),
    );
  }

  /**
   * Lets the scheduler Lambda start one task carrying a whole batch.
   *
   * Deliberately not an EventBridge rule with an ECS target: that starts one
   * task per event, and a container cold start per complaint would mean a dozen
   * Chromium launches to check a dozen references. The scheduler batches them
   * into a single task instead, and the *return* path is EventBridge, where
   * fan-in is what you actually want.
   */
  grantRunTask(grantee: iam.IGrantable): void {
    iam.Grant.addToPrincipal({
      grantee,
      actions: ['ecs:RunTask'],
      resourceArns: [this.taskDefinition.taskDefinitionArn],
      // Only into this cluster — a stolen credential cannot start this task
      // definition somewhere else.
      conditions: { ArnEquals: { 'ecs:cluster': this.cluster.clusterArn } },
    });

    // RunTask needs to hand the task its two roles.
    iam.Grant.addToPrincipal({
      grantee,
      actions: ['iam:PassRole'],
      resourceArns: [
        this.taskDefinition.taskRole.roleArn,
        this.taskDefinition.obtainExecutionRole()?.roleArn ?? this.taskDefinition.taskRole.roleArn,
      ],
    });
  }
}
