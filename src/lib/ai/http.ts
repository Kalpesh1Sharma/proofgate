/** HTTP status mapping for AI advisor failures. Pure and testable. */

import type { AiFailure } from "./types";

export function statusForAiFailure(code: AiFailure["code"]): number {
  switch (code) {
    case "NOT_CONFIGURED":
      return 503;
    case "CONSENT_REQUIRED":
      return 403;
    case "INVALID_REQUEST":
      return 422;
    case "PAYLOAD_TOO_LARGE":
      return 413;
    case "RATE_LIMITED":
    case "UPSTREAM_RATE_LIMITED":
      return 429;
    case "UPSTREAM_ERROR":
    case "NETWORK_ERROR":
    case "INVALID_OUTPUT":
      return 502;
    case "TIMEOUT":
      return 504;
  }
}