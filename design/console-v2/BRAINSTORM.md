# Refonte de la console G.O.D.S.E.Y.E — brainstorm

Statut : proposition, à valider avant tout code. La maquette `prototype/index.html` illustre ce document. Elle n'appelle aucune API et toutes ses données sont fictives.

---

## 1. Diagnostic de la console actuelle

### Ce qu'elle fait (`apps/console`, 15 routes, environ 80 composants)

| Route | Contenu réel |
|---|---|
| `/` Vue d'ensemble | Tuiles serveur, aperçu opérationnel, 4 compteurs (projets, environnements, opérations, exécutions CI), 5 projets, 5 « connexions », activité récente |
| `/projects`, `/projects/new`, `/projects/:id` | Liste, création, puis une page détail qui empile timeline, formulaires de métadonnées, cartes d'environnement avec formulaire, domaines, cycle de vie, backend, dépôt et encart explicatif |
| `/databases` | Profils PostgreSQL, allocations, sauvegardes, restauration tenue, activation |
| `/pipelines` | Politiques de livraison, sources, builds, releases, previews, builds Jenkins |
| `/jobs` | Définitions, exécutions, outbox |
| `/usage` | Grand livre, prix, budgets, rapprochement |
| `/observability` | Télémétrie, incidents, canaux de notification |
| `/operations` | Journal d'opérations |
| `/infrastructure` | Inventaire déclaré ou observé, préparations, allocations, marge |
| `/agents` « Hermes CORE » | Runtime, Codex/Claude Code, plans, chat, profils, formulaire de profil, formulaire de tâche, historique : **8 blocs empilés sur une seule page** |
| `/security` | Passkeys, sessions, récupération |
| `/access` | Secrets, OpenBao, identités de service |

### Pourquoi ça ne marche pas

1. **La navigation reflète le schéma de la base, pas le travail.** On a 12 entrées au même niveau. Les objets (projets, bases), les vues transverses (usage, observabilité, opérations) et les réglages (accès, secrets) sont mélangés. Un projet se lit sur 6 pages : sa base est dans `/databases`, ses déploiements dans `/pipelines`, ses jobs dans `/jobs`, ses coûts dans `/usage`. La fiche projet renvoie même vers la page globale (« Gérer les bases de données indépendantes »).
2. **Rien ne dit ce qui m'attend.** L'accueil affiche des compteurs sans décision possible (« Opérations : 02, journal persistant »). Les approbations sont dispersées dans les plans Hermes, la livraison et la récupération. Les incidents sont rangés dans une page « Observabilité ». Les effets inconnus, pourtant centraux dans la constitution, n'ont aucune place visible.
3. **L'information est écrite en prose au lieu d'être un état.** Chaque panneau porte un ou plusieurs paragraphes de précautions : « Cette destination enregistrée ne prouve pas une restauration physique… », « Les outils Hermès ne donnent pas accès aux commandes système… ». La vérité (observé, déclaré, inconnu) est juste, mais elle est noyée dans du texte au lieu d'être un signal lisible d'un coup d'œil.
4. **Les formulaires sont toujours ouverts.** Profil Hermes, tâche, métadonnées, environnement, preview, dépôt : tout est déplié en permanence dans le flux de lecture. Lire et agir se mélangent.
5. **La confirmation d'identité est un bouton global.** « Confirmer mon identité » est répété dans 15 fichiers. On confirme *avant* de savoir ce qu'on va approuver, puis les boutons se déverrouillent. Le passkey devrait confirmer *une action précise*, au moment de l'action.
6. **Hermes est pensé comme un formulaire, pas comme un collègue.** Les conversations, tâches, plans, profils et runners de code sont 5 concepts parallèles sur une même page. Le chat est enfoui au milieu, les plans sont séparés de la conversation qui les a produits, et la création de profil occupe autant de place que l'usage. Il manque le fil logique : *je demande → Hermes propose → j'approuve → ça s'exécute → je vois les preuves*.
7. **La direction visuelle est générique.** C'est un thème clair à barre latérale sombre, des cartes partout et un surtitre en capitales sur chaque page (« CENTRE DE CONTRÔLE », « INTELLIGENCE OPÉRATIONNELLE »). Les compteurs sont complétés à deux chiffres (« 02 ») et chaque titre a son icône. Aucune hiérarchie : tout a le même poids.

