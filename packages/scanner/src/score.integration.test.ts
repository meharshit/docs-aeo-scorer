import { describe, expect, it } from "vitest";
import { scoreDocsUrl } from "./score.js";

describe("scoreDocsUrl integration", () => {
  it(
    "scores developer.suki.ai as a strong AEO site",
    async () => {
      const report = await scoreDocsUrl("https://developer.suki.ai");
      expect(report.score).toBeGreaterThanOrEqual(70);
      expect(["A", "B", "C"]).toContain(report.grade);

      const byId = Object.fromEntries(
        report.categories.flatMap((c) => c.checks.map((ch) => [ch.id, ch])),
      );

      expect(byId["llms-txt-present"]?.status).toBe("pass");
      expect(byId["agent-skills-index"]?.status).toBe("pass");
      expect(byId["openapi-discoverable"]?.status).toBe("pass");
      expect(byId["mcp-endpoint"]?.status).toBe("pass");
      expect(byId["skill-md-reachable"]?.status).not.toBe("skip");
    },
    60_000,
  );

  it(
    "recognizes Expo's verified MCP remote",
    async () => {
      const report = await scoreDocsUrl("https://docs.expo.dev");
      const byId = Object.fromEntries(
        report.categories.flatMap((c) => c.checks.map((ch) => [ch.id, ch])),
      );

      expect(byId["mcp-endpoint"]?.status).toBe("pass");
      expect(byId["mcp-endpoint"]?.evidence.join(" ")).toContain(
        "https://mcp.expo.dev/mcp",
      );
    },
    60_000,
  );

  it(
    "scores example.com much lower than a docs-ready site",
    async () => {
      const weak = await scoreDocsUrl("https://example.com");
      const strong = await scoreDocsUrl("https://developer.suki.ai");
      expect(strong.score).toBeGreaterThan(weak.score + 20);
    },
    90_000,
  );
});
