import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import type { Logger } from '@civicsos/core';

/**
 * Secret loading from SSM Parameter Store.
 *
 * Standard Parameter Store parameters are free, and SecureString parameters are
 * encrypted with the AWS-managed SSM key, which is also free — so this is the
 * cheapest way to keep secrets out of Git, out of the repository, and out of
 * Lambda's plainly-visible environment configuration. (Secrets Manager would
 * cost about $0.40 per secret per month, which this project does not need.)
 *
 * Parameters are fetched once per container at cold start and cached for its
 * lifetime: a handful of API calls a day, well inside the free tier.
 *
 * Secrets are deliberately NOT created by the CDK stack: CloudFormation cannot
 * create SecureString parameters, and a secret should be written by a human with
 * the CLI rather than passed through a template. DEPLOYMENT.md has the commands.
 */

export interface SecretNames {
  geminiApiKey: string;
  guestSessionSecret: string;
}

export interface LoadedSecrets {
  geminiApiKey?: string;
  guestSessionSecret?: string;
}

let cached: LoadedSecrets | undefined;

export async function loadSecrets(
  names: SecretNames,
  logger: Logger,
  client: SSMClient = new SSMClient({}),
): Promise<LoadedSecrets> {
  if (cached) return cached;

  const wanted = [names.geminiApiKey, names.guestSessionSecret].filter((name) => name.length > 0);
  if (wanted.length === 0) {
    cached = {};
    return cached;
  }

  try {
    const result = await client.send(new GetParametersCommand({ Names: wanted, WithDecryption: true }));
    const values = new Map((result.Parameters ?? []).map((parameter) => [parameter.Name, parameter.Value]));

    if (result.InvalidParameters && result.InvalidParameters.length > 0) {
      // Absent is a supported state: no Gemini key means deterministic mode.
      // Names are configuration, not secrets, so they are safe to log.
      logger.warn('some secret parameters are not set', { missing: result.InvalidParameters });
    }

    cached = {
      geminiApiKey: values.get(names.geminiApiKey),
      guestSessionSecret: values.get(names.guestSessionSecret),
    };
    return cached;
  } catch (error) {
    // The application must still start: it degrades to deterministic-only mode
    // with demo sessions disabled rather than failing every request.
    logger.error('failed to load secrets from parameter store', { error });
    cached = {};
    return cached;
  }
}

/** Test seam — resets the container-lifetime cache. */
export function resetSecretCache(): void {
  cached = undefined;
}
