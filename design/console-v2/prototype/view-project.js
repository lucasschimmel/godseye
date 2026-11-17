// Project detail: environment switch, tabs, and the three detailed tabs.
window.VIEWS = window.VIEWS || {};

const PROJECT_TABS = {
  "Aperçu"() {
    const m = DATA.melvyn;
    return `
    <section class="kpis">
      <div class="kpi"><span class="vital-label">Disponibilité 30 j</span><strong class="mid">99,1<small>%</small></strong><span class="dim small">2 redémarrages, 1 inconnu</span></div>
      <div class="kpi"><span class="vital-label">Mémoire</span><strong class="mid">412<small>/ 1 024 Mio</small></strong><span class="dim small">${truth("obs", "il y a 40 s")}</span></div>
      <div class="kpi"><span class="vital-label">Base PostgreSQL</span><strong class="mid">214<small>Mo</small></strong><span class="dim small">${truth("obs", "sauvegardée il y a 41 min")}</span></div>
      <div class="kpi ring-kpi">${ring(48, { label: "48 %" })}<div><span class="vital-label">Budget du mois</span><strong class="mid">4,82<small>/ 10 $</small></strong></div></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Chemin de la version en ligne</h2><span class="mono dim">${m.release.commit} · ${m.release.when}</span></div>
      ${pipeline(m.pipeline)}
      <div class="release-foot">
        <p><span class="mono">${m.release.commit}</span> ${m.release.msg}</p>
        <div class="inline-actions"><button class="btn sm" data-toast="Maquette : réconciliation en lecture seule relancée.">${icon("refresh", 13)}Réconcilier</button><button class="btn ghost sm" data-sheet="rollback">${icon("rollback", 13)}Revenir à 9b20de</button></div>
      </div>
    </section>

    <div class="two">
      <section class="card">
        <div class="card-head"><h2>Mémoire de la cellule · 24 h</h2><span class="legend"><span class="legend-line"></span>plafond 1 024 Mio</span></div>
        ${areaChart(m.mem24, { max: 1100, ceiling: 1024, h: 140, xLabels: ["hier 10 h", "16 h", "22 h", "04 h", "maintenant"] })}
      </section>
      <section class="card">
        <div class="card-head"><h2>Garde-fous</h2><span class="legend">3 observés · 1 déclaré · 1 inconnu</span></div>
        <ul class="guards">${m.guards.map(([k, t, d]) => `<li class="${k}">${truth(k)}<div><strong>${t}</strong><span class="dim">${d}</span></div></li>`).join("")}</ul>
      </section>
    </div>`;
  },

  "Déploiements"() {
    const stageNames = ["Build", "Scan", "Smoke", "Prod"];
    return `<section class="card flush">
      <div class="card-head pad"><h2>Releases</h2><span class="legend">Politique active jusqu'au 17 déc. : auto en dev, passkey en prod</span></div>
      <ol class="releases">${DATA.melvyn.releases.map((r, i) => `
        <li class="${r.tone}">
          <span class="commit-dot"></span>
          <div class="rel-main"><span class="mono">${r.commit}</span><strong>${r.msg}</strong><span class="dim small">${r.when}</span></div>
          <div class="mini-stages">${r.stages.map((s, j) => `<span class="${s}" title="${stageNames[j]}">${stageNames[j]}</span>`).join("")}</div>
          <span class="rel-state">${envDot(r.tone)}${r.state}</span>
          <span>${i > 0 && r.tone !== "danger" ? `<button class="btn ghost sm" data-sheet="rollback">${icon("rollback", 13)}Revenir</button>` : ""}</span>
        </li>`).join("")}
      </ol>
    </section>`;
  },

  "Données"() {
    return `
    <section class="kpis">
      <div class="kpi"><span class="vital-label">Taille</span><strong class="mid">214<small>Mo</small></strong><span class="dim small">WAL 48 Mo</span></div>
      <div class="kpi ring-kpi">${ring(20, { label: "4" })}<div><span class="vital-label">Connexions</span><strong class="mid">4<small>/ 20</small></strong></div></div>
      <div class="kpi"><span class="vital-label">Dernière copie hors site</span><strong class="mid">41<small>min</small></strong><span class="dim small">${truth("obs", "Backblaze B2")}</span></div>
      <div class="kpi"><span class="vital-label">RPO visé</span><strong class="mid">15<small>min</small></strong><span class="dim small">${truth("unk", "jamais mesuré")}</span></div>
    </section>
    <div class="two">
      <section class="card">
        <div class="card-head"><h2>Instance</h2><span class="mono dim">PostgreSQL 18.6</span></div>
        <dl class="kv">
          <div><dt>Placement</dt><dd>cellule dédiée, PGDATA et WAL séparés</dd></div>
          <div><dt>Rôles</dt><dd class="mono">app · migration · lecture</dd></div>
          <div><dt>Identité</dt><dd>${truth("obs", "OpenBao, rotation le 2 déc.")}</dd></div>
        </dl>
      </section>
      <section class="card">
        <div class="card-head"><h2>Copies B2 · 14 j</h2><button class="btn sm" data-sheet="restore">Restaurer dans une cellule tenue…</button></div>
        ${strip(DATA.backupsTable[0].strip)}
        <ul class="kv-list">${DATA.melvyn.backups.map((b) => `<li><span>${truth(b.truth, `${b.kind} · ${b.when}`)}</span><span class="mono dim">${b.size}</span></li>`).join("")}</ul>
      </section>
    </div>
    <section class="card">
      <div class="card-head"><h2>Fenêtre de récupération</h2><span class="legend">${truth("obs", "restaurable")}${truth("decl", "hors fenêtre")}</span></div>
      <div class="window">
        <div class="window-track"><span class="window-fill" style="left:42%"></span><span class="window-mark" style="left:42%"><em class="mono">complète · dim. 03:00</em></span><span class="window-mark now" style="left:99%"><em class="mono">maintenant</em></span></div>
        <div class="ribbon-axis mono"><span style="left:0">10 nov.</span><span style="left:42%">15 nov.</span><span style="left:100%">17 nov.</span></div>
      </div>
    </section>`;
  },

  stub(name) {
    return `<div class="empty"><span class="tile">${icon("layers", 18)}</span><strong>${name}</strong><span class="dim">Section non détaillée dans cette maquette.</span></div>`;
  },
};

