export interface FetchResult {
  url: string;
  ok: boolean;
  status: number;
  contentType: string | null;
  body: string;
}

const DEFAULT_TIMEOUT_MS = 12_000;

export async function fetchText(
  url: string,
  init?: RequestInit,
): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/json,text/plain,text/markdown,*/*",
        "user-agent":
          "DocsAEOScorer/0.1 (+https://github.com/meharshit/docs-aeo-scorer)",
        ...(init?.headers ?? {}),
      },
    });

    const body = await response.text();
    return {
      url: response.url || url,
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type"),
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function joinUrl(base: string, path: string): string {
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function extractUrls(text: string): string[] {
  const matches = [...text.matchAll(/https?:\/\/[^\s)\]>"']+/g)].map((m) =>
    m[0].replace(/[.,;]+$/, ""),
  );
  return [...new Set(matches)];
}

export function extractMarkdownLinks(text: string): string[] {
  const links: string[] = [];
  for (const match of text.matchAll(/\[[^\]]*]\(([^)\s]+)\)/g)) {
    const href = match[1];
    if (href) links.push(href.replace(/[.,;]+$/, ""));
  }
  return [...new Set(links)];
}
