import { describe, expect, it } from "vitest";
import {
  isPublicEligibleUrl,
  toSiteKey,
  toSlug,
} from "./site-key.js";

describe("site-key", () => {
  it("normalizes site keys", () => {
    expect(toSiteKey("https://Linear.app/docs/")).toBe("linear.app/docs");
    expect(toSiteKey("https://www.example.com/docs?x=1#y")).toBe(
      "example.com/docs",
    );
  });

  it("builds slugs", () => {
    expect(toSlug("linear.app/docs")).toBe("linear-app-docs");
  });

  it("blocks private hosts", () => {
    expect(isPublicEligibleUrl("http://localhost:5173")).toBe(false);
    expect(isPublicEligibleUrl("https://192.168.1.1")).toBe(false);
    expect(isPublicEligibleUrl("https://docs.corp.internal")).toBe(false);
    expect(isPublicEligibleUrl("https://developer.suki.ai")).toBe(true);
  });
});
