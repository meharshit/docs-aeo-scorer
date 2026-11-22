import { describe, expect, it } from "vitest";
import { assertRubricWeights, listCheckIds, rubricV01 } from "./index.js";

describe("rubric v0.1", () => {
  it("has balanced category and check weights", () => {
    expect(() => assertRubricWeights(rubricV01)).not.toThrow();
  });

  it("exposes unique check ids", () => {
    const ids = listCheckIds(rubricV01);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("targets AEO retrieval path, not SEO marketing", () => {
    expect(rubricV01.description.toLowerCase()).toContain("not google seo");
  });
});
