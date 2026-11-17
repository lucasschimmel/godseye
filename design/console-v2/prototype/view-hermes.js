// Hermes workspace: threads, conversation with inline plan, thread context.
window.VIEWS = window.VIEWS || {};

const THREAD_STATE_ICON = { needs: "key", run: "refresh", done: "check" };

function threadT1() {
  const approved = window.STATE?.approved;
  const steps = [
    ["hermes", "Hermes", "Inventorier l'usage SQLite et la taille du fichier", "lecture seule", "0,02 $"],
    ["delivery", "Codex", "Monter le volume et ajouter DATABASE_PATH", "patch sur une branche, tests dans la VM de travail", "0,25 $"],
    ["hermes", "Clarification", "Choisir la fenêtre d'arrêt du bot", "vous serez sollicité ; 21:00 proposé", "—"],
    ["rocket", "Hermes", "Copier la base, redémarrer, vérifier les commandes", "seul effet en production", "0,13 $"],
  ];
  const state = (i) => (!approved ? "" : i === 0 ? "done" : i === 1 ? "run" : "wait");
  return `
  <div class="msg owner"><span class="avatar sm">LS</span><div class="bubble"><p>Melvyn perd ses réglages de serveur à chaque redéploiement. Trouve pourquoi et propose une correction.</p></div><time class="dim">09:31</time></div>
  <div class="msg agent">
    ${hermesMark(26)}
    <div class="agent-body">
      <div class="agent-name"><b>Hermes</b><span class="dim">Opérateur · GPT-6 Luna</span></div>
      <details class="tool"><summary>${icon("tool", 13)}<span>a lu <b>214 lignes</b> de journaux de la cellule</span><span class="dim mono">0,3 s</span>${icon("chevron", 13)}</summary><pre class="mono">2026-11-15T21:04:11Z sqlite: opened ./data/melvyn.db (new file)\n2026-11-15T21:04:11Z settings: 0 guilds loaded</pre></details>
      <details class="tool"><summary>${icon("tool", 13)}<span>a inspecté la release <b>a3f9c1</b></span><span class="dim mono">0,1 s</span>${icon("chevron", 13)}</summary><pre class="mono">rootfs: read-only\nvolumes: none\nenv: PORT</pre></details>
      <p>La base SQLite est créée dans le système de fichiers éphémère du conteneur. Chaque déploiement repart d'un fichier vide, d'où la perte des réglages.</p>
      <p>Il faut un <b>volume persistant attaché à la cellule</b> et un chemin de base configurable. Voici un plan.</p>
      <time class="dim">09:42</time>
    </div>
  </div>
  <article class="plan ${approved ? "approved" : ""}">
    <header>
      <div class="plan-title"><span class="plan-tag">${icon("layers", 13)}Plan</span><strong>Déplacer SQLite vers le volume persistant</strong></div>
      <span class="mono dim">7f3a9c · melvyn · production</span>
    </header>
    <ol class="stepper">${steps.map(([ic, k, t, e, c], i) => `
      <li class="${state(i)}">
        <span class="step-node">${state(i) === "done" ? icon("check", 12) : `<span class="mono">${i + 1}</span>`}</span>
        <div class="step-body"><strong>${t}</strong><span class="dim"><span class="kind">${icon(ic, 12)}${k}</span>${e}</span></div>
        <span class="step-side mono dim">${approved ? { done: "terminé", run: "en cours", wait: "en attente" }[state(i)] : c}</span>
      </li>`).join("")}
    </ol>
    <footer>
      <div class="plan-budget"><span class="vital-label">Réserve maximale</span><strong class="mono">0,40 $</strong><span class="dim small">expire dans 23 h · aucune publication automatique</span></div>
      ${approved
        ? `<span class="approved-label">${icon("check", 14)}Approuvé par passkey à ${window.STATE.approvedAt}</span>`
        : `<div class="inline-actions"><button class="btn ghost" data-toast="Maquette : la demande de modification part dans le fil.">Modifier</button><button class="btn ghost">Refuser</button><button class="btn accent" data-sheet="approve">${icon("fingerprint", 15)}Approuver</button></div>`}
    </footer>
  </article>`;
}

function threadGeneric(th) {
  return `<div class="msg owner"><span class="avatar sm">LS</span><div class="bubble"><p>${th.title} : regarde ce qui se passe.</p></div><time class="dim">08:10</time></div>
  <div class="msg agent">${hermesMark(26)}<div class="agent-body"><div class="agent-name"><b>Hermes</b><span class="dim">Opérateur</span></div>
  <details class="tool"><summary>${icon("tool", 13)}<span>a lu les journaux de la cellule</span><span class="dim mono">0,4 s</span>${icon("chevron", 13)}</summary><pre class="mono">…</pre></details>
  <p>Travail en cours. L'étape active et la dépense sont visibles dans le contexte du fil.</p><time class="dim">08:12</time></div></div>`;
}

