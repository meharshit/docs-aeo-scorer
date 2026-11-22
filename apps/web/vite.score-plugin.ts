import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { checkRateLimit, clientKeyFromHeaders } from "./rate-limit.js";
import { handlePublicScoresApi, handleScorePost } from "./public-api.js";

function readIp(req: IncomingMessage): string {
  const headers = req.headers as Record<string, string | string[] | undefined>;
  return clientKeyFromHeaders(
    headers,
    req.socket.remoteAddress ?? "unknown",
  );
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): void {
  res.statusCode = status;
  const merged = {
    "content-type": "application/json",
    ...(headers ?? {}),
  };
  for (const [key, value] of Object.entries(merged)) {
    res.setHeader(key, value);
  }
  res.end(JSON.stringify(body));
}

/**
 * Local APIs: POST /api/score and /api/public-scores*
 */
export function aeoScoreApiPlugin(): Plugin {
  return {
    name: "aeo-score-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || "/";
        const pathname = rawUrl.split("?")[0] || "/";
        const method = (req.method || "GET").toUpperCase();

        if (!pathname.startsWith("/api/score") && !pathname.startsWith("/api/public-scores")) {
          next();
          return;
        }

        try {
          if (method === "POST" && pathname === "/api/score") {
            const limit = checkRateLimit(readIp(req));
            res.setHeader("X-RateLimit-Limit", String(limit.limit));
            res.setHeader("X-RateLimit-Remaining", String(limit.remaining));
            if (!limit.allowed) {
              sendJson(
                res,
                429,
                {
                  error: limit.reason,
                  retryAfterSec: limit.retryAfterSec,
                },
                { "Retry-After": String(limit.retryAfterSec) },
              );
              return;
            }
            const body = await readBody(req);
            const result = await handleScorePost({
              url: typeof body.url === "string" ? body.url : undefined,
              public: body.public !== false,
            });
            sendJson(res, result.status, result.body, result.headers);
            return;
          }

          if (pathname.startsWith("/api/public-scores")) {
            if (method === "POST") {
              const limit = checkRateLimit(`public:${readIp(req)}`);
              if (!limit.allowed) {
                sendJson(
                  res,
                  429,
                  {
                    error: limit.reason,
                    retryAfterSec: limit.retryAfterSec,
                  },
                  { "Retry-After": String(limit.retryAfterSec) },
                );
                return;
              }
            }
            const url = new URL(rawUrl, "http://localhost");
            const body = method === "POST" ? await readBody(req) : {};
            const result = await handlePublicScoresApi(
              method,
              pathname,
              url.searchParams,
              body,
            );
            sendJson(res, result.status, result.body, result.headers);
            return;
          }

          next();
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "API failed",
          });
        }
      });
    },
  };
}
