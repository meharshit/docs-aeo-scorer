import {
  bandLabel,
  displayHost,
  normalizeDocsUrl,
  reportToMarkdown,
  toReport,
  type Report,
  type ScoreReport,
} from "./adapter.js";
import {
  buildPager,
  clearRemovalToken,
  formatHistoryDate,
  getRemovalToken,
  relativeTime as publicRelativeTime,
  renderHistoryChart,
  renderLandingTopRows,
  renderScoresListRows,
  saveRemovalToken,
} from "./public-scores-ui.js";

const CHECKS = [
  {
    name: "llms.txt and entry points",
    area: "Discoverability",
  },
  {
    name: "Agent skills index and SKILL.md",
    area: "Discoverability",
  },
  {
    name: "Documentation MCP endpoint",
    area: "Discoverability",
  },
  {
    name: "HTML and Markdown mirrors",
    area: "Readability",
  },
  {
    name: "Can agents complete tasks?",
    area: "Actionability",
  },
  {
    name: "Trust and freshness signals",
    area: "Trust and freshness",
  },
] as const;

type View = "landing" | "checking" | "results" | "scores";

type PublicMeta = {
  listed: boolean;
  slug?: string;
  rank?: number;
  total?: number;
  removalToken?: string;
  siteKey?: string;
};

const landing = document.querySelector<HTMLElement>("#view-landing");
const checking = document.querySelector<HTMLElement>("#view-checking");
const results = document.querySelector<HTMLElement>("#view-results");
const scoresView = document.querySelector<HTMLElement>("#view-scores");
const progressLine = document.querySelector<HTMLElement>("#progress-line");
const progressFill = document.querySelector<HTMLElement>("#progress-line-fill");
const form = document.querySelector<HTMLFormElement>("#score-form");
const urlInput = document.querySelector<HTMLInputElement>("#docs-url");
const makePublic = document.querySelector<HTMLInputElement>("#make-public");
const formError = document.querySelector<HTMLElement>("#form-error");
const toastEl = document.querySelector<HTMLElement>("#toast");
const publicBar = document.querySelector<HTMLElement>("#public-bar");
const historyWrap = document.querySelector<HTMLElement>("#history-wrap");
const historyLead = document.querySelector<HTMLElement>("#history-lead");
const historyList = document.querySelector<HTMLElement>("#history-list");
const publicLandingTop = document.querySelector<HTMLElement>("#public-landing-top");
const publicLandingEmpty = document.querySelector<HTMLElement>("#public-landing-empty");
const scoresList = document.querySelector<HTMLElement>("#scores-list");
const scoresEmpty = document.querySelector<HTMLElement>("#scores-empty");
const scoresListHead = document.querySelector<HTMLElement>("#scores-list-head");
const scoresFoot = document.querySelector<HTMLElement>("#scores-foot");
const scoresPageLabel = document.querySelector<HTMLElement>("#scores-page-label");
const scoresPager = document.querySelector<HTMLElement>("#scores-pager");
const scoresSearch = document.querySelector<HTMLInputElement>("#scores-search");
const scoresStats = document.querySelector<HTMLElement>("#scores-stats");
const scoresLive = document.querySelector<HTMLElement>("#scores-live");
const scoresLoading = document.querySelector<HTMLElement>("#scores-loading");
const statSites = document.querySelector<HTMLElement>("#stat-sites");
const statAverage = document.querySelector<HTMLElement>("#stat-average");
const statTop = document.querySelector<HTMLElement>("#stat-top");
const statStrong = document.querySelector<HTMLElement>("#stat-strong");

function setScoresLoading(on: boolean): void {
  if (scoresLoading) scoresLoading.hidden = !on;
  if (on) {
    if (scoresList) scoresList.innerHTML = "";
    if (scoresEmpty) scoresEmpty.hidden = true;
    if (scoresListHead) scoresListHead.hidden = true;
    if (scoresFoot) scoresFoot.hidden = true;
    if (scoresLive) scoresLive.textContent = "Loading public scores";
  }
}

let currentUrl = "";
let currentReport: Report | null = null;
let currentPublic: PublicMeta | null = null;
let toastTimer = 0;
let scoresSort = "top";
let scoresGrade = "all";
let scoresPage = 1;
let scoresQuery = "";
let scoresSearchTimer = 0;
let landingTopLoaded = false;