### Ce qu'on garde

- **Le fond, intégralement.** Contrats API, sémantique de vérité (inconnu ≠ succès), idempotence, révisions attendues, approbations liées à un hash.
- **La discipline des textes en français** et le refus d'afficher une configuration locale comme une infrastructure déployée.
- **Les suites d'accessibilité Playwright**, qui deviennent le filet de sécurité de la refonte.
- **TanStack Router/Query, Tailwind et shadcn**, utilisés comme primitives seulement.

Côté expérience, presque rien ne se garde : la navigation, l'accueil, la fiche projet et la page Hermes sont à refaire.

---

## 2. Principes

1. **« Qu'est-ce qui m'attend ? » avant « qu'est-ce qui existe ? »** L'accueil est une boîte de décisions, pas un tableau de compteurs.
2. **Le projet est le centre.** Tout ce qui appartient à un projet et à un environnement se trouve dans le projet. Les vues globales servent seulement aux sujets transverses : serveur, coûts, journal.
3. **La vérité est un signal, pas un paragraphe.** Trois glyphes servent partout :
   - `●` **observé**, mesuré à un instant donné, avec sa fraîcheur ;
   - `○` **déclaré**, voulu ou configuré mais pas prouvé ;
   - `◌` **inconnu**, impossible à affirmer, avec une réconciliation à lancer.

   Une seule ligne d'explication, au survol ou au clic, remplace les paragraphes.
4. **La passkey confirme une action, pas une session.** Chaque action sensible ouvre une feuille qui résume ce qu'on approuve : cible, hash, coût maximum, réversibilité. Ensuite on pose le doigt.
5. **Lire d'abord, agir ensuite.** Les formulaires sont fermés par défaut et s'ouvrent dans un panneau latéral ou une feuille. La page reste lisible.
6. **Hermes est un fil de travail.** La conversation, le plan, l'approbation, l'exécution et les preuves forment un seul fil chronologique.
7. **Une seule couleur parle.** L'ambre signifie « ça te concerne ». Le rouge et le vert sont réservés à la santé. Le reste est neutre.

---

## 3. Architecture d'information

```
Pilotage
  Aujourd'hui          /                       décisions, incidents, inconnus, santé, activité
  Projets              /projects               portefeuille
    Projet             /p/:slug/:env           sélecteur d'environnement persistant
      Aperçu · Déploiements · Données · Jobs · Domaines · Accès · Agents · Réglages
  Hermes               /hermes                 fils de travail
    Fil                /hermes/:threadId
    Exécutions · Profils · Skills (sous-onglets)
Plateforme
  Serveur              /platform/server        hôte → VM → cellules, réseau, capacité
  Livraison            /platform/delivery      Jenkins, registre, politiques
  Sauvegardes          /platform/backups       stanzas, B2, restaurations tenues
Suivi
  Coûts                /costs                  usage, budgets, rapprochement
  Journal              /journal                audit, opérations, incidents (une seule chronologie)
Réglages               /settings               passkeys, sessions, secrets, identités, notifications
⌘K                     partout                 navigation et actions
```

### Correspondance avec l'existant

| Ancien | Nouveau |
|---|---|
| `/` compteurs | `/` Aujourd'hui (décisions) |
| `/databases` | Projet › Données, et Plateforme › Sauvegardes pour la vue globale |
| `/pipelines` | Projet › Déploiements, et Plateforme › Livraison |
| `/jobs` | Projet › Jobs |
| `/usage` | Suivi › Coûts, et Projet › Aperçu (coût 30 jours) |
| `/observability` + `/operations` | Suivi › Journal ; les incidents remontent dans Aujourd'hui |
| `/infrastructure` | Plateforme › Serveur |
| `/agents` | Hermes (fils) ; Projet › Agents (fils filtrés par périmètre) |
| `/security` + `/access` | Réglages |
| Approbations dispersées | Aujourd'hui › À décider, et inline dans le fil Hermes concerné |

---

## 4. Hermes, repensé

Hermes devient un espace de travail en trois colonnes.

