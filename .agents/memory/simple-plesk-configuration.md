---
name: Simple Plesk configuration
description: User requirement against manual storage-path configuration on Plesk.
---

L’utilisateur ne veut pas renseigner `STORAGE_DIR` ni rechercher un chemin
`/var/www/vhosts/.../private/...` : pour la connexion à Cybrancee, il considère
les champs CYBRANCEE_DB_HOST/PORT/NAME/USER/PASSWORD suffisants.

**Why:** l’utilisateur a refusé explicitement et à plusieurs reprises cette
configuration de stockage manuelle.

**How to apply:** choisir un stockage privé automatique et persistant hors du
site public et des fichiers remplacés par Git. Ne pas réintroduire un chemin
obligatoire ou lui redemander ce chemin. Cela ne signifie pas supprimer la
sécurité des sessions ou les clés de chiffrement déjà configurées.
