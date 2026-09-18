import { NextResponse, type NextRequest } from 'next/server';
import {
  LOCAL_API_ENABLED,
} from '@/server/local-runtime';
import { consumeGrant, readLocalObject, resolveGrant, storeLocalObject } from '@/server/local-storage';

/**
 * Local stand-in for S3 pre-signed URLs.
 *
 * Exists so the evidence flow is genuinely exercised in development: the browser
 * PUTs the file to a URL it was handed, a grant with a real expiry is checked,
 * the declared content type and size are enforced, and the subsequent confirm
 * step only succeeds if the bytes actually arrived.
 *
 * Never active when a deployed API is configured — in that case the browser
 * talks to S3 directly.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Matches the API's evidence cap, so local behaviour matches deployed. */
const MAX_BYTES = 8 * 1024 * 1024;

function notFound(): NextResponse {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  if (!LOCAL_API_ENABLED) return notFound();

  const grantId = request.nextUrl.searchParams.get('grant');
  const resolution = resolveGrant(grantId, 'PUT');
  if (!resolution.ok || !resolution.grant) {
    return NextResponse.json({ error: resolution.message }, { status: resolution.status });
  }
  const grant = resolution.grant;

  // The real pre-signed PUT has the content type baked into its signature, so a
  // mismatch must fail here too.
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.startsWith(grant.contentType)) {
    return NextResponse.json({ error: 'Content type does not match the upload grant.' }, { status: 403 });
  }

  const buffer = new Uint8Array(await request.arrayBuffer());
  if (buffer.byteLength === 0) {
    return NextResponse.json({ error: 'Empty upload.' }, { status: 400 });
  }
  if (buffer.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'File is too large.' }, { status: 413 });
  }

  storeLocalObject(grant, buffer);
  // Single-use, like a pre-signed URL that has served its purpose.
  if (grantId) consumeGrant(grantId);

  return new NextResponse(null, { status: 200, headers: { etag: `"local-${buffer.byteLength}"` } });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!LOCAL_API_ENABLED) return notFound();

  const grantId = request.nextUrl.searchParams.get('grant');
  const resolution = resolveGrant(grantId, 'GET');
  if (!resolution.ok || !resolution.grant) {
    return NextResponse.json({ error: resolution.message }, { status: resolution.status });
  }

  const object = readLocalObject(resolution.grant.storageKey);
  if (!object?.bytes) return notFound();

  return new NextResponse(Buffer.from(object.bytes), {
    status: 200,
    headers: {
      'content-type': object.contentType,
      'content-length': String(object.bytes.byteLength),
      'cache-control': 'private, max-age=60',
      // Evidence is never rendered as a document, only as an image or download.
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
    },
  });
}