- **Fils** (gauche) : groupés par *À valider*, *En cours* et *Terminés*. Chaque fil a un titre, un périmètre (`melvyn · production`) et un état.
- **Fil** (centre) : la conversation. Les appels d'outils sont repliés en une ligne (« a lu 214 lignes de logs · 0,3 s »). Le **plan** apparaît *dans* le fil, sous forme de carte :
  - étapes numérotées avec leur nature (Hermes, coding Codex/Claude, clarification) ;
  - effets attendus ;
  - réserve de coût ;
  - hash court.

  Les actions proposées sont Approuver, Demander une modification et Refuser. Après approbation, chaque étape devient une ligne d'exécution vivante. Les sorties sont des artefacts (patch, journal de tests) téléchargeables, sans effet de bord.
- **Contexte** (droite) : périmètre, profil et modèle, outils accordés à *ce* fil (cases à cocher limitées par le plafond du profil), budget consommé sur réservé, exécutions de code liées.
- **Composer** : le périmètre et les outils sont visibles sous forme de puces au-dessus du champ, donc on sait ce qu'on autorise avant d'envoyer.
- **Profils et Skills** sont des sous-onglets de configuration et ne polluent plus l'usage quotidien.
- **Codex et Claude Code** ne sont plus une section à part : ce sont des étapes de plan, ou un fil de type « code » lancé directement sur un dépôt et un commit.

Le runtime non configuré n'est plus un paragraphe. C'est un état unique du composer : « Hermes n'est pas connecté sur ce serveur », avec un lien vers la configuration.

---

## 5. Système

### Direction artistique, version 2 (après le premier retour)

Le premier jet avait la bonne expérience mais une exécution visuelle trop plate. La v2 garde l'architecture et pousse le rendu :

- **Une seule grammaire visuelle pour la vérité.** Plein = observé, hachuré = déclaré, prévu ou estimé, pointillé ambre = inconnu. Elle s'applique partout : jauges, barres de coût, cellules non provisionnées, frise du jour, étapes de pipeline, jours sans copie. Les hachures (inspirées de la référence 1) ont donc une signification et ne sont jamais décoratives.
- **Typographie d'instrument.** Grandes valeurs en Geist 300 (34–46 px, interlettrage serré) avec l'unité en petit gris, et identifiants en Geist Mono. Les titres de page sont légers et grands, les titres de carte petits et calmes.
- **Surfaces.** Cartes de 14 px de rayon avec un léger dégradé de haut et un liseré intérieur clair, sur un fond très sombre à grille de points discrète. Contrôles en pilule (boutons, segments, puces), comme dans les références.
- **Barre latérale riche, mais utile.** Elle contient :
  - la marque ;
  - une carte serveur vivante (HEL1, CPU et RAM, pastille qui pulse) ;
  - la recherche ⌘K ;
  - la navigation, avec des tuiles d'icône qui s'inversent sur l'élément actif, des badges sémantiques (ambre = à décider, vert = en cours, rouge = défaut) et des raccourcis `G A`, `G P`… au survol ;
  - une carte « Hermes » avec la progression des fils actifs ;
  - le propriétaire avec un anneau de session et le temps restant.
- **Chaque graphique répond à une question.**
  - Frise des 24 h : ce qui s'est passé et ce qui arrive.
  - Disponibilité sur 30 jours : jours dégradés en ambre.
  - Coût du mois : projection hachurée.
  - Mémoire de la cellule : plafond en pointillés.
  - Topologie hôte → VM → cellules : largeur = mémoire allouée, remplissage = mémoire utilisée.
  - Bande de fraîcheur des copies B2 sur 14 jours.
  - Barres de coût : mesuré plein, estimé hachuré.
- **L'ambre reste rare.** La tuile « À décider », les badges de décision, la carte de plan Hermes, les inconnus et les échéances proches. Sur Aujourd'hui, une seule carte est pleine d'ambre : le nombre de décisions.

### Tokens (thème sombre par défaut, clair disponible)

