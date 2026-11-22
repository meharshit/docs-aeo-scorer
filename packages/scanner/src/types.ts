import type { CheckLevel } from "@aeo-docs-scorer/rubric";

export type CheckStatus = "pass" | "fail" | "warn" | "skip";

export interface CheckResult {
  id: string;
  title: string;
  status: CheckStatus;
  score: number;
  maxScore: number;
  level: CheckLevel;
  evidence: string[];
  howToFix: string;
}

export interface CategoryResult {
  id: string;
  title: string;
  score: number;
  maxScore: number;
  checks: CheckResult[];
}

export interface ScoreReport {
  url: string;
  scoredAt: string;
  rubricVersion: string;
  score: number;
  maxScore: number;
  grade: string;
  categories: CategoryResult[];
  notes: string[];
}

/** Grade bands match the landing scale: 0–50 F, 50–70 D/C, 70–100 B/A. */
export function gradeFromScore(score: number, maxScore: number): string {
  const pct = maxScore === 0 ? 0 : (score / maxScore) * 100;
  if (pct >= 85) return "A";
  if (pct >= 70) return "B";
  if (pct >= 60) return "C";
  if (pct >= 50) return "D";
  return "F";
}
