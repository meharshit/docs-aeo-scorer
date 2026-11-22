import { scoreDocsUrl } from "@aeo-docs-scorer/scanner";
import {
  checkRateLimit,
  clientKeyFromHeaders,
} from "../apps/web/rate-limit.js";

type ScoreRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type ScoreResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void };
};

/**
 * Production score API for Vercel (Hobby / free).
 * POST /api/score  { "url": "https://docs.example.com" }
 * Rate limit: 8 / minute and 50 / hour per IP.
 */
export default async function handler(
  req: ScoreRequest,
  res: ScoreResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const clientKey = clientKeyFromHeaders(req.headers, "unknown");
  const limit = checkRateLimit(clientKey);
  res.setHeader("X-RateLimit-Limit", String(limit.limit));
  res.setHeader("X-RateLimit-Remaining", String(limit.remaining));

  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfterSec));
    res.status(429).json({
      error: limit.reason,
      retryAfterSec: limit.retryAfterSec,
    });
    return;
  }

  try {
    const body =
      typeof req.body === "string"
        ? (JSON.parse(req.body || "{}") as { url?: string })
        : ((req.body ?? {}) as { url?: string });

    if (!body.url || typeof body.url !== "string") {
      res.status(400).json({ error: "Missing url" });
      return;
    }

    try {
      new URL(body.url);
    } catch {
      res.status(400).json({ error: "Invalid url" });
      return;
    }

    const report = await scoreDocsUrl(body.url);
    res.status(200).json(report);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Score failed",
    });
  }
}
