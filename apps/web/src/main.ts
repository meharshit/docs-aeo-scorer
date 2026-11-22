import {
  bandLabel,
  displayHost,
  normalizeDocsUrl,
  reportToMarkdown,
  toReport,
  type Report,
  type ScoreReport,
} from "./adapter.js";

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

type View = "landing" | "checking" | "results";

const landing = document.querySelector<HTMLElement>("#view-landing");
const checking = document.querySelector<HTMLElement>("#view-checking");
const results = document.querySelector<HTMLElement>("#view-results");
const progressLine = document.querySelector<HTMLElement>("#progress-line");
const progressFill = document.querySelector<HTMLElement>("#progress-line-fill");
const form = document.querySelector<HTMLFormElement>("#score-form");
const urlInput = document.querySelector<HTMLInputElement>("#docs-url");
const formError = document.querySelector<HTMLElement>("#form-error");
const toastEl = document.querySelector<HTMLElement>("#toast");

let currentUrl = "";
let currentReport: Report | null = null;
let toastTimer = 0;

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
  if (progressLine) progressLine.hidden = view !== "checking";
  scrollTop();
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "just now";
  const sec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
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

function renderResults(report: Report): void {
  currentReport = report;
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

async function runScore(url: string): Promise<void> {
  currentUrl = url;
  const host = displayHost(url);
  const checkingUrl = document.querySelector("#checking-url");
  const checkingError = document.querySelector<HTMLElement>("#checking-error");
  const tryAgain = document.querySelector<HTMLButtonElement>("#try-again");

  if (checkingUrl) checkingUrl.textContent = host;
  if (checkingError) {
    checkingError.hidden = true;
    checkingError.textContent = "";
  }
  if (tryAgain) tryAgain.hidden = true;

  const states = CHECKS.map(() => ({ state: "waiting" as LogState }));
  states[0]!.state = "running";
  renderCheckLog(states);
  setCheckingProgress(4);
  showView("checking");
  history.pushState({ view: "checking", url }, "", `/?view=check&url=${encodeURIComponent(url)}`);

  const started = Date.now();
  let pulse = window.setInterval(() => {
    const elapsed = Date.now() - started;
    const soft = Math.min(88, 4 + elapsed / 120);
    setCheckingProgress(soft);
  }, 200);

  try {
    const response = await fetch("/api/score", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const payload = (await response.json()) as ScoreReport & {
      error?: string;
      retryAfterSec?: number;
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
        if (i === 0) {
          s.state = "failed";
          (s as { error?: string }).error = msg;
        } else {
          s.state = "waiting";
        }
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
    states.forEach((s, i) => {
      s.state = "done";
      (s as { seconds?: number }).seconds = per + (i % 2);
    });
    renderCheckLog(states);
    setCheckingProgress(100);

    const report = toReport(payload);
    sessionStorage.setItem("aeo-last-report", JSON.stringify(report));
    renderResults(report);
    showView("results");
    history.replaceState(
      { view: "results", url },
      "",
      `/?view=report&url=${encodeURIComponent(url)}`,
    );
  } catch (error) {
    window.clearInterval(pulse);
    const msg = error instanceof Error ? error.message : "Score failed";
    states[0]!.state = "failed";
    (states[0] as { error?: string }).error = msg;
    for (let i = 1; i < states.length; i += 1) states[i]!.state = "waiting";
    renderCheckLog(states);
    setCheckingProgress(0);
    if (checkingError) {
      checkingError.hidden = false;
      checkingError.textContent = msg;
    }
    if (tryAgain) tryAgain.hidden = false;
  }
}

function goLanding(clear = false): void {
  showView("landing");
  history.pushState({ view: "landing" }, "", "/");
  if (clear && urlInput) {
    urlInput.value = "";
    urlInput.focus();
  }
  setFormError(null);
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

document.querySelector("#brand-home")?.addEventListener("click", () => {
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

document.querySelector("#nav-wotw")?.addEventListener("click", (event) => {
  event.preventDefault();
  showToast("World of Technical Writing link coming soon");
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
  if (!currentUrl) return;
  const share = `${window.location.origin}/?url=${encodeURIComponent(currentUrl)}`;
  await navigator.clipboard.writeText(share);
  showToast("Share link copied");
});

window.addEventListener("popstate", () => {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  if (view === "report" && currentReport) {
    showView("results");
    return;
  }
  if (view === "check" && currentUrl) {
    showView("checking");
    return;
  }
  showView("landing");
});

renderRuler(document.querySelector("#landing-ruler"), null);

const bootParams = new URLSearchParams(window.location.search);
const bootUrl = bootParams.get("url");
if (bootUrl) {
  const normalized = normalizeDocsUrl(bootUrl);
  if (normalized) {
    if (urlInput) urlInput.value = normalized;
    void runScore(normalized);
  }
}
