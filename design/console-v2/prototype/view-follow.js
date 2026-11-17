// Follow-up views: costs, journal, settings.
window.VIEWS = window.VIEWS || {};

Object.assign(VIEWS, {
  costs() {
    const c = DATA.costs;
    const total = c.bySource.reduce((s, [, v]) => s + v, 0);
    return `
    <header class="hero row">
      <div><p class="eyebrow-date">Novembre · jour 17 sur 30</p><h1>${fmt(c.month, 2)} $ <span class="h1-dim">sur ${c.ceiling} $</span></h1>
        <p class="lede">${truth("est", `Projection fin de mois ${fmt(c.projection, 2)} $`)} · facturation fournisseur ${truth("unk", "non connectée")}</p></div>
      <div class="hero-actions"><div class="seg"><button class="on">Mois</button><button>30 j</button><button>Année</button></div></div>
    </header>

    <section class="card">
      <div class="card-head"><h2>Dépense quotidienne</h2><span class="legend"><span class="sw obs"></span>mesuré<span class="sw est"></span>estimé</span></div>
      ${stackedBars(c.days, c.days.length - 1)}
      <div class="bars-axis mono dim"><span>1 nov.</span><span>8 nov.</span><span>aujourd'hui</span></div>
    </section>

    <div class="two">
      <section class="card">
        <div class="card-head"><h2>Par source</h2></div>
        <div class="share">${c.bySource.map(([n, v, k], i) => `<span class="s${i} ${k}" style="width:${((v / total) * 100).toFixed(1)}%"></span>`).join("")}</div>
        <ul class="kv-list">${c.bySource.map(([n, v, k], i) => `<li><span><i class="sw s${i} ${k}"></i>${truth(k, n)}</span><span class="mono">${fmt(v, 2)} $</span></li>`).join("")}</ul>
      </section>
      <section class="card">
        <div class="card-head"><h2>Budgets par projet</h2></div>
        <div class="budgets">${c.byProject.map(([n, v, m, k]) => `
          <div class="budget">${ring(Math.round((v / m) * 100), { size: 48, label: `${Math.round((v / m) * 100)}` })}<div><b>${n}</b><span class="mono dim">${fmt(v, 2)} / ${m} $</span>${k === "est" ? `<span class="small">${truth("est", "estimé")}</span>` : ""}</div></div>`).join("")}
        </div>
      </section>
    </div>`;
  },

  journal() {
    const filters = ["Tout", "Plans", "Livraison", "Données", "Accès", "Incidents"];
    const actorTile = (a) => (a === "Hermes" ? hermesMark(24) : `<span class="avatar sm ${a === "Vous" ? "me" : ""}">${a === "Vous" ? "LS" : a === "Jenkins" ? "JK" : "SY"}</span>`);
    return `
    <header class="hero row"><div><p class="eyebrow-date">${truth("obs", "ancre exportée hors site il y a 3 h")}</p><h1>Journal</h1><p class="lede">Audit, opérations et incidents dans une seule chronologie.</p></div>
      <div class="hero-actions"><button class="btn" data-toast="Maquette : export signé du journal.">${icon("download", 14)}Exporter</button></div></header>
    <div class="toolbar">
      <div class="seg">${filters.map((f, i) => `<button class="${i === 0 ? "on" : ""}">${f}</button>`).join("")}</div>
      <label class="thread-search wide">${icon("search", 14)}<input placeholder="Projet, acteur, hash…" /></label>
    </div>
    ${DATA.journal.map(([day, rows]) => `
      <section class="day">
        <h2 class="day-title">${day}<span class="mono dim">${rows.length}</span></h2>
        <ol class="ledger">${rows.map(([w, a, k, t, tr]) => `
          <li class="${tr}">
            <time class="mono dim">${w}</time>
            <span class="ledger-node">${actorTile(a)}</span>
            <div><span class="ledger-line"><b>${a}</b> ${t}</span><span class="ledger-tags"><span class="tag">${k}</span>${truth(tr)}</span></div>
          </li>`).join("")}
        </ol>
      </section>`).join("")}`;
  },

  settings() {
    const sections = [
      ["Passkeys", "key", "Deux authentificateurs. Chaque action sensible demande une confirmation récente.", [["YubiKey 5C", "ajoutée hier · utilisée il y a 3 min", "obs"], ["Windows Hello · poste fixe", "ajoutée le 15 nov.", "obs"]], "Ajouter une passkey"],
      ["Sessions", "lock", "Sessions de 8 h au maximum, révocables.", [["Chrome · Windows", "cette session · expire dans 7 h 12", "obs"]], "Révoquer les autres"],
      ["Secrets et identités", "shield", "OpenBao 2.7.2. Aucun secret n'est affiché dans la console.", [["Jeton contrôleur", "à renouveler avant le 17 nov. 2027", "obs"], ["Identités de service", "6 actives, 0 expirée", "obs"]], "Ouvrir OpenBao"],
      ["Notifications", "bell", "Où arrivent les incidents quand la console est fermée.", [["Discord · #godseye", "dernier test confirmé le 16 nov.", "obs"], ["Heartbeat externe", "non configuré", "unk"]], "Tester"],
    ];
    return `
    <header class="hero"><p class="eyebrow-date">Compte propriétaire</p><h1>Réglages</h1></header>
    <div class="settings-layout">
      <nav class="settings-nav">${sections.map(([t, ic], i) => `<a class="${i === 0 ? "on" : ""}" href="#s-${i}">${icon(ic, 15)}${t}</a>`).join("")}</nav>
      <div class="settings-body">${sections.map(([t, ic, d, items, a], i) => `
        <section class="card" id="s-${i}">
          <div class="card-head"><div><h2>${t}</h2><p class="dim small">${d}</p></div><button class="btn sm" data-sheet="generic" data-label="${a}">${a}</button></div>
          <ul class="setting-items">${items.map(([n, m, k]) => `<li>${truth(k)}<div><b>${n}</b><span class="dim small">${m}</span></div></li>`).join("")}</ul>
        </section>`).join("")}
      </div>
    </div>`;
  },
});
