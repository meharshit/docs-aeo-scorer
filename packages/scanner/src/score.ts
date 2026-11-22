import {
  assertRubricWeights,
  rubricV01,
  type Rubric,
  type RubricCheck,
} from "@aeo-docs-scorer/rubric";
import {
  extractMarkdownLinks,
  extractUrls,
  fetchText,
  joinUrl,
  type FetchResult,
} from "./fetch.js";
import {
  gradeFromScore,
  type CategoryResult,
  type CheckResult,
  type CheckStatus,
  type ScoreReport,
} from "./types.js";

interface SiteContext {
  base: string;
  llmsTxt: FetchResult | null;
  llmsFull: FetchResult | null;
  robotsTxt: FetchResult | null;
  skillsIndex: FetchResult | null;
  aiCatalog: FetchResult | null;
  openapi: FetchResult | null;
  mcp: FetchResult | null;
  mcpRemote: FetchResult | null;
  mcpDocs: FetchResult | null;
  homepage: FetchResult | null;
  agentsMd: FetchResult | null;
  sampledPages: FetchResult[];
  skillPages: FetchResult[];
  mdCompanions: FetchResult[];
  llmsUrls: string[];
  skillUrls: string[];
  corpus: string;
}

function resultFor(
  check: RubricCheck,
  status: CheckStatus,
  evidence: string[],
  earnedRatio = status === "pass" ? 1 : status === "warn" ? 0.5 : 0,
): CheckResult {
  return {
    id: check.id,
    title: check.title,
    status,
    score: Number((check.weight * earnedRatio).toFixed(2)),
    maxScore: check.weight,
    level: check.level,
    evidence,
    howToFix: check.howToFix,
  };
}

async function safeFetch(url: string, init?: RequestInit): Promise<FetchResult> {
  try {
    return await fetchText(url, init);
  } catch (error) {
    return {
      url,
      ok: false,
      status: 0,
      contentType: null,
      body: error instanceof Error ? error.message : "fetch failed",
    };
  }
}

