import { describe, expect, it, beforeEach } from "vitest";
import {
  RATE_LIMIT,
  checkRateLimit,
  resetRateLimitStore,
} from "./rate-limit.js";

describe("rate-limit", () => {
  beforeEach(() => {
    resetRateLimitStore();
  });

  it("allows normal usage under the hourly cap", () => {
    const first = checkRateLimit("1.1.1.1");
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(RATE_LIMIT.maxPerHour - 1);
  });

  it("blocks after the per-minute burst", () => {
    const key = "2.2.2.2";
    const now = Date.now();
    for (let i = 0; i < RATE_LIMIT.maxPerMinute; i += 1) {
      expect(checkRateLimit(key, now + i).allowed).toBe(true);
    }
    const blocked = checkRateLimit(key, now + RATE_LIMIT.maxPerMinute);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toMatch(/too quickly/i);
  });

  it("blocks after the hourly cap", () => {
    const key = "3.3.3.3";
    const start = Date.now();
    // Spread across minutes so burst limit is not the blocker.
    for (let i = 0; i < RATE_LIMIT.maxPerHour; i += 1) {
      const t = start + i * (RATE_LIMIT.minuteMs + 1);
      expect(checkRateLimit(key, t).allowed).toBe(true);
    }
    const blocked = checkRateLimit(
      key,
      start + RATE_LIMIT.maxPerHour * (RATE_LIMIT.minuteMs + 1),
    );
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.reason).toMatch(/hourly limit/i);
  });
});
