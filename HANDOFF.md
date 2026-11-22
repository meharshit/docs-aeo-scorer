# Handoff — build AEO Docs Scorer (next conversation)

**Open a new Cursor chat** in this folder and paste the block below.

---

## Prompt to paste in the new chat

```
Build out /Users/harshitsatyaseel/Documents/aeo-docs-scorer for meharshit.

Context:
- Product: AEO (Answer Engine Optimization) scorer for developer docs — NOT Google SEO.
- User pastes a docs base URL; we fetch/probe and score against packages/rubric.
- UI must use Docsense brand tokens in DESIGN.md and apps/web/src/styles.css (deep green + gold: #17261E, #1E3328, #EEF2EC, #E3C77A, etc.).
- Target repo: github.com/meharshit/aeo-docs-scorer (push only when I ask, as meharshit).

Already scaffolded (do not rewrite from scratch):
- packages/rubric — rubric.v0.1.json + weight tests
- packages/scanner — fetch probes, scoreDocsUrl, CLI
- apps/web — Vite UI shell with demo report

Build next, in order:
1. npm install, fix any TS/build issues, make npm test + npm run build green.
2. Deepen scanner v0.2: sample llms.txt URLs, parse skills index + SKILL.md reachability, better MCP detection, markdown .md probe on a sample page.
3. Add Cloudflare Worker (or similar) API: POST /score { url } → ScoreReport JSON so the browser UI can call it without CORS issues.
4. Wire apps/web to that API; keep Docsense colors; polished report (category bars, howToFix list, evidence).
5. README with screenshots path; GitHub Pages deploy notes.
6. Optional: fixtures for good vs weak docs sites under examples/.

Rules:
- Best engineering practices: small PRs of logic, tests for rubric + scoring edge cases, no secrets in repo.
- Do not invent product behavior beyond the rubric.
- Do not push until I say push (meharshit PAT / gh auth).
```

---

## Why a new chat

Keeps Docsense distribution context out of the build thread and gives the agent a clean, token-efficient job: finish scanner + Worker + UI against this scaffold.
