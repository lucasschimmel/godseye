# Guide propriétaire : ce que l'assistant ne peut pas faire seul

Rédigé le 2026-11-16 à partir des runbooks (`openbao-custody.md`, `break-glass.md`, `host-operations.md`), du ledger d'exécution, des scripts `infra/dedicated-server/` et des guides `docs/development/`. Les écarts correspondants sont dans l'[inventaire complet](../reviews/2026-11-16-full-gap-inventory.md).

**Règle commune.** Aucun secret dans le chat. Les valeurs secrètes se tapent dans une invite silencieuse (`read -rs`), un gestionnaire de mots de passe ou la console. À l'assistant on ne renvoie que des identifiants publics (empreintes, clés publiques, IDs numériques) ou un « fait ».

## Checklist ordonnée

1. Choisir la capacité (A, B ou C, point 1), puis confirmer la topologie dans la console.
2. Copier le mot de passe restic hors du PC (point 3).
3. Régler GitHub : facturation Actions ou visibilité du dépôt (point 5).
4. Laptop et mobile : WireGuard, SSH, interface Proxmox ; TOTP Proxmox ; clé d'urgence hors ligne (point 4).
5. Clés B2 par préfixe et règle lifecycle (point 3).
6. OpenBao : redistribuer les parts, répéter le déverrouillage, créer les identités, révoquer le jeton racine (point 2).
7. Canal d'alerte, test d'arrivée, heartbeat (point 5).
8. GitHub App et identifiants du registre (point 6).
9. Décisions : VM de code et IPv6 (points 7 et 8).
10. Fenêtre de reboot complet de l'hôte, toi présent (point 9).
11. Projets réels et jeu de référence (point 10).
12. Ensuite les points « avant soak » (11 à 14) et les options (15 à 17).

---

## BLOQUANT pour le soak

### 1. Capacité, ZFS et topologie (décision)
- **Constat.** Disques provisionnés 420 GiB + quota de sauvegarde 60 GiB = 480 GiB sur un pool de 472 GiB (101,7 %). RAM engagée 63 488 sur 64 076 MiB (99,1 %). La règle des 80 % est violée.
- **Options.**
  - **A (recommandée par le ledger).** Enregistrer une exception de thin-provisioning tant que l'espace réellement alloué reste sous 50 % du pool (~236 GiB). Conditions : alerte à 70 % (déjà en place), refus de nouvelles cellules au-dessus de 60 %, quota de sauvegarde ≤ 60 GiB, plafonds `p12-cell-ceilings.sh` sur les cellules. Le coding runner reste sur `godseye-work`, sans VM dédiée.
  - **B. VM de code dédiée.** RAM pro 24, games 8, work 6, coding 8 GiB (79,9 %), disque engagé 500 GiB. Impose une reconstruction ZFS planifiée, sauvegardée et testée.
  - **C. Statu quo sans exception.** Le gel est bloqué.
- Réduire le quota de sauvegarde à 40 GiB seul ne suffit pas (460/472 = 97,5 %). Le miroir `rpool` est conservé ; un layout hybride exige une reconstruction depuis les sauvegardes.
- **Étapes.** Réponds « A », « B » ou « C » à l'assistant. Puis dans la console : **Infrastructure**, section **Inventaire souhaité**, **Déclarer la topologie souhaitée**. Le formulaire est prérempli avec les valeurs du serveur : **Confirmer mon identité** (passkey), relis hôte, VM pro et jeux, case « VM tâche jetable », pool 472 GiB, pools IPv4 et IPv6, enregistre, puis **Actualiser les mesures**.
- **Vérification.** L'assistant lit `/infrastructure` et recoupe avec `zfs list` et `qm config`.

### 2. OpenBao : identité du contrôleur, jeton racine, parts, déverrouillage
- **Pourquoi bloqué.** Les parts de déverrouillage (3 parts, seuil 2) ne sont que chez toi. L'assistant ne doit ni les voir ni les manipuler.
- **État.** Fichier d'init supprimé de la VM (sur ta déclaration, non revérifié). Révocation du jeton racine non prouvée. `bao.auth` absent : la page Accès affiche `no_authority`. Aucune répétition de déverrouillage.
- **Vigilance.** Tu travailles à distance : au moins 2 parts doivent être accessibles depuis le laptop, sinon un reboot n'est pas récupérable à distance.

