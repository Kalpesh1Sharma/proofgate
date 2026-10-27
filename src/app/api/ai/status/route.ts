/**
 * GET /api/ai/status
 *
 * Reports whether the optional AI Fix Advisor is configured on this server.
 * It exposes no credentials: only a boolean, the provider name, the configured
 * model id (not a secret) and the documented request limits.
 */

import { connection } from "next/server";

import { readGroqConfig } from "@/lib/ai/config";
import { AI_CLIENT_POLICY, AI_INSTANCE_POLICY, describeRateLimit } from "@/lib/ai/rate-limit";
import { AI_REQUEST_TIMEOUT_MS } from "@/lib/ai/types";

export async function GET(): Promise<Response> {
  // Availability depends on server environment variables, so it must be read
  // per request rather than baked into the build. `connection()` opts this
  // route out of prerendering. Outside a Next request scope (unit tests) it
  // is not available; the config is still read immediately below.
  try {
    await connection();
  } catch {
    // No request scope; continue with the current environment.
  }

  const config = readGroqConfig();

  return Response.json(
    {
      available: config.ok,
      provider: "groq",
      model: config.ok ? config.config.model : null,
      reason: config.ok ? null : config.reason,
      consentRequired: true,
      limits: {
        perClientPerMinute: AI_CLIENT_POLICY.limit,
        perInstancePerMinute: AI_INSTANCE_POLICY.limit,
        timeoutMs: AI_REQUEST_TIMEOUT_MS,
        note: describeRateLimit(),
      },
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}