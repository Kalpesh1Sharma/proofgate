/**
 * Server-only configuration for the AI Fix Advisor.
 *
 * The API key is read from the environment and never returned, logged or
 * bundled. There is deliberately no fallback model: an unsupported or missing
 * GROQ_MODEL disables the feature instead of silently substituting an ID.
 */

export const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

/** Groq model IDs are short slugs such as `llama-3.3-70b-versatile` or `openai/gpt-oss-20b`. */
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

export interface GroqConfig {
  apiKey: string;
  model: string;
  endpoint: string;
}

export type GroqConfigResult =
  | { ok: true; config: GroqConfig }
  | { ok: false; reason: "MISSING_KEY" | "MISSING_MODEL" | "INVALID_MODEL"; message: string };

type Env = Record<string, string | undefined>;

export function readGroqConfig(env: Env = process.env): GroqConfigResult {
  const apiKey = typeof env.GROQ_API_KEY === "string" ? env.GROQ_API_KEY.trim() : "";
  const model = typeof env.GROQ_MODEL === "string" ? env.GROQ_MODEL.trim() : "";

  // Only the documented server-side names are read. A NEXT_PUBLIC_ variant is
  // never consulted, so a key accidentally exposed to the client is not used.
  if (apiKey.length === 0 || apiKey.length > 200) {
    return {
      ok: false,
      reason: "MISSING_KEY",
      message: "The AI advisor is not configured: no Groq API key is available on the server.",
    };
  }

  if (model.length === 0) {
    return {
      ok: false,
      reason: "MISSING_MODEL",
      message: "The AI advisor is not configured: no Groq model id is set.",
    };
  }

  if (
    !MODEL_PATTERN.test(model) ||
    model.endsWith("/") ||
    model.includes("//")
  ) {
    return {
      ok: false,
      reason: "INVALID_MODEL",
      message:
        "The AI advisor is disabled: GROQ_MODEL is not a valid model id, and no substitute is used.",
    };
  }

  return { ok: true, config: { apiKey, model, endpoint: GROQ_ENDPOINT } };
}

export function isGroqConfigured(env: Env = process.env): boolean {
  return readGroqConfig(env).ok;
}