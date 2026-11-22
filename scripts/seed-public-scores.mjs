/**
 * Seed local SQLite with real public docs scores for UI demos.
 * Usage (from repo root): node scripts/seed-public-scores.mjs
 */
import { scoreDocsUrl } from "@aeo-docs-scorer/scanner";
import { savePublicResult } from "@aeo-docs-scorer/public-scores";

const URLS = [
  "https://developer.suki.ai",
  "https://docs.stripe.com",
  "https://linear.app/docs",
  "https://docs.github.com",
  "https://developers.cloudflare.com",
  "https://docs.anthropic.com",
  "https://platform.openai.com/docs",
  "https://docs.vercel.com",
  "https://supabase.com/docs",
  "https://docs.expo.dev",
  "https://nextjs.org/docs",
  "https://react.dev",
  "https://tailwindcss.com/docs",
  "https://www.prisma.io/docs",
  "https://orm.drizzle.team/docs/overview",
  "https://docs.docker.com",
  "https://kubernetes.io/docs/home",
  "https://docs.aws.amazon.com",
  "https://cloud.google.com/docs",
  "https://learn.microsoft.com/en-us/azure",
  "https://docs.datadoghq.com",
  "https://docs.sentry.io",
  "https://docs.posthog.com",
  "https://docs.planetscale.com",
  "https://docs.neon.tech",
  "https://developers.notion.com",
  "https://developer.mozilla.org/en-US/docs/Web",
  "https://docs.gitlab.com",
  "https://docs.npmjs.com",
  "https://pnpm.io",
  "https://bun.sh/docs",
  "https://deno.land/manual",
  "https://nodejs.org/docs/latest/api",
  "https://docs.python.org/3",
  "https://go.dev/doc",
  "https://doc.rust-lang.org",
  "https://docs.flutter.dev",
  "https://developer.apple.com/documentation",
  "https://developer.android.com/docs",
  "https://docs.unity.com",
  "https://firebase.google.com/docs",
  "https://docs.mongodb.com",
  "https://redis.io/docs",
  "https://www.postgresql.org/docs",
  "https://docs.elastic.co",
  "https://docs.langchain.com",
  "https://docs.pinecone.io",
  "https://huggingface.co/docs",
  "https://docs.mintlify.com",
  "https://docusaurus.io/docs",
];

const CONCURRENCY = 3;

async function scoreOne(url, index, total) {
  const label = `[${index + 1}/${total}] ${url}`;
  try {
    process.stdout.write(`${label} … `);
    const report = await scoreDocsUrl(url);
    const saved = await savePublicResult({
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
    if (!saved) {
      console.log(`skip (not eligible) score=${report.score}`);
      return { url, ok: false, reason: "ineligible" };
    }
    console.log(
      `ok score=${report.score} grade=${report.grade} rank=${saved.rank}`,
    );
    return { url, ok: true, score: report.score, grade: report.grade };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`fail ${msg}`);
    return { url, ok: false, reason: msg };
  }
}

async function runPool(urls, concurrency) {
  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < urls.length) {
      const i = cursor;
      cursor += 1;
      results[i] = await scoreOne(urls[i], i, urls.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()),
  );
  return results;
}

const started = Date.now();
console.log(`Seeding ${URLS.length} docs sites (concurrency ${CONCURRENCY})…`);
const results = await runPool(URLS, CONCURRENCY);
const ok = results.filter((r) => r?.ok).length;
const fail = results.length - ok;
console.log(
  `\nDone in ${Math.round((Date.now() - started) / 1000)}s · saved ${ok} · failed ${fail}`,
);
if (fail > 0) {
  for (const r of results) {
    if (r && !r.ok) console.log(`  - ${r.url}: ${r.reason}`);
  }
}
process.exit(ok > 0 ? 0 : 1);
