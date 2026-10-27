/**
 * Groq chat-completions client for the AI Fix Advisor.
 *
 * The call is bounded by a 12 second timeout and a capped token budget. The
 * API key travels only in the Authorization header of this server-side request
 * and is never returned to the caller, logged or included in an error message.
 */

import type { GroqConfig } from "./config";
import { buildGroqPrompt } from "./prompt";
import { parseSuggestion } from "./suggestion";
import { AI_LIMITS, AI_MAX_OUTPUT_TOKENS, AI_REQUEST_TIMEOUT_MS } from "./types";
import type { AiExplainRequest, AiExplainResult } from "./types";

export interface GroqRequestDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
}

function failure(
  code: Extract<AiExplainResult, { ok: false }>["error"]["code"],
  message: string,
  hint: string,
  retryAfterSeconds: number | null = null,
): AiExplainResult {
  return { ok: false, error: { code, message, hint, retryAfterSeconds } };
}

function readRetryAfter(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

/**
 * Calls Groq and returns a validated suggestion or a safe, typed failure.
 * Never throws for provider or network problems.
 */
export async function requestGroqSuggestion(
  request: AiExplainRequest,
  config: GroqConfig,
  deps: GroqRequestDeps = {},
): Promise<AiExplainResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? AI_REQUEST_TIMEOUT_MS;
  const now = deps.now ?? (() => new Date());

  const prompt = buildGroqPrompt(request.finding);
  if (prompt.promptBytes > AI_LIMITS.promptBytes) {
    return failure(
      "PAYLOAD_TOO_LARGE",
      "The finding excerpt is too large to send.",
      "Open a single finding with a smaller context and try again.",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        temperature: 0.2,
        max_tokens: AI_MAX_OUTPUT_TOKENS,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      return failure(
        "TIMEOUT",
        `The AI provider did not respond within ${Math.round(timeoutMs / 1000)} seconds.`,
        "Try again, or review the finding without AI assistance.",
      );
    }
    void error;
    return failure(
      "NETWORK_ERROR",
      "The AI provider could not be reached.",
      "Check the deployment's outbound network access and try again.",
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429) {
    return failure(
      "UPSTREAM_RATE_LIMITED",
      "The AI provider is currently rate limiting requests.",
      "Wait a moment and try again, or review the finding manually.",
      readRetryAfter(response),
    );
  }

  if (response.status >= 500) {
    return failure(
      "UPSTREAM_ERROR",
      "The AI provider reported a server error.",
      "Try again later. The deterministic findings are unaffected.",
    );
  }

  if (!response.ok) {
    return failure(
      "UPSTREAM_ERROR",
      `The AI provider rejected the request (status ${response.status}).`,
      "Check that GROQ_MODEL names a model the account can use.",
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return failure(
      "INVALID_OUTPUT",
      "The AI provider returned a response that could not be read.",
      "The output was discarded. Review the finding manually.",
    );
  }

  let content: unknown;
  if (typeof payload === "object" && payload !== null && "choices" in payload) {
    const choices = (payload as { choices?: unknown }).choices;
    if (Array.isArray(choices) && choices.length > 0) {
      const first = choices[0];
      if (typeof first === "object" && first !== null && "message" in first) {
        const message = (first as { message?: unknown }).message;
        if (typeof message === "object" && message !== null && "content" in message) {
          content = (message as { content?: unknown }).content;
        }
      }
    }
  }

  const suggestion = parseSuggestion(content);
  if (!suggestion.ok) {
    return failure("INVALID_OUTPUT", suggestion.message, suggestion.hint);
  }

  return {
    ok: true,
    value: {
      classification: "AI_SUGGESTION",
      model: config.model,
      generatedAt: now().toISOString(),
      suggestion: suggestion.suggestion,
      disclosure: {
        fields: prompt.fields,
        contextLines: prompt.contextLines,
        promptBytes: prompt.promptBytes,
      },
    },
  };
}