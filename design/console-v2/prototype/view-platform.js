// Platform: server topology, delivery, backups.
window.VIEWS = window.VIEWS || {};

function cellTiles(cells) {
  const total = cells.reduce((s, c) => s + c.mib, 0);
  return `<div class="cells">${cells.map((c) => `
    <div class="cell ${c.state}" style="flex-grow:${c.mib}; flex-basis:${((c.mib / total) * 100).toFixed(1)}%" title="${c.name}">
      <span class="mono">${c.name}</span>
      <span class="cell-fill" style="height:${c.used ? Math.round((c.used / c.mib) * 100) : 0}%"></span>
      <span class="mono dim">${c.used ? `${fmt(c.used)} / ${fmt(c.mib)} Mio` : "déclarée"}</span>
    </div>`).join("")}</div>`;
}

Object.assign(VIEWS, {
  server() {
    const h = DATA.host;
    return `
    <header class="hero row">
      <div>
        <p class="eyebrow-date">${truth("obs", "rapport hôte il y a 40 s")}</p>
        <h1>${h.name}</h1>
        <p class="lede">Proxmox 9.2 · i5-13500, 14 cœurs / 20 threads · 62,57 Gio · ZFS miroir · en ligne depuis ${h.uptime}</p>
      </div>
    </header>

    <div class="two">
      <section class="card">
        <div class="card-head"><h2>Processeur · 24 h</h2><strong class="mono">${h.cpu} %</strong></div>
        ${areaChart(h.cpu24, { max: 100, threshold: 80, h: 120, xLabels: ["hier 10 h", "16 h", "22 h", "04 h", "maintenant"] })}
      </section>
      <section class="card">
        <div class="card-head"><h2>Mémoire · 24 h</h2><strong class="mono">${h.ram} %</strong></div>
        ${areaChart(h.ram24, { max: 100, threshold: 80, h: 120, xLabels: ["hier 10 h", "16 h", "22 h", "04 h", "maintenant"] })}
      </section>
    </div>

    <section class="card">
      <div class="card-head"><h2>Topologie</h2><span class="legend">largeur = mémoire allouée · remplissage = mémoire utilisée</span></div>
      <div class="topo">
        <div class="vm pro" style="flex-grow:32">
          <div class="vm-head">${envDot("ok")}<b class="mono">godseye-pro</b><span class="dim">32 Go · 8 vCPU</span><span class="mono">${h.vms[0].mem} %</span></div>
          ${cellTiles(h.cells)}
        </div>
        <div class="vm" style="flex-grow:16">
          <div class="vm-head">${envDot("ok")}<b class="mono">godseye-games</b><span class="dim">16 Go</span><span class="mono">41 %</span></div>
          <div class="cells"><div class="cell ok" style="flex-grow:1"><span class="mono">luanti</span><span class="cell-fill" style="height:41%"></span><span class="mono dim">30000/udp</span></div></div>
        </div>
        <div class="vm idle" style="flex-grow:6">
          <div class="vm-head">${envDot("decl")}<b class="mono">work</b><span class="dim">6 Go</span></div>
          <div class="cells"><div class="cell decl" style="flex-grow:1"><span class="mono">jetable</span><span class="mono dim">à l'arrêt</span></div></div>
        </div>
      </div>
    </section>

    <div class="three">
      <section class="card">
        <div class="card-head"><h2>Disques</h2></div>
        <div class="disk"><div class="disk-top"><b class="mono">nvme1n1</b><span class="pill-status danger">${envDot("danger")}Usure 126 %</span></div><div class="wear over"><span style="width:100%"></span></div><p class="dim small">Endurance dépassée, aucune erreur média. Remplacement à planifier.</p></div>
        <div class="disk"><div class="disk-top"><b class="mono">nvme0n1</b><span class="pill-status ok">${envDot("ok")}Usure 57 %</span></div><div class="wear"><span style="width:57%"></span></div></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Capacité engagée</h2></div>
        <div class="stack">
          <div><span class="label">Disques des VM</span>${meter(420, 472, "Gio", "decl")}</div>
          <div><span class="label">Mémoire des VM</span>${meter(54, 62.57, "Gio", "decl")}</div>
        </div>
        <p class="dim small mt-s">Au-delà de la règle des 80 % par exception acceptée le 16 nov.</p>
      </section>
      <section class="card">
        <div class="card-head"><h2>Réseau</h2></div>
        <dl class="kv compact">
          <div><dt>IPv4</dt><dd class="mono">65.108.38.218</dd></div>
          <div><dt>IPv6</dt><dd>${truth("decl", "AAAA non publié")}</dd></div>
          <div><dt>Admin</dt><dd>WireGuard · 2 pairs</dd></div>
          <div><dt>Mobile</dt><dd>${truth("unk", "aucune poignée de main")}</dd></div>
        </dl>
      </section>
    </div>`;
  },

  delivery() {
    const stageNames = ["Checkout", "Build", "Tests", "Scan"];
    return `
    <header class="hero row"><div><p class="eyebrow-date">Jenkins · contrôleur à 0 exécuteur</p><h1>Livraison</h1><p class="lede">Le job automatique suit <span class="mono">main</span>. Les candidats <span class="mono">develop</span> passent par le job manuel.</p></div>
      <div class="hero-actions"><button class="btn" data-sheet="generic" data-label="Lancer le job candidat">${icon("refresh", 14)}Job candidat</button></div></header>
    <section class="kpis">
      <div class="kpi"><span class="vital-label">Taux de réussite 14 j</span><strong class="mid">92<small>%</small></strong></div>
      <div class="kpi"><span class="vital-label">Durée médiane</span><strong class="mid">2<small>min 48 s</small></strong></div>
      <div class="kpi"><span class="vital-label">Build nocturne</span><strong class="mid">02:00</strong><span class="dim small">${truth("obs", "vert cette nuit")}</span></div>
      <div class="kpi"><span class="vital-label">Registre</span><strong class="mid">—</strong><span class="dim small">${truth("unk", "pas encore installé")}</span></div>
    </section>
    <section class="card flush">
      <ol class="builds">${DATA.builds.map((b) => `
        <li>
          <span class="mono b-n">${b.n}</span>
          <div><strong>${b.project}</strong><span class="mono dim">${b.commit} · ${b.when}</span></div>
          <div class="mini-stages">${b.stages.map((s, j) => `<span class="${s}">${stageNames[j]}</span>`).join("")}</div>
          <span class="mono dim">${b.dur}</span>
          <span class="pill-status ${b.result[0]}">${envDot(b.result[0])}${b.result[1]}</span>
        </li>`).join("")}
      </ol>
    </section>`;
  },

  backups() {
    return `
    <header class="hero row"><div><p class="eyebrow-date">pgBackRest 2.60 · Backblaze B2</p><h1>Sauvegardes</h1><p class="lede">Objectif : une copie hors site toutes les 24 h par stanza.</p></div></header>
    <section class="card flush">
      <div class="backup-row head"><span>Stanza</span><span>Copies B2 · 14 derniers jours</span><span>Dernière copie</span><span>Restauration tenue</span></div>
      ${DATA.backupsTable.map((b) => `
      <div class="backup-row">
        <span><b class="mono">${b.stanza}</b><span class="dim small">complète ${b.full} · diff. ${b.diff}</span></span>
        ${strip(b.strip)}
        <span class="${b.b2[0] === "danger" ? "danger-text" : ""}">${truth(b.b2[0], b.b2[1])}</span>
        <span class="dim">${b.restore}</span>
      </div>`).join("")}
    </section>
    <div class="callout unk">${icon("lock", 16)}<div><b>Activation de restauration bloquée</b><p class="dim">Le fournisseur pgBackRest ne sait pas encore promouvoir une copie tenue. Une restauration reste isolée, sans trafic ni effet externe.</p></div></div>`;
  },
});
