# BCA Messenger

Application de messagerie privée en français, React/Vite + Express + Socket.IO,
MySQL/MariaDB sur Cybrancee et Sequelize (PostgreSQL reste compatible pour le
développement existant). PWA installable avec Web Push, images et vocaux privés.

## Ce qui est livré

- Connexion membre avec nom d’utilisateur et téléphone : création automatique
  du compte et de son unique conversation support lors de la première saisie.
- Connexion commune sans sélecteur Équipe : le serveur reconnaît les administrateurs
  enregistrés dans la table `admins`. Un rôle envoyé par le navigateur ne donne
  aucun privilège. Les administrateurs utilisent leur mot de passe, les membres
  leur numéro de téléphone. Le couple nom + téléphone retrouve son historique ;
  toute autre combinaison ouvre un échange indépendant, y compris un autre
  téléphone pour le même nom. Aucun ancien compte ou message n’est remplacé.
- Comptes administrateur protégés par bcrypt, accès JWT 15 minutes et jeton de
  renouvellement opaque rotatif ; cookies httpOnly, Secure en production.
  Connexion conservée après fermeture du navigateur, durée glissante de 400 jours
  (limite des cookies navigateur), renouvelée aux visites et toutes les 10 minutes
  lorsque l’application est ouverte. Déconnexion : session révoquée en base.
  Effacer les cookies, changer d’appareil ou rester absent plus de 400 jours impose
  une nouvelle connexion ; aucune application web ne peut restaurer un cookie effacé.
- Conversation unique côté membre, boîte multi-agents côté support, recherche,
  favoris, filtres, non-lus, présence, saisie en cours et coches envoyé/reçu/lu.
- Images compressées et réencodées, visionneuse interne, téléchargement contrôlé,
  partage quand le navigateur le permet ; vocaux MediaRecorder et lecture audio.
- Profil avec recadrage central carré et redimensionnement ; thèmes clair/sombre.
- Fichiers chiffrés AES-256-GCM sur disque privé, autorisation à chaque lecture,
  validation des signatures de fichiers, images ≤ 5 Mo, vocaux ≤ 5 minutes.
- Manifest, service worker, aide d’installation iOS, notifications, badge et titre.

**L’inscription membre est ouverte, conformément au choix du propriétaire.**
Ce n’est pas une vérification d’appartenance à Academy ni de propriété du téléphone.
Le téléphone normalisé est stocké dans le profil et son empreinte bcrypt sert à
  conserver la compatibilité avec les anciens comptes. Le couple nom et téléphone
  du profil identifie les sessions suivantes. Sans SMS ni mot de passe membre, connaître le
nom et le téléphone peut permettre d’accéder aux échanges : ce risque a été
expliqué avant confirmation de l’inscription automatique. Les comptes support
restent précréés avec un mot de passe ; aucun rôle admin n’est fourni par le client.

## Prérequis

### Mise à jour : sessions de chat par nom et téléphone

Sur une **base Plesk déjà utilisée**, après le pull GitHub et **Deploy Now**,
lancer une seule fois **Node.js → Run script → `db:upgrade`**, puis **Restart App**.
Ne pas relancer `db:init` et ne pas réimporter le schéma initial.
Cette commande remplace l’unicité du nom membre par celle du couple
`(username, phone)`. Elle ajoute d’abord le nouvel index, puis retire uniquement
l’ancien index du nom ; elle ne supprime ni ne réécrit les comptes, conversations
ou messages, et ne modifie pas les administrateurs. Elle est relançable en cas
d’interruption. Conserver une sauvegarde avant toute évolution de schéma.
Des droits ALTER/INDEX sont nécessaires ; aucun build sur Plesk n’est requis.
Une base neuve initialisée avec cette distribution utilise déjà le nouvel index.

### Installation et notifications téléphone

La notice d’installation s’affiche dès l’entrée, avant toute session, et propose
soit le dialogue d’installation disponible, soit les instructions du navigateur.
Elle peut être fermée pour utiliser le site normalement et n’apparaît pas dans
l’application ouverte en mode autonome. Un simple refus d’installation n’est
jamais enregistré comme une installation réussie.

