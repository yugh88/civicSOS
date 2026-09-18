import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { TokenClaims, TokenVerifier } from '@civicsos/core';

/**
 * Cognito ID token verification.
 *
 * `aws-jwt-verify` fetches and caches the user pool's JWKS and checks the
 * signature, issuer, audience, expiry and token use. That last check matters: an
 * access token must not be accepted where an ID token is required, because it
 * does not carry the group claims we derive roles from.
 *
 * Roles come from `cognito:groups` — set by an administrator in the user pool,
 * never by anything the client sends.
 */

export interface CognitoVerifierOptions {
  userPoolId: string;
  clientId: string;
}

export function createCognitoTokenVerifier(options: CognitoVerifierOptions): TokenVerifier {
  const verifier = CognitoJwtVerifier.create({
    userPoolId: options.userPoolId,
    tokenUse: 'id',
    clientId: options.clientId,
  });

  return async (token: string): Promise<TokenClaims | undefined> => {
    const payload = await verifier.verify(token);
    const groups = payload['cognito:groups'];

    return {
      sub: String(payload.sub),
      email: typeof payload.email === 'string' ? payload.email : undefined,
      groups: Array.isArray(groups) ? groups.map(String) : undefined,
    };
  };
}
