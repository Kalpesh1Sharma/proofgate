"use client";

import { useEffect, useState } from "react";

export interface AiStatus {
  state: "loading" | "available" | "unavailable";
  model: string | null;
  reason: string | null;
}

const INITIAL: AiStatus = { state: "loading", model: null, reason: null };

/**
 * Reads the server's AI availability once per mount. This is a single request
 * with no polling; if it fails the feature stays hidden rather than showing a
 * broken action.
 */
export function useAiStatus(): AiStatus {
  const [status, setStatus] = useState<AiStatus>(INITIAL);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      try {
        const response = await fetch("/api/ai/status", {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("status request failed");
        const payload = (await response.json()) as {
          available?: unknown;
          model?: unknown;
          reason?: unknown;
        };
        if (!active) return;
        setStatus({
          state: payload.available === true ? "available" : "unavailable",
          model: typeof payload.model === "string" ? payload.model : null,
          reason: typeof payload.reason === "string" ? payload.reason : null,
        });
      } catch {
        if (!active) return;
        setStatus({ state: "unavailable", model: null, reason: "STATUS_UNAVAILABLE" });
      }
    }

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return status;
}