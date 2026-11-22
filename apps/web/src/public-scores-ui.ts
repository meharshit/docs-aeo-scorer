import { AREA_MAX, type PublicSiteRow } from "@aeo-docs-scorer/public-scores/types";

const TOKEN_PREFIX = "aeo-public-token:";

export function tokenKey(slug: string): string {
  return `${TOKEN_PREFIX}${slug}`;
}

export function saveRemovalToken(slug: string, token: string): void {
  try {
    localStorage.setItem(tokenKey(slug), token);
  } catch {
    /* ignore */
  }
}

export function getRemovalToken(slug: string): string | null {
  try {
    return localStorage.getItem(tokenKey(slug));
  } catch {
    return null;
  }
}

export function clearRemovalToken(slug: string): void {
  try {
    localStorage.removeItem(tokenKey(slug));
  } catch {
    /* ignore */
  }
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "just now";
  const sec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function trophySvg(): string {
  return `<svg class="ps-trophy" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 3.5h10V8a5 5 0 0 1-10 0z" fill="var(--mark-solid)" stroke="var(--ink)" stroke-width="1.8"/>
    <path d="M7 6H4.5v1.2A3.3 3.3 0 0 0 7.8 10.5M17 6h2.5v1.2a3.3 3.3 0 0 1-3.3 3.3" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M12 13v4M8.5 20.5h7M9.5 17h5" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`;
}

export function renderRankCell(rank: number): string {
  if (rank >= 1 && rank <= 3) {
    return `<span class="ps-rank top">${trophySvg()}<span>Rank ${rank}</span></span>`;
  }
  return `<span class="ps-rank plain">${rank}</span>`;
}

export function renderChange(change: number | null): string {
  if (change === null) return `<span class="ps-change">New</span>`;
  if (change > 0) {
    return `<span class="ps-change up"><span class="arrow">▲</span> +${change.toFixed(1)}</span>`;
  }
  if (change < 0) {
    return `<span class="ps-change"><span class="arrow">▼</span> ${change.toFixed(1)}</span>`;
  }
  return `<span class="ps-change">0.0</span>`;
}

function areaPct(
  areas: PublicSiteRow["areas"],
  key: keyof typeof AREA_MAX,
): number {
  const max = AREA_MAX[key];
  return Math.round((areas[key] / max) * 100);
}

export function renderAreas(areas: PublicSiteRow["areas"]): string {
  const keys: (keyof typeof AREA_MAX)[] = [
    "discoverability",
    "readability",
    "actionability",
    "trust",
  ];
  const labels = ["D", "R", "A", "T"] as const;
  return `<div class="ps-areas">${keys
    .map((key, i) => {
      const pct = areaPct(areas, key);
      return `<div>
        <div class="ps-area-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
        <p class="ps-area-label">${labels[i]} ${pct}</p>
      </div>`;
    })
    .join("")}</div>`;
}

export function renderLandingTopRows(rows: PublicSiteRow[]): string {
  if (rows.length === 0) return "";
  return `
    <div class="ps-table-head">
      <span>Rank</span><span>Docs site</span><span class="right">Score</span><span></span>
    </div>
    ${rows
      .map((row) => {
        const top = row.rank <= 3 ? "top3" : "";
        const rank1 = row.rank === 1 ? "rank1" : "";
        return `<div class="ps-row ${top} ${rank1}">
          ${renderRankCell(row.rank)}
          <div>
            <div class="ps-site">${row.siteKey}</div>
            <p class="ps-meta">Checked ${relativeTime(row.checkedAt)}</p>
          </div>
          <div class="ps-score">
            <span class="ps-score-num">${row.score}</span>
            <span class="ps-score-grade">${row.grade}</span>
          </div>
          <a class="text-link ps-report" href="/r/${row.slug}">Report</a>
        </div>`;
      })
      .join("")}
  `;
}

export function renderScoresListRows(rows: PublicSiteRow[]): string {
  if (rows.length === 0) {
    return `<li class="scores-empty">No docs match that search yet. Score them and they will show up here.</li>`;
  }
  return rows
    .map((row) => {
      const yours = getRemovalToken(row.slug) ? "yours" : "";
      const top = row.rank <= 3 ? "top3" : "";
      const rank1 = row.rank === 1 ? "rank1" : "";
      const yoursNote = getRemovalToken(row.slug) ? " · your report" : "";
      return `<li class="scores-list-row ps-row ${top} ${rank1} ${yours}">
        ${renderRankCell(row.rank)}
        <div>
          <div class="ps-site">${row.siteKey}</div>
          <p class="ps-meta">Checked ${relativeTime(row.checkedAt)}${yoursNote}</p>
        </div>
        ${renderAreas(row.areas)}
        <div class="ps-score">
          <span class="ps-score-num">${row.score}</span>
          <span class="ps-score-grade">${row.grade}</span>
        </div>
        ${renderChange(row.change)}
        <a class="text-link ps-view" href="/r/${row.slug}">View report →</a>
      </li>`;
    })
    .join("");
}

export function buildPager(
  page: number,
  pages: number,
): { label: string; page: number; current?: boolean; disabled?: boolean; nav?: boolean }[] {
  if (pages <= 1) return [];
  const items: {
    label: string;
    page: number;
    current?: boolean;
    disabled?: boolean;
    nav?: boolean;
  }[] = [];
  items.push({
    label: "← Previous",
    page: page - 1,
    disabled: page <= 1,
    nav: true,
  });

  const pushPage = (p: number) => {
    items.push({ label: String(p), page: p, current: p === page });
  };

  if (pages <= 7) {
    for (let p = 1; p <= pages; p += 1) pushPage(p);
  } else {
    pushPage(1);
    const start = Math.max(2, page - 1);
    const end = Math.min(pages - 1, page + 1);
    if (start > 2) items.push({ label: "…", page: page, disabled: true });
    for (let p = start; p <= end; p += 1) pushPage(p);
    if (end < pages - 1) items.push({ label: "…", page: page, disabled: true });
    pushPage(pages);
  }

  items.push({
    label: "Next →",
    page: page + 1,
    disabled: page >= pages,
    nav: true,
  });
  return items;
}

export function renderHistoryChart(
  points: { score: number; checkedAt: string }[],
): string {
  if (points.length < 2) return "";
  const w = 260;
  const h = 70;
  const pad = 8;
  const scores = points.map((p) => p.score);
  const min = Math.min(...scores) - 2;
  const max = Math.max(...scores) + 2;
  const span = Math.max(1, max - min);
  const coords = points.map((p, i) => {
    const x =
      pad + (i / Math.max(points.length - 1, 1)) * (w - pad * 2);
    const y = h - pad - ((p.score - min) / span) * (h - pad * 2);
    return { x, y, score: p.score };
  });
  const d = coords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(" ");
  const label = points.map((p) => `${p.score}`).join(", ");
  const circles = coords
    .map((c, i) => {
      const last = i === coords.length - 1;
      const r = last ? 6 : 5;
      const fill = last ? "var(--mark-solid)" : "var(--paper)";
      return `<circle cx="${c.x}" cy="${c.y}" r="${r}" fill="${fill}" stroke="var(--ink)" stroke-width="1.5"/>`;
    })
    .join("");
  return `<svg class="score-history-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Score history: ${label}">
    <path d="${d}" fill="none" stroke="var(--ink)" stroke-width="2.5"/>
    ${circles}
  </svg>`;
}

export function formatHistoryDate(iso: string, change: number | null): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) {
    const delta =
      change === null
        ? ""
        : change >= 0
          ? ` · +${change.toFixed(1)}`
          : ` · ${change.toFixed(1)}`;
    return `Today${delta}`;
  }
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
