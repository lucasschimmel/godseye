// Shell: rail, hash router, command palette, step-up sheet, toast, theme, G-shortcuts.
window.STATE = { approved: false, approvedAt: "", accent: "ambre" };

/* ---------- accent trial (prototype only) ---------- */
const ACCENTS = {
  ambre: { label: "Ambre", dark: ["#f2b84b", "#1b1405"], light: ["#b5800f", "#ffffff"] },
  signal: { label: "Signal", dark: ["#ff7a3d", "#1a0a02"], light: ["#d9531a", "#ffffff"] },
  lime: { label: "Lime", dark: ["#c6f36b", "#121a04"], light: ["#5f8a12", "#ffffff"] },
  electrique: { label: "Électrique", dark: ["#6b8cff", "#050a1f"], light: ["#3557e0", "#ffffff"] },
  orchidee: { label: "Orchidée", dark: ["#e48be0", "#1d061c"], light: ["#b03aac", "#ffffff"] },
};
function applyAccent(name = STATE.accent) {
  const a = ACCENTS[name] ?? ACCENTS.ambre;
  STATE.accent = name in ACCENTS ? name : "ambre";
  const [accent, ink] = a[document.documentElement.dataset.theme === "light" ? "light" : "dark"];
  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty("--accent-ink", ink);
  try { localStorage.setItem("godseye-accent", STATE.accent); } catch { /* storage unavailable: keep in memory */ }
}
try { STATE.accent = localStorage.getItem("godseye-accent") ?? "ambre"; } catch { /* storage unavailable */ }

const NAV = [
  ["Pilotage", [["today", "Aujourd'hui", "#/", "A"], ["projects", "Projets", "#/projects", "P"], ["hermes", "Hermes", "#/hermes", "H"]]],
  ["Plateforme", [["server", "Serveur", "#/platform/server", "S"], ["delivery", "Livraison", "#/platform/delivery", "L"], ["backups", "Sauvegardes", "#/platform/backups", "B"]]],
  ["Suivi", [["costs", "Coûts", "#/costs", "C"], ["journal", "Journal", "#/journal", "J"]]],
];

function badgeFor(key) {
  if (key === "today") return [`${STATE.approved ? 2 : 3}`, "accent"];
  if (key === "projects") return ["1", "warn-dot"];
  if (key === "hermes") return STATE.approved ? ["3", "live"] : ["1", "accent"];
  if (key === "backups") return ["!", "danger"];
  return null;
}

function renderRail(active) {
  const h = DATA.host;
  document.getElementById("rail").innerHTML = `
    <a class="brand" href="#/">
      <span class="brand-mark"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="2.8" fill="currentColor"/></svg></span>
      <span class="brand-text">G.O.D.S.E.Y.E<small>plan de contrôle privé</small></span>
    </a>

    <a class="host-card" href="#/platform/server" title="Serveur dédié">
      <div class="hc-top"><span class="live-dot"></span><b>HEL1</b><span class="mono dim">EX44 · ${h.uptime}</span></div>
      <div class="hc-row"><span>CPU</span><i><b style="width:${h.cpu}%"></b></i><span class="mono">${h.cpu}</span></div>
      <div class="hc-row"><span>RAM</span><i><b style="width:${h.ram}%"></b></i><span class="mono">${h.ram}</span></div>
    </a>

    <button class="search" type="button" data-action="palette">${icon("search", 14)}<span>Rechercher, agir…</span><kbd>Ctrl K</kbd></button>

    <nav class="nav">${NAV.map(([group, items]) => `
      <p class="nav-group">${group}</p>
      ${items.map(([key, label, href, k]) => {
        const b = badgeFor(key);
        return `<a class="nav-item" href="${href}" ${key === active ? 'aria-current="page"' : ""}>
          <span class="nav-tile">${icon(key, 16)}</span><span class="nav-label">${label}</span>
          ${b ? `<span class="nav-badge ${b[1]}">${b[1] === "warn-dot" ? "" : b[0]}</span>` : ""}
          <kbd class="nav-kbd">G ${k}</kbd>
        </a>`;
      }).join("")}`).join("")}
    </nav>

    <a class="rail-hermes" href="#/hermes">
      <div class="rh-top">${hermesMark(22)}<b>Hermes</b><span class="dim">${STATE.approved ? 3 : 2} fils actifs</span></div>
      ${DATA.running.concat(STATE.approved ? [{ title: "SQLite vers le volume", n: 2, of: 4 }] : []).map((r) => `
        <div class="rh-row"><span>${r.title}</span><span class="steps-bar">${Array.from({ length: r.of }, (_, i) => `<i class="${i < r.n - 1 ? "done" : i === r.n - 1 ? "run" : ""}"></i>`).join("")}</span></div>`).join("")}
    </a>

    <div class="rail-foot">
      <a class="nav-item" href="#/settings" ${active === "settings" ? 'aria-current="page"' : ""}><span class="nav-tile">${icon("settings", 16)}</span><span class="nav-label">Réglages</span><kbd class="nav-kbd">G R</kbd></a>
      <div class="owner">
        ${ring(90, { size: 34, label: "LS", hot: false })}
        <div><b>Lucas</b><small>${icon("fingerprint", 11)}passkey il y a 3 min</small></div>
        <span class="mono dim session" title="Temps de session restant">7 h 12</span>
      </div>
    </div>`;
}