Après ouverture d’une session, une notice propose les notifications. L’autorisation
est demandée uniquement après une action de l’utilisateur. Si elle est déjà accordée,
l’abonnement est automatiquement enregistré pour la session courante ; les abonnements
de sessions fermées/expirées ne reçoivent pas de push. Les clés VAPID stables existantes
sont dérivées de SESSION_SECRET, le contact de APP_ORIGIN : aucune nouvelle clé n’est
requise dans la configuration Plesk existante. HTTPS reste obligatoire.

Sur iPhone/iPad, utiliser Safari, ajouter l’application à l’écran d’accueil puis
ouvrir cette application pour autoriser les notifications (iOS/iPadOS 16.4+).
Sur Android, utiliser un navigateur compatible et autoriser les notifications.
Le système peut les bloquer ou les retarder (permissions, économie de batterie,
réseau, mode silencieux) : leur affichage physique n’est pas garanti par le site.

- Node.js **22 LTS ou plus récent**, npm, accès réseau à npm pour l’installation.
- MySQL 8 / MariaDB 10.6+ pour Cybrancee ; PostgreSQL également pris en charge.
- FFprobe fourni par les dépendances d’exécution pour mesurer la durée réelle
  des vocaux, sans installation système manuelle. L’hébergement doit autoriser
  l’exécution de ce binaire ; FFPROBE_PATH reste une surcharge facultative.
- HTTPS pour les cookies de production, le micro, la PWA et le Web Push.
- Disque **persistant** et privé, hors document root. Ne pas utiliser un système
  de fichiers éphémère pour les pièces jointes réelles.

## Lancement sur Replit

Les services configurés lancent l’API et le frontend ; la base PostgreSQL est
fournie par le projet. Conserver `SESSION_SECRET` dans Secrets, jamais dans Git.

```sh
pnpm install
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run seed:demo
```

Ouvrir l’aperçu puis **Démo membre**. L’accès de démonstration administrateur est
désactivé ; un administrateur doit être désigné dans la base puis utiliser le
formulaire commun. Cet accès membre de démonstration est explicitement
réservés au développement et la route démo renvoie 404 en production, même si la
variable `ENABLE_DEMO` vaut true. Les comptes de démonstration ont des identifiants
aléatoires non affichés et ne servent pas de comptes administrateur de production.

Pour les opérations de production sur Replit, le flux Publish gère la migration
de la base intégrée. Ne pas exécuter de migration SQL externe contre cette base.
Le stockage disque privé demandé n’est adapté qu’à un service avec volume durable :
vérifier cette condition avant une utilisation réelle, ou adapter le stockage à
un service de fichiers persistant avec accord du propriétaire.

## Installation Node.js autonome

### Vérifications MySQL/MariaDB

`pnpm --filter @workspace/api-server exec tsx src/services/conversations.mysql.test.ts`
vérifie le pilote et le contrat de la boîte de réception, sans connexion à une base.
`npm run test:mysql` nécessite `mariadbd` et `mariadb-install-db` : cette suite lance
une base temporaire locale sous `/tmp`, importe le schéma et vérifie connexion,
authentification, messages, autorisations membre/support et présence. Elle ne
touche pas à Cybrancee. Certains environnements de commandes peuvent bloquer
le serveur natif avant son démarrage ; ce cas ne valide pas la suite d'intégration.

### Installation

Copier `.env.example` vers `.env`, renseigner les valeurs via un moyen sécurisé,
puis préparer la base et le compte support avant d’ouvrir le service au public.
Ne jamais committer `.env`.

```sh
npm install
# npm délègue l'installation des packages workspace à pnpm automatiquement.
# Initialisation EXPLICITE d'une base EXTERNE VIDE uniquement :
# MySQL/MariaDB : importer lib/db/mysql/initial.sql dans phpMyAdmin.
# PostgreSQL existant : psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/drizzle/0000_outgoing_mentor.sql
# Le seed charge les variables fournies par l'environnement du processus :
npx pnpm --filter @workspace/api-server run seed
# Renseigner ADMIN_USERNAME et ADMIN_PASSWORD (14 caractères minimum)
# dans l'environnement sécurisé avant le seed, puis retirer ADMIN_PASSWORD.
npm run build:plesk
node plesk/deploy.cjs
npm start
```