function scoresQueryString(): string {
  const params = new URLSearchParams();
  if (scoresSort !== "top") params.set("sort", scoresSort);
  if (scoresGrade !== "all") params.set("grade", scoresGrade);
  if (scoresQuery) params.set("q", scoresQuery);
  if (scoresPage > 1) params.set("page", String(scoresPage));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function syncScoresUrl(push: boolean): void {
  const url = `/scores${scoresQueryString()}`;
  if (push) history.pushState({ view: "scores" }, "", url);
  else history.replaceState({ view: "scores" }, "", url);
}

function setSegmentPressed(
  root: ParentNode | null,
  attr: string,
  value: string,
): void {
  if (!root) return;
  root.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
    const match = btn.getAttribute(attr) === value;
    btn.setAttribute("aria-pressed", match ? "true" : "false");
  });
}

function applyScoresControlsFromState(): void {
  setSegmentPressed(document.querySelector("#scores-sort"), "data-sort", scoresSort);
  setSegmentPressed(
    document.querySelector("#scores-grade"),
    "data-grade",
    scoresGrade,
  );
  if (scoresSearch && scoresSearch.value !== scoresQuery) {
    scoresSearch.value = scoresQuery;
  }
}

function scrollTop(): void {
  window.scrollTo({ top: 0, behavior: "auto" });
}

function showToast(message: string): void {
  if (!toastEl) return;
  toastEl.hidden = false;
  toastEl.textContent = message;
  requestAnimationFrame(() => toastEl.classList.add("show"));
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove("show");
    window.setTimeout(() => {
      toastEl.hidden = true;
    }, 200);
  }, 1600);
}

function renderRuler(host: HTMLElement | null, score: number | null): void {
  if (!host) return;
  const ticks: string[] = [];
  for (let i = 0; i <= 100; i += 5) {
    const cls = i === 50 || i === 70 ? "band" : i % 10 === 0 ? "ten" : "five";
    ticks.push(`<span class="ruler-tick ${cls}" style="left:${i}%"></span>`);
  }

  const marker =
    score === null
      ? ""
      : `<div class="ruler-marker" style="left:${Math.min(100, Math.max(0, score))}%">
          <span class="ruler-marker-label">You · ${Number(score.toFixed(1))}</span>
          <span class="ruler-marker-pin" aria-hidden="true"></span>
        </div>`;

  host.innerHTML = `
    <div class="ruler" aria-hidden="${score === null ? "false" : "false"}">
      ${marker}
      <div class="ruler-track">${ticks.join("")}</div>
      <div class="ruler-nums">
        <span style="left:0%">0</span>
        <span style="left:50%">50</span>
        <span style="left:70%">70</span>
        <span style="left:100%">100</span>
      </div>
      <div class="ruler-bands">
        <div class="ruler-band"><strong>F</strong>Needs work</div>
        <div class="ruler-band"><strong>D to C</strong>Getting there</div>
        <div class="ruler-band"><strong>B to A</strong>Strong</div>
      </div>
    </div>
  `;
}

function setFormError(message: string | null): void {
  if (!formError) return;
  if (!message) {
    formError.hidden = true;
    formError.textContent = "";
    return;
  }
  formError.hidden = false;
  formError.textContent = message;
}

function showView(view: View): void {
  if (landing) landing.hidden = view !== "landing";
  if (checking) checking.hidden = view !== "checking";
  if (results) results.hidden = view !== "results";
  if (scoresView) scoresView.hidden = view !== "scores";
  if (progressLine) progressLine.hidden = view !== "checking";
  scrollTop();
  if (view === "landing") void loadLandingTop();
}

function relativeTime(iso: string): string {
  return publicRelativeTime(iso);
}

function setCheckingProgress(percent: number): void {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const pctEl = document.querySelector("#checking-percent");
  const live = document.querySelector("#checking-live");
  if (pctEl) pctEl.textContent = String(clamped);
  if (progressFill) progressFill.style.width = `${clamped}%`;
  if (live) live.textContent = `Progress ${clamped} percent`;
}

type LogState = "waiting" | "running" | "done" | "failed";

function renderCheckLog(
  states: { state: LogState; seconds?: number; error?: string }[],
): void {
  const log = document.querySelector("#check-log");
  if (!log) return;
  log.innerHTML = CHECKS.map((check, index) => {
    const row = states[index] ?? { state: "waiting" as const };
    const num = String(index + 1).padStart(2, "0");
    let status = "Waiting";
    let statusClass = "";
    if (row.state === "running") {
      status = "Running";
      statusClass = "running";
    } else if (row.state === "done") {
      status = `Done · ${row.seconds ?? 1}s`;
    } else if (row.state === "failed") {
      status = "Failed";
      statusClass = "failed";
    }
    const failLine =
      row.state === "failed" && row.error
        ? `<p class="check-log-fail">${row.error}</p>`
        : "";
    return `
      <li class="check-log-row ${row.state === "waiting" ? "waiting" : ""}">
        <span class="check-log-num">${num}</span>
        <div>
          <div>${check.name}</div>
          <p class="check-log-area">${check.area}</p>
          ${failLine}
        </div>
        <span class="check-log-leader" aria-hidden="true"></span>
        <span class="check-log-status ${statusClass}">${status}</span>
      </li>
    `;
  }).join("");
}

