import type { ApiError, ApiErrorCode, RejectionCode } from '@wc/engine';

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-wc-protocol',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

/** Thrown anywhere in a handler; turned into an ApiError response. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function rejection(code: RejectionCode, message: string): HttpError {
  return new HttpError(code === 'STALE_VERSION' ? 409 : 422, code, message);
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) {
    const body: ApiError = { error: { code: e.code, message: e.message } };
    return json(body, e.status);
  }
  console.error(e);
  const body: ApiError = { error: { code: 'INTERNAL', message: 'internal error' } };
  return json(body, 500);
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'body must be JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'BAD_REQUEST', 'body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

/** Constant-time string comparison for the system secret. */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}