`npm start` démarre la distribution **déjà compilée** dans `plesk/`, sans build,
sur `process.env.PORT` (3000 par défaut), avec API, Socket.IO et frontend. Les données
de `.env` sont chargées pour cette commande. Pour les scripts seed/provisionnement
en local, on peut utiliser `node --env-file=.env` avec le lanceur tsx :

```sh
node --env-file=.env --import ./artifacts/api-server/node_modules/tsx/dist/loader.mjs \
  artifacts/api-server/src/scripts/seed.ts
```

Autre option : injecter les variables dans le terminal ou le panneau d’hébergement
et utiliser `npx pnpm --filter @workspace/api-server run seed`.

Pour reconstruire après une modification :

```sh
npm run build:plesk
node plesk/deploy.cjs
npm start
```

La première connexion crée automatiquement le membre. Pour un provisionnement
manuel facultatif, configurer temporairement `MEMBER_USERNAME`,
`MEMBER_NUMBER` (confidentiel) et éventuellement `MEMBER_PHONE`, puis :

```sh
npx pnpm --filter @workspace/api-server run member:create
```

Le script crée le membre et sa conversation. Le téléphone du profil est visible
par le membre concerné et par le support, pas par les autres membres.
Répéter le seed admin avec un autre nom permet d’ajouter un agent support.
Il ne modifie pas le mot de passe d’un agent existant.

## Guide Cybrancee / Plesk

Guide pour une offre autorisant Node.js, MySQL/MariaDB, WebSocket et un disque
persistant. **Non testé sur un compte Cybrancee réel** : les menus, versions et
capacités dépendent de l’offre. Vérifier leur disponibilité avec l’hébergeur.

Le dossier **`plesk/` est une distribution autonome précompilée, incluse dans Git**.
Les `dist/` intermédiaires restent ignorés. Ne pas envoyer `node_modules`, `.env`,
les fichiers privés ou les secrets sur GitHub. Le build ne tourne jamais dans
Passenger, au démarrage ou dans l'action « Deploy Now ».

### Configuration initiale — une seule fois

1. **Git et HTTPS** : connecter le dépôt GitHub dans Plesk, choisir son dossier
   de déploiement et activer HTTPS. Ne pas exposer la racine du dépôt.
2. **Node.js** : version **22 ou supérieure**, mode **Production**.
   Pour un dépôt dans `/httpdocs` :
   - Application Root : `/httpdocs/plesk`
   - Document Root : `/httpdocs/plesk/public`
   - Application Startup File : **`app.cjs`**
   Garder un seul processus Node/Passenger pour la présence et Socket.IO.
3. **Variables Plesk** : renseigner les paramètres de `plesk/.env.example` dans
   les variables personnalisées Node.js. Les secrets Replit ne sont pas transférés
   par GitHub. Pour Cybrancee, définir `CYBRANCEE_DB_HOST`, `CYBRANCEE_DB_NAME`,
   `CYBRANCEE_DB_USER`, `CYBRANCEE_DB_PASSWORD`. Ces champs utilisent MySQL/MariaDB ;
   aucun port PostgreSQL n'est requis. `CYBRANCEE_DB_PORT` est **facultatif** :
   3306 par défaut, à changer uniquement si l'hébergeur indique un autre port.
   Alternative : omettre tous les champs `CYBRANCEE_DB_*` et fournir une
   `DATABASE_URL=mysql://...` (ou `mariadb://...`). PostgreSQL reste compatible
   avec une URL `postgresql://...` pour les installations existantes.
   Un fichier privé `plesk/.env` permet de fournir la même configuration au
   serveur et à « Run script » si les variables du panneau ne sont pas transmises.
   Conserver `SESSION_SECRET` (32 caractères minimum) et `APP_ORIGIN` HTTPS sans
   `/` final. Le stockage privé est automatique : aucune variable `STORAGE_DIR`
   n'est requise.
   Conserver les clés de chiffrement après les
   mises à jour, sinon les fichiers privés existants ne seront plus lisibles.
