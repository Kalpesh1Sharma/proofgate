/**
 * Best-effort, per-instance rate limiting for the AI advisor.
 *
 * IMPORTANT: this limiter lives in the memory of a single server instance. On
 * serverless platforms such as Vercel each instance has its own memory and
 * instances are created and destroyed at will, so the limit is NOT globally
 * reliable. It reduces casual abuse and protects one instance's quota; a
 * durable limit needs shared storage or a platform-level control.
 */

export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly policy: RateLimitPolicy,
    private readonly now: () => number = Date.now,
  ) {}

  /** Consumes one unit for the key and reports whether the call may proceed. */
  check(key: string): RateLimitDecision {
    const timestamp = this.now();
    this.prune(timestamp);

    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= timestamp) {
      this.buckets.set(key, { count: 1, resetAt: timestamp + this.policy.windowMs });
      return {
        allowed: true,
        limit: this.policy.limit,
        remaining: this.policy.limit - 1,
        retryAfterSeconds: 0,
      };
    }

    if (existing.count >= this.policy.limit) {
      return {
        allowed: false,
        limit: this.policy.limit,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - timestamp) / 1000)),
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      limit: this.policy.limit,
      remaining: this.policy.limit - existing.count,
      retryAfterSeconds: 0,
    };
  }

  private prune(timestamp: number): void {
    if (this.buckets.size < 500) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= timestamp) this.buckets.delete(key);
    }
  }

  size(): number {
    return this.buckets.size;
  }

  reset(): void {
    this.buckets.clear();
  }
}

export const AI_CLIENT_POLICY: RateLimitPolicy = { limit: 5, windowMs: 60_000 };
export const AI_INSTANCE_POLICY: RateLimitPolicy = { limit: 20, windowMs: 60_000 };

export const clientLimiter = new InMemoryRateLimiter(AI_CLIENT_POLICY);
export const instanceLimiter = new InMemoryRateLimiter(AI_INSTANCE_POLICY);

/** Test helper: clears both limiters. Never called by request handling. */
export function resetRateLimits(): void {
  clientLimiter.reset();
  instanceLimiter.reset();
}

export function describeRateLimit(): string {
  return [
    `Per client: ${AI_CLIENT_POLICY.limit} requests per ${AI_CLIENT_POLICY.windowMs / 1000}s.`,
    `Per instance: ${AI_INSTANCE_POLICY.limit} requests per ${AI_INSTANCE_POLICY.windowMs / 1000}s.`,
    "This in-memory limit is best-effort per server instance and is not globally reliable on serverless deployments.",
  ].join(" ");
}