Object.assign(VIEWS, {
  project(slug, env, tab) {
    const p = DATA.projects.find((x) => x.slug === slug) ?? DATA.projects[0];
    const currentEnv = env || p.envs[0][0];
    const tabs = [["Aperçu", "grid"], ["Déploiements", "rocket"], ["Données", "database"], ["Jobs", "clock"], ["Domaines", "globe"], ["Accès", "key"], ["Agents", "hermes"], ["Réglages", "settings"]];
    const t = tab || "Aperçu";
    const base = `#/p/${p.slug}/${encodeURIComponent(currentEnv)}`;
    return `
    <header class="project-hero">
      <div class="ph-id">
        <span class="tile lg">${icon(p.icon, 22)}</span>
        <div>
          <div class="ph-title"><h1>${p.name}</h1>${statusPill(p.state)}</div>
          <p class="lede"><span class="mono">${p.repo}</span><span class="sep-dot"></span>${p.kind}<span class="sep-dot"></span>déployé ${p.deploy}</p>
        </div>
      </div>
      <div class="hero-actions">
        <button class="btn" data-toast="Maquette : ouvre un fil Hermes limité à ${p.name} · ${currentEnv}.">${hermesMark(18)}Demander à Hermes</button>
        <button class="btn primary" data-sheet="deploy">${icon("rocket", 14)}Déployer</button>
      </div>
    </header>
    <div class="project-bar">
      <div class="seg env-seg" role="tablist" aria-label="Environnement">
        ${p.envs.map(([n, s]) => `<a role="tab" class="${n === currentEnv ? "on" : ""}" aria-selected="${n === currentEnv}" href="#/p/${p.slug}/${encodeURIComponent(n)}/${encodeURIComponent(t)}">${envDot(s)}${n}</a>`).join("")}
        <a class="add" href="#" data-toast="Maquette : création d'une preview depuis une PR.">${icon("plus", 13)}</a>
      </div>
      <nav class="tabs" aria-label="Sections du projet">
        ${tabs.map(([x, ic]) => `<a href="${base}/${encodeURIComponent(x)}" aria-current="${x === t ? "page" : "false"}">${icon(ic, 14)}${x}</a>`).join("")}
      </nav>
    </div>
    <div class="project-body">${p.slug === "melvyn" ? (PROJECT_TABS[t] ?? PROJECT_TABS.stub)(t) : PROJECT_TABS.stub(`${p.name} · ${t}`)}</div>`;
  },
});