function parse() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [head, a, b, c] = parts;
  if (!head) return { key: "today", crumbs: ["Aujourd'hui"], html: VIEWS.today() };
  if (head === "projects") return { key: "projects", crumbs: ["Projets"], html: VIEWS.projects() };
  if (head === "p") {
    const p = DATA.projects.find((x) => x.slug === a) ?? DATA.projects[0];
    return { key: "projects", crumbs: [["Projets", "#/projects"], p.name, b ?? ""], html: VIEWS.project(a, b, c) };
  }
  if (head === "hermes") return { key: "hermes", crumbs: ["Hermes", "Fils"], html: VIEWS.hermes(a), wide: true };
  if (head === "platform" && VIEWS[a]) return { key: a, crumbs: ["Plateforme", { server: "Serveur", delivery: "Livraison", backups: "Sauvegardes" }[a]], html: VIEWS[a]() };
  if (VIEWS[head] && ["costs", "journal", "settings"].includes(head)) return { key: head, crumbs: [{ costs: "Coûts", journal: "Journal", settings: "Réglages" }[head]], html: VIEWS[head]() };
  return { key: "today", crumbs: ["Aujourd'hui"], html: VIEWS.today() };
}

function hydrateIcons(root) {
  root.querySelectorAll("i[data-icon]").forEach((el) => { el.outerHTML = icon(el.dataset.icon); });
}

function render() {
  const route = parse();
  renderRail(route.key);
  document.getElementById("crumbs").innerHTML = route.crumbs.filter(Boolean)
    .map((c) => (Array.isArray(c) ? `<a href="${c[1]}">${c[0]}</a>` : `<span>${c}</span>`)).join(`<span class="sep">${icon("chevronRight", 12)}</span>`);
  const view = document.getElementById("view");
  view.className = route.wide ? "wide" : "";
  view.innerHTML = route.html;
}