| Rôle | Sombre | Usage |
|---|---|---|
| `bg` / `rail` | `#09090a` / `#0c0c0e` | fond, barre latérale |
| `surface` | `#111113` (+ dégradé haut) | cartes |
| `raised` | `#1c1c20` | pistes, puces, champs |
| `line` | blanc à 6,5 % | séparateurs |
| `text` / `text-2` / `text-3` | `#f2f2f3` / `#a4a4ac` / `#66666e` | hiérarchie de texte |
| `accent` | `#f2b84b` | **seul accent** : décision, inconnu, échéance |
| `ok` / `danger` | `#5cc690` / `#f06460` | santé uniquement |

- **Rayons** : pilule pour les contrôles, 9 px pour les tuiles, 14 px pour les cartes. La profondeur vient d'un liseré intérieur et du dégradé de surface, pas d'ombres portées.
- **Typographie** : Geist pour l'interface et Geist Mono pour tout ce qui est identifiant, hash, nombre ou chemin, en chiffres tabulaires. Les titres sont en casse de phrase. Pas de surtitre en capitales.
- **Densité** : lignes de 40 px dans les listes, 13–14 px de texte courant. C'est un outil de travail quotidien, pas une page vitrine.

### Composants clés

- `Truth` : glyphe ●/○/◌, avec fraîcheur (« il y a 2 min ») et explication au survol.
- `DecisionRow` : type, cible, conséquence et action principale.
- `EnvSwitch` : production, développement et previews, persistant dans l'URL.
- `StepUpSheet` : résumé exact de l'action, passkey, puis résultat.
- `PlanCard` : étapes, effets, réserve, hash et actions.
- `Meter` : valeur mesurée sur plafond déclaré, avec le seuil des 80 %.
- `Ledger row` : acteur (propriétaire, Hermes, système), action, cible, provenance et horodatage.
- `Command palette` (⌘K).

---

## 6. Direction artistique et garde-fous anti-slop

S'inspirer des références sans les copier :

- **Référence 3 (monochrome, Radix)** : c'est la base. Sobriété, densité, une seule couleur de signal.
- **Référence 1** : on garde la frise de période (ici les fenêtres de sauvegarde et les expirations de preview) et l'audace de la grande valeur unique quand elle a du sens.
- **Référence 2** : on garde la chaleur. L'accent ambre remplace l'orange, et le fond reste neutre plutôt que brun.

**Interdits explicites :**

- Emoji, « Welcome back », avatars de stock.
- Dégradés violets ou rose-bleu, texte en dégradé, glassmorphism, lueurs.
- Badges `+2,3 %` verts sur chaque chiffre.
- Graphiques décoratifs sans question à laquelle ils répondent.
- Icône dans chaque titre de carte, surtitres en CAPITALES.
- Compteurs remplis à deux chiffres, paragraphes de précautions.
- Données génériques : on utilise de vrais concepts du produit (cellules, stanzas, hash de plan, runsc).

---

## 7. Ce que la maquette montre

| Écran | Démontré |
|---|---|
| Aujourd'hui | Décisions, incidents et inconnus, santé compacte, Hermes en cours, activité |
| Projets | Portefeuille avec états par environnement, coût et fraîcheur des sauvegardes |
| Projet `melvyn` | Sélecteur d'environnement ; onglets Aperçu, Déploiements et Données détaillés ; garde-fous d'isolation avec glyphes de vérité |
| Hermes | Trois colonnes, fil avec outils repliés, carte de plan, approbation par passkey, contexte et budget |
| Serveur | Hôte EX44 → VM → cellules, disques avec usure NVMe, réseau |
| Coûts, Journal, Livraison, Sauvegardes, Réglages | Versions légères pour valider la structure |
| Global | ⌘K, feuille passkey, bascule sombre/clair |

Ce qu'elle ne montre pas : les états vides et le premier lancement, le responsive fin, les formulaires de création (projet, profil) et les erreurs réseau. Ce sont les prochaines étapes, une fois la direction validée.

## 8. Ensuite

1. Valider la direction et l'architecture d'information sur la maquette.
2. Écrire `DESIGN.md` (tokens W3C) pour remplacer le DESIGN.md provisoire.
3. Construire d'abord le shell, ⌘K, `Truth` et `StepUpSheet`, puis Aujourd'hui, la fiche Projet, Hermes, et enfin les vues transverses.
4. Faire passer la suite d'accessibilité existante sur chaque écran migré.