4. **Stockage automatique** : au démarrage, l'application crée un dossier privé
   dans `.bca-messenger-private/`, à côté du dépôt Git, donc hors de `plesk/public`
   et des fichiers remplacés par Deploy Now. Le sous-dossier propre à l'application
   est stable pour le même Application Root, avec permissions 700. Aucun chemin à
   configurer. Le compte Node doit pouvoir écrire dans le dossier parent du dépôt.
   Ne jamais effacer ce dossier lors d'une mise à jour et l'inclure aux sauvegardes.
   Une ancienne valeur explicite de `STORAGE_DIR` reste acceptée pour ne pas
   déplacer des fichiers existants. La retirer uniquement pour une installation
   neuve ou après transfert explicite des fichiers vers le stockage automatique.
5. **Action de déploiement Git** : activer les actions supplémentaires et ajouter :

   ```sh
   cd /var/www/vhosts/VOTRE-DOMAINE/httpdocs
   sh plesk/deploy.sh /opt/plesk/node/22/bin/node
   ```

   Adapter les deux chemins à votre installation et à la version Node sélectionnée
   dans Plesk (par exemple `/opt/plesk/node/24/bin/node`). Cette action vérifie
   les fichiers, installe **uniquement les dépendances d'exécution** si nécessaire
   avec `npm ci --omit=dev`, puis conserve les dépendances pour les mises à jour
   sans changement. **Ce n'est pas une compilation** : ni Vite, ni TypeScript,
   ni pnpm, ni esbuild n'est utilisé sur le serveur. L'installation initiale reste
   nécessaire pour les bibliothèques natives correspondant à Linux du serveur.
6. **Base vide externe uniquement** : pour MySQL/MariaDB, importer une seule fois
   **`plesk/schema/initial-mysql.sql`** depuis phpMyAdmin (base sélectionnée).
   Ce fichier ne contient aucun DROP/TRUNCATE ; ne pas le réimporter sur une base
   déjà initialisée. Il crée les huit tables applicatives et leurs contraintes.
   Pour une ancienne installation PostgreSQL uniquement, utiliser `plesk/schema/initial.sql`.
   Ne jamais réimporter ce schéma sur une base existante. Les migrations ultérieures
   restent une opération explicite après sauvegarde ; aucune migration automatique
   ni création de compte ne se produit au démarrage ou au déploiement.
   **Si phpMyAdmin refuse l'import (HTTP 403)** : après le déploiement de cette
   version, utiliser **Node.js → Run script → `db:init`**. Cette commande explicite
   crée les huit tables uniquement si la base MySQL/MariaDB est vide. Elle
   n'est jamais lancée par le démarrage ou Deploy Now. Elle ne supprime aucune
   donnée, refuse une base partiellement initialisée ou contenant d'autres tables,
   et n'effectue rien si les huit tables sont déjà présentes. Un verrou protège
   contre deux initialisations simultanées. Les créations MySQL ne sont pas
   transactionnelles : en cas d'interruption, lancer `diagnose` et ne pas supprimer
   les tables déjà créées. Les droits CREATE sont nécessaires une seule fois.
7. **Administrateur** : définir temporairement `ADMIN_USERNAME` et `ADMIN_PASSWORD`
   (14 caractères minimum) dans un environnement sécurisé et exécuter
   `node plesk/admin.cjs` depuis la racine du dépôt. Retirer ensuite ces deux
   variables. La commande doit recevoir les mêmes variables d'environnement que
   l'application ; le terminal ne reprend pas nécessairement les variables du
   panneau Node.js. Alternative : `node admin.cjs` dans `plesk/` avec un `.env`
   privé. Les membres se créent maintenant à leur première connexion :
   aucun script ni nouvelle variable n’est requis. Le provisionnement manuel
   reste facultatif via `node plesk/member.cjs`, avec `MEMBER_USERNAME`,
   `MEMBER_NUMBER` et éventuellement `MEMBER_PHONE`. Aucun outil de build requis.
