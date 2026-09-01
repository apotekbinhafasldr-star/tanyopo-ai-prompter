import { NextResponse } from "next/server";

/**
 * The API response envelope every route under /api/v1/* returns (product
 * spec §71): `{ data, error, meta }`, always all three keys, `error` and
 * `meta` explicitly `null` rather than omitted when unused.
 */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiEnvelope<T> {
  data: T | null;
  error: ApiErrorBody | null;
  meta: Record<string, unknown> | null;
}

export function apiSuccess<T>(
  data: T,
  options?: { status?: number; meta?: Record<string, unknown> },
): NextResponse<ApiEnvelope<T>> {
  return NextResponse.json(
    { data, error: null, meta: options?.meta ?? null },
    { status: options?.status ?? 200 },
  );
}

export function apiError(
  code: string,
  message: string,
  status: number,
  details?: unknown,
): NextResponse<ApiEnvelope<never>> {
  return NextResponse.json(
    { data: null, error: { code, message, details }, meta: null },
    { status },
  );
}
