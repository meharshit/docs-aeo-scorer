import {
  addPublicAgain,
  getHistory,
  getPublicBySlug,
  getPublicStatsAndRows,
  getTopPublic,
  removePublic,
  savePublicResult,
} from "@aeo-docs-scorer/public-scores";
import { scoreDocsUrl } from "@aeo-docs-scorer/scanner";

export type JsonResult = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

function json(status: number, body: unknown, headers?: Record<string, string>): JsonResult {
  return {
    status,
    body,
    headers: {
      "content-type": "application/json",
      "cache-control": status === 200 ? "public, max-age=60" : "no-store",
      ...headers,
    },
  };
}

export async function handleScorePost(body: {
  url?: string;
  public?: boolean;
}): Promise<JsonResult> {
  if (!body.url || typeof body.url !== "string") {
    return json(400, { error: "Missing url" });
  }
  try {
    new URL(body.url);
  } catch {
    return json(400, { error: "Invalid url" });
  }

  const report = await scoreDocsUrl(body.url);
  const makePublic = body.public !== false;

  let publicMeta: {
    slug: string;
    rank: number;
    total: number;
    removalToken: string;
    siteKey: string;
  } | null = null;
  let publicError: string | null = null;

  if (makePublic) {
    try {
      publicMeta = await savePublicResult({
        url: report.url,
        score: report.score,
        grade: report.grade,
        checkedAt: report.scoredAt,
        categories: report.categories.map((c) => ({
          id: c.id,
          score: c.score,
        })),
        report,
      });
    } catch (error) {
      // Scoring must still succeed if the public board DB is misconfigured.
      publicError =
        error instanceof Error ? error.message : "Public listing failed";
      publicMeta = null;
    }
  }

  return json(200, {
    ...report,
    public: publicMeta
      ? {
          listed: true,
          slug: publicMeta.slug,
          rank: publicMeta.rank,
          total: publicMeta.total,
          removalToken: publicMeta.removalToken,
          siteKey: publicMeta.siteKey,
        }
      : {
          listed: false,
          ...(publicError ? { error: publicError } : {}),
        },
  });
}

export async function handlePublicScoresApi(
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
  body: Record<string, unknown> = {},
): Promise<JsonResult> {
  const path = pathname.replace(/\/+$/, "") || "/";

  if (method === "GET" && path === "/api/public-scores") {
    const data = await getPublicStatsAndRows({
      sort: searchParams.get("sort") || "top",
      grade: searchParams.get("grade") || "all",
      q: searchParams.get("q") || "",
      page: Number(searchParams.get("page") || "1"),
    });
    return json(200, data);
  }

  if (method === "GET" && path === "/api/public-scores/top") {
    const limit = Number(searchParams.get("limit") || "5");
    const rows = await getTopPublic(limit);
    return json(200, { rows });
  }

  const historyMatch = path.match(/^\/api\/public-scores\/([^/]+)\/history$/);
  if (method === "GET" && historyMatch) {
    const slug = decodeURIComponent(historyMatch[1]!);
    const points = await getHistory(slug);
    return json(200, { points });
  }

  const removeMatch = path.match(/^\/api\/public-scores\/([^/]+)\/remove$/);
  if (method === "POST" && removeMatch) {
    const slug = decodeURIComponent(removeMatch[1]!);
    const token =
      typeof body.removalToken === "string" ? body.removalToken : "";
    const ok = await removePublic(slug, token);
    if (!ok) return json(403, { error: "Forbidden" });
    return json(200, { ok: true });
  }

  const addMatch = path.match(/^\/api\/public-scores\/([^/]+)\/add$/);
  if (method === "POST" && addMatch) {
    const slug = decodeURIComponent(addMatch[1]!);
    const token =
      typeof body.removalToken === "string" ? body.removalToken : "";
    const result = await addPublicAgain(slug, token);
    if (!result) return json(403, { error: "Forbidden" });
    return json(200, result);
  }

  const slugMatch = path.match(/^\/api\/public-scores\/([^/]+)$/);
  if (method === "GET" && slugMatch) {
    const slug = decodeURIComponent(slugMatch[1]!);
    const report = await getPublicBySlug(slug);
    if (!report) return json(404, { error: "Not found" });
    return json(200, report);
  }

  return json(404, { error: "Not found" });
}
