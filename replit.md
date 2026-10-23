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

- Authentification personnalisée explicitement demandée : numéro Academy haché
  pour les membres, mot de passe bcrypt pour les admins, JWT httpOnly + refresh
  rotatif en base. Ne pas remplacer par un autre fournisseur sans accord.
- L’API réelle Academy n’a pas été fournie. Son vérificateur est isolé ; pas de
  validation permissive de comptes arbitraires.
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
PostgreSQL externe confirmée. Voir README pour sauvegardes et prérequis.
