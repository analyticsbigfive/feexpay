#!/bin/sh
set -e

# Le .env des serveurs garde les noms de .env.example (SUPABASE_URL…). Nuxt lit ces noms au
# build seulement ; à l'exécution, il ne reconnaît que NUXT_<clé de runtimeConfig>. Une
# variable vide n'est pas relayée, pour laisser la valeur par défaut de nuxt.config.ts.
relaie() {
  eval "valeur=\${$1:-}"
  [ -n "$valeur" ] && export "$2=$valeur"
  return 0
}
relaie SUPABASE_URL NUXT_SUPABASE_URL
relaie SUPABASE_URL NUXT_PUBLIC_SUPABASE_URL
relaie SUPABASE_KEY NUXT_PUBLIC_SUPABASE_KEY
relaie SUPABASE_SERVICE_KEY NUXT_SUPABASE_SERVICE_KEY
relaie DATABASE_URL NUXT_DATABASE_URL
relaie RESEND_API_KEY NUXT_RESEND_API_KEY
relaie RESEND_WEBHOOK_SECRET NUXT_RESEND_WEBHOOK_SECRET
relaie RESEND_FROM NUXT_RESEND_FROM
relaie CRON_SECRET NUXT_CRON_SECRET
relaie APP_BASE_URL NUXT_PUBLIC_APP_BASE_URL
relaie PUBLIC_GA4_MEASUREMENT_ID NUXT_PUBLIC_GA4_MEASUREMENT_ID
relaie PUBLIC_META_PIXEL_ID NUXT_PUBLIC_META_PIXEL_ID
relaie TRACKING_ENABLED NUXT_PUBLIC_TRACKING_ENABLED

echo "Running migrations..."
node scripts/migrate.mjs
echo "Seeding..."
# Publie la version 2.2 du moteur si elle n'est pas en base, sinon ne fait rien.
# Node 22 exécute le TypeScript directement ; l'avertissement vient de package.json, sans
# "type": "module", qu'on ne change pas pour un script.
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/seed-scoring-version.ts

exec "$@"