/* ---------- toast ---------- */
let toastTimer;
function toast(text) {
  const el = document.getElementById("toast");
  el.innerHTML = `${icon("check", 14)}<span>${text}</span>`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

/* ---------- step-up sheet ---------- */
const SHEETS = {
  approve: { kind: "Plan Hermes", title: "Approuver le plan 7f3a9c", rows: [["Périmètre", "melvyn · production"], ["Étapes", "4, dont 1 Codex et 1 clarification"], ["Réserve maximale", "0,40 $"], ["Effet en production", "étape 4 seulement, après votre réponse"], ["Hash", "7f3a9c2e…b81d"]], note: "Toute modification du plan invalide cette approbation.", reversible: "Les étapes 1 à 3 sont sans effet en production.", done: "Plan approuvé. Étape 1 lancée." },
  deploy: { kind: "Livraison", title: "Déployer Melvyn", rows: [["Environnement", "production"], ["Commit", "a3f9c1 · main"], ["Image", "déjà construite, scan 0 critique"], ["Retour arrière", "9b20de reste disponible"]], note: "La version actuelle reste en place si le smoke échoue.", reversible: "Réversible par retour arrière.", done: "Déploiement lancé." },
  promote: { kind: "Livraison", title: "Promouvoir shiplabs-web", rows: [["De", "développement"], ["Vers", "production"], ["Release", "a3f9c1 · build #118"], ["Migration", "aucune"]], note: "La politique de livraison autorise cette promotion jusqu'au 17 déc.", reversible: "Réversible par retour arrière.", done: "Promotion lancée." },
  extend: { kind: "Preview", title: "Prolonger la preview pr-42", rows: [["Projet", "portfolio"], ["Nouvelle expiration", "jeudi 19 nov. · 16:00"], ["Données", "synthétiques uniquement"]], note: "Sans prolongation, la preview est arrêtée et dépubliée ; rien n'est purgé sans nouvelle approbation.", reversible: "Réversible.", done: "Preview prolongée de 48 h." },
  rollback: { kind: "Livraison", title: "Revenir à 9b20de", rows: [["Projet", "melvyn · production"], ["Image", "conservée, déjà scannée"], ["Base de données", "inchangée, aucune migration entre les deux"]], note: "La version actuelle est conservée pour revenir en avant.", reversible: "Réversible.", done: "Retour arrière lancé." },
  restore: { kind: "Données", title: "Restaurer dans une cellule tenue", rows: [["Source", "melvyn-prod · différentielle 09:15"], ["Cible", "nouvelle cellule isolée et tenue"], ["Source conservée", "oui"]], note: "La cellule restaurée ne reçoit ni trafic ni effet externe tant que son activation n'est pas prouvée sûre.", reversible: "Sans effet sur la production.", done: "Restauration tenue lancée." },
};

function openSheet(kind, label) {
  const s = SHEETS[kind] ?? { kind: "Action", title: label ?? "Confirmer", rows: [["Action", label ?? "—"]], note: "Maquette.", reversible: "", done: "Fait." };
  const body = document.getElementById("sheet-body");
  body.innerHTML = `
    <div class="sheet-head"><span class="tile accent">${icon("fingerprint", 18)}</span><div><span class="dim small">${s.kind} · confirmation par passkey</span><h2 id="sheet-title">${s.title}</h2></div></div>
    <dl class="kv sheet-kv">${s.rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
    ${s.reversible ? `<p class="sheet-rev">${icon("rollback", 13)}${s.reversible}</p>` : ""}
    <p class="dim small">${s.note}</p>
    <div class="sheet-actions">
      <button class="btn ghost" data-close>Annuler</button>
      <button class="btn primary" data-confirm>${icon("fingerprint", 15)}Confirmer avec la passkey</button>
    </div>`;
  document.getElementById("sheet").hidden = false;
  body.querySelector("[data-confirm]").focus();
  body.querySelector("[data-close]").onclick = closeSheet;
  body.querySelector("[data-confirm]").onclick = (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>Touchez votre clé…`;
    setTimeout(() => {
      closeSheet();
      if (kind === "approve") {
        const now = new Date();
        STATE.approved = true;
        STATE.approvedAt = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        render();
      }
      toast(s.done);
    }, 1000);
  };
}
function closeSheet() { document.getElementById("sheet").hidden = true; }

/* ---------- command palette ---------- */
const COMMANDS = [
  ["Aller à", "Aujourd'hui", "#/", "today"], ["Aller à", "Projets", "#/projects", "projects"], ["Projet", "Melvyn · production", "#/p/melvyn/production", "bot"],
  ["Projet", "Portfolio · production", "#/p/portfolio/production", "globe"], ["Aller à", "Hermes", "#/hermes", "hermes"], ["Aller à", "Serveur", "#/platform/server", "server"],
  ["Aller à", "Sauvegardes", "#/platform/backups", "backups"], ["Aller à", "Coûts", "#/costs", "costs"], ["Aller à", "Journal", "#/journal", "journal"], ["Aller à", "Réglages", "#/settings", "settings"],
  ["Action", "Examiner le plan 7f3a9c", "#/hermes/t1", "key"], ["Action", "Déployer Melvyn…", "sheet:deploy", "rocket"], ["Action", "Prolonger la preview pr-42", "sheet:extend", "clock"],
  ["Action", "Nouveau fil Hermes", "toast:Maquette : nouveau fil, le périmètre est choisi en premier.", "plus"],
];
let paletteIndex = 0;
const paletteItems = () => {
  const q = document.getElementById("palette-input").value.trim().toLowerCase();
  return COMMANDS.filter(([, l]) => l.toLowerCase().includes(q));
};
function drawPalette() {
  const items = paletteItems();
  paletteIndex = Math.min(paletteIndex, Math.max(0, items.length - 1));
  document.getElementById("palette-list").innerHTML = items.length
    ? items.map(([k, l, , ic], i) => `<li data-i="${i}" class="${i === paletteIndex ? "on" : ""}"><span class="nav-tile">${icon(ic, 14)}</span><span>${l}</span><span class="dim small">${k}</span></li>`).join("")
    : '<li class="dim">Aucun résultat</li>';
}
function openPalette() {
  document.getElementById("palette").hidden = false;
  const input = document.getElementById("palette-input");
  input.value = "";
  paletteIndex = 0;
  drawPalette();
  input.focus();
}
function closePalette() { document.getElementById("palette").hidden = true; }
function runCommand(target) {
  closePalette();
  if (target.startsWith("sheet:")) openSheet(target.slice(6));
  else if (target.startsWith("toast:")) toast(target.slice(6));
  else location.hash = target;
}

/* ---------- events ---------- */
document.addEventListener("click", (e) => {
  const sw = e.target.closest(".switch");
  if (sw) { sw.classList.toggle("on"); sw.setAttribute("aria-pressed", sw.classList.contains("on")); return; }
  const t = e.target.closest("[data-sheet],[data-toast],[data-action]");
  if (t) {
    if (t.dataset.sheet) { e.preventDefault(); openSheet(t.dataset.sheet, t.dataset.label); }
    else if (t.dataset.toast) { e.preventDefault(); toast(t.dataset.toast); }
    else if (t.dataset.action === "palette") openPalette();
    else if (t.dataset.action === "theme") {
      const root = document.documentElement;
      root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
      applyAccent();
    } else if (t.dataset.action === "accent") {
      applyAccent(t.dataset.accent);
      render();
    }
    return;
  }
  const li = e.target.closest("#palette-list li[data-i]");
  if (li) runCommand(paletteItems()[Number(li.dataset.i)][2]);
  if (e.target.id === "palette") closePalette();
  if (e.target.id === "sheet") closeSheet();
});

let gPending = 0;
const G_TARGETS = { a: "#/", p: "#/projects", h: "#/hermes", s: "#/platform/server", l: "#/platform/delivery", b: "#/platform/backups", c: "#/costs", j: "#/journal", r: "#/settings" };
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
  if (e.key === "Escape") { closePalette(); closeSheet(); return; }
  const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName ?? "");
  if (document.getElementById("palette").hidden) {
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (gPending && Date.now() - gPending < 1200 && G_TARGETS[k]) { location.hash = G_TARGETS[k]; gPending = 0; return; }
    gPending = k === "g" ? Date.now() : 0;
    return;
  }
  const items = paletteItems();
  if (!items.length) return;
  if (e.key === "ArrowDown") { paletteIndex = (paletteIndex + 1) % items.length; drawPalette(); e.preventDefault(); }
  if (e.key === "ArrowUp") { paletteIndex = (paletteIndex - 1 + items.length) % items.length; drawPalette(); e.preventDefault(); }
  if (e.key === "Enter") runCommand(items[paletteIndex][2]);
});
document.getElementById("palette-input").addEventListener("input", () => { paletteIndex = 0; drawPalette(); });
window.addEventListener("hashchange", () => {
  if (location.hash.startsWith("#s-") || location.hash === "#decisions") return;
  render();
  document.getElementById("view").focus({ preventScroll: true });
  window.scrollTo(0, 0);
});

hydrateIcons(document);
applyAccent();
render();
