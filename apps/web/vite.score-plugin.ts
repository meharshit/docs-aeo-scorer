import type { IncomingMessage } from "node:http";
import type { Plugin } from "vite";
import { scoreDocsUrl } from "@aeo-docs-scorer/scanner";
import { checkRateLimit, clientKeyFromHeaders } from "./rate-limit.js";

function readIp(req: IncomingMessage): string {
  const headers = req.headers as Record<string, string | string[] | undefined>;
  return clientKeyFromHeaders(
    headers,
    req.socket.remoteAddress ?? "unknown",
  );
}

/**
 * Local score API so the browser UI can run real scans without CORS.
 * POST /api/score  { "url": "https://docs.example.com" }
 * Rate limit: 8 / minute and 50 / hour per IP.
 */
export function aeoScoreApiPlugin(): Plugin {
  return {
    name: "aeo-score-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== "POST" || req.url?.split("?")[0] !== "/api/score") {
          next();
          return;
        }

        try {
          const limit = checkRateLimit(readIp(req));
          res.setHeader("X-RateLimit-Limit", String(limit.limit));
          res.setHeader("X-RateLimit-Remaining", String(limit.remaining));

          if (!limit.allowed) {
            res.statusCode = 429;
            res.setHeader("content-type", "application/json");
            res.setHeader("Retry-After", String(limit.retryAfterSec));
            res.end(
              JSON.stringify({
                error: limit.reason,
                retryAfterSec: limit.retryAfterSec,
              }),
            );
            return;
          }

          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const body = JSON.parse(
            Buffer.concat(chunks).toString("utf8") || "{}",
          ) as { url?: string };

          if (!body.url || typeof body.url !== "string") {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Missing url" }));
            return;
          }

          try {
            new URL(body.url);
          } catch {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Invalid url" }));
            return;
          }

          const report = await scoreDocsUrl(body.url);
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(report));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Score failed",
            }),
          );
        }
      });
    },
  };
}
