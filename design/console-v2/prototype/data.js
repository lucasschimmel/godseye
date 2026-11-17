// Fictional data for the prototype. Shapes loosely follow the real control API concepts.
const wave = (n, base, amp, seed = 1) =>
  Array.from({ length: n }, (_, i) => Math.max(0, base + amp * Math.sin(i / 2.3 + seed) + amp * 0.45 * Math.sin(i * 1.7 + seed * 3)));

window.DATA = {
  today: "Mardi 17 novembre",
  now: 10.1,
  vitals: {
    availability: "99,94",
    availabilityDays: [100, 100, 100, 99.8, 100, 100, 100, 100, 100, 99.2, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 99.9, 100, 100, 100, 100, 100, 100, 100],
    month: 7.58, ceiling: 40, projection: 13.4,
  },
  ribbon: [
    { h: 2, t: "02:00", label: "Build nocturne Jenkins vert", tone: "ok" },
    { h: 3, t: "03:00", label: "Sauvegardes complètes", tone: "ok" },
    { h: 5.2, t: "05:12", label: "Déploiement portfolio", tone: "ok" },
    { h: 7.17, t: "07:10", label: "Copie B2 portfolio en retard", tone: "danger" },
    { h: 9.25, t: "09:15", label: "Différentielle melvyn-prod", tone: "ok" },
    { h: 9.5, t: "09:30", label: "Effet inconnu melvyn-worker", tone: "unk" },
    { h: 16, t: "16:00", label: "Expiration preview pr-42", tone: "due" },
    { h: 21, t: "21:00", label: "Fenêtre d'arrêt proposée (Melvyn)", tone: "due" },
  ],
  decisions: [
    {
      id: "d1", kind: "Plan Hermes", icon: "hermes", scope: "melvyn · production",
      title: "Déplacer la base SQLite vers le volume persistant de la cellule",
      facts: ["4 étapes", "1 étape Codex", "0,40 $ max"], due: "expire dans 23 h",
      action: "Examiner", href: "#/hermes/t1",
    },
    {
      id: "d2", kind: "Preview", icon: "clock", scope: "portfolio · pr-42",
      title: "La preview pr-42 sera arrêtée à 16:00",
      facts: ["données synthétiques", "rien à purger"], due: "dans 6 h", urgent: true,
      action: "Prolonger 48 h", sheet: "extend",
    },
    {
      id: "d3", kind: "Livraison", icon: "rocket", scope: "shiplabs-web · production",
      title: "Release a3f9c1 prête à promouvoir",
      facts: ["build #118", "Trivy 0 critique", "smoke vert en dev"], due: "politique jusqu'au 17 déc.",
      action: "Promouvoir", sheet: "promote",
    },
  ],
  attention: [
    {
      tone: "unk", title: "Effet inconnu : redémarrage de melvyn-worker",
      detail: "La demande a peut-être atteint Docker. Réconciliation en lecture seule, aucune relance automatique.",
      when: "il y a 35 min", href: "#/p/melvyn/production",
    },
    {
      tone: "danger", title: "Copie hors site en retard",
      detail: "portfolio-prod : dernière copie B2 il y a 26 h, objectif 24 h.",
      when: "il y a 3 h", href: "#/platform/backups",
    },
  ],
  host: {
    name: "EX44 · HEL1-DC8", cpu: 31, ram: 71, disk: 64, uptime: "12 j 4 h",
    cpu24: wave(48, 28, 9, 1), ram24: wave(48, 69, 3, 2),
    vms: [
      { name: "godseye-pro", ram: 32, cpu: 38, mem: 74, state: "ok" },
      { name: "godseye-games", ram: 16, cpu: 12, mem: 41, state: "ok" },
      { name: "godseye-work", ram: 6, cpu: 0, mem: 8, state: "idle" },
    ],
    cells: [
      { name: "melvyn/production", mib: 1024, used: 412, state: "warn" },
      { name: "melvyn/développement", mib: 512, used: 188, state: "ok" },
      { name: "shiplabs-web/production", mib: 1024, used: 530, state: "ok" },
      { name: "shiplabs-web/développement", mib: 512, used: 140, state: "ok" },
      { name: "portfolio/production", mib: 256, used: 64, state: "ok" },
      { name: "portfolio/pr-42", mib: 256, used: 41, state: "ok" },
      { name: "rbx-intel/développement", mib: 512, used: 0, state: "decl" },
      { name: "plateforme", mib: 4096, used: 2150, state: "ok" },
    ],
  },
  running: [
    { title: "Erreurs 502 de portfolio", scope: "portfolio · production", step: "lit les journaux Caddy", n: 2, of: 3, spend: "0,04 $" },
    { title: "discord.js 15.2", scope: "melvyn · développement", step: "Codex · tests dans la VM de travail", n: 1, of: 2, spend: "0,18 $" },
  ],
  activity: [
    { actor: "Hermes", text: "a proposé un plan pour melvyn · production", when: "09:42" },
    { actor: "Système", text: "différentielle melvyn-prod terminée · 184 Mo", when: "09:15" },
    { actor: "Vous", text: "avez approuvé la politique de livraison de shiplabs-web", when: "08:51" },
    { actor: "Jenkins", text: "build #118 shiplabs-web vert en 3 min 12 s", when: "08:47" },
    { actor: "Système", text: "certificat portfolio.dev renouvelé", when: "06:02" },
  ],
  projects: [
    {
      slug: "melvyn", name: "Melvyn", kind: "Bot Discord", icon: "bot", repo: "lucasschimmel/Melvyn", state: ["warn", "Dégradé"],
      envs: [["production", "warn"], ["développement", "ok"]], deploy: "il y a 2 j", backup: ["obs", "il y a 41 min"],
      cost: "4,82 $", budget: 48, series: wave(14, 0.3, 0.12, 3),
    },
    {
      slug: "portfolio", name: "Portfolio", kind: "Site statique", icon: "globe", repo: "lucasschimmel/portfolio", state: ["ok", "Nominal"],
      envs: [["production", "ok"], ["développement", "ok"], ["pr-42", "decl"]], deploy: "il y a 5 h", backup: ["danger", "il y a 26 h"],
      cost: "0,61 $", budget: 12, series: wave(14, 0.05, 0.03, 5),
    },
    {
      slug: "shiplabs-web", name: "Ship Labs", kind: "Application Node", icon: "layers", repo: "shiplabs/web", state: ["ok", "Nominal"],
      envs: [["production", "ok"], ["développement", "ok"]], deploy: "hier", backup: ["obs", "il y a 1 h"],
      cost: "2,15 $", budget: 22, series: wave(14, 0.15, 0.08, 7),
    },
    {
      slug: "rbx-intel", name: "rbx-intel", kind: "API Node", icon: "cpu", repo: "lucasschimmel/rbx-intel", state: ["decl", "Non provisionné"],
      envs: [["développement", "decl"]], deploy: "jamais", backup: ["unk", "aucune"],
      cost: "0,00 $", budget: 0, series: Array(14).fill(0),
    },
  ],
  melvyn: {
    release: { image: "melvyn@sha256:4be1…c09d", commit: "a3f9c1", msg: "fix: guard empty guild cache on reconnect", when: "15 nov. · 21:04", by: "politique de livraison" },
    mem24: wave(48, 380, 40, 4),
    pipeline: [["Build #117", "done", "2 min 40 s"], ["Scan Trivy", "done", "0 critique"], ["Smoke dev", "done", "commandes OK"], ["Production", "unk", "redémarrage inconnu"]],
    guards: [
      ["obs", "Runtime runsc (gVisor systrap)", "inspecté il y a 4 min"],
      ["obs", "Racine en lecture seule, capacités retirées", "inspecté il y a 4 min"],
      ["obs", "Réseau de cellule isolé, IPv4 et IPv6", "sonde il y a 1 h"],
      ["decl", "Plafond CPU et mémoire de la cellule", "déclaré, pas appliqué par la plateforme"],
      ["unk", "Sortie réseau vers discord.com", "aucune liste d'autorisation qualifiée"],
    ],
    releases: [
      { commit: "a3f9c1", msg: "fix: guard empty guild cache on reconnect", when: "15 nov. 21:04", state: "En ligne", tone: "warn", stages: ["done", "done", "done", "unk"] },
      { commit: "9b20de", msg: "feat: /remind slash command", when: "12 nov. 18:30", state: "Remplacée", tone: "muted", stages: ["done", "done", "done", "done"] },
      { commit: "71c4aa", msg: "chore: bump discord.js 15.1", when: "9 nov. 10:12", state: "Remplacée", tone: "muted", stages: ["done", "done", "done", "done"] },
      { commit: "e0f913", msg: "feat: per-guild settings", when: "4 nov. 22:47", state: "Échec smoke", tone: "danger", stages: ["done", "done", "fail", "none"] },
    ],
    backups: [
      { kind: "Différentielle", when: "aujourd'hui 09:15", size: "184 Mo", where: "local + B2", truth: "obs" },
      { kind: "Différentielle", when: "hier 09:15", size: "176 Mo", where: "local + B2", truth: "obs" },
      { kind: "Complète", when: "dim. 03:00", size: "1,2 Go", where: "local + B2", truth: "obs" },
    ],
  },
  threads: {
    "À valider": [{ id: "t1", title: "SQLite vers le volume persistant", scope: "melvyn · prod", meta: "plan 7f3a9c", state: "needs" }],
    "En cours": [
      { id: "t2", title: "Erreurs 502 de portfolio", scope: "portfolio · prod", meta: "étape 2/3", state: "run" },
      { id: "t3", title: "discord.js 15.2", scope: "melvyn · dev", meta: "Codex", state: "run" },
    ],
    "Terminés": [
      { id: "t4", title: "Audit des dépendances", scope: "shiplabs-web · dev", meta: "hier", state: "done" },
      { id: "t5", title: "Pourquoi le build #116 a échoué", scope: "shiplabs-web · dev", meta: "14 nov.", state: "done" },
    ],
  },
  backupsTable: [
    { stanza: "melvyn-prod", full: "dim. 03:00", diff: "09:15", b2: ["obs", "il y a 41 min"], restore: "testée le 12 nov.", strip: ["ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok"] },
    { stanza: "portfolio-prod", full: "dim. 03:10", diff: "hier 09:20", b2: ["danger", "il y a 26 h"], restore: "jamais", strip: ["ok", "ok", "ok", "ok", "ok", "late", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "miss"] },
    { stanza: "shiplabs-prod", full: "dim. 03:20", diff: "08:30", b2: ["obs", "il y a 1 h"], restore: "testée le 15 nov.", strip: ["none", "none", "none", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok"] },
    { stanza: "plateforme", full: "dim. 02:40", diff: "08:00", b2: ["obs", "il y a 2 h"], restore: "testée le 16 nov.", strip: ["ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok"] },
  ],
  builds: [
    { n: "#118", project: "shiplabs-web", commit: "a3f9c1", dur: "3 min 12 s", when: "08:47", stages: ["done", "done", "done", "done"], result: ["ok", "Vert"] },
    { n: "#117", project: "melvyn", commit: "a3f9c1", dur: "2 min 40 s", when: "hier 20:58", stages: ["done", "done", "done", "done"], result: ["ok", "Vert"] },
    { n: "#116", project: "shiplabs-web", commit: "c81e07", dur: "1 min 05 s", when: "14 nov.", stages: ["done", "done", "fail", "none"], result: ["danger", "Échec tests"] },
    { n: "#115", project: "plateforme", commit: "5c4ad95", dur: "9 min 51 s", when: "13 nov.", stages: ["done", "done", "done", "done"], result: ["ok", "Vert"] },
  ],
  costs: {
    month: 7.58, ceiling: 40, projection: 13.4,
    byProject: [["Melvyn", 4.82, 10, "obs"], ["Ship Labs", 2.15, 10, "obs"], ["Portfolio", 0.61, 5, "est"], ["rbx-intel", 0, 5, "obs"]],
    bySource: [["Modèles Hermes", 3.94, "obs"], ["Codex", 2.71, "obs"], ["Claude Code", 0.93, "est"]],
    days: [[0.1, 0.02], [0.3, 0], [0.08, 0], [0.35, 0.06], [0.2, 0.02], [0.05, 0], [0, 0], [0.5, 0.1], [0.3, 0.05], [0.18, 0], [0.22, 0.05], [0.8, 0.1], [0.4, 0.04], [0.31, 0], [0.2, 0], [0.45, 0.07], [0.6, 0.06]],
  },
  journal: [
    ["Aujourd'hui", [
      ["09:42", "Hermes", "Plan", "a proposé le plan 7f3a9c (4 étapes) pour melvyn · production", "obs"],
      ["09:30", "Système", "Incident", "effet inconnu sur le redémarrage de melvyn-worker, réconciliation lancée", "unk"],
      ["09:15", "Système", "Données", "différentielle melvyn-prod · 184 Mo · copiée sur B2", "obs"],
      ["08:51", "Vous", "Accès", "politique de livraison shiplabs-web approuvée par passkey, expire le 17 déc.", "obs"],
      ["08:47", "Jenkins", "Livraison", "build #118 shiplabs-web vert, image a3f9c1", "obs"],
      ["07:10", "Système", "Incident", "copie hors site portfolio-prod en retard, notification Discord confirmée", "obs"],
      ["06:02", "Système", "Domaines", "certificat portfolio.dev renouvelé jusqu'au 15 février", "obs"],
    ]],
    ["Hier", [
      ["23:58", "Hermes", "Plan", "étape 3/3 terminée, rapport d'audit attaché (artefact texte)", "obs"],
      ["20:58", "Jenkins", "Livraison", "build #117 melvyn vert", "obs"],
      ["18:20", "Vous", "Accès", "passkey YubiKey 5C ajoutée", "obs"],
    ]],
  ],
};
