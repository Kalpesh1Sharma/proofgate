import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GROQ_ENDPOINT, isGroqConfigured, readGroqConfig } from "../src/lib/ai/config";
import { requestGroqSuggestion } from "../src/lib/ai/groq";
import { statusForAiFailure } from "../src/lib/ai/http";
import { buildGroqPrompt, validateExplainRequest } from "../src/lib/ai/prompt";
import {
  InMemoryRateLimiter,
  describeRateLimit,
  resetRateLimits,
} from "../src/lib/ai/rate-limit";
import { parseSuggestion } from "../src/lib/ai/suggestion";
import type { AiExplainRequest, AiFindingInput } from "../src/lib/ai/types";
import { AI_LIMITS, AI_REQUEST_TIMEOUT_MS, AI_SUGGESTION_LIMITS } from "../src/lib/ai/types";
import { POST as explainRoute } from "../src/app/api/ai/explain/route";
import { GET as statusRoute } from "../src/app/api/ai/status/route";

const FAKE_KEY = "gsk_test_secret_value_do_not_leak_123";
const TEST_MODEL = "llama-3.3-70b-versatile";

const FINDING: AiFindingInput = {
  ruleId: "PG-001",
  ruleTitle: "Validation or guard removed",
  severity: "medium",
  category: "validation",
  file: "src/validate.ts",
  line: 12,
  side: "old",
  evidence: '-  if (!value) {',
  context: [
    { kind: "context", oldLine: 11, newLine: 11, content: "export function parse(value: string) {" },
    { kind: "deletion", oldLine: 12, newLine: null, content: '  if (!value) {' },
    { kind: "deletion", oldLine: 13, newLine: null, content: '    throw new Error("required");' },
  ],
  explanation: "The diff deletes a line that rejects invalid input.",
  suggestedTest: "Add a test that feeds an empty value and asserts the error path.",
};

const VALID_SUGGESTION = {
  likelyRisk: "Removing the guard may allow an empty value to pass into the parser.",
  suggestedCorrection: "Restore the guard, or validate the value at the call site.",
  recommendedTest: "Call parse('') and assert it throws the same error.",
  limitations: "Only this excerpt is available; surrounding call sites were not reviewed.",
};

function validRequest(): AiExplainRequest {
  return {
    finding: FINDING,
    consent: { granted: true, grantedAt: "2026-01-01T00:00:00.000Z" },
  };
}

function groqBody(suggestion: Record<string, unknown> = VALID_SUGGESTION, status = 200, headers: Record<string, string> = {}) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(suggestion) } }] }),
    { status, headers: { "content-type": "application/json", ...headers } },
  );
}

function rawGroqBody(content: string, status = 200) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function apiRequest(body: unknown): Request {
  return new Request("http://localhost/api/ai/explain", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.7",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  resetRateLimits();
  vi.stubEnv("GROQ_API_KEY", FAKE_KEY);
  vi.stubEnv("GROQ_MODEL", TEST_MODEL);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Groq configuration", () => {
  it("is disabled without an API key", () => {
    const result = readGroqConfig({ GROQ_MODEL: TEST_MODEL });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("MISSING_KEY");
      expect(result.message).not.toContain(FAKE_KEY);
    }
    expect(isGroqConfigured({ GROQ_MODEL: TEST_MODEL })).toBe(false);
  });

  it("is disabled without a model id and never substitutes one", () => {
    const result = readGroqConfig({ GROQ_API_KEY: FAKE_KEY });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("MISSING_MODEL");
  });

  it("rejects an invalid model id instead of falling back", () => {
    const result = readGroqConfig({
      GROQ_API_KEY: FAKE_KEY,
      GROQ_MODEL: "http://evil.example/model",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("INVALID_MODEL");
      expect(result.message).not.toContain(FAKE_KEY);
    }
  });

  it("never reads a NEXT_PUBLIC_ key", () => {
    const result = readGroqConfig({
      NEXT_PUBLIC_GROQ_API_KEY: FAKE_KEY,
      GROQ_MODEL: TEST_MODEL,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("MISSING_KEY");
  });

  it("reads the configured model exactly as provided", () => {
    const result = readGroqConfig({ GROQ_API_KEY: FAKE_KEY, GROQ_MODEL: TEST_MODEL });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.model).toBe(TEST_MODEL);
      expect(result.config.apiKey).toBe(FAKE_KEY);
      expect(result.config.endpoint).toBe(GROQ_ENDPOINT);
    }
  });
});