**a) Jeton racine temporaire** (sur la VM pro, via WireGuard) :
```
ssh -t root@10.20.1.10
set +o history; export BAO_ADDR=https://127.0.0.1:8200 BAO_CACERT=/etc/openbao/bao.crt
bao operator generate-root -init        # note Nonce et OTP
bao operator generate-root              # part 1 (silencieux), puis refaire avec la part 2
bao operator generate-root -decode=<Encoded Token> -otp=<OTP>   # jeton temporaire
```

**b) AppRoles.** Le jeton temporaire est demandé à l'invite silencieuse :
```
ssh -t godseye-pro "sudo bash /opt/godseye/infra/dedicated-server/p12-openbao-owner-setup.sh /opt/godseye/infra/dedicated-server/templates"
```
Crée les AppRoles `godseye-bindings-render` et `godseye-snapshot`. L'assistant lance ensuite `p12-install-snapshots.sh` pour activer le timer de snapshot raft.

**c) Identité du contrôleur (`bao.auth`).** Le contrôleur reçoit un jeton dont la seule politique est `godseye-broker-v1` (périodique 720 h, renouvelé chaque semaine par un timer). Le script écrit la politique compilée, crée le jeton, arrête le contrôleur, installe `bao.auth` par la CLI du dépôt, redémarre le contrôleur et installe le timer de renouvellement :
```
ssh -t godseye-pro "sudo bash /opt/godseye/infra/dedicated-server/p13-openbao-controller-identity.sh identity"
```

**d) Révocation du jeton racine** (avec le même jeton temporaire ; le script prouve ensuite que OpenBao le refuse) :
```
ssh -t godseye-pro "sudo bash /opt/godseye/infra/dedicated-server/p13-openbao-controller-identity.sh revoke-admin"
```

**e) Redistribution des parts :** `bao operator rekey -init -key-shares=3 -key-threshold=2` (puis 2 anciennes parts avec le nonce). Une part dans le gestionnaire de mots de passe, une sur clé USB chiffrée, une sur papier au coffre. Détruis les anciennes.

**f) Répétition de déverrouillage.** L'assistant redémarre `openbao` sur la VM : le service passe en sealed, l'edge, la console et l'API sont indisponibles quelques minutes. Depuis le laptop, deux fois avec deux parts différentes :
```
ssh -t root@10.20.1.10 "read -rs -p 'part: ' S; echo; BAO_ADDR=https://127.0.0.1:8200 BAO_CACERT=/etc/openbao/bao.crt bao operator unseal \"\$S\""
```
Renvoie « OK » et l'heure. L'assistant vérifie `Sealed false`, redémarre l'edge et l'API, puis lance `p12-post-reboot-check.sh`. Le dossier d'état doit être sauvegardé avec la base, y compris `owner/identity.key` et `owner/bao.auth`.

### 3. Sauvegardes Backblaze
- **a) Escrow du mot de passe restic.** Sans lui, les copies hors site sont illisibles après la perte de l'hôte. Dans PowerShell sur le PC :
  ```
  $f="$HOME\godseye-restic-password.txt"; scp godseye-wg:/etc/godseye/restic-password $f; icacls $f /inheritance:r /grant:r "${env:USERNAME}:(R)"
  ```
  Déplace le fichier dans le gestionnaire de mots de passe, imprime une copie papier, puis supprime-le du PC.
- **b) Clés dédiées** (le ledger accepte le risque R-P06b tant que la clé est partagée). Backblaze : *App Keys > Add a New Application Key*. `godseye-host-restic` : bucket `godseye-backups-dab6e7328bfc` uniquement, préfixe `host/`, lecture et écriture ; prévoir aussi une clé pour `pgbackrest/` et une pour `cells/`. Puis `ssh -t godseye-wg bash h08-offhost-credentials.sh` (l'assistant a copié le dossier `host/` avant) avec saisie silencieuse de l'id et de la clé. Il n'existe pas d'équivalent de `h08` pour `pgbackrest/` et `cells/` : l'assistant prépare un script à invite silencieuse.
- **c) Lifecycle.** Bucket > *Lifecycle Settings* > « Keep only the last version of the file ». La clé applicative ne peut ni lire ni écrire cette règle (entrée 023). Optionnel : Object Lock par défaut sur `host/`.
- **Renvoyer.** Le préfixe et « stocké », jamais la clé.
- **Vérification.** `h13-offhost-restore-drill.sh`, `p13-b2-retention-check.sh`, `/var/lib/godseye/status/offhost-backup.json`.

