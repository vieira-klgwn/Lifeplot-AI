import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../../config/env.js';
import { unauthorized } from '../../lib/errors.js';

export interface SocialIdentity {
  provider: 'GOOGLE' | 'APPLE';
  subject: string;
  email: string;
  name?: string;
}

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const APPLE_ISSUER = 'https://appleid.apple.com';

const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

/**
 * ID tokens are verified against the provider JWKS on the server. The mobile
 * app never holds a client secret: it only forwards the ID token it received.
 */
export async function verifySocialIdToken(
  provider: 'GOOGLE' | 'APPLE',
  idToken: string,
): Promise<SocialIdentity> {
  const audiences = provider === 'GOOGLE' ? env.googleClientIds : env.appleClientIds;
  if (audiences.length === 0) {
    throw unauthorized(`${provider} sign-in is not configured on this server`);
  }

  try {
    const { payload } = await jwtVerify(idToken, provider === 'GOOGLE' ? googleJwks : appleJwks, {
      audience: audiences,
      issuer: provider === 'GOOGLE' ? GOOGLE_ISSUERS : APPLE_ISSUER,
    });

    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
    if (!payload.sub || !email) throw new Error('Missing subject or email claim');

    return {
      provider,
      subject: payload.sub,
      email,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    };
  } catch {
    throw unauthorized(`Could not verify your ${provider.toLowerCase()} sign-in`);
  }
}