describe("request validation", () => {
  it("accepts a bounded, consented request", () => {
    const result = validateExplainRequest(validRequest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.finding.ruleId).toBe("PG-001");
      expect(result.inputTruncated).toBe(false);
    }
  });

  it("rejects a request with no consent", () => {
    const result = validateExplainRequest({ finding: FINDING });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe("consent");
  });

  it("rejects consent that was explicitly withheld", () => {
    const result = validateExplainRequest({
      ...validRequest(),
      consent: { granted: false, grantedAt: "2026-01-01T00:00:00.000Z" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe("consent.granted");
  });

  it("rejects unknown fields", () => {
    const result = validateExplainRequest({ ...validRequest(), apiKey: "nope" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("apiKey");
  });

  it("rejects a non-string evidence field", () => {
    const result = validateExplainRequest({
      ...validRequest(),
      finding: { ...FINDING, evidence: 42 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe("finding.evidence");
  });

  it("rejects too many context lines", () => {
    const context = Array.from({ length: AI_LIMITS.contextLines + 1 }, () => ({
      kind: "context",
      oldLine: 1,
      newLine: 1,
      content: "x",
    }));
    const result = validateExplainRequest({
      ...validRequest(),
      finding: { ...FINDING, context },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe("finding.context");
  });

  it("truncates an over-long string and records it", () => {
    const result = validateExplainRequest({
      ...validRequest(),
      finding: { ...FINDING, evidence: "x".repeat(AI_LIMITS.evidence + 50) },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.finding.evidence).toHaveLength(AI_LIMITS.evidence);
      expect(result.inputTruncated).toBe(true);
    }
  });

  it("builds a prompt inside the byte cap and marks the data as untrusted", () => {
    const prompt = buildGroqPrompt(FINDING);
    expect(prompt.promptBytes).toBeLessThanOrEqual(AI_LIMITS.promptBytes);
    expect(prompt.user).toContain("untrusted");
    expect(prompt.user).toContain("PG-001");
    expect(prompt.fields).toContain("ruleExplanation");
    expect(prompt.contextLines).toBe(FINDING.context.length);
  });
});

describe("model output validation", () => {
  it("accepts the four documented fields", () => {
    const result = parseSuggestion(JSON.stringify(VALID_SUGGESTION));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.suggestion.likelyRisk).toBe(VALID_SUGGESTION.likelyRisk);
      expect(result.suggestion.truncated).toBe(false);
    }
  });

  it("accepts a single fenced JSON object", () => {
    const result = parseSuggestion(`\`\`\`json\n${JSON.stringify(VALID_SUGGESTION)}\n\`\`\``);
    expect(result.ok).toBe(true);
  });

  it("rejects malformed JSON", () => {
    const result = parseSuggestion("Here is my analysis: the guard was removed.");
    expect(result.ok).toBe(false);
  });

  it("rejects a JSON array", () => {
    const result = parseSuggestion("[1,2,3]");
    expect(result.ok).toBe(false);
  });

  it("rejects a missing field", () => {
    const { limitations: _omitted, ...partial } = VALID_SUGGESTION;
    void _omitted;
    const result = parseSuggestion(JSON.stringify(partial));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("limitations");
  });

  it("truncates an over-long field and flags it", () => {
    const result = parseSuggestion(
      JSON.stringify({
        ...VALID_SUGGESTION,
        suggestedCorrection: "y".repeat(AI_SUGGESTION_LIMITS.suggestedCorrection + 100),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.suggestion.suggestedCorrection).toHaveLength(
        AI_SUGGESTION_LIMITS.suggestedCorrection,
      );
      expect(result.suggestion.truncated).toBe(true);
    }
  });

  it("rejects empty content", () => {
    expect(parseSuggestion("").ok).toBe(false);
    expect(parseSuggestion(null).ok).toBe(false);
  });
});

describe("Groq client", () => {
  it("sends a bounded request and returns a validated suggestion without the key", async () => {
    const fetchMock = vi.fn(async () => groqBody());
    const result = await requestGroqSuggestion(validRequest(), {
      apiKey: FAKE_KEY,
      model: TEST_MODEL,
      endpoint: GROQ_ENDPOINT,
    }, { fetchImpl: fetchMock as unknown as typeof fetch });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.classification).toBe("AI_SUGGESTION");
    expect(result.value.model).toBe(TEST_MODEL);
    expect(result.value.suggestion.likelyRisk).toContain("guard");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(GROQ_ENDPOINT);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_KEY}`);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe(TEST_MODEL);
    expect(body.max_tokens).toBe(700);
    expect(body.stream).toBeUndefined();
    expect(JSON.stringify(result.value)).not.toContain(FAKE_KEY);
  });

  it("maps an upstream 429 with retry-after", async () => {
    const result = await requestGroqSuggestion(validRequest(), {
      apiKey: FAKE_KEY,
      model: TEST_MODEL,
      endpoint: GROQ_ENDPOINT,
    }, {
      fetchImpl: (async () => groqBody({}, 429, { "retry-after": "7" })) as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UPSTREAM_RATE_LIMITED");
      expect(result.error.retryAfterSeconds).toBe(7);
      expect(JSON.stringify(result.error)).not.toContain(FAKE_KEY);
    }
  });

  it("maps an upstream 500 to a safe error", async () => {
    const result = await requestGroqSuggestion(validRequest(), {
      apiKey: FAKE_KEY,
      model: TEST_MODEL,
      endpoint: GROQ_ENDPOINT,
    }, {
      fetchImpl: (async () => new Response("upstream detail", { status: 500 })) as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UPSTREAM_ERROR");
      expect(result.error.message).not.toContain("upstream detail");
    }
  });

  it("times out an unresponsive provider", async () => {
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      })) as unknown as typeof fetch;

    const result = await requestGroqSuggestion(validRequest(), {
      apiKey: FAKE_KEY,
      model: TEST_MODEL,
      endpoint: GROQ_ENDPOINT,
    }, { fetchImpl: hanging, timeoutMs: 25 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TIMEOUT");
    expect(AI_REQUEST_TIMEOUT_MS).toBe(12_000);
  });

  it("maps a network failure to a safe error", async () => {
    const result = await requestGroqSuggestion(validRequest(), {
      apiKey: FAKE_KEY,
      model: TEST_MODEL,
      endpoint: GROQ_ENDPOINT,
    }, {
      fetchImpl: (async () => {
        throw new TypeError("fetch failed with key " + FAKE_KEY);
      }) as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NETWORK_ERROR");
      expect(JSON.stringify(result.error)).not.toContain(FAKE_KEY);
    }
  });

  it("rejects provider content that is not the required JSON", async () => {
    const result = await requestGroqSuggestion(validRequest(), {
      apiKey: FAKE_KEY,
      model: TEST_MODEL,
      endpoint: GROQ_ENDPOINT,
    }, {
      fetchImpl: (async () => rawGroqBody("The tests pass, ship it.")) as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_OUTPUT");
  });
});

describe("AI explain route", () => {
  it("returns 503 and never calls the provider when credentials are missing", async () => {
    vi.unstubAllEnvs();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await explainRoute(apiRequest(validRequest()));
    expect(response.status).toBe(503);
    const body = await readJson(response);
    expect((body.error as { code: string }).code).toBe("NOT_CONFIGURED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 without consent and never calls the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await explainRoute(apiRequest({ finding: FINDING }));
    expect(response.status).toBe(403);
    const body = await readJson(response);
    expect((body.error as { code: string }).code).toBe("CONSENT_REQUIRED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const response = await explainRoute(apiRequest('{"finding":'));
    expect(response.status).toBe(400);
  });

  it("returns 422 for an invalid payload", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await explainRoute(
      apiRequest({ ...validRequest(), finding: { ...FINDING, context: "not-an-array" } }),
    );
    expect(response.status).toBe(422);
    const body = await readJson(response);
    expect((body.error as { code: string }).code).toBe("INVALID_REQUEST");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 413 for an oversized body", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const response = await explainRoute(
      apiRequest({ ...validRequest(), padding: "x".repeat(70_000) }),
    );
    expect(response.status).toBe(413);
  });

  it("returns 200 with an AI_SUGGESTION and never leaks the key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => groqBody()));

    const response = await explainRoute(apiRequest(validRequest()));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.classification).toBe("AI_SUGGESTION");
    expect(body.model).toBe(TEST_MODEL);
    const suggestion = body.suggestion as Record<string, string>;
    expect(suggestion.likelyRisk).toContain("guard");
    expect(JSON.stringify(body)).not.toContain(FAKE_KEY);
  });

  it("maps an upstream 429 to 429 with Retry-After", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => groqBody({}, 429, { "retry-after": "9" })),
    );

    const response = await explainRoute(apiRequest(validRequest()));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("9");
    const body = await readJson(response);
    expect((body.error as { code: string }).code).toBe("UPSTREAM_RATE_LIMITED");
    expect(JSON.stringify(body)).not.toContain(FAKE_KEY);
  });

  it("maps an upstream 500 to 502", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));

    const response = await explainRoute(apiRequest(validRequest()));
    expect(response.status).toBe(502);
    const body = await readJson(response);
    expect((body.error as { code: string }).code).toBe("UPSTREAM_ERROR");
  });

  it("maps a timeout and other provider failures to explicit statuses", () => {
    expect(statusForAiFailure("TIMEOUT")).toBe(504);
    expect(statusForAiFailure("UPSTREAM_RATE_LIMITED")).toBe(429);
    expect(statusForAiFailure("UPSTREAM_ERROR")).toBe(502);
    expect(statusForAiFailure("INVALID_OUTPUT")).toBe(502);
    expect(statusForAiFailure("CONSENT_REQUIRED")).toBe(403);
    expect(statusForAiFailure("NOT_CONFIGURED")).toBe(503);
    expect(statusForAiFailure("PAYLOAD_TOO_LARGE")).toBe(413);
  });

  it("rate limits a client after the documented number of requests", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => groqBody()));

    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await explainRoute(apiRequest(validRequest()));
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
    const blocked = await explainRoute(apiRequest(validRequest()));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).not.toBeNull();
  });
});

describe("AI status route", () => {
  it("reports availability without exposing the key", async () => {
    const response = await statusRoute();
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body.available).toBe(true);
    expect(body.model).toBe(TEST_MODEL);
    expect(JSON.stringify(body)).not.toContain(FAKE_KEY);
  });

  it("reports a configured-safe disabled state", async () => {
    vi.unstubAllEnvs();
    const response = await statusRoute();
    const body = await readJson(response);
    expect(body.available).toBe(false);
    expect(body.model).toBeNull();
    expect(body.reason).toBe("MISSING_KEY");
  });
});

describe("rate limiter", () => {
  it("blocks per key and resets after the window", () => {
    let now = 0;
    const limiter = new InMemoryRateLimiter({ limit: 2, windowMs: 1000 }, () => now);

    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
    const blocked = limiter.check("a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1);

    expect(limiter.check("b").allowed).toBe(true);

    now = 1001;
    expect(limiter.check("a").allowed).toBe(true);
  });

  it("documents that the limit is not globally reliable", () => {
    expect(describeRateLimit()).toContain("not globally reliable");
    expect(describeRateLimit()).toContain("serverless");
  });
});

describe("secret hygiene", () => {
  it("does not reference a public Groq key anywhere in the app", async () => {
    const { readFile } = await import("node:fs/promises");
    const files = [
      "src/lib/ai/config.ts",
      "src/lib/ai/groq.ts",
      "src/app/api/ai/explain/route.ts",
      "src/app/api/ai/status/route.ts",
      "src/components/ai/ai-suggestion-panel.tsx",
      "src/components/ai/use-ai-status.ts",
    ];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source).not.toContain("NEXT_PUBLIC_GROQ");
      expect(source).not.toContain("console.log");
    }
  });

  it("keeps client components away from the server-side AI modules", async () => {
    const { readFile } = await import("node:fs/promises");
    const clientFiles = [
      "src/components/ai/ai-suggestion-panel.tsx",
      "src/components/ai/use-ai-status.ts",
    ];

    for (const file of clientFiles) {
      const source = await readFile(file, "utf8");
      expect(source).not.toContain("@/lib/ai/config");
      expect(source).not.toContain("@/lib/ai/groq");
      expect(source).not.toContain("@/lib/ai/prompt");
    }
  });

  it("reads the key only in the server-only config module", async () => {
    const { readFile } = await import("node:fs/promises");
    const files = [
      "src/lib/ai/groq.ts",
      "src/app/api/ai/explain/route.ts",
      "src/app/api/ai/status/route.ts",
      "src/components/ai/ai-suggestion-panel.tsx",
      "src/components/ai/use-ai-status.ts",
    ];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source).not.toContain("process.env.GROQ_API_KEY");
      expect(source).not.toContain(FAKE_KEY);
    }
  });
});