### 4. Accès de secours : WireGuard, clé d'urgence, TOTP
- **WireGuard laptop et mobile.** Seul l'appareil génère sa paire de clés (laptop : *Ajouter un tunnel vide* ; téléphone : *Créer à partir de zéro*). Adresses : laptop `10.20.0.11`, mobile `10.20.0.12`, en `/32`. Peer : clé publique du serveur (l'assistant te la donne), endpoint `65.108.38.218:51820`, AllowedIPs comme sur le poste fixe. Envoie à l'assistant uniquement la **clé publique** de chaque appareil ; il la pose avec `h10-replace-wg-peer.sh <adresse> <clé publique>`.
  - Test (`break-glass.md` §5), poste fixe éteint : ping `10.20.0.1`, `ssh root@10.20.0.1`, `https://10.20.0.1:8006`. Mobile : même test en 4G. Renvoie date, appareil et résultat.
- **Clé d'urgence SSH** (`godseye-emergency-rescue`). Vérifie que la partie privée existe ailleurs que sur le PC (gestionnaire de mots de passe, clé USB chiffrée) et que la clé publique est enregistrée dans Hetzner Robot (*Key management*, onglet *Rescue* du serveur). Renvoie l'empreinte (`ssh-keygen -lf`) et « enregistrée ».
- **TOTP Proxmox.** `https://10.20.0.1:8006` > Datacenter > Permissions > *Two Factor* > Add > TOTP pour `lucas@pve` (et `root@pam` si utilisé). Range les codes de secours dans le gestionnaire de mots de passe.
- **Vérification.** `wg show wg0` (handshakes récents), `pveum user list`.

### 5. Canal d'alerte, heartbeat, GitHub Actions
- **Canal d'alerte.** Il faut un récepteur HTTPS public, port 443, nom DNS public (pas d'IP, pas de `.local`), répondant 2xx. Le corps est `{"source":"godseye", ...}` avec les en-têtes `Idempotency-Key` et, si un secret est défini, `X-Godseye-Timestamp` et `X-Godseye-Signature: v1=<HMAC-SHA256>`. Les webhooks entrants de Slack, Discord ou Telegram attendent un JSON précis et refuseront probablement ce corps (à vérifier). Options simples : **ntfy.sh** (topic au nom aléatoire long, URL `https://ntfy.sh/<topic>`, appli sur le téléphone) ou **healthchecks.io** (URL `https://hc-ping.com/<uuid>/fail`). Ne pas auto-héberger le récepteur sur le serveur surveillé.
  - Dans la console : **Observabilité et incidents**, **Canaux webhook du propriétaire**, **Confirmer mon identité**, remplis Nom, Adresse https et Secret de signature (facultatif, 16 caractères minimum), **Ajouter le canal**, puis **Envoyer un test d'arrivée**. Attendu : « Test confirmé : … HTTP 2xx » **et** une notification réellement reçue sur le téléphone (le 2xx seul ne prouve pas qu'un humain est prévenu). Renvoie le nom du canal et « reçu sur téléphone », jamais l'URL.
- **Heartbeat externe.** Aucun script heartbeat n'existe dans le dépôt : l'assistant doit l'écrire. De ton côté : compte healthchecks.io, check « godseye-host » (période 30 min, grâce 30 min) relié à ton email ou Telegram, puis `ssh -t godseye-wg 'umask 077; read -rs U; printf %s "$U" > /etc/godseye/heartbeat-url'`. Vérification : l'assistant coupe le ping, l'alerte doit arriver.
- **GitHub Actions.** Le workflow `external-observer.yml` est bloqué par un échec de paiement (entrée 020). Deux voies :
  - **Facturation** : Settings > Billing and plans > Payment information, puis Spending limits (Actions). Ensuite `gh workflow run external-observer.yml --ref main`.
  - **Dépôt public** (c'est déjà le cas aujourd'hui) : les minutes Actions sont gratuites. Repasser en privé arrêterait Actions et l'observateur. Sur un dépôt public, GitHub désactive les workflows planifiés après 60 jours sans activité. Le dépôt contient l'IP publique, des empreintes SSH et des numéros de série : décide quoi anonymiser, l'assistant peut lancer un scan de secrets sur l'historique.
  - Active aussi l'email d'échec Actions (Settings > Notifications).

