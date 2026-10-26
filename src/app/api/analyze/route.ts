/**
 * POST /api/analyze
 *
 * The only HTTP surface of Phase 1. It accepts a unified diff, runs the
 * deterministic engine and returns a JSON analysis. It never executes the
 * submitted code, never writes it to disk and never calls an external service.
 */

import { analyzeDiff } from "@/lib/engine/analyze";
import { DiffParseError } from "@/lib/engine/parse-diff";
import type { DiffErrorCode } from "@/lib/engine/parse-diff";

const MAX_REQUEST_BYTES = 1024 * 1024;

interface ErrorBody {
  error: {
    code: string;
    message: string;
    hint: string;
    line: number | null;
  };
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  hint: string,
  line: number | null = null,
): Response {
  const body: ErrorBody = { error: { code, message, hint, line } };
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

const STATUS_BY_CODE: Record<DiffErrorCode, number> = {
  EMPTY_INPUT: 400,
  MALFORMED_DIFF: 422,
  UNSUPPORTED_DIFF_FORMAT: 422,
  PREAMBLE_UNSUPPORTED: 422,
  DIFF_TOO_LARGE: 413,
  BINARY_INPUT: 415,
  BINARY_DIFF_UNSUPPORTED: 415,
  DIFF_TOO_COMPLEX: 413,
};

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return errorResponse(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Send the diff as a JSON body.",
      'Use `Content-Type: application/json` with a `{ "diff": "..." }` body.',
    );
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return errorResponse(
      400,
      "UNREADABLE_BODY",
      "The request body could not be read.",
      "Retry the request with a smaller diff.",
    );
  }

  if (new TextEncoder().encode(raw).length > MAX_REQUEST_BYTES) {
    return errorResponse(
      413,
      "REQUEST_TOO_LARGE",
      "The request body exceeds the 1 MB transport limit.",
      "ProofGate accepts diffs up to 200 KB. Review a smaller change.",
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return errorResponse(
      400,
      "INVALID_JSON",
      "The request body is not valid JSON.",
      'Send `{ "diff": "<unified diff>" }`.',
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("diff" in body) ||
    typeof (body as { diff?: unknown }).diff !== "string"
  ) {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      "The request must include a `diff` string.",
      'Send `{ "diff": "<unified diff>" }`.',
    );
  }

  try {
    const result = analyzeDiff((body as { diff: string }).diff);
    return Response.json(result, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof DiffParseError) {
      return errorResponse(
        STATUS_BY_CODE[error.code] ?? 422,
        error.code,
        error.message,
        error.hint,
        error.line,
      );
    }

    // Never leak stack traces or user content in an error response.
    console.error("ProofGate analysis failed", error instanceof Error ? error.name : "unknown");
    return errorResponse(
      500,
      "ANALYSIS_FAILED",
      "The analysis engine failed unexpectedly.",
      "The diff was not stored. Retry once, and report the issue if it persists.",
    );
  }
}