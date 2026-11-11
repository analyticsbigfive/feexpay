import type { H3Event } from 'h3'
import { executerControles, getVersion, listVersions, type ResultatControle } from '@radar/scoring'
import { audit } from './admin-auth'

/**
 * T01 — registre des versions de scoring. Les versions vivent dans le code
 * (`packages/scoring/src/versions/`) ; la base porte le registre publié (questions, options,
 * checksum) pour les jointures métier. Publier une version : vérifier qu'elle existe dans le
 * code, que son checksum correspond si elle est déjà en base, que les cas de contrôle §5.5
 * passent, puis archiver la version publiée et activer la nouvelle. Le retour arrière est la
 * réactivation d'une version archivée : rien n'est jamais recalculé, chaque participation
 * garde sa version.
 */
export interface VersionRegistre {
  version: string
  enBase: boolean
  enCode: boolean
  status: 'published' | 'archived' | 'draft' | 'absente'
  checksum: string | null
  checksumCode: string | null
  checksumOk: boolean
  publishedAt: Date | null
  questions: number
  options: number
  participations: number
  courante: boolean
}

export async function registreVersions(): Promise<VersionRegistre[]> {
  const { rows } = await db().query<Record<string, any>>(
    `select v.id, v.version, v.status, v.checksum, v.published_at,
            (select count(*) from question q where q.version_id = v.id) as questions,
            (select count(*) from "option" o join question q on q.id = o.question_id where q.version_id = v.id) as options,
            (select count(*) from participation p where p.version_id = v.id) as participations
       from scoring_version v`,
  )
  const versions = new Set([...listVersions(), ...rows.map((r) => r.version as string)])
  return [...versions]
    .sort((a, b) => Number(b) - Number(a))
    .map((version) => {
      const r = rows.find((x) => x.version === version)
      const enCode = listVersions().includes(version)
      const checksumCode = enCode ? getVersion(version).checksum : null
      return {
        version,
        enBase: Boolean(r),
        enCode,
        status: r ? r.status : 'absente',
        checksum: r?.checksum ?? null,
        checksumCode,
        checksumOk: !r || !checksumCode || r.checksum === checksumCode,
        publishedAt: r?.published_at ?? null,
        questions: Number(r?.questions ?? 0),
        options: Number(r?.options ?? 0),
        participations: Number(r?.participations ?? 0),
        courante: r?.status === 'published',
      }
    })
}

export interface Publication {
  /** Conformité : la version existe dans le moteur déployé, son empreinte correspond et tous les contrôles passent. */
  ok: boolean
  /** Conforme et pas déjà publiée : le bouton de publication ou de réactivation peut s'afficher. */
  publiable: boolean
  controles: ResultatControle[]
  /** Défauts de conformité. Vide quand `ok` est vrai. */
  erreurs: string[]
  /** État de la version qui empêche de la publier sans être un défaut (« déjà publiée »). */
  remarques: string[]
  /** Empreinte enregistrée en base comparée à celle du moteur déployé. `base` est nul pour une version jamais publiée. */
  empreinte: { base: string | null; code: string | null; identique: boolean }
  action: 'publiee' | 'reactivee' | 'refusee'
}

/**
 * Contrôles avant publication, sans effet en base. « Déjà publiée » est une remarque et non
 * un écart : la version publiée doit pouvoir s'afficher conforme.
 */
export async function controlerVersion(version: string): Promise<Omit<Publication, 'action'>> {
  if (!listVersions().includes(version)) {
    return {
      ok: false,
      publiable: false,
      controles: [],
      erreurs: [`La version ${version} n’existe pas dans le moteur déployé.`],
      remarques: [],
      empreinte: { base: null, code: null, identique: false },
    }
  }
  const erreurs: string[] = []
  const remarques: string[] = []
  const code = getVersion(version)
  const { rows } = await db().query<{ status: string; checksum: string }>(`select status, checksum from scoring_version where version = $1`, [version])
  const base = rows[0]?.checksum ?? null
  const identique = base === null || base === code.checksum
  if (!identique) {
    erreurs.push(`Le checksum en base (${base!.slice(0, 12)}…) diffère de celui du code (${code.checksum.slice(0, 12)}…) : une version publiée est immuable, publier une nouvelle version.`)
  }
  const controles = executerControles(version)
  const rates = controles.filter((c) => !c.ok)
  if (rates.length) erreurs.push(`${rates.length} contrôle${rates.length > 1 ? 's' : ''} en échec.`)
  if (rows[0]?.status === 'published') remarques.push(`La version ${version} est la version publiée.`)
  const ok = erreurs.length === 0
  return { ok, publiable: ok && remarques.length === 0, controles, erreurs, remarques, empreinte: { base, code: code.checksum, identique } }
}

export async function publierVersion(event: H3Event, version: string): Promise<Publication> {
  const c = await controlerVersion(version)
  if (!c.publiable) return { ...c, erreurs: [...c.erreurs, ...c.remarques], action: 'refusee' }
  const code = getVersion(version)
  const admin = event.context.admin as { user: { id: string } }

  const action = await tx(async (cl) => {
    const existante = await cl.query<{ id: string; status: string }>(`select id, status from scoring_version where version = $1 for update`, [version])
    await cl.query(`update scoring_version set status = 'archived', updated_at = now() where status = 'published'`)
    if (existante.rows[0]) {
      await cl.query(`update scoring_version set status = 'published', updated_at = now() where id = $1`, [existante.rows[0].id])
      return 'reactivee' as const
    }
    const ins = await cl.query<{ id: string }>(
      `insert into scoring_version (version, status, checksum, published_at, author_id) values ($1, 'published', $2, now(), $3) returning id`,
      [version, code.checksum, admin.user.id],
    )
    const vid = ins.rows[0]!.id
    const qid = new Map<string, string>()
    for (const q of code.questions) {
      const r = await cl.query<{ id: string }>(
        `insert into question (version_id, code, diagnostic_type, ordre, texte) values ($1, $2, $3, $4, $5) returning id`,
        [vid, q.code, q.type, q.ordre, q.texte],
      )
      qid.set(q.code, r.rows[0]!.id)
    }
    for (const o of code.options) {
      const { code: oc, questionCode, lettre, texte, ...mapping } = o as any
      await cl.query(`insert into "option" (question_id, code, lettre, texte, mapping) values ($1, $2, $3, $4, $5)`, [
        qid.get(questionCode),
        oc,
        lettre,
        texte,
        JSON.stringify(mapping),
      ])
    }
    return 'publiee' as const
  })
  await audit(event, action === 'publiee' ? 'version.publish' : 'version.reactivate', 'scoring_version', version, { checksum: code.checksum, controles: c.controles.length })
  return { ...c, action }
}