### 6. GitHub App et registre (livraison)
- **GitHub App.** Settings > Developer settings > GitHub Apps > New GitHub App. Webhook URL `https://godseye.lucasschimmel.fr/hooks/github`, content type `application/json`. Secret : `[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))` (PowerShell 7), à ranger dans le gestionnaire de mots de passe. Permissions dépôt (lecture seule, ce que le code demande dans `github-app-auth.ts`) : Contents (read), Pull requests (read), Metadata (read), rien d'autre ; événements Push et Pull request. Installation sur le seul dépôt `lucasschimmel/godseye`. Génère la clé privée `.pem` et garde-la hors du chat et du dépôt.
- **Stockage.** Le secret webhook et la `.pem` vont dans OpenBao. Aucun script ne le fait aujourd'hui : l'assistant en écrit un à invite silencieuse. Toi : `scp` de la `.pem` vers un chemin temporaire, puis exécution du script. La liaison `GODSEYE_GITHUB_APP_BINDING` est `{issuer, privateKeyPath}`.
- **Renvoyer** l'App ID, l'Installation ID et l'ID numérique du dépôt (identifiants publics, à saisir dans la page projet).
- **Registre Zot** (VM pro, avant `p10-install-registry.sh`) : `read -rs P; printf %s "$P" | htpasswd -niB <user> > /etc/zot/htpasswd`, puis `chmod 0640` et `chown root:zot`.
- **Vérification.** Webhook signé reçu (200), l'API liste l'installation, build de test via l'agent de build.

### 7. VM de code : acceptation et egress
- Le coding runner reste `available:false` tant que deux gates manquent : `vm-egress-allowlist` et `owner-acceptance` (`coding-runners.md`). Le second ne peut être signé que par toi.
- **À trancher.** `godseye-work` est aussi l'agent CI Jenkins et doit joindre Internet : une allowlist « broker seul » casse la CI. `g03-work-egress.sh` filtre déjà par noms. Réponds « garder work + allowlist » ou « VM dédiée » (lié à l'option B du point 1).
- **Acceptation.** Sur `godseye-work`, crée `artifacts/work-vm/owner-acceptance.json` : `{"accepted": true, "boundary": "disposable-vm-container"}`. Tu reconnais que la frontière est plus faible qu'un microVM KVM (noyau partagé). L'assistant rejoue ensuite `coding_sandbox_qualify.py qualify codex claude-code` ; `readiness` doit passer à `available:true`.

### 8. IPv6 / AAAA (décision)
Dis « dans le périmètre » ou « hors périmètre ». Si oui : l'assistant exécute la matrice (`h05-external-scan.ps1`, `h05-guest-network-tests.sh`), puis tu publies chez OVH un AAAA pour `godseye.lucasschimmel.fr` vers l'adresse IPv6 de la VM pro indiquée par l'assistant, et on étend l'observateur. Si non, l'assistant le consigne dans le ledger.

### 9. Reboot complet de l'hôte avec garde (toi présent)
- **Préalables.** Points 2 (f), 3 (a) et 4 faits ; fenêtre convenue (dimanche 09:00-11:00 UTC par exemple) ; deux parts et la clé d'urgence accessibles depuis le laptop.
- **Déroulé.** L'assistant reboote les guests (`qm reboot`) puis l'hôte en dernier. Après le retour du tunnel, tu déverrouilles deux fois (point 2 f). L'assistant redémarre l'API puis lance `p12-post-reboot-check.sh`.
- **Risque.** Quelques minutes sans WireGuard ; secours : Hetzner Rescue (`break-glass.md` §3 B). Recommandé : demander à Hetzner une console distante (KVM) pour la nuit via Robot > Support.

### 10. Projets réels et jeu de référence
Désigne 2 projets (prod et dev) pour le soak et confirme le jeu de référence (Luanti, image épinglée par digest, UDP 30000). Il faut d'abord les points 6 et 7 (builds fonctionnels) et une session passkey fraîche pour créer les projets dans la console. Pour changer l'image du jeu plus tard : donne le nouveau digest après sauvegarde fraîche et restore.