async function loadLandingTop(): Promise<void> {
  if (!publicLandingTop) return;
  if (publicLandingEmpty) publicLandingEmpty.hidden = true;
  publicLandingTop.innerHTML = `
    <div class="ps-loading" role="status" aria-live="polite">
      <span class="ps-spinner" aria-hidden="true"></span>
      <span>Loading public scores…</span>
    </div>
  `;
  try {
    const response = await fetch("/api/public-scores/top?limit=5");
    if (!response.ok) throw new Error("top failed");
    const data = (await response.json()) as { rows: Parameters<typeof renderLandingTopRows>[0] };
    landingTopLoaded = true;
    if (!data.rows || data.rows.length === 0) {
      publicLandingTop.innerHTML = "";
      if (publicLandingEmpty) publicLandingEmpty.hidden = false;
      return;
    }
    if (publicLandingEmpty) publicLandingEmpty.hidden = true;
    publicLandingTop.innerHTML = renderLandingTopRows(data.rows);
  } catch {
    if (!landingTopLoaded) {
      publicLandingTop.innerHTML = "";
      if (publicLandingEmpty) publicLandingEmpty.hidden = false;
    }
  }
}

function renderPublicBar(meta: PublicMeta | null): void {
  if (!publicBar) return;
  if (!meta?.listed || !meta.slug) {
    publicBar.hidden = true;
    publicBar.innerHTML = "";
    return;
  }

  const token = meta.removalToken || getRemovalToken(meta.slug);
  const rank = meta.rank ?? "—";
  const total = meta.total ?? "—";
  const site = meta.siteKey || meta.slug;

  publicBar.hidden = false;
  publicBar.innerHTML = `
    <span class="public-bar-dot" aria-hidden="true"></span>
    <span>Listed publicly as <span class="mono">${site}</span></span>
    <span>Rank <b>${rank}</b> of <b>${total}</b></span>
    <span class="public-bar-spacer"></span>
    <a class="text-link" href="/r/${meta.slug}">Public link</a>
    <a class="text-link" href="/scores">All scores</a>
    ${
      token
        ? `<button type="button" class="text-link muted-link" id="public-remove-btn">Remove from public</button>`
        : ""
    }
  `;

  document.querySelector("#public-remove-btn")?.addEventListener("click", () => {
    void removeFromPublic(meta.slug!, token!);
  });
}

async function removeFromPublic(slug: string, token: string): Promise<void> {
  try {
    const response = await fetch(
      `/api/public-scores/${encodeURIComponent(slug)}/remove`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ removalToken: token }),
      },
    );
    if (!response.ok) {
      showToast("Could not remove this score");
      return;
    }
    clearRemovalToken(slug);
    currentPublic = { listed: false };
    renderPublicBar(null);
    showToast("Removed from public scores");
    landingTopLoaded = false;
    void loadLandingTop();
  } catch {
    showToast("Could not remove this score");
  }
}

async function loadHistory(slug: string): Promise<void> {
  if (!historyWrap || !historyList) return;
  try {
    const response = await fetch(
      `/api/public-scores/${encodeURIComponent(slug)}/history`,
    );
    if (!response.ok) throw new Error("history failed");
    const data = (await response.json()) as {
      points: { score: number; checkedAt: string; change?: number | null }[];
    };
    const points = data.points ?? [];
    if (points.length === 0) {
      historyWrap.hidden = true;
      return;
    }

    historyWrap.hidden = false;
    if (historyLead) {
      historyLead.textContent =
        points.length === 1
          ? "First public score for this site."
          : `${points.length} public checks on record.`;
    }

    if (points.length === 1) {
      const only = points[0]!;
      historyList.innerHTML = `
        <p class="score-history-first">
          <strong>${only.score}</strong> · ${formatHistoryDate(only.checkedAt, null)}
        </p>
      `;
      return;
    }

    const recent = points.slice(-4).reverse();
    const withChange = recent.map((p, i, arr) => {
      const older = arr[i + 1];
      const change =
        older == null ? null : Number((p.score - older.score).toFixed(1));
      return { ...p, change };
    });

    historyList.innerHTML = `
      ${renderHistoryChart(points)}
      <div class="score-history-points">
        ${withChange
          .map(
            (p) => `
          <div class="score-history-point">
            <strong>${p.score}</strong>
            <span>${formatHistoryDate(p.checkedAt, p.change)}</span>
          </div>`,
          )
          .join("")}
      </div>
    `;
  } catch {
    historyWrap.hidden = true;
  }
}