Object.assign(VIEWS, {
  hermes(threadId) {
    const all = Object.values(DATA.threads).flat();
    const th = all.find((x) => x.id === threadId) ?? all[0];
    const approved = window.STATE?.approved;
    return `
    <div class="hermes">
      <aside class="threads">
        <div class="threads-head">
          <h2>Hermes</h2>
          <button class="btn sm" data-toast="Maquette : nouveau fil, le périmètre est choisi en premier.">${icon("plus", 13)}Fil</button>
        </div>
        <div class="seg full"><a class="on">Fils</a><a data-toast="Maquette : exécutions de code (Codex, Claude Code).">Exécutions</a><a data-toast="Maquette : profils et plafonds d'outils.">Profils</a></div>
        <label class="thread-search">${icon("search", 14)}<input placeholder="Filtrer les fils" /></label>
        ${Object.entries(DATA.threads).map(([group, items]) => `
          <p class="group">${group}<span class="mono">${items.length}</span></p>
          <ul>${items.map((x) => {
            const s = x.id === "t1" && approved ? "run" : x.state;
            return `<li><a href="#/hermes/${x.id}" aria-current="${x.id === th.id ? "page" : "false"}" class="thread-item ${s}">
            <span class="t-icon">${icon(THREAD_STATE_ICON[s], 13)}</span>
            <span class="t-text"><strong>${x.title}</strong><span class="mono dim">${x.scope} · ${x.meta}</span></span></a></li>`;
          }).join("")}</ul>`).join("")}
      </aside>

      <section class="thread">
        <header class="thread-head">
          <div><h1>${th.title}</h1><div class="thread-meta"><span class="chip scope">${icon("projects", 12)}${th.scope}</span><span class="chip">Opérateur</span><span class="dim small">ouvert à 09:31</span></div></div>
          <div class="inline-actions"><button class="icon-btn" aria-label="Archiver" data-toast="Maquette : archive du fil.">${icon("backups", 15)}</button></div>
        </header>
        <div class="messages"><div class="messages-inner">${th.id === "t1" ? threadT1() : threadGeneric(th)}</div></div>
        <form class="composer" onsubmit="event.preventDefault()">
          <div class="composer-box">
            <textarea rows="2" placeholder="Répondre à Hermes ou demander une modification du plan…"></textarea>
            <div class="composer-bar">
              <div class="composer-chips">
                <span class="chip scope">${th.scope}</span>
                <span class="chip">${icon("tool", 12)}journaux</span>
                <span class="chip">${icon("tool", 12)}scratch</span>
                <span class="chip ghost">GPT-6 Luna</span>
              </div>
              <button class="btn primary sm" aria-label="Envoyer">Envoyer${icon("send", 13)}</button>
            </div>
          </div>
        </form>
      </section>

      <aside class="context">
        <section>
          <h3>Budget du fil</h3>
          <div class="budget-ring">${ring(14, { size: 64, label: "14 %" })}<div><strong class="mid mono">0,07 $</strong><span class="dim small">sur 0,50 $ réservés</span></div></div>
        </section>
        <section>
          <h3>Périmètre</h3>
          <dl class="kv compact">
            <div><dt>Projet</dt><dd class="mono">melvyn</dd></div>
            <div><dt>Env.</dt><dd class="mono">production</dd></div>
            <div><dt>Profil</dt><dd>Opérateur</dd></div>
            <div><dt>Session</dt><dd>${truth("obs", "passkey 3 min")}</dd></div>
          </dl>
        </section>
        <section>
          <h3>Outils de ce fil</h3>
          <ul class="switches">
            <li><span>Lire les journaux</span><button class="switch on" aria-pressed="true"></button></li>
            <li><span>Espace scratch</span><button class="switch on" aria-pressed="true"></button></li>
            <li><span>Publier un artefact</span><button class="switch" aria-pressed="false"></button></li>
          </ul>
          <p class="dim small">Plafond du profil : 5 outils. Ni shell, ni build.</p>
        </section>
        <section>
          <h3>Exécution liée</h3>
          <div class="exec">
            <div class="exec-top">${icon("delivery", 14)}<b>Codex</b><span class="pill-status ${approved ? "warn" : "decl"}">${envDot(approved ? "warn" : "decl")}${approved ? "en cours" : "pas lancée"}</span></div>
            <span class="mono dim">Melvyn @ a3f9c1 · VM de travail</span>
          </div>
        </section>
        <section>
          <h3>Artefacts</h3>
          <a class="artifact" href="#" data-toast="Maquette : téléchargement d'un artefact texte inerte.">${icon("file", 15)}<span><b class="mono">diagnostic-sqlite.txt</b><span class="dim">2 Ko · texte</span></span>${icon("download", 14)}</a>
        </section>
      </aside>
    </div>`;
  },
});
