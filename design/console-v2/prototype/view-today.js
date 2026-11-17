// Today (decision inbox) and the project portfolio.
window.VIEWS = window.VIEWS || {};

const envDot = (state) => `<span class="dot ${state}"></span>`;
const statusPill = ([tone, label]) => `<span class="pill-status ${tone}">${envDot(tone)}${label}</span>`;

Object.assign(VIEWS, {
  today() {
    const approved = window.STATE?.approved;
    const decisions = DATA.decisions.filter((x) => !(approved && x.id === "d1"));
    const v = DATA.vitals;
    const h = DATA.host;
    return `
    <header class="hero row">
      <div>
        <p class="eyebrow-date">${DATA.today} · 10:06</p>
        <h1>${decisions.length} décisions vous attendent.</h1>
        <p class="lede">Un effet inconnu à réconcilier, une copie hors site en retard. Tout le reste est nominal.</p>
      </div>
      <div class="accent-trial" role="radiogroup" aria-label="Couleur primaire à tester">
        <span class="vital-label">Couleur primaire · essai</span>
        <div class="swatches">${Object.entries(ACCENTS).map(([key, a]) => `
          <button role="radio" aria-checked="${STATE.accent === key}" data-action="accent" data-accent="${key}" class="swatch ${STATE.accent === key ? "on" : ""}" title="${a.label}">
            <i style="background:${a[document.documentElement.dataset.theme === "light" ? "light" : "dark"][0]}"></i><span>${a.label}</span>
          </button>`).join("")}
        </div>
      </div>
    </header>

    <section class="vitals">
      <a class="vital accent" href="#decisions">
        <span class="vital-label">À décider</span>
        <strong class="big">${decisions.length}</strong>
        <span class="vital-foot">la plus urgente <b>dans 6 h</b></span>
      </a>
      <div class="vital">
        <span class="vital-label">Disponibilité 30 j</span>
        <strong class="big">${v.availability}<small>%</small></strong>
        <span class="avail">${v.availabilityDays.map((d) => `<i class="${d < 100 ? "dip" : ""}" style="height:${d < 100 ? 45 : 100}%"></i>`).join("")}</span>
      </div>
      <div class="vital">
        <span class="vital-label">Coût de novembre</span>
        <strong class="big">${fmt(v.month, 2)}<small>$</small></strong>
        <div class="progress"><span style="width:${(v.month / v.ceiling) * 100}%"></span><i style="left:${(v.month / v.ceiling) * 100}%;width:${((v.projection - v.month) / v.ceiling) * 100}%" title="projection"></i></div>
        <span class="vital-foot">${truth("est", `projection ${fmt(v.projection, 2)} $ sur ${v.ceiling} $`)}</span>
      </div>
      <a class="vital" href="#/platform/server">
        <span class="vital-label">Serveur · 24 h</span>
        <strong class="big">${h.cpu}<small>% CPU</small></strong>
        ${spark(h.cpu24, { max: 100 })}
        <span class="vital-foot">mémoire <b>${h.ram} %</b> · disques engagés <b class="warn-text">89 %</b></span>
      </a>
    </section>

    <section class="card ribbon-card">
      <div class="card-head"><h2>Aujourd'hui</h2><span class="legend">${truth("obs", "passé observé")}${truth("decl", "prévu")}</span></div>
      ${dayRibbon(DATA.ribbon, DATA.now)}
    </section>

    <div class="today-grid">
      <div class="col">
        <section class="card" id="decisions">
          <div class="card-head"><h2>À décider</h2><span class="count-pill">${decisions.length}</span></div>
          <ul class="decisions">${decisions.map((x) => `
            <li class="decision ${x.urgent ? "urgent" : ""}">
              <span class="tile">${icon(x.icon, 17)}</span>
              <div class="decision-main">
                <div class="decision-meta"><span>${x.kind}</span><span class="mono dim">${x.scope}</span></div>
                <strong>${x.title}</strong>
                <div class="facts">${x.facts.map((f) => `<span>${f}</span>`).join("")}<span class="due ${x.urgent ? "urgent" : ""}">${icon("clock", 12)}${x.due}</span></div>
              </div>
              <div class="decision-actions">
                <button class="btn ghost sm" data-toast="Maquette : reporter masque l'élément jusqu'à demain 9 h.">Plus tard</button>
                ${x.href ? `<a class="btn accent" href="${x.href}">${x.action}${icon("arrow", 14)}</a>` : `<button class="btn accent" data-sheet="${x.sheet}">${x.action}</button>`}
              </div>
            </li>`).join("")}
          </ul>
        </section>

        <section class="card">
          <div class="card-head"><h2>À surveiller</h2></div>
          <ul class="watch">${DATA.attention.map((x) => `
            <li><a href="${x.href}" class="watch-item ${x.tone}">
              <span class="tile ${x.tone}">${icon(x.tone === "unk" ? "refresh" : "alert", 16)}</span>
              <div><strong>${x.title}</strong><p>${x.detail}</p></div>
              <time class="dim">${x.when}</time>
            </a></li>`).join("")}
          </ul>
        </section>
      </div>

      <div class="col">
        <section class="card">
          <div class="card-head"><h2>Hermes travaille</h2><a href="#/hermes" class="link">Fils ${icon("arrowUpRight", 13)}</a></div>
          <ul class="running">${DATA.running.map((r) => `
            <li>
              <div class="running-top"><strong>${r.title}</strong><span class="mono dim">${r.spend}</span></div>
              <span class="mono dim">${r.scope}</span>
              <div class="steps-bar">${Array.from({ length: r.of }, (_, i) => `<i class="${i < r.n - 1 ? "done" : i === r.n - 1 ? "run" : ""}"></i>`).join("")}</div>
              <span class="dim small">Étape ${r.n}/${r.of} · ${r.step}</span>
            </li>`).join("")}
          </ul>
        </section>
        <section class="card">
          <div class="card-head"><h2>Projets</h2><a href="#/projects" class="link">Tous ${icon("arrowUpRight", 13)}</a></div>
          <div class="mini-projects">${DATA.projects.map((p) => `
            <a href="#/p/${p.slug}/${encodeURIComponent(p.envs[0][0])}">
              <span class="tile sm">${icon(p.icon, 14)}</span>
              <span class="mp-name">${p.name}</span>
              <span class="mp-envs">${p.envs.map(([, s]) => envDot(s)).join("")}</span>
              <span class="mono dim">${p.cost}</span>
            </a>`).join("")}
          </div>
        </section>
        <section class="card">
          <div class="card-head"><h2>Activité</h2><a href="#/journal" class="link">Journal ${icon("arrowUpRight", 13)}</a></div>
          <ol class="activity">${DATA.activity.map((a) => `<li><time class="mono dim">${a.when}</time><span><b>${a.actor}</b> ${a.text}</span></li>`).join("")}</ol>
        </section>
      </div>
    </div>`;
  },

  projects() {
    return `
    <header class="hero row">
      <div>
        <p class="eyebrow-date">Portefeuille</p>
        <h1>Projets</h1>
        <p class="lede">4 projets, 8 environnements isolés, 7,58 $ ce mois-ci.</p>
      </div>
      <div class="hero-actions">
        <div class="seg"><button class="on" aria-label="Grille">${icon("grid", 14)}</button><button aria-label="Liste" data-toast="Maquette : vue liste dense.">${icon("list", 14)}</button></div>
        <button class="btn primary" data-toast="Maquette : la création de projet s'ouvre dans une feuille.">${icon("plus", 15)}Nouveau projet</button>
      </div>
    </header>
    <div class="project-grid">
      ${DATA.projects.map((p) => `
      <a class="card project-card ${p.state[0]}" href="#/p/${p.slug}/${encodeURIComponent(p.envs[0][0])}">
        <div class="pc-head">
          <span class="tile">${icon(p.icon, 17)}</span>
          <div><strong>${p.name}</strong><span class="mono dim">${p.repo}</span></div>
          ${statusPill(p.state)}
        </div>
        <div class="pc-envs">${p.envs.map(([n, s]) => `<span class="env ${s}">${envDot(s)}${n}</span>`).join("")}</div>
        <div class="pc-chart">${spark(p.series.some((x) => x) ? p.series : [0, 0], { max: 0.5 })}<span class="dim small">coût quotidien, 14 j</span></div>
        <dl class="pc-stats">
          <div><dt>Déploiement</dt><dd>${p.deploy}</dd></div>
          <div><dt>Sauvegarde</dt><dd class="${p.backup[0] === "danger" ? "danger-text" : ""}">${truth(p.backup[0], p.backup[1])}</dd></div>
          <div><dt>30 j</dt><dd class="mono">${p.cost}</dd></div>
        </dl>
      </a>`).join("")}
      <button class="card project-card new" data-toast="Maquette : la création de projet s'ouvre dans une feuille.">
        <span class="tile">${icon("plus", 18)}</span><strong>Nouveau projet</strong><span class="dim small">Cellule, base, identité et jobs réservés ensemble</span>
      </button>
    </div>`;
  },
});