function renderResults(report: Report, publicMeta: PublicMeta | null = null): void {
  currentReport = report;
  currentPublic = publicMeta;
  const host = displayHost(report.url);

  const reportUrl = document.querySelector("#report-url");
  const reportMeta = document.querySelector("#report-meta");
  const scoreValue = document.querySelector("#score-value");
  const scoreGrade = document.querySelector("#score-grade");
  const headline = document.querySelector("#score-headline");
  const body = document.querySelector("#score-body");
  const counts = document.querySelector("#score-counts");
  const areas = document.querySelector("#areas");
  const recs = document.querySelector("#recs-list");

  if (reportUrl) reportUrl.textContent = host;
  if (reportMeta) {
    reportMeta.textContent = `Checked ${relativeTime(report.checkedAt)} · ${report.checksRun} checks run`;
  }
  if (scoreValue) scoreValue.textContent = String(report.score);
  if (scoreGrade) {
    scoreGrade.innerHTML = `<b>Grade ${report.grade}</b> · ${bandLabel(report.score)}`;
  }

  if (headline && body && report.summary) {
    const highlight = report.summary.highlight
      ? ` <span class="mark">${report.summary.highlight}</span>.`
      : ".";
    headline.innerHTML = `${report.summary.headline}${highlight}`;
    body.textContent = report.summary.body;
  }

  const needFix = report.recommendations.filter(
    (r) => r.severity === "needs-fix",
  ).length;
  const improve = report.recommendations.filter(
    (r) => r.severity === "can-improve",
  ).length;
  const ranked = [...report.areas]
    .map((a) => ({
      ...a,
      pct: a.max === 0 ? 0 : Math.round((a.score / a.max) * 100),
    }))
    .sort((a, b) => a.pct - b.pct);
  const lowest = ranked[0];
  const hasRealWeakSpot =
    Boolean(lowest) && (lowest!.pct < 85 || needFix > 0);

  const thirdCount = hasRealWeakSpot
    ? `<div class="score-count"><strong>${lowest!.pct}%</strong><span>Weakest: ${lowest!.name}</span></div>`
    : `<div class="score-count"><strong>${Math.min(...ranked.map((a) => a.pct)) || 100}%</strong><span>Lowest area still strong</span></div>`;

  if (counts) {
    counts.innerHTML = `
      <div class="score-count"><strong>${needFix}</strong><span>Need fixing</span></div>
      <div class="score-count"><strong>${improve}</strong><span>Can improve</span></div>
      ${thirdCount}
    `;
  }

  renderRuler(document.querySelector("#results-ruler"), report.score);
  renderPublicBar(publicMeta);
  if (publicMeta?.listed && publicMeta.slug) {
    void loadHistory(publicMeta.slug);
  } else if (historyWrap) {
    historyWrap.hidden = true;
  }

  if (areas) {
    areas.innerHTML = report.areas
      .map((area, index) => {
        const pct =
          area.max === 0 ? 0 : Math.round((area.score / area.max) * 100);
        const num = String(index + 1).padStart(2, "0");
        const items = area.checks
          .map((check) => {
            const sym =
              check.status === "pass"
                ? "✓"
                : check.status === "partial"
                  ? "◐"
                  : "○";
            const tag = check.path
              ? `<span class="mark">${check.path}</span>`
              : check.status === "pass"
                ? "Pass"
                : check.status === "partial"
                  ? "Partial"
                  : "Missing";
            return `
              <div class="area-check ${check.status}">
                <span class="area-check-sym">${sym}</span>
                <span class="area-check-label">${check.label}</span>
                <span class="area-check-tag">${tag}</span>
              </div>
            `;
          })
          .join("");
        return `
          <div>
            <div class="area-row">
              <span class="area-num">${num}</span>
              <span class="area-name">${area.name}</span>
              <div class="area-bar-wrap area-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
              <span class="area-pts">${area.score} / ${area.max}</span>
              <span class="area-pct">${pct}%</span>
            </div>
            <div class="area-checks">${items}</div>
          </div>
        `;
      })
      .join("");
  }

  if (recs) {
    if (report.recommendations.length === 0) {
      recs.innerHTML = `
        <div class="rec">
          <div class="rec-num">01</div>
          <div>
            <p class="rec-kicker">Looking good</p>
            <p class="rec-title">No big fixes needed</p>
            <p class="rec-body">Come back after your next docs release and score again.</p>
          </div>
          <div></div>
        </div>
      `;
    } else {
      recs.innerHTML = report.recommendations
        .map((rec, index) => {
          const num = String(index + 1).padStart(2, "0");
          const sev =
            rec.severity === "needs-fix" ? "Needs fix" : "Can improve";
          const side = rec.path
            ? `<div class="rec-side">
                <p class="rec-path"><span class="mark">${rec.path}</span></p>
                ${rec.hint ? `<p class="rec-hint">${rec.hint}</p>` : ""}
              </div>`
            : `<div class="rec-side"></div>`;
          return `
            <div class="rec">
              <div class="rec-num">${num}</div>
              <div>
                <p class="rec-kicker">${sev} · ${rec.area}</p>
                <p class="rec-title">${rec.title}</p>
                <p class="rec-body">${rec.body}</p>
              </div>
              ${side}
            </div>
          `;
        })
        .join("");
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

type CheckRowState = {
  state: LogState;
  seconds?: number;
  error?: string;
};

function paintPendingChecks(
  states: CheckRowState[],
  activeIndex: number,
  elapsedSec: number,
): void {
  const per = Math.max(1, Math.round(elapsedSec / Math.max(activeIndex, 1)));
  states.forEach((row, i) => {
    row.error = undefined;
    if (i < activeIndex) {
      row.state = "done";
      row.seconds = per + (i % 2);
    } else if (i === activeIndex) {
      row.state = "running";
      row.seconds = undefined;
    } else {
      row.state = "waiting";
      row.seconds = undefined;
    }
  });
  renderCheckLog(states);
}

async function runScore(url: string): Promise<void> {
  currentUrl = url;
  const host = displayHost(url);
  const checkingUrl = document.querySelector("#checking-url");
  const checkingError = document.querySelector<HTMLElement>("#checking-error");
  const tryAgain = document.querySelector<HTMLButtonElement>("#try-again");
  const wantPublic = makePublic?.checked !== false;

  if (checkingUrl) checkingUrl.textContent = host;
  if (checkingError) {
    checkingError.hidden = true;
    checkingError.textContent = "";
  }
  if (tryAgain) tryAgain.hidden = true;

  const states: CheckRowState[] = CHECKS.map(() => ({ state: "waiting" }));
  let activeIndex = 0;
  paintPendingChecks(states, activeIndex, 1);
  setCheckingProgress(4);
  showView("checking");
  history.pushState(
    { view: "checking", url },
    "",
    `/?view=check&url=${encodeURIComponent(url)}`,
  );

  const started = Date.now();
  const stepMs = 850;
  let pulse = window.setInterval(() => {
    const elapsed = Date.now() - started;
    activeIndex = Math.min(
      CHECKS.length - 1,
      Math.floor(elapsed / stepMs),
    );
    paintPendingChecks(states, activeIndex, Math.max(1, Math.round(elapsed / 1000)));
    const soft = Math.min(
      90,
      6 +
        (activeIndex / Math.max(CHECKS.length - 1, 1)) * 72 +
        (elapsed % stepMs) / 40,
    );
    setCheckingProgress(soft);
  }, 180);

  try {
    const response = await fetch("/api/score", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, public: wantPublic }),
    });
    const payload = (await response.json()) as ScoreReport & {
      error?: string;
      retryAfterSec?: number;
      public?: PublicMeta;
    };

    window.clearInterval(pulse);

    if (!response.ok) {
      const msg =
        response.status === 429
          ? `${payload.error ?? "Rate limit reached."}${
              payload.retryAfterSec
                ? ` Try again in about ${payload.retryAfterSec}s.`
                : ""
            }`
          : payload.error || `HTTP ${response.status}`;
      states.forEach((s, i) => {
        s.state = i === activeIndex ? "failed" : "waiting";
        s.error = i === activeIndex ? msg : undefined;
      });
      renderCheckLog(states);
      setCheckingProgress(0);
      if (checkingError) {
        checkingError.hidden = false;
        checkingError.textContent = msg;
      }
      if (tryAgain) tryAgain.hidden = false;
      return;
    }

    const totalSec = Math.max(1, Math.round((Date.now() - started) / 1000));
    const per = Math.max(1, Math.round(totalSec / CHECKS.length));

    for (let i = 0; i < CHECKS.length; i += 1) {
      if (states[i]!.state === "done") {
        states[i]!.seconds = per + (i % 2);
        continue;
      }
      states[i]!.state = "running";
      renderCheckLog(states);
      setCheckingProgress(Math.round(((i + 0.45) / CHECKS.length) * 100));
      await sleep(220);
      states[i]!.state = "done";
      states[i]!.seconds = per + (i % 2);
      renderCheckLog(states);
      setCheckingProgress(Math.round(((i + 1) / CHECKS.length) * 100));
    }

    await sleep(280);

    const report = toReport(payload);
    const publicMeta = payload.public ?? { listed: false };
    if (publicMeta.listed && publicMeta.slug && publicMeta.removalToken) {
      saveRemovalToken(publicMeta.slug, publicMeta.removalToken);
    }
    sessionStorage.setItem("aeo-last-report", JSON.stringify(report));
    sessionStorage.setItem("aeo-last-public", JSON.stringify(publicMeta));
    renderResults(report, publicMeta);
    showView("results");
    landingTopLoaded = false;
    history.replaceState(
      { view: "results", url },
      "",
      `/?view=report&url=${encodeURIComponent(url)}`,
    );
  } catch (error) {
    window.clearInterval(pulse);
    const msg = error instanceof Error ? error.message : "Score failed";
    states.forEach((s, i) => {
      s.state = i === activeIndex ? "failed" : "waiting";
      s.error = i === activeIndex ? msg : undefined;
    });
    renderCheckLog(states);
    setCheckingProgress(0);
    if (checkingError) {
      checkingError.hidden = false;
      checkingError.textContent = msg;
    }
    if (tryAgain) tryAgain.hidden = false;
  }
}

