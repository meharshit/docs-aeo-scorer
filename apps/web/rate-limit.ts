/**
 * Simple in-memory rate limiter for the score API.
 * Free-hosting friendly (no Redis). Limits are per process instance.
 */

export const RATE_LIMIT = {
  /** Max scores per client IP in a rolling hour. */
  maxPerHour: 50,
  /** Short burst cap so automation cannot dump the hour budget instantly. */
  maxPerMinute: 8,
  hourMs: 60 * 60 * 1000,
  minuteMs: 60 * 1000,
} as const;

type Bucket = {
  hour: number[];
  minute: number[];
};

const buckets = new Map<string, Bucket>();

function prune(timestamps: number[], windowMs: number, now: number): number[] {
  return timestamps.filter((t) => now - t < windowMs);
}

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
  reason?: string;
};

export function clientKeyFromHeaders(
  headers: Record<string, string | string[] | undefined> | Headers,
  fallback = "unknown",
): string {
  const read = (name: string): string | undefined => {
    if (typeof (headers as Headers).get === "function") {
      return (headers as Headers).get(name) ?? undefined;
    }
    const value = (headers as Record<string, string | string[] | undefined>)[name];
    if (Array.isArray(value)) return value[0];
    return value;
  };

  const forwarded = read("x-forwarded-for") ?? read("X-Forwarded-For");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || fallback;
  }

  const realIp = read("x-real-ip") ?? read("X-Real-Ip");
  if (realIp) return realIp.trim();

  return fallback;
}

export function checkRateLimit(clientKey: string, now = Date.now()): RateLimitDecision {
  const key = clientKey.trim() || "unknown";
  const existing = buckets.get(key) ?? { hour: [], minute: [] };

  const hour = prune(existing.hour, RATE_LIMIT.hourMs, now);
  const minute = prune(existing.minute, RATE_LIMIT.minuteMs, now);

  if (minute.length >= RATE_LIMIT.maxPerMinute) {
    const oldest = minute[0] ?? now;
    const retryAfterSec = Math.max(
      1,
      Math.ceil((RATE_LIMIT.minuteMs - (now - oldest)) / 1000),
    );
    buckets.set(key, { hour, minute });
    return {
      allowed: false,
      limit: RATE_LIMIT.maxPerHour,
      remaining: Math.max(0, RATE_LIMIT.maxPerHour - hour.length),
      retryAfterSec,
      reason:
        "Too many scores too quickly. Wait a minute, then try again. Limit is meant for people checking docs, not bots.",
    };
  }

  if (hour.length >= RATE_LIMIT.maxPerHour) {
    const oldest = hour[0] ?? now;
    const retryAfterSec = Math.max(
      1,
      Math.ceil((RATE_LIMIT.hourMs - (now - oldest)) / 1000),
    );
    buckets.set(key, { hour, minute });
    return {
      allowed: false,
      limit: RATE_LIMIT.maxPerHour,
      remaining: 0,
      retryAfterSec,
      reason: `Hourly limit reached (${RATE_LIMIT.maxPerHour} scores per hour). Try again later.`,
    };
  }

  hour.push(now);
  minute.push(now);
  buckets.set(key, { hour, minute });

  return {
    allowed: true,
    limit: RATE_LIMIT.maxPerHour,
    remaining: Math.max(0, RATE_LIMIT.maxPerHour - hour.length),
    retryAfterSec: 0,
  };
}

/** Test helper — clears all buckets. */
export function resetRateLimitStore(): void {
  buckets.clear();
}
