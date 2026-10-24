# BCA Messenger

Messagerie privée française pour les membres de l’académie et les agents support.

## Exécution

- Frontend : workflow `artifacts/biz-connect: web`.
- API : workflow `artifacts/api-server: API Server`.
- `pnpm run typecheck` : vérification TypeScript complète.
- `pnpm --filter @workspace/api-spec run codegen` après modification du contrat.
- `pnpm --filter @workspace/db run push` : schéma de développement seulement.
- `pnpm --filter @workspace/api-server run seed:demo` : exemples en développement.
- Voir `README.md` pour les commandes npm autonomes et le guide Plesk.

## Décisions

- Hébergement de production demandé : Plesk/Cybrancee, pas Replit Core.
- Base de production demandée : MySQL/MariaDB sur Cybrancee. Les quatre champs
  CYBRANCEE_DB_HOST/NAME/USER/PASSWORD suffisent ; port 3306 par défaut, facultatif.
  PostgreSQL est conservé pour le développement existant, pas imposé en production.
- Livrer une distribution `plesk/` précompilée dans Git : après installation
  initiale, GitHub → Plesk → Deploy Now + Restart, jamais de build dans Plesk.
- Après tout changement applicatif, reconstruire `npm run build:plesk` avant
  livraison et vérifier `npm run verify:plesk`. Les dist intermédiaires restent
  ignorés ; les dépendances natives sont installées sur l'hôte, jamais commitées.
- Aucune migration externe automatique, aucun secret ni fichier privé dans Git.

- Identité visuelle : utiliser les deux logos BCA fournis par l’utilisateur à la
  place des marques provisoires. Le logo sur fond bleu est le logo principal de
  l’application, y compris sur l’écran d’ouverture de session, le favicon et
  l’icône de l’application installée. Conserver la variante colorée disponible.
- La notice d’installation doit toujours proposer « Installer » et « Plus tard »,
  sur téléphone, tablette et ordinateur. Si l’installation native n’est pas
  disponible, « Installer » affiche les étapes adaptées au navigateur, sans
  prétendre que l’application est installée.
- Toute activation des notifications doit aboutir à une confirmation ou à une
  erreur avec possibilité de réessayer, jamais à un chargement sans fin ni à une
  boucle automatique. L’autorisation du navigateur n’est pas à elle seule une
  confirmation de l’enregistrement auprès du serveur.
- Sessions de chat par nom et téléphone, avec création technique automatique
  d’une identité membre si le couple est nouveau, explicitement demandée par
  l’utilisateur sans parcours d’inscription/connexion. Téléphone normalisé ;
  empreinte bcrypt conservée pour les anciens comptes sans téléphone de profil.
  Aucune vérification SMS ni intégration Academy.
  Le couple nom + téléphone identifie un échange : même couple = ancien historique,
  autre couple (même nom compris) = nouvelle identité et nouvelle conversation.
  Ne jamais réinitialiser ou écraser un membre existant avec un autre numéro.
  Le risque d’accès par un tiers connaissant le nom et le téléphone a été expliqué.
  Mot de passe bcrypt obligatoire pour les comptes admins désignés dans la base,
  sans création automatique ni repli en mode membre pour leur nom réservé.
  JWT httpOnly + refresh rotatif en base ; ne pas changer de fournisseur sans accord.
- Sequelize à l’exécution, schéma Drizzle aligné pour l’intégration des migrations
  Replit. Aucun DDL ni seed automatique au démarrage.
- Stockage disque privé explicitement demandé pour l’hébergement Plesk. AES-GCM
  au repos ; disque persistant requis. Pas de fichiers sous le dossier public.
- Démonstration uniquement hors production ; pas d’auto-connexion.
- Une instance Node : présence et limites en mémoire. Adapter avant multi-instance.

## Consignes produit

- Nom de l’application : BCA Messenger.
- Connexion commune, sans mode ni bouton Équipe. Le rôle support vient uniquement
  de la table admins ; aucun accès admin de démonstration.
- Photo de l’expéditeur au début de chaque message reçu, avec initiales si absente.
- Coches : une blanche non reçu, deux blanches reçu non lu, deux or #D4AF37 lu.
- Les membres écrivent exclusivement au support, jamais entre eux.
- Session membre persistante : après saisie du nom d’utilisateur et du numéro de
  téléphone, revenir directement au chat sans ressaisie jusqu’à une déconnexion
  explicite, comme demandé par l’utilisateur.
