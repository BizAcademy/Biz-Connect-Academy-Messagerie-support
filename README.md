# Biz Connect Academy — Messagerie support

Application de messagerie privée en français, React/Vite + Express + Socket.IO,
PostgreSQL et Sequelize. PWA installable avec Web Push, images et vocaux privés.

## Ce qui est livré

- Connexion membre avec nom d’utilisateur et numéro Biz Connect ; vérification
  isolée dans `artifacts/api-server/src/services/accounts.ts`.
- Connexion administrateur distincte, bcrypt, accès JWT 15 minutes et jeton de
  renouvellement opaque rotatif 30 jours ; cookies httpOnly, Secure en production.
- Conversation unique côté membre, boîte multi-agents côté support, recherche,
  favoris, filtres, non-lus, présence, saisie en cours et coches envoyé/reçu/lu.
- Images compressées et réencodées, visionneuse interne, téléchargement contrôlé,
  partage quand le navigateur le permet ; vocaux MediaRecorder et lecture audio.
- Profil avec recadrage central carré et redimensionnement ; thèmes clair/sombre.
- Fichiers chiffrés AES-256-GCM sur disque privé, autorisation à chaque lecture,
  validation des signatures de fichiers, images ≤ 5 Mo, vocaux ≤ 5 minutes.
- Manifest, service worker, aide d’installation iOS, notifications, badge et titre.

**Ce n’est pas une connexion déjà branchée à la vraie plateforme Academy.**
Les identifiants des membres doivent être provisionnés, ou le vérificateur doit
être raccordé à votre API officielle. Aucun compte réel n’est accepté par défaut.
Le numéro Academy est traité comme un secret et stocké haché ; s’il est public
ou facile à deviner, la plateforme doit fournir une vérification complémentaire
(OTP ou authentification API) avant une ouverture à de vrais utilisateurs.

## Prérequis

- Node.js **22 LTS ou plus récent**, npm, accès réseau à npm pour l’installation.
- PostgreSQL ; ce projet ne fournit pas d’adaptateur MySQL.
- FFmpeg/FFprobe accessible au serveur pour mesurer la durée réelle des vocaux.
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

Ouvrir l’aperçu puis **Démo membre** ou **Démo équipe**. Ces accès sont explicitement
réservés au développement et la route démo renvoie 404 en production, même si la
variable `ENABLE_DEMO` vaut true. Les comptes de démonstration ont des identifiants
aléatoires non affichés et ne servent pas de comptes administrateur de production.

Pour les opérations de production sur Replit, le flux Publish gère la migration
de la base intégrée. Ne pas exécuter de migration SQL externe contre cette base.
Le stockage disque privé demandé n’est adapté qu’à un service avec volume durable :
vérifier cette condition avant une utilisation réelle, ou adapter le stockage à
un service de fichiers persistant avec accord du propriétaire.

## Installation Node.js autonome

Copier `.env.example` vers `.env`, renseigner les valeurs via un moyen sécurisé,
puis préparer la base et le compte support avant d’ouvrir le service au public.
Ne jamais committer `.env`.

```sh
npm install
# npm délègue l'installation des packages workspace à pnpm automatiquement.
# Initialisation EXPLICITE d'une base PostgreSQL EXTERNE vide uniquement :
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f lib/db/drizzle/0000_outgoing_mentor.sql
# Le seed charge les variables fournies par l'environnement du processus :
npx pnpm --filter @workspace/api-server run seed
# Renseigner ADMIN_USERNAME et ADMIN_PASSWORD (14 caractères minimum)
# dans l'environnement sécurisé avant le seed, puis retirer ADMIN_PASSWORD.
npm start
```

