#!/bin/sh
# Remplace les tâches planifiées de vercel.json. Usage : cron.sh abandon | cron.sh relance
#   0 3 * * * /var/www/radar.feexpay.me/cron.sh abandon
#   0 8 * * * /var/www/radar.feexpay.me/cron.sh relance
set -eu
cd "$(dirname "$0")"
# Lu comme Docker Compose lit le .env : commentaire de fin de ligne et guillemets retirés.
SECRET=$(sed -n 's/^CRON_SECRET=//p' .env | sed -e 's/[[:space:]]#.*$//' -e 's/[[:space:]]*$//' -e 's/^["'\'']\(.*\)["'\'']$/\1/')
curl -fsS --max-time 120 -H "Authorization: Bearer $SECRET" "http://127.0.0.1:7000/api/cron/$1"
echo
