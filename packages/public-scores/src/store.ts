import { createClient, type Client } from "@libsql/client";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cacheGet, cacheInvalidatePrefix, cacheSet } from "./cache.js";
import { isPublicEligibleUrl, isValidSlug, toSiteKey, toSlug } from "./site-key.js";
import type {
  AreaScores,
  HistoryPoint,
  PublicListResponse,
  PublicReportResponse,
  PublicSiteRow,
} from "./types.js";

const REPLACE_WINDOW_MS = 10 * 60 * 1000;
const PER_PAGE = 20;

let clientPromise: Promise<Client> | null = null;

function defaultFileUrl(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // packages/public-scores/dist -> repo root data/
  const dbPath = resolve(here, "../../../data/public-scores.db");
  mkdirSync(dirname(dbPath), { recursive: true });
  return `file:${dbPath}`;
}

async function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const url = process.env.TURSO_DATABASE_URL || defaultFileUrl();
      const authToken = process.env.TURSO_AUTH_TOKEN;
      const client = createClient(
        authToken ? { url, authToken } : { url },
      );
      await migrate(client);
      return client;
    })();
  }
  return clientPromise;
}

async function migrate(client: Client): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS public_results (
      id TEXT PRIMARY KEY,
      site_key TEXT NOT NULL,
      slug TEXT NOT NULL,
      url TEXT NOT NULL,
      score REAL NOT NULL,
      grade TEXT NOT NULL,
      discoverability REAL NOT NULL,
      readability REAL NOT NULL,
      actionability REAL NOT NULL,
      trust REAL NOT NULL,
      checked_at TEXT NOT NULL,
      removal_token_hash TEXT NOT NULL,
      report_json TEXT NOT NULL,
      hidden INTEGER NOT NULL DEFAULT 0
    )
  `);
  await client.execute(
    `CREATE INDEX IF NOT EXISTS idx_public_site_checked
     ON public_results(site_key, checked_at DESC)`,
  );
  await client.execute(
    `CREATE INDEX IF NOT EXISTS idx_public_slug_checked
     ON public_results(slug, checked_at DESC)`,
  );
  await client.execute(
    `CREATE INDEX IF NOT EXISTS idx_public_hidden_score
     ON public_results(hidden, score DESC, checked_at DESC)`,
  );
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newId(): string {
  return randomBytes(16).toString("hex");
}

function newRemovalToken(): string {
  return randomBytes(24).toString("hex");
}

function areasFromReport(report: {
  categories?: { id: string; score: number }[];
}): AreaScores {
  const byId = new Map(
    (report.categories ?? []).map((c) => [c.id, c.score] as const),
  );
  return {
    discoverability: byId.get("discoverability") ?? 0,
    readability: byId.get("readability") ?? 0,
    actionability: byId.get("actability") ?? byId.get("actionability") ?? 0,
    trust: byId.get("trust") ?? 0,
  };
}

type LatestRow = {
  id: string;
  site_key: string;
  slug: string;
  url: string;
  score: number;
  grade: string;
  discoverability: number;
  readability: number;
  actionability: number;
  trust: number;
  checked_at: string;
  report_json: string;
};

async function latestVisibleBySite(): Promise<LatestRow[]> {
  const client = await getClient();
  const result = await client.execute(`
    SELECT r.*
    FROM public_results r
    INNER JOIN (
      SELECT site_key, MAX(checked_at) AS max_checked
      FROM public_results
      WHERE hidden = 0
      GROUP BY site_key
    ) latest
      ON latest.site_key = r.site_key AND latest.max_checked = r.checked_at
    WHERE r.hidden = 0
  `);
  return result.rows.map((row) => row as unknown as LatestRow);
}

function rankSites(latest: LatestRow[]): PublicSiteRow[] {
  const sorted = [...latest].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.checked_at.localeCompare(a.checked_at);
  });

  // Previous score per site (second newest visible)
  return sorted.map((row, index) => ({
    rank: index + 1,
    siteKey: row.site_key,
    slug: row.slug,
    score: row.score,
    grade: row.grade,
    areas: {
      discoverability: row.discoverability,
      readability: row.readability,
      actionability: row.actionability,
      trust: row.trust,
    },
    change: null as number | null,
    checkedAt: row.checked_at,
  }));
}

async function attachChanges(rows: PublicSiteRow[]): Promise<PublicSiteRow[]> {
  const client = await getClient();
  const out: PublicSiteRow[] = [];
  for (const row of rows) {
    const hist = await client.execute({
      sql: `
        SELECT score FROM public_results
        WHERE site_key = ? AND hidden = 0
        ORDER BY checked_at DESC
        LIMIT 2
      `,
      args: [row.siteKey],
    });
    const scores = hist.rows.map((r) => Number(r.score));
    const change =
      scores.length >= 2
        ? Number((scores[0]! - scores[1]!).toFixed(1))
        : null;
    out.push({ ...row, change });
  }
  return out;
}

export type SavePublicInput = {
  url: string;
  score: number;
  grade: string;
  checkedAt: string;
  categories?: { id: string; score: number }[];
  report: unknown;
};

export type SavePublicOutput = {
  slug: string;
  rank: number;
  total: number;
  removalToken: string;
  siteKey: string;
};

export async function savePublicResult(
  input: SavePublicInput,
): Promise<SavePublicOutput | null> {
  if (!isPublicEligibleUrl(input.url)) return null;

  const siteKey = toSiteKey(input.url);
  const slug = toSlug(siteKey);
  if (!slug) return null;

  const areas = areasFromReport(input);
  const client = await getClient();
  const removalToken = newRemovalToken();
  const tokenHash = hashToken(removalToken);
  const now = input.checkedAt || new Date().toISOString();

  const recent = await client.execute({
    sql: `
      SELECT id, checked_at FROM public_results
      WHERE site_key = ? AND hidden = 0
      ORDER BY checked_at DESC
      LIMIT 1
    `,
    args: [siteKey],
  });

  const latest = recent.rows[0];
  if (latest) {
    const age =
      Date.now() - new Date(String(latest.checked_at)).getTime();
    if (age >= 0 && age < REPLACE_WINDOW_MS) {
      await client.execute({
        sql: `
          UPDATE public_results SET
            url = ?, score = ?, grade = ?,
            discoverability = ?, readability = ?, actionability = ?, trust = ?,
            checked_at = ?, removal_token_hash = ?, report_json = ?
          WHERE id = ?
        `,
        args: [
          input.url,
          input.score,
          input.grade,
          areas.discoverability,
          areas.readability,
          areas.actionability,
          areas.trust,
          now,
          tokenHash,
          JSON.stringify(input.report),
          String(latest.id),
        ],
      });
      cacheInvalidatePrefix("public:");
      const ranked = await listRanked();
      const mine = ranked.find((r) => r.siteKey === siteKey);
      return {
        slug,
        rank: mine?.rank ?? ranked.length,
        total: ranked.length,
        removalToken,
        siteKey,
      };
    }
  }

  await client.execute({
    sql: `
      INSERT INTO public_results (
        id, site_key, slug, url, score, grade,
        discoverability, readability, actionability, trust,
        checked_at, removal_token_hash, report_json, hidden
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `,
    args: [
      newId(),
      siteKey,
      slug,
      input.url,
      input.score,
      input.grade,
      areas.discoverability,
      areas.readability,
      areas.actionability,
      areas.trust,
      now,
      tokenHash,
      JSON.stringify(input.report),
    ],
  });

  cacheInvalidatePrefix("public:");
  const ranked = await listRanked();
  const mine = ranked.find((r) => r.siteKey === siteKey);
  return {
    slug,
    rank: mine?.rank ?? ranked.length,
    total: ranked.length,
    removalToken,
    siteKey,
  };
}

async function listRanked(): Promise<PublicSiteRow[]> {
  const latest = await latestVisibleBySite();
  const ranked = rankSites(latest);
  return attachChanges(ranked);
}

export async function getPublicStatsAndRows(options: {
  sort?: string;
  grade?: string;
  q?: string;
  page?: number;
}): Promise<PublicListResponse> {
  const sort = options.sort || "top";
  const grade = options.grade || "all";
  const q = (options.q || "").trim().toLowerCase();
  const page = Math.max(1, options.page || 1);
  const cacheKey = `public:list:${sort}:${grade}:${q}:${page}`;
  const cached = cacheGet<PublicListResponse>(cacheKey);
  if (cached) return cached;

  let rows = await listRanked();
  const stats = {
    sites: rows.length,
    average:
      rows.length === 0
        ? 0
        : Number(
            (
              rows.reduce((sum, r) => sum + r.score, 0) / rows.length
            ).toFixed(1),
          ),
    top: rows.length === 0 ? 0 : rows[0]!.score,
    strongCount: rows.filter((r) => r.score >= 70).length,
  };

  if (grade === "strong") rows = rows.filter((r) => r.score >= 70);
  else if (grade === "mid")
    rows = rows.filter((r) => r.score >= 50 && r.score < 70);
  else if (grade === "low") rows = rows.filter((r) => r.score < 50);

  if (q) rows = rows.filter((r) => r.siteKey.toLowerCase().includes(q));

  if (sort === "recent") {
    rows = [...rows].sort((a, b) => {
      const byDate = b.checkedAt.localeCompare(a.checkedAt);
      if (byDate !== 0) return byDate;
      return b.score - a.score;
    });
  } else if (sort === "improved") {
    rows = [...rows].sort((a, b) => {
      if (a.change === null && b.change === null) return a.rank - b.rank;
      if (a.change === null) return 1;
      if (b.change === null) return -1;
      if (b.change !== a.change) return b.change - a.change;
      return a.rank - b.rank;
    });
  } else {
    // top: keep rank order
    rows = [...rows].sort((a, b) => a.rank - b.rank);
  }

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const safePage = Math.min(page, pages);
  const start = (safePage - 1) * PER_PAGE;
  const pageRows = rows.slice(start, start + PER_PAGE);

  const payload: PublicListResponse = {
    total,
    page: safePage,
    perPage: PER_PAGE,
    pages,
    stats,
    rows: pageRows,
  };
  cacheSet(cacheKey, payload);
  return payload;
}

export async function getTopPublic(limit = 5): Promise<PublicSiteRow[]> {
  const key = `public:top:${limit}`;
  const cached = cacheGet<PublicSiteRow[]>(key);
  if (cached) return cached;
  const rows = await listRanked();
  const top = rows.slice(0, Math.max(1, Math.min(20, limit)));
  cacheSet(key, top);
  return top;
}

export async function getPublicBySlug(
  slug: string,
): Promise<PublicReportResponse | null> {
  if (!isValidSlug(slug)) return null;
  const key = `public:slug:${slug}`;
  const cached = cacheGet<PublicReportResponse>(key);
  if (cached) return cached;

  const client = await getClient();
  const result = await client.execute({
    sql: `
      SELECT * FROM public_results
      WHERE slug = ? AND hidden = 0
      ORDER BY checked_at DESC
      LIMIT 1
    `,
    args: [slug],
  });
  const row = result.rows[0] as unknown as LatestRow | undefined;
  if (!row) return null;

  const ranked = await listRanked();
  const mine = ranked.find((r) => r.slug === slug);
  let report: unknown = null;
  try {
    report = JSON.parse(row.report_json);
  } catch {
    report = null;
  }

  const payload: PublicReportResponse = {
    slug: row.slug,
    siteKey: row.site_key,
    url: row.url,
    score: row.score,
    grade: row.grade,
    areas: {
      discoverability: row.discoverability,
      readability: row.readability,
      actionability: row.actionability,
      trust: row.trust,
    },
    checkedAt: row.checked_at,
    rank: mine?.rank ?? 0,
    total: ranked.length,
    report,
  };
  cacheSet(key, payload);
  return payload;
}

export async function getHistory(slug: string): Promise<HistoryPoint[]> {
  if (!isValidSlug(slug)) return [];
  const key = `public:history:${slug}`;
  const cached = cacheGet<HistoryPoint[]>(key);
  if (cached) return cached;

  const client = await getClient();
  const result = await client.execute({
    sql: `
      SELECT score, checked_at FROM public_results
      WHERE slug = ? AND hidden = 0
      ORDER BY checked_at DESC
      LIMIT 10
    `,
    args: [slug],
  });
  const points = result.rows
    .map((r) => ({
      score: Number(r.score),
      checkedAt: String(r.checked_at),
    }))
    .reverse();
  cacheSet(key, points);
  return points;
}

export async function removePublic(
  slug: string,
  removalToken: string,
): Promise<boolean> {
  if (!isValidSlug(slug) || !removalToken) return false;
  const client = await getClient();
  const hash = hashToken(removalToken);
  const latest = await client.execute({
    sql: `
      SELECT id, removal_token_hash FROM public_results
      WHERE slug = ? AND hidden = 0
      ORDER BY checked_at DESC
      LIMIT 1
    `,
    args: [slug],
  });
  const row = latest.rows[0];
  if (!row || String(row.removal_token_hash) !== hash) return false;

  await client.execute({
    sql: `UPDATE public_results SET hidden = 1 WHERE site_key = (
      SELECT site_key FROM public_results WHERE id = ?
    )`,
    args: [String(row.id)],
  });
  cacheInvalidatePrefix("public:");
  return true;
}

export async function addPublicAgain(
  slug: string,
  removalToken: string,
): Promise<SavePublicOutput | null> {
  if (!isValidSlug(slug) || !removalToken) return null;
  const client = await getClient();
  const hash = hashToken(removalToken);

  const owned = await client.execute({
    sql: `
      SELECT * FROM public_results
      WHERE slug = ? AND removal_token_hash = ?
      ORDER BY checked_at DESC
      LIMIT 1
    `,
    args: [slug, hash],
  });
  const row = owned.rows[0] as unknown as LatestRow & {
    removal_token_hash: string;
    hidden: number;
  };
  if (!row) return null;

  await client.execute({
    sql: `UPDATE public_results SET hidden = 0 WHERE site_key = ?`,
    args: [row.site_key],
  });
  cacheInvalidatePrefix("public:");
  const ranked = await listRanked();
  const mine = ranked.find((r) => r.slug === slug);
  return {
    slug,
    siteKey: String(row.site_key),
    rank: mine?.rank ?? ranked.length,
    total: ranked.length,
    removalToken,
  };
}
