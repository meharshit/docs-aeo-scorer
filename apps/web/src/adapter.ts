/** Map scanner ScoreReport → UI Report. Does not change the backend. */

export type CheckStatus = "pass" | "partial" | "missing";
export type AreaId =
  | "discoverability"
  | "readability"
  | "actionability"
  | "trust";

export interface AreaResult {
  id: AreaId;
  name: string;
  score: number;
  max: number;
  checks: { status: CheckStatus; label: string; path?: string }[];
}

export interface Recommendation {
  severity: "needs-fix" | "can-improve";
  area: string;
  title: string;
  body: string;
  path?: string;
  hint?: string;
}

export interface Report {
  url: string;
  checkedAt: string;
  checksRun: number;
  score: number;
  grade: string;
  areas: AreaResult[];
  recommendations: Recommendation[];
  summary?: { headline: string; highlight?: string; body: string };
}

type BackendCheck = {
  id: string;
  title: string;
  status: "pass" | "fail" | "warn" | "skip";
  score: number;
  maxScore: number;
  evidence: string[];
  howToFix: string;
};

type BackendCategory = {
  id: string;
  title: string;
  score: number;
  maxScore: number;
  checks: BackendCheck[];
};

export type ScoreReport = {
  url: string;
  scoredAt: string;
  rubricVersion: string;
  score: number;
  maxScore: number;
  grade: string;
  categories: BackendCategory[];
  notes: string[];
};

const AREA_ORDER: { backendId: string; id: AreaId; name: string }[] = [
  { backendId: "discoverability", id: "discoverability", name: "Discoverability" },
  { backendId: "readability", id: "readability", name: "Readability" },
  {
    backendId: "actability",
    id: "actionability",
    name: "Actionability",
  },
  { backendId: "trust", id: "trust", name: "Trust and freshness" },
];

function mapStatus(status: BackendCheck["status"]): CheckStatus | null {
  if (status === "pass") return "pass";
  if (status === "warn") return "partial";
  if (status === "fail") return "missing";
  return null; // skip: do not invent
}

function pathFromEvidence(evidence: string[]): string | undefined {
  for (const item of evidence) {
    const match = item.match(/https?:\/\/\S+|\/[\w./-]+\.\w+/);
    if (match) return match[0]!.replace(/[.,;]+$/, "");
  }
  return undefined;
}

export function bandLabel(score: number, maxScore = 100): string {
  const pct = maxScore === 0 ? 0 : (score / maxScore) * 100;
  if (pct >= 70) return "Strong";
  if (pct >= 50) return "Getting there";
  return "Needs work";
}

