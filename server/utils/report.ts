import type { H3Event } from 'h3'
import {
  crossReading,
  scoreDirigeant,
  scoreRayonnement,
  toPublicDirigeant,
  toPublicRayonnement,
  type Answers,
  type PublicDirigeantResult,
  type PublicRayonnementResult,
} from '@radar/scoring'

export interface RapportPublic {
  id: string
  status: 'pending' | 'ready' | 'revoked'
  etabliLe: string
  version: string
  contact: { prenom: string; nom: string; email: string; entreprise: string | null; telephone: string | null }
  dirigeant: PublicDirigeantResult | null
  rayonnement: PublicRayonnementResult | null
  /** Présente seulement quand les deux diagnostics figurent au rapport. */
  croisement: {
    code: string
    pilotage: number
    rayonnement: number
    ecart: number
    qualificatif: string
    ecartLecture: string
    ecartAction: string
    lecture: string
    interpretation: string
    formulation: string
    prioriteMarketing: string
  } | null
}

/**
 * Rapport public (P12) : relu depuis le jeton de rapport remis en P10. Le jeton n'est
 * pas lié à la session — il est envoyé par email et doit rester consultable plus tard.
 * Les projections sont recalculées par le moteur depuis les réponses figées, comme en P08/P09.
 * `prioriteFeexpay` ne sort jamais : aucune recommandation produit côté public (CDC).
 */
export async function reportByToken(event: H3Event, token: string): Promise<RapportPublic> {
  const r = await reportById(null, hashToken(token))
  if (!r) throw apiError(event, 'NOT_FOUND', 'Rapport introuvable.')
  return r
}

/**
 * Charge un rapport par son identifiant, ou par l'empreinte de son jeton quand `id` est null.
 * Null si le rapport n'existe pas ou est révoqué. Sans requête HTTP : la relance planifiée
 * s'en sert.
 */
export async function reportById(id: string | null, tokenHash?: string): Promise<RapportPublic | null> {
  const { rows } = await db().query<{
    id: string
    status: 'pending' | 'ready' | 'revoked'
    created_at: Date
    editorial_version: string
    prenom: string
    nom: string
    email_norm: string
    entreprise: string | null
    phone_e164: string | null
    snapshot_refs: { score_snapshot_ids?: string[] }
  }>(
    `select r.id, r.status, r.created_at, r.editorial_version, r.snapshot_refs,
            c.prenom, c.nom, c.email_norm::text, c.entreprise, c.phone_e164
       from report r join contact c on c.id = r.contact_id
      where ($1::uuid is not null and r.id = $1::uuid) or ($1::uuid is null and r.token_hash = $2)`,
    [id, tokenHash ?? null],
  )
  const r = rows[0]
  if (!r || r.status === 'revoked') return null

  const ids = r.snapshot_refs?.score_snapshot_ids ?? []
  const parts = ids.length
    ? await db().query<{ id: string; diagnostic_type: 'dirigeant' | 'rayonnement'; version: string }>(
        `select p.id, p.diagnostic_type, v.version
           from score_snapshot s
           join participation p on p.id = s.participation_id
           join scoring_version v on v.id = p.version_id
          where s.id = any($1::uuid[])`,
        [ids],
      )
    : { rows: [] as { id: string; diagnostic_type: 'dirigeant' | 'rayonnement'; version: string }[] }

  let dirigeant: PublicDirigeantResult | null = null
  let rayonnement: PublicRayonnementResult | null = null
  let croisement: RapportPublic['croisement'] = null
  let rDir: ReturnType<typeof scoreDirigeant> | null = null
  let rRay: ReturnType<typeof scoreRayonnement> | null = null

  for (const p of parts.rows) {
    const answers = (await engineAnswers(p.id)) as Answers
    if (p.diagnostic_type === 'dirigeant') {
      rDir = scoreDirigeant(answers, p.version)
      dirigeant = toPublicDirigeant(rDir)
    } else {
      rRay = scoreRayonnement(answers, p.version)
      rayonnement = toPublicRayonnement(rRay, answers)
    }
  }
  if (rDir && rRay && rDir.version === rRay.version) {
    const cr = crossReading(rDir, rRay)
    croisement = {
      code: cr.code,
      pilotage: Math.round(cr.pilotage),
      rayonnement: Math.round(cr.rayonnement),
      ecart: Math.round(cr.ecart),
      qualificatif: cr.qualificatif,
      ecartLecture: cr.ecartLecture,
      ecartAction: cr.ecartAction,
      lecture: cr.lecture,
      interpretation: cr.interpretation,
      formulation: cr.formulation,
      prioriteMarketing: cr.prioriteMarketing,
    }
  }

  return {
    id: r.id,
    status: r.status,
    etabliLe: r.created_at.toISOString(),
    version: r.editorial_version,
    contact: { prenom: r.prenom, nom: r.nom, email: r.email_norm, entreprise: r.entreprise, telephone: r.phone_e164 },
    dirigeant,
    rayonnement,
    croisement,
  }
}

/** Libellé du rapport tel qu'affiché en P10/P11 : « Votre rapport Stratège complet ». */
export function nomRapport(r: RapportPublic): string {
  if (r.dirigeant) return `Votre rapport ${r.dirigeant.archetype.code} complet`
  return 'Votre rapport Rayonnement complet'
}
