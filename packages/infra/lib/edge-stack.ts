import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import type { Construct } from 'constructs';

/**
 * The WAF web ACL.
 *
 * Lives in its own stack in **us-east-1** because that is a hard AWS
 * constraint: a web ACL with `scope: CLOUDFRONT` can only exist there,
 * whatever region the rest of the stack uses. The main stack reads the ARN
 * across regions.
 *
 * This is also why CloudFront is in the architecture at all. AWS WAF cannot
 * attach to an API Gateway **HTTP** API — it supports CloudFront, ALB, REST
 * API, AppSync, Cognito and App Runner. The alternatives were to migrate the
 * API to REST (3.5× the request price, for features we do not use) or to put
 * CloudFront in front of it. CloudFront is cheaper, adds edge termination and
 * Shield Standard, and leaves the API untouched.
 */
export interface EdgeStackProps extends StackProps {
  stage: string;
  /** Requests per 5 minutes, per IP, before WAF starts blocking. */
  requestsPer5Min?: number;
}

export class EdgeStack extends Stack {
  /** Consumed by the main stack's CloudFront distribution. */
  readonly webAclArn: string;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);

    const prefix = `civicsos-${props.stage}`;

    /**
     * Managed rule groups, in priority order.
     *
     * Deliberately three, not ten. Each one is a real class of attack against a
     * public JSON API; adding rule groups that mostly defend PHP applications
     * would cost money and add false positives without protecting anything here.
     */
    const managedRules: Array<{ name: string; priority: number; note: string }> = [
      {
        // SQLi, XSS, path traversal, oversized bodies, bad user agents.
        name: 'AWSManagedRulesCommonRuleSet',
        priority: 10,
        note: 'core web exploits',
      },
      {
        // Payloads known to trigger RCE and deserialisation bugs.
        name: 'AWSManagedRulesKnownBadInputsRuleSet',
        priority: 20,
        note: 'known-bad request patterns',
      },
      {
        // Addresses AWS observes running bots, scanners and takeovers.
        name: 'AWSManagedRulesAmazonIpReputationList',
        priority: 30,
        note: 'IP reputation',
      },
    ];

    const webAcl = new wafv2.CfnWebACL(this, 'ApiWebAcl', {
      name: `${prefix}-api`,
      description: 'Protects the CivicSOS API behind CloudFront.',
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `${prefix}-api-waf`,
        // Full request sampling is billed; the metrics alone tell us what we
        // need and a sampled request can contain a citizen's complaint text.
        sampledRequestsEnabled: false,
      },
      rules: [
        ...managedRules.map((rule) => ({
          name: rule.name,
          priority: rule.priority,
          statement: {
            managedRuleGroupStatement: { vendorName: 'AWS', name: rule.name },
          },
          // `none` means the rule group's own action (block) applies.
          overrideAction: { none: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${prefix}-${rule.note.replace(/\s+/g, '-')}`,
            sampledRequestsEnabled: false,
          },
        })),
        {
          /**
           * Per-IP rate limit — the layer API Gateway's stage throttle cannot
           * provide, because that throttle is account-wide and one abusive
           * client would consume the whole allowance for everybody.
           *
           * Set well above human use: the application's own per-user limiter
           * handles normal shaping, and this exists to stop a flood.
           */
          name: 'RateLimitPerIp',
          priority: 40,
          statement: {
            rateBasedStatement: {
              limit: props.requestsPer5Min ?? 2000,
              aggregateKeyType: 'IP',
            },
          },
          action: { block: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${prefix}-rate-limit`,
            sampledRequestsEnabled: false,
          },
        },
      ],
    });

    this.webAclArn = webAcl.attrArn;

    new CfnOutput(this, 'WebAclArn', { value: webAcl.attrArn });
  }
}
