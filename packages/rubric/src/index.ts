import rubricJson from "./rubric.v0.1.json" with { type: "json" };

export type CheckLevel = "must" | "should" | "may";

export interface RubricCheck {
  id: string;
  title: string;
  weight: number;
  level: CheckLevel;
  howToFix: string;
}

export interface RubricCategory {
  id: string;
  title: string;
  weight: number;
  description: string;
  checks: RubricCheck[];
}

export interface Rubric {
  id: string;
  version: string;
  title: string;
  description: string;
  maxScore: number;
  categories: RubricCategory[];
}

/** Current public rubric (v0.1). Bump version in JSON when weights/checks change. */
export const rubricV01 = rubricJson as Rubric;

export function listCheckIds(rubric: Rubric = rubricV01): string[] {
  return rubric.categories.flatMap((category) =>
    category.checks.map((check) => check.id),
  );
}

export function assertRubricWeights(rubric: Rubric = rubricV01): void {
  const categorySum = rubric.categories.reduce((sum, c) => sum + c.weight, 0);
  if (categorySum !== rubric.maxScore) {
    throw new Error(
      `Category weights sum to ${categorySum}, expected ${rubric.maxScore}`,
    );
  }

  for (const category of rubric.categories) {
    const checkSum = category.checks.reduce((sum, c) => sum + c.weight, 0);
    if (checkSum !== category.weight) {
      throw new Error(
        `Category ${category.id} checks sum to ${checkSum}, expected ${category.weight}`,
      );
    }
  }
}
