import {
  checkRateLimit,
  clientKeyFromHeaders,
} from "../apps/web/rate-limit.js";
import { handleScorePost } from "../apps/web/public-api.js";

type ScoreRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type ScoreResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void };
};

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
        ? (JSON.parse(req.body || "{}") as { url?: string; public?: boolean })
        : ((req.body ?? {}) as { url?: string; public?: boolean });

    const result = await handleScorePost({
      url: body.url,
      public: body.public !== false,
    });
    if (result.headers) {
      for (const [key, value] of Object.entries(result.headers)) {
        res.setHeader(key, value);
      }
    }
    res.status(result.status).json(result.body);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Score failed",
    });
  }
}