function resolveHref(base: string, href: string): string | null {
  try {
    if (href.startsWith("#")) return null;
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function contentType(res: FetchResult | null): string {
  return (res?.contentType ?? "").toLowerCase();
}

function isHtml(res: FetchResult | null): boolean {
  if (!res) return false;
  if (contentType(res).includes("text/html")) return true;
  const body = res.body.trimStart().slice(0, 200).toLowerCase();
  return body.startsWith("<!doctype html") || body.startsWith("<html");
}

function isSoft404(res: FetchResult | null): boolean {
  if (!res || !res.ok) return true;
  if (!isHtml(res)) return false;
  const text = res.body.toLowerCase();
  return (
    /page not found|404|doesn't exist|does not exist|no longer available/.test(
      text,
    ) && text.length < 20_000
  );
}

function isRealJson(res: FetchResult | null): boolean {
  if (!res?.ok || isHtml(res) || isSoft404(res)) return false;
  const ct = contentType(res);
  if (ct.includes("json")) return true;
  const trimmed = res.body.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function isLikelyMarkdown(res: FetchResult | null): boolean {
  if (!res?.ok || isSoft404(res)) return false;
  if (contentType(res).includes("markdown")) return true;
  if (res.url.toLowerCase().endsWith(".md")) return !isHtml(res);
  const start = res.body.trimStart();
  return (
    !isHtml(res) &&
    (start.startsWith("# ") ||
      start.startsWith("---\n") ||
      /^#{1,3}\s+\S+/m.test(start.slice(0, 400)))
  );
}

function isLikelyMcpTransport(res: FetchResult | null): boolean {
  if (!res || res.status === 0 || res.status === 404) {
    return false;
  }
  // Streamable HTTP endpoints often return auth / method errors to plain GETs.
  // Treat those as valid transport signals before falling back to body sniffing.
  if ([401, 405, 406, 415, 421].includes(res.status)) return true;
  if (isSoft404(res)) return false;
  // HTML / Markdown docs pages must not count as MCP transport.
  if (isHtml(res) || isLikelyMarkdown(res)) return false;

  const ct = contentType(res);
  if (
    ct.includes("json") ||
    ct.includes("event-stream") ||
    ct.includes("text/event-stream")
  ) {
    return true;
  }

  const body = res.body.trimStart();
  // Do not treat "mcp" substring alone as transport — docs pages mention MCP too.
  return (
    body.startsWith("{") ||
    body.includes("jsonrpc") ||
    /"jsonrpc"\s*:/i.test(body) ||
    body.toLowerCase().includes("method not allowed")
  );
}

function parseSkillUrls(skillsIndex: FetchResult | null, base: string): string[] {
  if (!skillsIndex || !isRealJson(skillsIndex)) return [];
  try {
    const data = JSON.parse(skillsIndex.body) as unknown;
    const urls: string[] = [];

    const pushMaybe = (value: unknown) => {
      if (typeof value === "string") {
        const resolved = resolveHref(base, value);
        if (resolved) urls.push(resolved);
      } else if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        for (const key of ["url", "href", "path", "skill", "src"]) {
          if (typeof obj[key] === "string") {
            const resolved = resolveHref(base, obj[key] as string);
            if (resolved) urls.push(resolved);
          }
        }
      }
    };

    if (Array.isArray(data)) {
      data.forEach(pushMaybe);
    } else if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      for (const key of ["skills", "items", "entries", "agentSkills"]) {
        if (Array.isArray(obj[key])) {
          (obj[key] as unknown[]).forEach(pushMaybe);
        }
      }
    }

    return [...new Set(urls)].slice(0, 12);
  } catch {
    return [];
  }
}

function parseAiCatalogMcpUrls(catalog: FetchResult | null): string[] {
  if (!catalog || !isRealJson(catalog)) return [];
  try {
    const data = JSON.parse(catalog.body) as unknown;
    const remoteUrls: string[] = [];
    const fallbackUrls: string[] = [];

    const walk = (value: unknown, inRemotes = false): void => {
      if (!value) return;
      if (typeof value === "string") {
        if (value.startsWith("http") && /mcp/i.test(value)) {
          (inRemotes ? remoteUrls : fallbackUrls).push(value);
        }
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item) => walk(item, inRemotes));
        return;
      }
      if (typeof value === "object") {
        const obj = value as Record<string, unknown>;
        for (const key of Object.keys(obj)) {
          const child = obj[key];
          const childInRemotes = inRemotes || key === "remotes";
          if (
            ["url", "href", "endpoint", "uri"].includes(key) &&
            typeof child === "string" &&
            child.startsWith("http")
          ) {
            // Prefer remotes[]; skip marketing websiteUrl / icon pages.
            if (childInRemotes || /mcp\./i.test(child) || /\/mcp\/?$/i.test(child)) {
              (childInRemotes || /mcp\./i.test(child)
                ? remoteUrls
                : fallbackUrls
              ).push(child);
            }
          }
          walk(child, childInRemotes);
        }
      }
    };

    walk(data);
    return [...new Set([...remoteUrls, ...fallbackUrls])].slice(0, 6);
  } catch {
    return [];
  }
}

