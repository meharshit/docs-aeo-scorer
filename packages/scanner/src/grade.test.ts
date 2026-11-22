import { describe, expect, it } from "vitest";
import { gradeFromScore } from "./types.js";

describe("gradeFromScore", () => {
  it("maps percentages to letter grades", () => {
    expect(gradeFromScore(95, 100)).toBe("A");
    expect(gradeFromScore(82, 100)).toBe("B");
    expect(gradeFromScore(69, 100)).toBe("C");
    expect(gradeFromScore(59, 100)).toBe("D");
    expect(gradeFromScore(10, 100)).toBe("F");
  });
});
