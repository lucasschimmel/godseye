// Small SVG/HTML chart helpers. Every chart answers a concrete question; none is decorative.
let chartSeq = 0;

const fmt = (n, d = 0) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

const TRUTH_LABEL = { obs: "observé", decl: "déclaré", unk: "inconnu", est: "estimé", danger: "en défaut" };
function truth(kind, text = "") {
  return `<span class="truth-wrap" title="${TRUTH_LABEL[kind] ?? kind}"><span class="truth ${kind}"></span>${text}</span>`;
}

// Area chart with optional ceiling line (dashed) and 80 % threshold band.
function areaChart(values, { h = 120, max = 100, ceiling = null, threshold = null, hot = false, xLabels = [] } = {}) {
  const id = `g${++chartSeq}`;
  const w = 600;
  const step = w / (values.length - 1);
  const y = (v) => h - (v / max) * (h - 8) - 2;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M${pts.join(" L")}`;
  const area = `${line} L${w},${h} L0,${h} Z`;
  const last = values[values.length - 1];
  const grid = [0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${w}" y1="${(h * f).toFixed(1)}" y2="${(h * f).toFixed(1)}" class="grid"/>`).join("");
  return `<figure class="area ${hot ? "hot" : ""}">
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img">
      <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" class="stop-a"/><stop offset="1" class="stop-b"/></linearGradient></defs>
      ${grid}
      ${threshold ? `<line x1="0" x2="${w}" y1="${y(threshold).toFixed(1)}" y2="${y(threshold).toFixed(1)}" class="thresh"/>` : ""}
      ${ceiling ? `<line x1="0" x2="${w}" y1="${y(ceiling).toFixed(1)}" y2="${y(ceiling).toFixed(1)}" class="ceiling"/>` : ""}
      <path d="${area}" fill="url(#${id})"/>
      <path d="${line}" class="line"/>
      <circle cx="${w}" cy="${y(last).toFixed(1)}" r="3.5" class="end"/>
    </svg>
    ${xLabels.length ? `<figcaption>${xLabels.map((l) => `<span>${l}</span>`).join("")}</figcaption>` : ""}
  </figure>`;
}

function spark(values, { max = Math.max(...values), hot = false } = {}) {
  const w = 120;
  const h = 32;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`).join(" ");
  return `<svg class="spark ${hot ? "hot" : ""}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}

// Ring gauge, used only for a value against a hard ceiling.
function ring(pct, { size = 44, label = "", hot = pct >= 80 } = {}) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(pct, 100) / 100);
  return `<span class="ring ${hot ? "hot" : ""}" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="${r}" class="track"/><circle cx="22" cy="22" r="${r}" class="value" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"/></svg>
    <span>${label}</span></span>`;
}

// Horizontal meter: observed fill, hatched remainder when the value is not observed.
function meter(used, max, unit, kind = "obs") {
  const pct = Math.round((used / max) * 100);
  const tone = pct >= 80 ? "hot" : "";
  return `<div class="meter ${tone} ${kind}">
    <div class="meter-bar"><span style="width:${Math.min(pct, 100)}%"></span><i style="left:80%"></i></div>
    <div class="meter-text">${truth(kind)}<span class="mono">${fmt(used, used % 1 ? 2 : 0)} / ${fmt(max, max % 1 ? 2 : 0)} ${unit}</span><span class="mono dim">${pct} %</span></div>
  </div>`;
}

// Day ribbon: past solid, future hatched, events as markers, "now" as a needle.
function dayRibbon(events, now) {
  const pos = (h) => `${((h / 24) * 100).toFixed(2)}%`;
  return `<div class="ribbon">
    <div class="ribbon-track">
      <span class="ribbon-past" style="width:${pos(now)}"></span>
      <span class="ribbon-future" style="left:${pos(now)}"></span>
      ${events.map((e) => `<span class="ribbon-ev ${e.tone}" style="left:${pos(e.h)}" tabindex="0"><b></b><em><span class="mono">${e.t}</span>${e.label}</em></span>`).join("")}
      <span class="ribbon-now" style="left:${pos(now)}"><em class="mono">${String(Math.floor(now)).padStart(2, "0")}:${String(Math.round((now % 1) * 60)).padStart(2, "0")}</em></span>
    </div>
    <div class="ribbon-axis mono">${[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => `<span style="left:${pos(h)}">${String(h).padStart(2, "0")}</span>`).join("")}</div>
  </div>`;
}

// Freshness strip: one cell per day; hatched when the expected copy is missing.
function strip(states) {
  return `<span class="strip">${states.map((s) => `<i class="${s}" title="${{ ok: "copie à l'heure", late: "copie en retard", miss: "aucune copie", none: "pas encore planifiée" }[s]}"></i>`).join("")}</span>`;
}

// Stacked daily bars: observed part solid, estimated part hatched.
function stackedBars(days, todayIndex) {
  const max = Math.max(...days.map(([o, e]) => o + e));
  return `<div class="bars">${days.map(([o, e], i) => `<div class="bar-col ${i === todayIndex ? "today" : ""}" title="${fmt(o + e, 2)} $">
      <span class="bar-est" style="height:${((e / max) * 100).toFixed(1)}%"></span>
      <span class="bar-obs" style="height:${((o / max) * 100).toFixed(1)}%"></span>
    </div>`).join("")}</div>`;
}

// Pipeline: ordered stages, the current one outlined, unknown ones hatched.
function pipeline(stages) {
  return `<ol class="pipeline">${stages.map(([label, state, note]) => `<li class="${state}"><span class="pip">${state === "done" ? icon("check", 12) : state === "fail" ? icon("x", 12) : ""}</span><div><strong>${label}</strong><span class="mono dim">${note}</span></div></li>`).join("")}</ol>`;
}