async function loadScoresPage(pushUrl = false): Promise<void> {
  if (!scoresList) return;
  applyScoresControlsFromState();
  syncScoresUrl(pushUrl);
  setScoresLoading(true);

  const params = new URLSearchParams({
    sort: scoresSort,
    grade: scoresGrade,
    page: String(scoresPage),
  });
  if (scoresQuery) params.set("q", scoresQuery);

  try {
    const response = await fetch(`/api/public-scores?${params.toString()}`);
    if (!response.ok) throw new Error("list failed");
    const data = (await response.json()) as {
      total: number;
      page: number;
      pages: number;
      perPage: number;
      stats: {
        sites: number;
        average: number;
        top: number;
        strongCount: number;
      };
      rows: Parameters<typeof renderScoresListRows>[0];
    };

    setScoresLoading(false);
    if (scoresStats) scoresStats.hidden = false;
    if (statSites) statSites.textContent = String(data.stats.sites);
    if (statAverage) statAverage.textContent = String(data.stats.average);
    if (statTop) statTop.textContent = String(data.stats.top);
    if (statStrong) statStrong.textContent = String(data.stats.strongCount);

    if (data.stats.sites === 0 && !scoresQuery && scoresGrade === "all") {
      scoresList.innerHTML = "";
      if (scoresEmpty) {
        scoresEmpty.hidden = false;
        scoresEmpty.innerHTML =
          'No public scores yet. Be the first — <a href="/">score your docs</a>.';
      }
      if (scoresListHead) scoresListHead.hidden = true;
      if (scoresFoot) scoresFoot.hidden = true;
      if (scoresLive) scoresLive.textContent = "0 sites";
      return;
    }

    if (data.total === 0) {
      scoresList.innerHTML = renderScoresListRows([]);
      if (scoresEmpty) scoresEmpty.hidden = true;
      if (scoresListHead) scoresListHead.hidden = false;
      if (scoresFoot) scoresFoot.hidden = true;
      if (scoresLive) scoresLive.textContent = "0 matching sites";
      return;
    }

    if (scoresEmpty) scoresEmpty.hidden = true;
    if (scoresListHead) scoresListHead.hidden = false;
    scoresList.innerHTML = renderScoresListRows(data.rows);

    const from = (data.page - 1) * data.perPage + 1;
    const to = Math.min(data.total, data.page * data.perPage);
    if (scoresLive) {
      scoresLive.textContent = `Showing ${from}–${to} of ${data.total} sites`;
    }

    if (scoresFoot && scoresPager && scoresPageLabel) {
      scoresFoot.hidden = false;
      scoresPageLabel.textContent = `Showing ${from}–${to} of ${data.total} sites`;
      const items = buildPager(data.page, data.pages);
      scoresPager.innerHTML = items
        .map((item) => {
          const attrs = [
            `type="button"`,
            `data-page="${item.page}"`,
            item.current ? `aria-current="page"` : "",
            item.disabled ? "disabled" : "",
            item.nav ? `class="nav"` : "",
          ]
            .filter(Boolean)
            .join(" ");
          return `<button ${attrs}>${item.label}</button>`;
        })
        .join("");
      scoresPager
        .querySelectorAll<HTMLButtonElement>("button[data-page]")
        .forEach((btn) => {
          btn.addEventListener("click", () => {
            if (btn.disabled) return;
            scoresPage = Number(btn.dataset.page || "1");
            void loadScoresPage(true);
          });
        });
    }
  } catch {
    setScoresLoading(false);
    scoresList.innerHTML = `<li class="scores-empty">Could not load public scores. Try again shortly.</li>`;
    if (scoresEmpty) scoresEmpty.hidden = true;
    if (scoresFoot) scoresFoot.hidden = true;
  }
}

function readScoresStateFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  const sort = params.get("sort") || "top";
  scoresSort = ["top", "recent", "improved"].includes(sort) ? sort : "top";
  const grade = params.get("grade") || "all";
  scoresGrade = ["all", "strong", "mid", "low"].includes(grade)
    ? grade
    : "all";
  scoresQuery = (params.get("q") || "").trim();
  const page = Number(params.get("page") || "1");
  scoresPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function goScores(push = true): void {
  if (push && window.location.pathname.replace(/\/+$/, "") !== "/scores") {
    scoresSort = "top";
    scoresGrade = "all";
    scoresPage = 1;
    scoresQuery = "";
  } else {
    readScoresStateFromUrl();
  }
  showView("scores");
  void loadScoresPage(push);
}

function goLanding(clear = false, push = true): void {
  showView("landing");
  if (push) history.pushState({ view: "landing" }, "", "/");
  if (clear && urlInput) {
    urlInput.value = "";
    urlInput.focus();
  }
  setFormError(null);
}

async function openPublicReport(slug: string, push = true): Promise<void> {
  showView("checking");
  setCheckingProgress(12);
  renderCheckLog(CHECKS.map(() => ({ state: "waiting" as const })));
  const checkingUrl = document.querySelector("#checking-url");
  if (checkingUrl) checkingUrl.textContent = slug;

  try {
    const response = await fetch(
      `/api/public-scores/${encodeURIComponent(slug)}`,
    );
    if (!response.ok) throw new Error("Report not found");
    const data = (await response.json()) as {
      url: string;
      slug: string;
      siteKey: string;
      rank: number;
      total: number;
      report: ScoreReport;
    };
    const report = toReport(data.report);
    currentUrl = report.url;
    const publicMeta: PublicMeta = {
      listed: true,
      slug: data.slug,
      rank: data.rank,
      total: data.total,
      siteKey: data.siteKey,
      removalToken: getRemovalToken(data.slug) || undefined,
    };
    renderResults(report, publicMeta);
    showView("results");
    if (push) {
      history.pushState({ view: "results", slug }, "", `/r/${data.slug}`);
    }
  } catch {
    showToast("Public report not found");
    goScores(push);
  }
}

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  setFormError(null);
  const raw = urlInput?.value ?? "";
  const url = normalizeDocsUrl(raw);
  if (!url) {
    setFormError("Enter a full URL, like https://docs.example.com");
    return;
  }
  if (urlInput) urlInput.value = url;
  void runScore(url);
});

