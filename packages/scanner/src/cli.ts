#!/usr/bin/env node
import { scoreDocsUrl } from "./score.js";

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: aeo-score <docs-base-url>");
    process.exit(1);
  }

  try {
    new URL(url);
  } catch {
    console.error(`Invalid URL: ${url}`);
    process.exit(1);
  }

  const report = await scoreDocsUrl(url);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
