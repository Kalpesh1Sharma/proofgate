/**
 * POST /api/ai/explain
 *
 * Optional, consent-gated AI Fix Advisor. It accepts one heuristic finding,
 * sends a bounded excerpt to Groq and returns a validated suggestion labelled
 * AI_SUGGESTION.
 *
 * Guarantees:
 *  - the API key is read from the server environment only and never returned;
 *  - nothing is sent without `consent.granted === true` in the request;
 *  - the excerpt is bounded before the call and the call has a 12s timeout;
 *  - the request is not stored, logged or executed;
 *  - the model cannot confirm a defect or claim that a test passed.
 */

import { readGroqConfig } from "@/lib/ai/config";
import { requestGroqSuggestion } from "@/lib/ai/groq";
import { statusForAiFailure } from "@/lib/ai/http";
import {
  isWithinTransportLimit,
  validateExplainRequest,
} from "@/lib/ai/prompt";
import {
  clientLimiter,
  instanceLimiter,
} from "@/lib/ai/rate-limit";
import type { AiFailure } from "@/lib/ai/types";
import { AI_TRANSPORT_MAX_BYTES } from "@/lib/ai/types";

function errorResponse(error: AiFailure, status: number): Response {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (error.retryAfterSeconds !== null) {
    headers["Retry-After"] = String(error.retryAfterSeconds);
  }
  return Response.json({ error }, { status, headers });
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const candidate =
    (forwarded ? forwarded.split(",")[0] : null) ??
    request.headers.get("x-real-ip") ??
    "anonymous";
  return candidate.trim().slice(0, 64).replace(/[^A-Za-z0-9.:_-]/g, "") || "anonymous";
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return errorResponse(
      {
        code: "INVALID_REQUEST",
        message: "Send the finding as a JSON body.",
        hint: 'Use `Content-Type: application/json` with a `{ "finding": ..., "consent": ... }` body.',
        retryAfterSeconds: null,
      },
      415,
    );
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > AI_TRANSPORT_MAX_BYTES) {
    return errorResponse(
      {
        code: "PAYLOAD_TOO_LARGE",
        message: "The request body is larger than the AI advisor accepts.",
        hint: "Send one finding with its short context excerpt.",
        retryAfterSeconds: null,
      },
      413,
    );
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return errorResponse(
      {
        code: "INVALID_REQUEST",
        message: "The request body could not be read.",
        hint: "Retry with a single finding.",
        retryAfterSeconds: null,
      },
      400,
    );
  }

  if (new TextEncoder().encode(raw).length > AI_TRANSPORT_MAX_BYTES) {
    return errorResponse(
      {
        code: "PAYLOAD_TOO_LARGE",
        message: "The request body is larger than the AI advisor accepts.",
        hint: "Send one finding with its short context excerpt.",
        retryAfterSeconds: null,
      },
      413,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    return errorResponse(
      {
        code: "INVALID_REQUEST",
        message: "The request body is not valid JSON.",
        hint: "Reload the finding and try again.",
        retryAfterSeconds: null,
      },
      400,
    );
  }

  if (!isWithinTransportLimit(body)) {
    return errorResponse(
      {
        code: "PAYLOAD_TOO_LARGE",
        message: "The finding excerpt is too large to send.",
        hint: "Send one finding with its short context excerpt.",
        retryAfterSeconds: null,
      },
      413,
    );
  }

  const validated = validateExplainRequest(body);
  if (!validated.ok) {
    const isConsent = validated.path === "consent" || validated.path.startsWith("consent.");
    return errorResponse(
      {
        code: isConsent ? "CONSENT_REQUIRED" : "INVALID_REQUEST",
        message: validated.message,
        hint: validated.hint,
        retryAfterSeconds: null,
      },
      isConsent ? 403 : 422,
    );
  }

  const config = readGroqConfig();
  if (!config.ok) {
    return errorResponse(
      {
        code: "NOT_CONFIGURED",
        message: config.message,
        hint: "Set GROQ_API_KEY and GROQ_MODEL as server-side environment variables to enable this feature.",
        retryAfterSeconds: null,
      },
      503,
    );
  }

  const client = clientLimiter.check(clientKey(request));
  if (!client.allowed) {
    return errorResponse(
      {
        code: "RATE_LIMITED",
        message: "Too many AI requests from this client.",
        hint: "Wait before asking for another suggestion. This limit is per server instance and best-effort.",
        retryAfterSeconds: client.retryAfterSeconds,
      },
      429,
    );
  }

  const instance = instanceLimiter.check("instance");
  if (!instance.allowed) {
    return errorResponse(
      {
        code: "RATE_LIMITED",
        message: "This server instance has reached its AI request budget.",
        hint: "Wait before asking for another suggestion. This limit is per server instance and best-effort.",
        retryAfterSeconds: instance.retryAfterSeconds,
      },
      429,
    );
  }

  const result = await requestGroqSuggestion(validated.request, config.config);

  if (!result.ok) {
    return errorResponse(result.error, statusForAiFailure(result.error.code));
  }

  return Response.json(result.value, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}