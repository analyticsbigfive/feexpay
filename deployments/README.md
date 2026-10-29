# Déploiement — Radar by FeexPay

Un seul environnement : `radar.feexpay.me`, sur le VPS Contabo.

| Branche | Image | Serveur | Dossier sur le serveur |
|---|---|---|---|
| `main` | `registry.feexpay.me/radar-prod` | VPS Contabo (SSH par mot de passe) | `/var/www/radar.feexpay.me` |

L'application écoute sur le port **7000**, ouvert sur `127.0.0.1` seulement : nginx, sur le
même VPS, sert le domaine en HTTPS. La base est un projet **Supabase** : l'espace admin
repose sur Supabase Auth, un Postgres seul ne suffit pas.

## Arborescence

```
deployments/
├── radar.feexpay.me/
│   ├── compose.yaml      image radar-prod:latest, port 127.0.0.1:7000
│   ├── .env.example      à copier en .env sur le serveur
│   └── cron.sh           tâches planifiées (remplace vercel.json)
└── README.md
```

## Ce qui se passe au démarrage du conteneur

`docker-entrypoint.sh`, à la racine du dépôt :

1. relaie les variables du `.env` (`SUPABASE_URL`…) sous les noms que Nuxt lit à
   l'exécution (`NUXT_SUPABASE_URL`…) ;
2. `scripts/migrate.mjs` : applique les fichiers de `supabase/migrations/` absents de la table
   `radar_migration` ;
3. `scripts/seed-scoring-version.ts` : publie la version 2.2 du moteur si elle n'est pas en
   base ;
4. lance le serveur.

Les étapes 2 et 3 ne font rien quand la base est à jour.

## Prérequis serveur

- Docker et le plugin Compose (`docker compose version`).
- `curl` (pour `cron.sh`).
- nginx et certbot.
- Le port 7000 libre : `sudo ss -ltnp | grep 7000`.

## Mise en place (une fois)

Depuis la racine du dépôt :

```bash
ssh <user>@<vps> 'sudo mkdir -p /var/www/radar.feexpay.me && sudo chown $USER /var/www/radar.feexpay.me'
scp -r deployments/radar.feexpay.me/. <user>@<vps>:/var/www/radar.feexpay.me/
```

Puis sur le VPS :

```bash
cd /var/www/radar.feexpay.me
cp .env.example .env && chmod 600 .env
nano .env                  # remplir les valeurs
chmod +x cron.sh
crontab -e                 # ajouter les deux lignes ci-dessous
```

```
0 3 * * * /var/www/radar.feexpay.me/cron.sh abandon
0 8 * * * /var/www/radar.feexpay.me/cron.sh relance
```

Heures en UTC, comme sur Vercel : à décaler si le VPS est sur un autre fuseau (`date`).

### nginx

`/etc/nginx/sites-available/radar.feexpay.me`, puis lien dans `sites-enabled`,
`sudo nginx -t && sudo systemctl reload nginx`, et `sudo certbot --nginx -d radar.feexpay.me`
une fois le DNS propagé (enregistrement A `radar` → IP du VPS).

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name radar.feexpay.me;

    location / {
        proxy_pass http://127.0.0.1:7000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        # Remplacé, pas complété : l'application journalise la première adresse de
        # X-Forwarded-For, qu'un client ne doit pas pouvoir choisir.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    client_max_body_size 1m;
}
```

Les en-têtes de sécurité (HSTS, CSP…) sont posés par l'application : ne pas les doubler.

### Le `.env`

- `DATABASE_URL` : chaîne du **pooler Supavisor en mode session** (port 5432), prise dans
  Supabase → Connect. Pas le port 6543.
- `APP_BASE_URL=https://radar.feexpay.me` : sert à construire les liens envoyés par email
  (invitation admin, mot de passe oublié, rapport, suppression de données).
- `MIGRATIONS_BASELINE=true` **uniquement** si la base a déjà reçu les migrations à la main
  (cas du projet Supabase actuel du prestataire). Au premier démarrage, les fichiers sont
  notés comme appliqués sans être rejoués. Remettre `false` ensuite.
- `CRON_SECRET` : une longue chaîne aléatoire (`openssl rand -hex 32`).

### Premier administrateur

Le seed ne crée pas de compte admin. Une fois l'application démarrée, depuis un poste avec
le dépôt et un `.env` pointant la même base, avec `APP_BASE_URL=https://radar.feexpay.me` :
`pnpm seed:admins`, qui imprime les liens d'invitation.

