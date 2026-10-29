/**
 * Applique les migrations de supabase/migrations/ qui ne l'ont pas encore été.
 *
 * Lancé à chaque démarrage du conteneur (docker-entrypoint.sh) : doit être sans effet
 * quand tout est à jour. Les fichiers joués sont notés dans `radar_migration`.
 *
 * Base déjà migrée à la main (projet Supabase existant) : démarrer une fois avec
 * MIGRATIONS_BASELINE=true. Si `radar_migration` est vide, tous les fichiers présents sont
 * notés comme appliqués sans être rejoués. La variable n'a plus d'effet ensuite.
 *
 *   node --env-file=.env scripts/migrate.mjs     (en local : pnpm db:migrate)
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations')
const fichiers = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

// Même clé pour tous les conteneurs : deux démarrages simultanés ne jouent pas deux fois
// le même fichier.
const VERROU = 'radar_migration'

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL manquant')
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', [VERROU])

    // RLS activée et forcée sans policy, comme toutes les tables du schéma : la table
    // n'est pas lisible par l'API REST de Supabase.
    await client.query(`
      create table if not exists radar_migration (
        fichier    text primary key,
        applied_at timestamptz not null default now()
      );
      alter table radar_migration enable row level security;
      alter table radar_migration force row level security;
    `)

    const { rows } = await client.query('select fichier from radar_migration')
    const faits = new Set(rows.map((r) => r.fichier))

    if (faits.size === 0 && process.env.MIGRATIONS_BASELINE === 'true') {
      for (const f of fichiers) {
        await client.query('insert into radar_migration (fichier) values ($1)', [f])
      }
      console.log(`✓ base existante : ${fichiers.length} migrations notées sans être rejouées`)
      return
    }

    const restants = fichiers.filter((f) => !faits.has(f))
    for (const f of restants) {
      const sql = readFileSync(join(dir, f), 'utf8')
      // Certains fichiers portent déjà leur begin/commit : on ne les emboîte pas dans un
      // second bloc, Postgres n'imbrique pas les transactions.
      const transactionPropre = /^\s*begin\s*;/im.test(sql)
      try {
        if (!transactionPropre) await client.query('begin')
        await client.query(sql)
        await client.query('insert into radar_migration (fichier) values ($1)', [f])
        if (!transactionPropre) await client.query('commit')
      } catch (err) {
        await client.query('rollback').catch(() => {})
        throw new Error(`${f} : ${err instanceof Error ? err.message : err}`)
      }
      console.log(`✓ ${f}`)
    }
    if (restants.length === 0) console.log('✓ migrations à jour, rien à faire.')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('✗ migration échouée :', err instanceof Error ? err.message : err)
  process.exit(1)
})
