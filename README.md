# Docs AEO Scorer

**Check your AEO score** — easy-to-search name for Answer Engine Optimization readiness of developer docs.

Paste a docs base URL. Docs AEO Scorer checks how well coding agents can **find, read, and act on** your docs (`llms.txt`, agent skills, MCP, markdown mirrors, OpenAPI). This is **not** Google SEO.

> Product name: **Docs AEO Scorer** · Brand: light Docsense green + gold (`DESIGN.md`).

## Status

Scaffold **v0.1** ready for `meharshit/aeo-docs-scorer`:

| Package | Role |
| --- | --- |
| `@aeo-docs-scorer/rubric` | Versioned checklist + weights (`rubric.v0.1.json`) |
| `@aeo-docs-scorer/scanner` | Fetch probes + score engine + CLI |
| `@aeo-docs-scorer/web` | UI shell (Docsense colors) |

**Next build pass:** wire UI → scanner via Cloudflare Worker (CORS), deepen link/skill crawls, publish npm + GitHub Pages.

## Monorepo layout

```
aeo-docs-scorer/
  packages/rubric/     # public scoring contract
  packages/scanner/    # Node fetch + score + aeo-score CLI
  apps/web/            # Vite UI
  DESIGN.md            # color tokens
  HANDOFF.md           # instructions for the next coding agent chat
```

## Quickstart (local)

```bash
cd aeo-docs-scorer
npm install
npm run build
npm test

# CLI score (server-side fetch)
node packages/scanner/dist/cli.js https://developer.suki.ai

# UI shell
npm run dev:web
```

## Rubric categories (100 pts)

1. **Discoverability (25)** — `llms.txt`, skills index, MCP advertised, OpenAPI  
2. **Readability (30)** — markdown mirrors, SSR/text body, samples, robots  
3. **Actability (25)** — live MCP, task skills, auth for agents, prompts, cookbooks  
4. **Trust (20)** — freshness, consistency, HTTPS  

Full check list: `packages/rubric/src/rubric.v0.1.json`.

## Engineering practices

- TypeScript strict + workspace packages  
- Rubric weights validated in tests  
- Deterministic structural checks first; LLM judges later (optional)  
- Version the rubric when checks change  
- MIT license  

## Target GitHub

Push to **https://github.com/meharshit/aeo-docs-scorer** (create empty repo first if needed).

## Related

- Docsense (local search): https://github.com/meharshit/docsense  
- Expo AEO practices (inspiration)  
- Agent Ready find/read/act checklists (inspiration)