## Secrets GitHub

Settings → Secrets and variables → Actions :

| Secret | Usage |
|---|---|
| `REGISTRY_USERNAME` / `REGISTRY_PASSWORD` | registry.feexpay.me |
| `VPS_HOST` / `VPS_USERNAME` / `VPS_PASSWORD` | VPS Contabo |

## Déclencher un déploiement

1. Incrémenter `version` dans `package.json` (ex. `1.0.0` → `1.0.1`).
2. Pousser sur `main`.

Un push qui ne modifie pas `package.json` ne déploie rien. Pour relancer sans changer de
version : Actions → Deploy Production → Run workflow.

Le job tourne sur le runner self-hosted `lavedette-signoz`. Le secours est **manuel** : si ce
runner est hors ligne, un run déclenché par push reste en « Queued ». L'annuler, puis
Actions → Deploy Production → Run workflow, branche `main`, `runner = ubuntu-latest`. Le
job ne s'exécute que sur `main` : lancé depuis une autre branche, il est ignoré.

Le workflow lance d'abord `pnpm test` (moteur de scoring et migrations sur une base en
mémoire). Si un test échoue, aucune image n'est publiée.

## Commandes utiles

```bash
cd /var/www/radar.feexpay.me
docker compose logs -f                 # journaux (migrations au démarrage, puis serveur)
docker compose ps                      # état du conteneur
docker compose restart                 # redémarrage (rejoue migrations et seed, sans effet si à jour)
docker compose pull && docker compose up -d   # tirer et lancer la dernière image
curl -s http://127.0.0.1:7000/api/public/health   # version du moteur embarquée
./cron.sh abandon                      # lancer une tâche planifiée à la main
```

Revenir à une version précédente : remplacer `:latest` par `:1.0.0` (par exemple) dans
`compose.yaml`, puis `docker compose up -d`. Remettre `:latest` au déploiement suivant.

## Troubleshooting

**Le conteneur redémarre en boucle, `✗ migration échouée` dans les logs.**
Lire le nom du fichier et l'erreur dans `docker compose logs`. Causes fréquentes :
- `relation "…" already exists` : la base a été migrée à la main et `radar_migration` est
  vide. Mettre `MIGRATIONS_BASELINE=true`, `docker compose up -d`, puis remettre `false`.
- `schema "auth" does not exist` ou `role "anon" does not exist` : la base n'est pas un
  projet Supabase.

**Base injoignable (`ENETUNREACH`, `ETIMEDOUT`, `getaddrinfo`).**
`DATABASE_URL` pointe la connexion directe au lieu du pooler, ou le VPS ne peut pas sortir
sur le port 5432. Tester : `docker compose run --rm --entrypoint node radar -e
"new (require('pg').Client)({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}).connect().then(()=>console.log('ok'))"`.

**`prepared statement "…" already exists`.**
`DATABASE_URL` utilise le port 6543 (mode transaction). Passer au port 5432.

**`Bind for 127.0.0.1:7000 failed: port is already allocated`.**
Un autre service occupe le port : `sudo ss -ltnp | grep 7000`. Changer le port à gauche
dans `compose.yaml` (`"127.0.0.1:7001:7000"`), dans `proxy_pass` et dans `cron.sh`, ou
libérer le port.

**502 Bad Gateway.**
Le conteneur ne tourne pas ou démarre encore (`docker compose ps`, `docker compose logs`).

**Migrations non jouées après un déploiement.**
Vérifier que l'image tirée est la bonne : `docker compose images` doit montrer la date du
dernier build. Puis `docker compose logs | grep -A20 "Running migrations"`.

**`pull access denied` / `manifest unknown` / `unauthorized`.**
Le workflow fait `docker login` sur le VPS avant chaque `docker pull` : vérifier
`REGISTRY_USERNAME` et `REGISTRY_PASSWORD` dans GitHub, et que l'`image:` de `compose.yaml`
correspond à `REPOSITORY_NAME` du workflow (`radar-prod`). Une commande `docker compose`
lancée à la main utilise la connexion laissée par le dernier déploiement.

**`cron.sh` renvoie 401 ou 403.**
403 : `CRON_SECRET` vide dans le `.env` vu par le conteneur (redémarrer après l'avoir
rempli). 401 : la valeur lue par `cron.sh` diffère de celle du conteneur.

**Les emails n'arrivent pas.**
Sans domaine vérifié chez Resend, seul le titulaire du compte Resend reçoit les emails. Voir
`docs/DNS_radar.feexpay.me.md`.
