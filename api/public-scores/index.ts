import {
  checkRateLimit,
  clientKeyFromHeaders,
} from "../../apps/web/rate-limit.js";
import { handlePublicScoresApi } from "../../apps/web/public-api.js";

type ApiRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => { json: (body: unknown) => void };
};

/** Handles GET /api/public-scores (zero-segment path). */
export default async function handler(
  req: ApiRequest,
  res: ApiResponse,
): Promise<void> {
  try {
    const method = (req.method || "GET").toUpperCase();
    const rawUrl = req.url || "/api/public-scores";
    const parsed = new URL(rawUrl, "http://localhost");

    if (method === "POST") {
      const clientKey = clientKeyFromHeaders(req.headers, "unknown");
      const limit = checkRateLimit(`public:${clientKey}`);
      if (!limit.allowed) {
        res.setHeader("Retry-After", String(limit.retryAfterSec));
        res.status(429).json({
          error: limit.reason,
          retryAfterSec: limit.retryAfterSec,
        });
        return;
      }
    }

    const body =
      typeof req.body === "string"
        ? (JSON.parse(req.body || "{}") as Record<string, unknown>)
        : ((req.body ?? {}) as Record<string, unknown>);

    const result = await handlePublicScoresApi(
      method,
      "/api/public-scores",
      parsed.searchParams,
      body,
    );
    if (result.headers) {
      for (const [key, value] of Object.entries(result.headers)) {
        res.setHeader(key, value);
      }
    }
    res.status(result.status).json(result.body);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "API failed",
    });
  }
}