document.querySelectorAll<HTMLButtonElement>(".hint-link").forEach((btn) => {
  btn.addEventListener("click", () => {
    const url = btn.dataset.url;
    if (!urlInput || !url) return;
    urlInput.value = url;
    urlInput.focus();
  });
});

const navToggle = document.querySelector<HTMLButtonElement>("#nav-toggle");
const headerNav = document.querySelector<HTMLElement>("#header-nav");

function setMobileNavOpen(open: boolean): void {
  if (!navToggle || !headerNav) return;
  headerNav.classList.toggle("is-open", open);
  navToggle.setAttribute("aria-expanded", open ? "true" : "false");
  navToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
}

function closeMobileNav(): void {
  setMobileNavOpen(false);
}

navToggle?.addEventListener("click", () => {
  const open = navToggle.getAttribute("aria-expanded") !== "true";
  setMobileNavOpen(open);
});

headerNav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    closeMobileNav();
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMobileNav();
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 920) closeMobileNav();
});

document.querySelector("#brand-home")?.addEventListener("click", (event) => {
  event.preventDefault();
  closeMobileNav();
  goLanding(false);
});

function scrollToLandingSection(id: string): void {
  if (landing?.hidden) {
    goLanding(false);
    window.setTimeout(() => {
      document.querySelector(id)?.scrollIntoView({ behavior: "smooth" });
    }, 50);
    return;
  }
  document.querySelector(id)?.scrollIntoView({ behavior: "smooth" });
}