async function probeOpenApi(base: string, llmsBody: string): Promise<FetchResult> {
  const candidates = [
    "/openapi.json",
    "/api-reference/openapi.json",
    "/api/openapi.json",
    "/swagger.json",
    "/.well-known/openapi.json",
  ];

  const fromLlms = [
    ...llmsBody.matchAll(/https?:\/\/[^\s)\]"']*openapi\.json|\/[^\s)\]"']*openapi\.json/gi),
  ].map((m) => m[0]);

  for (const path of [...fromLlms, ...candidates]) {
    const url = path.startsWith("http") ? path : joinUrl(base, path);
    const res = await safeFetch(url);
    if (
      res.ok &&
      !isHtml(res) &&
      !isSoft404(res) &&
      (/["']?openapi["']?\s*:/i.test(res.body) ||
        /["']?swagger["']?\s*:/i.test(res.body))
    ) {
      return res;
    }
  }

  return {
    url: joinUrl(base, "/openapi.json"),
    ok: false,
    status: 404,
    contentType: null,
    body: "openapi not found in common locations",
  };
}

function preferDocUrls(urls: string[]): string[] {
  return urls
    .filter((u) => {
      const lower = u.toLowerCase();
      return (
        !lower.includes("/.well-known/agent-skills/") &&
        !lower.endsWith(".png") &&
        !lower.endsWith(".jpg") &&
        !lower.endsWith(".svg") &&
        !lower.endsWith(".css") &&
        !lower.endsWith(".js")
      );
    })
    .sort((a, b) => {
      const score = (u: string) => {
        let s = 0;
        if (u.includes("/docs")) s += 2;
        if (u.includes("quickstart") || u.includes("get-started")) s += 2;
        if (u.endsWith(".md")) s += 1;
        return -s;
      };
      return score(a) - score(b);
    });
}

async function buildContext(base: string): Promise<SiteContext> {
  const [
    llmsTxt,
    llmsFull,
    robotsTxt,
    skillsIndex,
    aiCatalog,
    mcp,
    mcpDocs,
    homepage,
    agentsMd,
  ] = await Promise.all([
    safeFetch(joinUrl(base, "/llms.txt")),
    safeFetch(joinUrl(base, "/llms-full.txt")),
    safeFetch(joinUrl(base, "/robots.txt")),
    safeFetch(joinUrl(base, "/.well-known/agent-skills/index.json")),
    safeFetch(joinUrl(base, "/.well-known/ai-catalog.json")),
    safeFetch(joinUrl(base, "/mcp")),
    safeFetch(joinUrl(base, "/documentation/references/mcp")),
    safeFetch(joinUrl(base, "/")),
    safeFetch(joinUrl(base, "/AGENTS.md")),
  ]);

  const openapi = await probeOpenApi(base, llmsTxt.ok && !isHtml(llmsTxt) ? llmsTxt.body : "");

  const catalogMcpUrls = parseAiCatalogMcpUrls(
    isRealJson(aiCatalog) ? aiCatalog : null,
  );
  let mcpRemote: FetchResult | null = null;
  for (const remoteUrl of catalogMcpUrls) {
    const probed = await safeFetch(remoteUrl);
    if (isLikelyMcpTransport(probed)) {
      mcpRemote = probed;
      break;
    }
    // Keep the first probe as evidence if none verify as transport.
    if (!mcpRemote) mcpRemote = probed;
  }

  const absolute = llmsTxt.ok && !isHtml(llmsTxt) ? extractUrls(llmsTxt.body) : [];
  const relative =
    llmsTxt.ok && !isHtml(llmsTxt)
      ? extractMarkdownLinks(llmsTxt.body)
          .map((href) => resolveHref(base, href))
          .filter((u): u is string => Boolean(u))
      : [];
  const llmsUrls = preferDocUrls(
    [...new Set([...absolute, ...relative])].filter((u) => {
      try {
        return new URL(u).origin === new URL(base).origin;
      } catch {
        return false;
      }
    }),
  ).slice(0, 8);

  const skillUrls = parseSkillUrls(
    isRealJson(skillsIndex) ? skillsIndex : null,
    base,
  );

  const sampleTargets = llmsUrls.slice(0, 5);
  const mdTargets = sampleTargets
    .map((u) => {
      try {
        const url = new URL(u);
        if (url.pathname.endsWith(".md")) return null;
        if (url.pathname.endsWith("/")) {
          url.pathname = `${url.pathname.replace(/\/$/, "")}.md`;
        } else {
          url.pathname = `${url.pathname}.md`;
        }
        return url.toString();
      } catch {
        return null;
      }
    })
    .filter((u): u is string => Boolean(u))
    .slice(0, 4);

  const [sampledPages, skillPages, mdCompanions] = await Promise.all([
    Promise.all(sampleTargets.map((url) => safeFetch(url))),
    Promise.all(skillUrls.slice(0, 5).map((url) => safeFetch(url))),
    Promise.all(mdTargets.map((url) => safeFetch(url))),
  ]);

  const corpus = [
    llmsTxt.ok && !isHtml(llmsTxt) ? llmsTxt.body : "",
    homepage?.ok ? homepage.body : "",
    mcpDocs?.ok && !isSoft404(mcpDocs) ? mcpDocs.body : "",
    agentsMd?.ok && isLikelyMarkdown(agentsMd) ? agentsMd.body : "",
    ...sampledPages.filter((p) => p.ok && !isSoft404(p)).map((p) => p.body),
    ...skillPages.filter((p) => p.ok && !isSoft404(p)).map((p) => p.body),
  ]
    .join("\n")
    .toLowerCase();

  return {
    base,
    llmsTxt: llmsTxt.ok && !isHtml(llmsTxt) ? llmsTxt : null,
    llmsFull: llmsFull.ok && !isHtml(llmsFull) ? llmsFull : null,
    robotsTxt,
    skillsIndex: isRealJson(skillsIndex) ? skillsIndex : null,
    aiCatalog: isRealJson(aiCatalog) ? aiCatalog : null,
    openapi: openapi.ok ? openapi : null,
    mcp,
    mcpRemote,
    mcpDocs: mcpDocs.ok && !isSoft404(mcpDocs) ? mcpDocs : null,
    homepage,
    agentsMd: isLikelyMarkdown(agentsMd) ? agentsMd : null,
    sampledPages,
    skillPages,
    mdCompanions,
    llmsUrls,
    skillUrls,
    corpus,
  };
}

function evaluateCheck(check: RubricCheck, ctx: SiteContext): CheckResult {
  switch (check.id) {
    case "llms-txt-present": {
      const ok = Boolean(ctx.llmsTxt?.ok && ctx.llmsTxt.body.trim());
      return resultFor(check, ok ? "pass" : "fail", [
        ctx.llmsTxt ? `${ctx.llmsTxt.status} ${ctx.llmsTxt.url}` : "missing",
      ]);
    }
    case "llms-txt-size": {
      if (!ctx.llmsTxt?.ok) return resultFor(check, "skip", ["llms.txt missing"]);
      const len = ctx.llmsTxt.body.length;
      if (len <= 100_000) {
        return resultFor(check, "pass", [`${len} characters (budget 100000)`]);
      }
      return resultFor(check, "warn", [`${len} characters exceeds 100000`], 0.35);
    }
    case "llms-txt-links-valid": {
      if (!ctx.llmsTxt?.ok) return resultFor(check, "skip", ["llms.txt missing"]);
      const validSamples = ctx.sampledPages.filter((p) => p.ok && !isSoft404(p));
      if (ctx.sampledPages.length === 0) {
        return resultFor(check, "fail", ["no sampleable links in llms.txt"]);
      }
      const ratio = validSamples.length / ctx.sampledPages.length;
      if (ratio >= 0.8) {
        return resultFor(check, "pass", [
          `${validSamples.length}/${ctx.sampledPages.length} sampled llms.txt links OK`,
        ]);
      }
      if (ratio >= 0.4) {
        return resultFor(
          check,
          "warn",
          [`${validSamples.length}/${ctx.sampledPages.length} sampled llms.txt links OK`],
          0.4,
        );
      }
      return resultFor(check, "fail", [
        `${validSamples.length}/${ctx.sampledPages.length} sampled llms.txt links OK`,
      ]);
    }
    case "agent-skills-index": {
      const ok = Boolean(ctx.skillsIndex?.ok);
      return resultFor(check, ok ? "pass" : "fail", [
        ctx.skillsIndex
          ? `${ctx.skillsIndex.status} ${ctx.skillsIndex.url}`
          : "missing",
      ]);
    }
    case "skill-md-reachable": {
      if (!ctx.skillsIndex?.ok) {
        return resultFor(check, "skip", ["skills index missing"]);
      }
      if (ctx.skillUrls.length === 0) {
        return resultFor(check, "fail", [
          "skills index present but no skill.md URLs parsed",
        ]);
      }
      const okCount = ctx.skillPages.filter(
        (p) => p.ok && !isSoft404(p) && (isLikelyMarkdown(p) || !isHtml(p)),
      ).length;
      const ratio = okCount / Math.max(ctx.skillPages.length, 1);
      if (ratio >= 0.8) {
        return resultFor(check, "pass", [
          `${okCount}/${ctx.skillPages.length} sampled skill files OK`,
        ]);
      }
      if (okCount > 0) {
        return resultFor(
          check,
          "warn",
          [`${okCount}/${ctx.skillPages.length} sampled skill files OK`],
          0.4,
        );
      }
      return resultFor(check, "fail", [
        `0/${ctx.skillPages.length} sampled skill files OK`,
      ]);
    }
    case "mcp-documented": {
      const hasCatalog = Boolean(ctx.aiCatalog?.ok);
      const hasDocs = Boolean(ctx.mcpDocs?.ok);
      const mentionsInstall =
        /connect .*mcp|docs mcp|mcp server|add.*mcp|cursor.*mcp|claude.*mcp/i.test(
          ctx.corpus,
        );
      if (hasDocs || hasCatalog || mentionsInstall) {
        return resultFor(check, "pass", [
          hasDocs
            ? `MCP docs page ${ctx.mcpDocs!.url}`
            : hasCatalog
              ? `AI catalog ${ctx.aiCatalog!.url}`
              : "MCP install/connect guidance found",
        ]);
      }
      return resultFor(check, "fail", ["no clear MCP setup docs found"]);
    }
    case "openapi-discoverable": {
      if (ctx.openapi?.ok) {
        return resultFor(check, "pass", [
          `${ctx.openapi.status} ${ctx.openapi.url}`,
        ]);
      }
      return resultFor(check, "fail", [
        "openapi.json not found at common docs paths",
      ]);
    }
    case "markdown-mirrors": {
      const companions = ctx.mdCompanions.filter((p) => isLikelyMarkdown(p));
      const sampledMd = ctx.sampledPages.filter((p) => isLikelyMarkdown(p));
      const distinctFull =
        Boolean(ctx.llmsFull?.ok) &&
        ctx.llmsTxt?.ok &&
        ctx.llmsFull!.url !== ctx.llmsTxt.url &&
        ctx.llmsFull!.body !== ctx.llmsTxt.body &&
        ctx.llmsFull!.body.length > ctx.llmsTxt.body.length * 1.2;

      if (companions.length > 0) {
        return resultFor(check, "pass", [
          `${companions.length} .md companion page(s) verified`,
        ]);
      }
      if (sampledMd.length > 0) {
        return resultFor(check, "pass", [
          `${sampledMd.length} markdown page(s) sampled from llms.txt`,
        ]);
      }
      if (distinctFull) {
        return resultFor(check, "pass", [
          `distinct llms-full.txt (${ctx.llmsFull!.body.length} chars)`,
        ]);
      }
      if (ctx.agentsMd?.ok) {
        return resultFor(check, "warn", ["AGENTS.md found, but no page.md mirrors"], 0.35);
      }
      return resultFor(check, "fail", ["no markdown mirrors or llms-full.txt found"]);
    }
    case "server-rendered-answers": {
      if (!ctx.homepage?.ok || isSoft404(ctx.homepage)) {
        return resultFor(check, "fail", ["homepage fetch failed"]);
      }
      const text = ctx.homepage.body
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .trim();
      if (text.length > 500) {
        return resultFor(check, "pass", [
          "homepage has substantial non-script body content",
        ]);
      }
      if (isLikelyMarkdown(ctx.homepage) && text.length > 200) {
        return resultFor(check, "pass", [
          "homepage served as markdown with readable content",
        ]);
      }
      return resultFor(check, "fail", [
        "homepage body looks thin after stripping scripts",
      ]);
    }
    case "clear-page-purpose": {
      const pages = [ctx.homepage, ...ctx.sampledPages].filter(
        (p): p is FetchResult => Boolean(p?.ok && !isSoft404(p)),
      );
      const hasH1 = pages.some(
        (p) => /<h1[\s>]/i.test(p.body) || /^#\s+\S+/m.test(p.body),
      );
      return resultFor(
        check,
        hasH1 ? "pass" : "fail",
        [hasH1 ? "H1 / title found on homepage or sampled pages" : "no clear H1 found"],
      );
    }
    case "code-samples": {
      const hasCode =
        /```[\s\S]+```|<pre[\s>]|npm (?:i|install)|curl |pip install|yarn add/i.test(
          ctx.corpus,
        );
      return resultFor(
        check,
        hasCode ? "pass" : "fail",
        [hasCode ? "install/API code samples detected" : "no code samples detected"],
      );
    }
    case "corrections-section": {
      const has =
        /common (?:mistakes|misconceptions)|corrections? section|outdated (?:info|information|docs)|do not (?:use|confuse)/i.test(
          ctx.corpus,
        );
      // Optional check: missing is a light warn, not free points.
      return resultFor(
        check,
        has ? "pass" : "warn",
        [
          has
            ? "common mistakes / corrections content found"
            : "no corrections section detected (optional)",
        ],
        has ? 1 : 0.15,
      );
    }
    case "robots-allows-docs": {
      if (!ctx.robotsTxt?.ok || isHtml(ctx.robotsTxt)) {
        return resultFor(check, "pass", ["no robots.txt (default allow)"]);
      }
      const body = ctx.robotsTxt.body.toLowerCase();
      const blocksAll = /disallow:\s*\/\s*$/m.test(body);
      return resultFor(check, blocksAll ? "fail" : "pass", [
        blocksAll
          ? "robots.txt Disallow: /"
          : "robots.txt does not blanket-block /",
      ]);
    }
    case "mcp-endpoint": {
      if (isLikelyMcpTransport(ctx.mcp)) {
        return resultFor(check, "pass", [
          `${ctx.mcp!.status} ${ctx.mcp!.url} (MCP transport signal)`,
        ]);
      }
      if (isLikelyMcpTransport(ctx.mcpRemote)) {
        return resultFor(check, "pass", [
          `${ctx.mcpRemote!.status} ${ctx.mcpRemote!.url} (from ai-catalog)`,
        ]);
      }
      if (ctx.aiCatalog?.ok) {
        return resultFor(
          check,
          "warn",
          [`ai-catalog present at ${ctx.aiCatalog.url}, but MCP remote not verified`],
          0.35,
        );
      }
      if (ctx.mcp && isHtml(ctx.mcp)) {
        return resultFor(check, "fail", [
          `${ctx.mcp.url} looks like an HTML docs page, not an MCP endpoint`,
        ]);
      }
      return resultFor(check, "fail", [
        ctx.mcp ? `${ctx.mcp.status} ${ctx.mcp.url}` : "/mcp missing",
      ]);
    }
    case "task-skills": {
      if (!ctx.skillsIndex?.ok) {
        return resultFor(check, "fail", ["skills index missing"]);
      }
      const count = Math.max(
        ctx.skillUrls.length,
        ctx.skillPages.filter((p) => p.ok && !isSoft404(p)).length,
      );
      if (count >= 3) {
        return resultFor(check, "pass", [`${count} task skills discovered`]);
      }
      if (count >= 1) {
        return resultFor(check, "warn", [`only ${count} skill(s) discovered`], 0.45);
      }
      return resultFor(check, "fail", [
        "skills index exists but skill entries were not parsed",
      ]);
    }
    case "auth-for-agents": {
      const has = /api key|bearer|oauth|access token|authentication|partner.?auth/i.test(
        ctx.corpus,
      );
      return resultFor(
        check,
        has ? "pass" : "fail",
        [has ? "auth guidance found in docs corpus" : "no auth-for-agents guidance found"],
      );
    }
    case "copy-paste-prompts": {
      const has =
        /copy (?:and )?paste|paste (?:this|into)|prompt below|agent prompt/i.test(
          ctx.corpus,
        );
      return resultFor(
        check,
        has ? "pass" : "fail",
        [
          has
            ? "copy-paste / agent prompt patterns found"
            : "no copy-paste agent prompts detected",
        ],
      );
    }
    case "cookbooks": {
      const has = /cookbook|recipe|end-to-end|quickstart|getting started/i.test(
        ctx.corpus,
      );
      return resultFor(
        check,
        has ? "pass" : "fail",
        [
          has
            ? "cookbook / quickstart style guides found"
            : "no cookbook/recipe signals detected",
        ],
      );
    }
    case "version-or-updated": {
      const has =
        /changelog|release notes|last updated|version|v\d+\.\d+/i.test(ctx.corpus);
      return resultFor(
        check,
        has ? "pass" : "fail",
        [
          has
            ? "version / freshness signals found"
            : "few version or last-updated signals",
        ],
      );
    }
    case "skill-docs-consistency": {
      if (!ctx.skillsIndex?.ok) {
        return resultFor(check, "skip", ["skills index missing"]);
      }
      const okCount = ctx.skillPages.filter((p) => p.ok && !isSoft404(p)).length;
      if (okCount >= 1) {
        return resultFor(check, "pass", [
          `${okCount} skill page(s) reachable from index`,
        ]);
      }
      return resultFor(check, "fail", [
        "skills index present but skill pages unreachable",
      ]);
    }
    case "changelog-present": {
      const has = /changelog|release notes|what's new|whats new/i.test(ctx.corpus);
      return resultFor(
        check,
        has ? "pass" : "warn",
        [has ? "changelog / release notes found" : "no changelog detected"],
        has ? 1 : 0.15,
      );
    }
    case "no-marketing-corrections": {
      const marketingOnly =
        /fastest (?:way|docs)|best documentation ever|#1 docs/i.test(ctx.corpus) &&
        !/correction|misconception|common mistakes/i.test(ctx.corpus);
      if (marketingOnly) {
        return resultFor(check, "warn", ["possible marketing-only guidance"], 0.3);
      }
      return resultFor(check, "pass", [
        "no marketing-only corrections pattern detected",
      ]);
    }
    case "https-canonical": {
      const ok = ctx.base.startsWith("https://");
      return resultFor(check, ok ? "pass" : "fail", [ctx.base]);
    }
    default:
      return resultFor(check, "skip", [`unknown check ${check.id}`], 0);
  }
}

export async function scoreDocsUrl(
  inputUrl: string,
  rubric: Rubric = rubricV01,
): Promise<ScoreReport> {
  assertRubricWeights(rubric);

  const base = new URL(inputUrl).origin;
  const ctx = await buildContext(base);

  const categories: CategoryResult[] = rubric.categories.map((category) => {
    const checks = category.checks.map((check) => evaluateCheck(check, ctx));
    const score = Number(
      checks.reduce((sum, c) => sum + c.score, 0).toFixed(2),
    );
    return {
      id: category.id,
      title: category.title,
      score,
      maxScore: category.weight,
      checks,
    };
  });

  const score = Number(
    categories.reduce((sum, c) => sum + c.score, 0).toFixed(2),
  );

  return {
    url: base,
    scoredAt: new Date().toISOString(),
    rubricVersion: rubric.version,
    score,
    maxScore: rubric.maxScore,
    grade: gradeFromScore(score, rubric.maxScore),
    categories,
    notes: [
      "Docs AEO Scorer checks structural AEO readiness for coding agents — not Google SEO.",
      "Probes llms.txt, skills, MCP/ai-catalog, OpenAPI, markdown companions, and page content signals.",
    ],
  };
}