export function displayHost(url: string): string {
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    return `${u.host}${u.pathname.replace(/\/$/, "")}${u.search}` || u.host;
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

export function normalizeDocsUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const u = new URL(withProtocol);
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Only call something a weak spot when it is actually weak, not just the lowest of four strong areas. */
const WEAK_AREA_PCT = 85;

function buildSummary(
  areas: AreaResult[],
  recommendations: Recommendation[],
  overallScore: number,
): Report["summary"] {
  const withPct = areas.map((a) => ({
    ...a,
    pct: a.max === 0 ? 0 : (a.score / a.max) * 100,
  }));
  const weakest = [...withPct].sort((a, b) => a.pct - b.pct)[0];
  const phrases: Record<AreaId, string> = {
    discoverability: "find your docs",
    readability: "read your pages cleanly",
    actionability: "finish tasks",
    trust: "tell what is current",
  };
  const needsFix = recommendations.filter((r) => r.severity === "needs-fix");
  const titles = needsFix.slice(0, 3).map((r) => r.title.toLowerCase());

  let body: string;
  if (titles.length === 0) {
    body =
      "Re-check after your next docs release to stay in a strong band.";
  } else if (titles.length === 1) {
    body = `Fix ${titles[0]} first, then re-check after your next docs release.`;
  } else if (titles.length === 2) {
    body = `Fix ${titles[0]} and ${titles[1]} first, then re-check after your next docs release.`;
  } else {
    body = `Fix ${titles[0]}, ${titles[1]} and ${titles[2]} first, then re-check after your next docs release.`;
  }

  const hasRealWeakSpot =
    Boolean(weakest) &&
    (weakest!.pct < WEAK_AREA_PCT || needsFix.length > 0);

  // Perfect / near-perfect: never claim agents "struggle" just because one area
  // ties for lowest among four full scores.
  if (overallScore >= 90 && !hasRealWeakSpot) {
    return {
      headline: "Strong agent readiness across the board. Keep",
      highlight: "shipping improvements",
      body,
    };
  }

  if (overallScore >= 70 && !hasRealWeakSpot) {
    return {
      headline: "Solid AEO foundation. Agents can already",
      highlight: "find and use your docs",
      body,
    };
  }

  if (!hasRealWeakSpot || !weakest) {
    return {
      headline: "Your docs are in decent shape. Keep watching",
      highlight: "what agents need next",
      body,
    };
  }

  return {
    headline: `Your weakest area is ${weakest.name}. Agents struggle to`,
    highlight: phrases[weakest.id],
    body,
  };
}

export function toReport(backend: ScoreReport): Report {
  const byId = new Map(backend.categories.map((c) => [c.id, c]));

  const areas: AreaResult[] = AREA_ORDER.map((meta) => {
    const cat = byId.get(meta.backendId);
    const checks =
      cat?.checks
        .map((check) => {
          const status = mapStatus(check.status);
          if (!status) return null;
          return {
            status,
            label: check.title,
            path: pathFromEvidence(check.evidence),
          };
        })
        .filter((c): c is NonNullable<typeof c> => Boolean(c)) ?? [];

    return {
      id: meta.id,
      name: meta.name,
      score: cat?.score ?? 0,
      max: cat?.maxScore ?? 0,
      checks,
    };
  });

  const recommendations: Recommendation[] = backend.categories
    .flatMap((cat) => {
      const areaMeta =
        AREA_ORDER.find((a) => a.backendId === cat.id)?.name ?? cat.title;
      return cat.checks
        .filter((c) => c.status === "fail" || c.status === "warn")
        .map((c) => ({
          severity:
            c.status === "fail"
              ? ("needs-fix" as const)
              : ("can-improve" as const),
          area: areaMeta === "Actability" ? "Actionability" : areaMeta,
          title: c.title,
          body: c.howToFix,
          path: pathFromEvidence(c.evidence),
          hint: c.evidence[0],
        }));
    })
    .sort((a, b) => {
      if (a.severity === b.severity) return 0;
      return a.severity === "needs-fix" ? -1 : 1;
    });

  // Prefer Actionability label from mapping
  for (const rec of recommendations) {
    if (rec.area === "Actability") rec.area = "Actionability";
  }

  const checksRun = areas.reduce((sum, a) => sum + a.checks.length, 0);

  return {
    url: backend.url,
    checkedAt: backend.scoredAt,
    checksRun,
    score: backend.score,
    grade: backend.grade,
    areas,
    recommendations,
    summary: buildSummary(areas, recommendations, backend.score),
  };
}

export function reportToMarkdown(report: Report): string {
  const band = bandLabel(report.score);
  const lines: string[] = [
    `# AEO report: ${report.url}`,
    `Score: ${report.score} / 100 (Grade ${report.grade}, ${band})`,
    `Checked: ${report.checkedAt}`,
    "",
    "## Areas",
  ];

  for (const area of report.areas) {
    const p = area.max === 0 ? 0 : Math.round((area.score / area.max) * 100);
    lines.push(`- ${area.name}: ${area.score} / ${area.max} (${p}%)`);
    for (const check of area.checks) {
      const tag =
        check.status === "pass"
          ? "Pass"
          : check.status === "partial"
            ? "Partial"
            : "Missing";
      const path = check.path ? ` (${check.path})` : "";
      lines.push(`  - ${tag}: ${check.label}${path}`);
    }
  }

  lines.push("", "## What to fix first");
  report.recommendations.forEach((rec, i) => {
    const sev = rec.severity === "needs-fix" ? "Needs fix" : "Can improve";
    const path = rec.path ? ` Path: ${rec.path}` : "";
    lines.push(
      `${i + 1}. ${rec.title} (${sev} · ${rec.area}): ${rec.body}${path}`,
    );
  });

  return lines.join("\n");
}