- L’écran d’entrée est un formulaire « ouvrir une session de chat », pas une page
  d’inscription/connexion, avec le texte Biz Connect Academy fourni par l’utilisateur.
  Référence visuelle demandée : écran mobile sombre de messagerie.
- Proposer l’installation PWA dès la visite si l’application n’est pas installée ;
  proposer l’activation des notifications téléphone après ouverture de session.
  Ne jamais prétendre pouvoir contourner les permissions du navigateur ou d’iOS.

- Interface française, style Telegram ; bulles sortantes bleues #1E5EFF,
  entrantes vertes #16A34A ; or #D4AF37 pour accents et non-lus.
- Le membre n’a qu’une conversation support ; les agents voient la boîte commune.
- Les liens détectés sont limités à http(s), mailto et tel.
- Images dans une visionneuse interne, jamais un lien public ni un nouvel onglet.
- Ne jamais mettre des fichiers privés ou réponses API dans le cache PWA.
- Ne pas promettre de son push personnalisé en arrière-plan : dépend du navigateur.

## Sécurité d’exploitation

`SESSION_SECRET` existe dans Secrets. Ne jamais afficher ses valeurs ni celles
des variables sensibles. Le chiffrement et VAPID peuvent dériver des clés de ce
secret : sa rotation requiert une migration des fichiers et réabonnement push.

La base intégrée est migrée par Publish, pas par une migration de production
artisanale. Le SQL versionné n’est à appliquer manuellement que sur une base
externe confirmée, avec le SQL correspondant à son moteur : MySQL/MariaDB
(`plesk/schema/initial-mysql.sql`) ou PostgreSQL (`plesk/schema/initial.sql`).
Ne jamais convertir, vider ou réinitialiser une base existante automatiquement.
Voir README pour sauvegardes et prérequis.

## Vocaux et identité du support

- Le nom affiché du support est **Support BCA**. Le nom de l’application reste
  **BCA Messenger**.
- Les vocaux doivent permettre de maintenir le micro, glisser vers le haut pour
  verrouiller en mains libres, mettre en pause puis reprendre le même vocal,
  et terminer avec un envoi manuel explicite. Ne pas envoyer à la simple fin
  d’un maintien ; conserver l’aperçu en cas d’échec pour permettre de réessayer.
- Le destinataire peut écouter en **1×, 1,5× ou 2×**.
- Toute nouvelle session membre demande un numéro international commençant par
  **+ et l’indicatif du pays**. Ne pas réécrire les anciens comptes ni deviner
  leur pays. Les identifiants administrateurs existants restent utilisables.
- L’utilisateur demande le nom de l’expéditeur et un aperçu du message dans les
  notifications. Les réglages de confidentialité du téléphone restent prioritaires.
- À la demande de l’utilisateur, les deux participants peuvent supprimer un
  message reçu ou envoyé pour tout le monde, après confirmation explicite.
  La suppression personnelle ne concerne que le compte qui la demande.
- Installation et notifications : guides illustrés avec commandes ciblées sur
  iPhone/iPad, Android et ordinateur lorsqu’une demande native est impossible.
  Ne jamais promettre qu’un site peut autoriser ou ouvrir les réglages système.
- Le déploiement Plesk ne doit pas exiger une installation système manuelle
  d’un outil audio ni une configuration supplémentaire pour les vocaux.

## Temps réel

- Entrée doit toujours ajouter une ligne, sur ordinateur comme sur mobile ;
  seul le bouton d’envoi transmet un message, y compris une légende d’image.
- Les images du fil doivent rester compactes et les vocaux ne doivent pas
  télécharger leur fichier avant la première demande de lecture.
- Les réponses citées doivent permettre de retrouver l’original avec un
  surlignage or léger, sans télécharger l’historique entier.
- L’objectif utilisateur est de réduire la consommation de données et de servir
  plus de 100 membres simultanément ; ne pas promettre une durée fixe avec 100 Mo
  ni une capacité de production sans mesure sur le serveur concerné.

- Préférer l’intégration directe des événements Socket.IO au rechargement du
  fil à chaque message, coche ou changement de présence.
- Les réessais Socket.IO/HTTP partagent un identifiant stable afin qu’un accusé
  perdu ne crée pas deux messages. Une coche de lecture ne doit pas régresser
  si un accusé d’envoi arrive après la réception.
- Conserver le rattrapage après reconnexion, le repli HTTP, les sessions
  authentifiées et l’isolation des conversations membre/support.