8. **Vocaux et réseau** : FFprobe est inclus dans les dépendances d’exécution
   installées par deploy, sans build ni configuration supplémentaire. Le script
   vérifie son exécution. Un FFPROBE_PATH personnalisé reste facultatif.
   Autoriser WebSocket et HTTP long-polling sur `/api/socket.io/`, transmettre
   `Upgrade`, `Connection`, `Host`, `X-Forwarded-Proto=https` et `X-Forwarded-For`.
   Un niveau de proxy est approuvé. Ne pas exposer le port Node directement.

### Mises à jour — sans build dans Plesk

1. **Avant le push GitHub**, dans l'environnement de développement :
   `npm run build:plesk` puis `npm run verify:plesk`. Commiter le code **et** tout
   le dossier `plesk/`, puis pousser. La version fournie est déjà construite.
2. Dans Plesk : récupérer le dernier commit, cliquer **Deploy Now**, puis **Restart App**.
3. Vérifier `https://votre-domaine/api/healthz` et une connexion membre/support.

Le workflow GitHub `Verify precompiled Plesk release` contrôle l'intégrité et
refuse une version compilée ne correspondant plus aux sources, sans compiler
quoi que ce soit. `npm run test:plesk` teste la distribution dans un dossier isolé,
sans les sources ni les dépendances du monorepo et sans toucher à la base.

### Si le frontend s'affiche mais l'API renvoie 504