`npm start` construit les fichiers si nécessaire et démarre le serveur unique sur
`process.env.PORT` (3000 par défaut), avec API, Socket.IO et frontend. Les données
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
npm run build:standalone
npm start
```

Pour provisionner un membre local, configurer temporairement `MEMBER_USERNAME`,
`MEMBER_NUMBER` (confidentiel) et éventuellement `MEMBER_PHONE`, puis :

```sh
npx pnpm --filter @workspace/api-server run member:create
```

Le script crée le membre et sa conversation sans publier son numéro Academy.
Répéter le seed admin avec un autre nom permet d’ajouter un agent support.
Il ne modifie pas le mot de passe d’un agent existant.

## Guide Cybrancee / Plesk

Guide pour une offre autorisant Node.js, PostgreSQL, WebSocket et un disque
persistant. **Non testé sur un compte Cybrancee réel** : les menus, versions et
capacités dépendent de l’offre. Vérifier leur disponibilité avec l’hébergeur.

1. **Domaine et SSL** : ajouter le domaine dans Plesk, activer un certificat SSL
   valide et forcer la redirection HTTP → HTTPS.
2. **Application Node.js** : dans la rubrique Node.js du domaine, sélectionner
   Node 22+, le mode Production et la racine du dépôt comme Application Root.
   Renseigner `app.cjs` comme fichier de démarrage Passenger.
3. **Base** : créer une base PostgreSQL et un utilisateur dédié avec droits limités
   à cette base. Si l’offre n’a que MySQL, ce code ne peut pas fonctionner sans
   adaptation : choisir une base PostgreSQL externe ou une offre compatible.
4. **Variables** : ajouter `DATABASE_URL`, un `SESSION_SECRET` aléatoire de 32+
   caractères, `NODE_ENV=production`, `APP_ORIGIN=https://votre-domaine` (sans `/`
   final), `ENABLE_DEMO=false`, `STORAGE_DIR` absolu et `VAPID_SUBJECT`.
   Ajouter `FILE_ENCRYPTION_KEY` si une clé de fichiers indépendante est souhaitée.
5. **Stockage** : créer le répertoire `STORAGE_DIR` hors du Document Root, appartenant
   à l’utilisateur du processus Node, permissions 700 pour le répertoire, 600 pour
   les fichiers. Ne jamais exposer `/storage` via Nginx ou Apache.
6. **Dépendances** : lancer `npm install` via Plesk ou le terminal. Installer
   FFprobe via le mécanisme autorisé par l’offre ; renseigner `FFPROBE_PATH` si son
   emplacement n’est pas dans PATH. Sans lui, les vocaux sont refusés explicitement.
7. **Schéma externe** : appliquer le SQL initial ci-dessus une seule fois sur une
   base vide. Pour les mises à jour, générer une migration, la relire et la tester
   en préproduction avant de l’appliquer sur la base externe. Sauvegarder d’abord.
8. **Compte support** : définir temporairement `ADMIN_USERNAME` et `ADMIN_PASSWORD`,
   lancer le seed, puis retirer le mot de passe des variables du processus.
9. **Build** : lancer `npm run build:standalone`. Le Document Root peut être
   `artifacts/biz-connect/dist/public` si Passenger est bien activé pour toute
   l’application ; ne pas utiliser la racine du dépôt comme dossier public.
10. **Proxy/WebSocket** : activer le proxy HTTP et WebSocket pour `/api/socket.io/`,
    transmettre `Upgrade`, `Connection`, le vrai `Host`, `X-Forwarded-Proto=https`
    et `X-Forwarded-For`. Le serveur fait confiance à un niveau de proxy. Pour
    plusieurs niveaux, adapter ce réglage aux adresses de proxy de confiance,
    ne pas ouvrir le port Node directement à Internet.
11. **Redémarrage** : cliquer sur Restart App. Vérifier `/api/healthz`, puis tester
    un envoi entre deux navigateurs connectés avec des rôles différents.
12. **Téléphone** : installer depuis le navigateur, autoriser les notifications,
    fermer l’application et vérifier une notification entrante sur le téléphone.

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
- Sauvegarder quotidiennement PostgreSQL (`pg_dump`, restauration via `pg_restore`)
  et `STORAGE_DIR` de façon cohérente, chiffrer les sauvegardes, conserver les clés
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