---

## AVANT le soak

### 11. Hermes et modèle payant
- Crée un projet OpenAI avec limite de dépense mensuelle et une clé API dédiée. Aucun script serveur ne pose le binding Hermes dans OpenBao (`agent-center.md` ne décrit que l'aide locale `hermes:bind`) : l'assistant écrit un script à invite silencieuse. Les UUID projet et environnement sont dans **Agent Center > Identifiants du périmètre** (un projet réel doit exister).
- Tu autorises explicitement un appel payant de qualification (budget par tâche ≤ 0,01 $). Renvoie « clé stockée, appel autorisé ».

### 12. Domaines personnalisés
L'assistant ajoute `domains: {cnameTarget, publicIpv4}` au `GODSEYE_DELIVERY_BINDING` et réinstalle l'edge. Toi : dans la page projet, ajoute le nom d'hôte (passkey fraîche). Sous-domaine : CNAME vers `godseye.lucasschimmel.fr` chez le registrar. Apex : enregistrement A vers l'IPv4 publique. Option TXT : `_godseye-challenge.<hôte>` = `godseye-verify=<jeton>`. Clique **Vérifier**. Attendu : statut `active`, certificat émis, 404 sur hôte inconnu. Rien n'a encore été qualifié en réel.

### 13. Passkeys
- Sur `https://console.godseye.lucasschimmel.fr` (WireGuard actif) : **Accès propriétaire** (`/security`), **Confirmer mon identité**, ajoute une 2e clé (téléphone) et une clé matérielle. La dernière clé ne peut pas être révoquée par l'interface. Le flux « ajouter une passkey » dans la console est encore du code à faire (inventaire E02.S01).
- Perte de toutes les clés : lien d'enrôlement valable 10 minutes, généré sur le serveur : `ssh -t godseye-pro "bash /opt/godseye-edge-staging/infra/dedicated-server/p07-owner-enroll.sh"`. À lancer uniquement dans ton terminal, jamais via l'assistant. Ne change pas `GODSEYE_PUBLIC_ORIGIN` : cela invalide toutes les passkeys.

### 14. Jeton API Proxmox scopé (décision)
Aucun design dans le dépôt. Si tu en veux un : `pveum user token add lucas@pve monitor --privsep 1` puis rôle `PVEAuditor`. Le secret reste hors chat. Dis « oui » ou « non ».

---

## OPTIONNEL

### 15. Laya (E10.S01 et S02)
Décide les cas d'usage, les métriques (macro-F1, précision) et fournis un jeu de données FR/EN annoté. Les seuils doivent être gelés avant de regarder les données de test. Rien n'est démarré.

### 16. Hetzner Robot
- **NVMe.** Les deux disques sont usés (un à 126 % d'usure, tolérance garantie confirmée par Hetzner). Ouvre un ticket matériel (Robot > Support > Hardware) pour planifier un échange : ce sera aussi la première répétition de resilver ZFS.
- **Rescue annuel** (`break-glass.md` §5.5) : monter `rpool`, puis retour, tous les guests redémarrés.

### 17. Rotation de la clé API OVH
Si tu la changes : régénère-la sur `eu.api.ovh.com/createToken` (droits limités à la zone `/domain/zone/lucasschimmel.fr/*`), relance `ssh -t godseye-pro sudo ./p10-store-edge-credentials.sh` avec un jeton admin court, puis révoque ce jeton.

---

## Points non confirmés
- Durée de vie et renouvellement du jeton `bao.auth` (point 2 c).
- Scripts à invite silencieuse inexistants dans le dépôt : GitHub App, Hermes, clés B2 `pgbackrest/` et `cells/`, heartbeat. L'assistant les écrit.
- Payload accepté par Slack, Discord ou ntfy.
- Libellés exacts des boutons de la console au-delà de ceux cités.
- État réel du mobile : aucun handshake enregistré depuis le dernier boot de l'hôte.
- Contradiction entre l'inventaire (« allowlist egress work-VM non faite ») et `host-operations.md` (script `g03` livré) : l'assistant vérifie sur le serveur avant ton acceptation.