Dans **Node.js → Run script**, lancer **`diagnose`** après le dernier Deploy Now
et Restart App. La commande vérifie la distribution, les variables obligatoires
(sans afficher leurs valeurs), les modules natifs, le démarrage d'un serveur
temporaire local et sa route `/api/healthz`, puis la connexion MySQL/MariaDB (ou
PostgreSQL selon l'URL) et
l'existence des tables, uniquement en lecture seule. Elle ne compile rien, ne
crée aucune table, n'installe rien et arrête son serveur temporaire.

Le dernier état du vrai démarrage est conservé dans **`plesk/.startup-status.json`**,
hors du dossier public et ignoré par Git. On peut le lire via File Manager si
le lecteur de logs Plesk reste bloqué. Seuls l'étape, l'heure et une erreur
filtrée y figurent, jamais la configuration ou les secrets.
Un succès local ne valide pas Passenger : si l'URL publique reste en 504,
le rapport de démarrage permet de distinguer l'application du routage Plesk.

Socket.IO est attaché au même serveur HTTP que l’API, sur `/api/socket.io`.
Le repli HTTP long-polling est conservé si WebSocket n’est pas disponible.
Déployer **un seul processus Node** dans cette version : la présence et les
limiteurs sont en mémoire. Un déploiement multi-processus exige un adaptateur
Socket.IO partagé, des sessions adhérentes pour polling et un limiteur partagé.

## Notifications et limites des navigateurs

- Autorisation demandée volontairement après connexion dans les préférences.
- Web Push utilise des clés VAPID dédiées si configurées ; sinon une paire stable
  est dérivée cryptographiquement de `SESSION_SECRET`, avec séparation de domaine.
  `VAPID_SUBJECT` doit être une URL publique HTTPS ou un contact `mailto:` réel.
- Le serveur accepte les fournisseurs Chrome/FCM, Firefox/Mozilla et Safari/Apple ;
  adapter la liste blanche pour un autre fournisseur, sans ouvrir un proxy SSRF.
- Le service worker ouvre la bonne conversation au clic et ne met **jamais**
  les réponses API ou fichiers privés dans le cache.
- Sur iOS, Web Push nécessite une version compatible et l’installation sur l’écran
  d’accueil. L’installation automatique n’est pas disponible partout.
- Son, vibration et badge sont **soumis au navigateur et au système**. Le son WAV
  est utilisé en premier plan après interaction. Un son personnalisé lorsque
  l’application est fermée n’est pas garanti par l’API Web Push.
- Certains navigateurs imposent leur propre menu système malgré les protections
  CSS/contextmenu. Les fichiers restent authentifiés et non publics.

## Sécurité, sauvegardes et exploitation

- CSRF signé dans un cookie httpOnly et en-tête sur toutes les mutations, contrôle
  d’origine, CORS restreint, Helmet/CSP, requêtes paramétrées, validation Zod.
- Login limité à 15 tentatives / 15 minutes / IP ; limite globale 300 / minute ;
  uploads limités à 15 / minute. Pour les réseaux partagés, adapter prudemment.
- JWT vérifiés avec algorithme fixé et session en base ; logout révoque la session,
  ferme son socket et retire son abonnement push.
- Clé de chiffrement AES dérivée de `FILE_ENCRYPTION_KEY` si fournie, sinon de
  `SESSION_SECRET`. **Changer la clé sans migration rend les fichiers existants
  illisibles.** Conserver les anciennes clés dans une sauvegarde sécurisée.
- Sauvegarder quotidiennement la base (MySQL/MariaDB : export Plesk/phpMyAdmin ou
  `mariadb-dump` ; PostgreSQL existant : `pg_dump`, restauration via `pg_restore`)
  et le dossier privé automatique (ou l'ancien `STORAGE_DIR`) de façon cohérente,
  chiffrer les sauvegardes, conserver les clés
  séparément et tester une restauration régulièrement. Planifier ces tâches chez
  l’hébergeur : le dépôt ne crée pas de sauvegarde distante automatiquement.
- Nettoyer périodiquement les sessions expirées et les fichiers téléversés mais
  jamais attachés après une rétention définie. Ne pas effacer sans politique métier.
- Les messages ne sont pas chiffrés de bout en bout : les agents autorisés et le
  serveur peuvent les lire. Ne pas annoncer une garantie de conformité non auditée.

## Vérifications

```sh
pnpm run typecheck
# Services de développement lancés ; comptes de démo initialisés :
node artifacts/api-server/test/text.mjs
node artifacts/api-server/test/media.mjs
node artifacts/api-server/test/inbox.mjs
node artifacts/api-server/test/realtime.mjs
node artifacts/api-server/test/pwa-security.mjs
```

Ces scripts vérifient l’API contre le proxy de développement et ajoutent quelques
messages/fichiers techniques aux comptes de démo. Ne pas les lancer en production.
Les anciens tests multi-rôles demandent `TEST_ADMIN_USERNAME` et
`TEST_ADMIN_PASSWORD` dans l’environnement sécurisé. Le test ciblé
`pnpm --filter @workspace/api-server exec tsx test/bca-messenger.ts` crée et
supprime ses propres comptes temporaires, sans afficher leurs identifiants.
La réception push réelle, le microphone et l’installation doivent être validés
sur les appareils ciblés ; un test serveur ne remplace pas ce contrôle.

## Organisation

- `artifacts/api-server/src/routes` : auth, conversations, fichiers, push.
- `artifacts/api-server/src/services` : comptes, conversations, temps réel,
  stockage chiffré, notifications.
- `artifacts/api-server/src/middlewares` : sessions et CSRF.
- `artifacts/api-server/src/scripts` : seed et provisionnement.
- `artifacts/biz-connect/src` : frontend, paramètres, chat et médias.
- `artifacts/biz-connect/public` : manifest, service worker, icônes et son.
- `lib/db/src/models.ts` : modèles Sequelize utilisés à l’exécution.
- `lib/db/src/schema` et `lib/db/drizzle` : schéma déclaratif et migration initiale.
  Le schéma Drizzle sert aussi au suivi de migration par Replit ; conserver son
  alignement avec les modèles Sequelize lors de toute modification.
- `lib/api-spec/openapi.yaml` : contrat source ; régénérer avec
  `pnpm --filter @workspace/api-spec run codegen` après modification.
