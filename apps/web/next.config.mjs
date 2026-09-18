/**
 * Next.js configuration.
 *
 * Two things matter here: `transpilePackages` so the workspace packages are
 * compiled from TypeScript source (no separate build step during development),
 * and the security headers, which are the page-level counterpart to the API's
 * own response headers.
 */

/**
 * Content Security Policy for the app shell.
 *
 * `'unsafe-inline'` for styles is required because Next injects its critical
 * CSS inline; scripts are restricted to the app's own origin plus the nonce-free
 * inline bootstrap Next needs, which is why `'unsafe-inline'` appears there too
 * and is deliberately paired with a strict `connect-src` and `object-src 'none'`.
 * Tightening this to a nonce-based policy is noted as future work in SECURITY.md.
 */
function contentSecurityPolicy() {
  const isDev = process.env.NODE_ENV !== 'production';

  const apiOrigins = [process.env.NEXT_PUBLIC_API_BASE_URL, process.env.NEXT_PUBLIC_COGNITO_ENDPOINT]
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return '';
      }
    })
    .filter(Boolean);

  const connect = [
    "'self'",
    // The dev server's hot-reload socket.
    ...(isDev ? ['ws://localhost:*', 'http://localhost:*'] : []),
    ...apiOrigins,
    // Cognito's regional IDP endpoint and S3 pre-signed upload/download URLs.
    'https://*.amazonaws.com',
    'https://*.amazoncognito.com',
  ];

  return [
    "default-src 'self'",
    // Next's development bundler evaluates modules with `eval` for fast source
    // maps, so dev needs 'unsafe-eval'. Production never gets it.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    // Evidence previews come back as blob: object URLs after upload.
    "img-src 'self' data: blob: https://*.amazonaws.com",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@civicsos/core'],
  // The app lives in a monorepo; without this Next guesses the wrong root when
  // tracing files for the standalone output.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  eslint: { ignoreDuringBuilds: false },
  /**
   * The workspace packages are ESM TypeScript and import siblings with explicit
   * `.js` specifiers (required for Node ESM). Webpack needs to be told those
   * `.js` specifiers may resolve to `.ts` source, which is what lets the web app
   * consume `@civicsos/core` directly from source with no separate build step.
   */
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'content-security-policy', value: contentSecurityPolicy() },
          { key: 'x-content-type-options', value: 'nosniff' },
          { key: 'x-frame-options', value: 'DENY' },
          { key: 'referrer-policy', value: 'strict-origin-when-cross-origin' },
          { key: 'permissions-policy', value: 'geolocation=(self), camera=(), microphone=(), payment=()' },
          { key: 'strict-transport-security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default nextConfig;