document.querySelector("#nav-method")?.addEventListener("click", (event) => {
  if (landing?.hidden) {
    event.preventDefault();
    scrollToLandingSection("#method");
  }
});

document.querySelector("#nav-learn")?.addEventListener("click", (event) => {
  if (landing?.hidden) {
    event.preventDefault();
    scrollToLandingSection("#learn");
  }
});

document.querySelector("#nav-scores")?.addEventListener("click", (event) => {
  event.preventDefault();
  goScores(true);
});

document.querySelector("#try-again")?.addEventListener("click", () => {
  if (currentUrl) void runScore(currentUrl);
});

document.querySelector("#rescore-btn")?.addEventListener("click", () => {
  if (currentUrl) void runScore(currentUrl);
});

document.querySelector("#rescore-link")?.addEventListener("click", () => {
  if (currentUrl) void runScore(currentUrl);
});

document.querySelector("#another-url")?.addEventListener("click", () => {
  goLanding(true);
});

document.querySelector("#copy-md")?.addEventListener("click", async () => {
  if (!currentReport) return;
  await navigator.clipboard.writeText(reportToMarkdown(currentReport));
  showToast("Report copied as Markdown");
});

document.querySelector("#share-btn")?.addEventListener("click", async () => {
  if (currentPublic?.listed && currentPublic.slug) {
    const share = `${window.location.origin}/r/${currentPublic.slug}`;
    await navigator.clipboard.writeText(share);
    showToast("Public report link copied");
    return;
  }
  if (!currentUrl) return;
  const share = `${window.location.origin}/?url=${encodeURIComponent(currentUrl)}`;
  await navigator.clipboard.writeText(share);
  showToast("Share link copied");
});

document
  .querySelectorAll<HTMLButtonElement>("#scores-sort button")
  .forEach((btn) => {
    btn.addEventListener("click", () => {
      scoresSort = btn.dataset.sort || "top";
      scoresPage = 1;
      void loadScoresPage(true);
    });
  });

document
  .querySelectorAll<HTMLButtonElement>("#scores-grade button")
  .forEach((btn) => {
    btn.addEventListener("click", () => {
      scoresGrade = btn.dataset.grade || "all";
      scoresPage = 1;
      void loadScoresPage(true);
    });
  });

scoresSearch?.addEventListener("input", () => {
  window.clearTimeout(scoresSearchTimer);
  scoresSearchTimer = window.setTimeout(() => {
    scoresQuery = scoresSearch.value.trim();
    scoresPage = 1;
    void loadScoresPage(true);
  }, 250);
});

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  const link = target?.closest?.("a[href^='/scores'], a[href^='/r/']");
  if (!link) return;
  const href = link.getAttribute("href");
  if (!href) return;
  if (href === "/scores" || href.startsWith("/scores?")) {
    event.preventDefault();
    if (href.startsWith("/scores?")) {
      history.pushState({ view: "scores" }, "", href);
      readScoresStateFromUrl();
      showView("scores");
      void loadScoresPage(false);
      return;
    }
    goScores(true);
    return;
  }
  const match = href.match(/^\/r\/([^/?#]+)/);
  if (match) {
    event.preventDefault();
    void openPublicReport(decodeURIComponent(match[1]!));
  }
});

function routeFromLocation(push = false): void {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(window.location.search);

  if (path === "/scores") {
    readScoresStateFromUrl();
    showView("scores");
    void loadScoresPage(false);
    return;
  }

  const reportMatch = path.match(/^\/r\/([^/]+)$/);
  if (reportMatch) {
    void openPublicReport(decodeURIComponent(reportMatch[1]!), push);
    return;
  }

  const view = params.get("view");
  if (view === "report" && currentReport) {
    showView("results");
    return;
  }
  if (view === "check" && currentUrl) {
    showView("checking");
    return;
  }

  const bootUrl = params.get("url");
  if (bootUrl) {
    const normalized = normalizeDocsUrl(bootUrl);
    if (normalized) {
      if (urlInput) urlInput.value = normalized;
      void runScore(normalized);
      return;
    }
  }

  goLanding(false, push);
}

window.addEventListener("popstate", () => {
  routeFromLocation(false);
});

renderRuler(document.querySelector("#landing-ruler"), null);
routeFromLocation(false);
