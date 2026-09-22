import { requireAdmin } from '../../../../utils/admin-auth'
import { STATUTS_SUIVI, dossierContact, leviers, leviersPourConstats, libelleSource, prioriteCommerciale } from '../../../../utils/admin-metier'
import { statutRapport } from '../../prospects.get'
import { angleEntretien } from '../../../../utils/pdf'

/** GET /api/admin/prospects/:id — A04 et A05 : fiche complète d'un contact. Rôle Lecture seule. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event, 'lecture')
  const id = getRouterParam(event, 'id')!
  const { rows } = await db().query<Record<string, any>>(
    `select c.id, c.prenom, c.nom, c.email_norm::text as email, c.phone_e164, c.entreprise, c.secteur, c.secteur_autre,
            c.taille, c.pays, c.contact_allowed, c.match_conflict, c.created_at,
            s.statut as suivi_statut, s.assignee_id, s.updated_at as suivi_maj,
            a.prenom || ' ' || a.nom as assignee_nom
       from contact c
       left join prospect_suivi s on s.contact_id = c.id
       left join admin_user a on a.id = s.assignee_id
      where c.id = $1`,
    [id],
  )
  const c = rows[0]
  if (!c) throw apiError(event, 'NOT_FOUND', 'Prospect introuvable.')

  const dossier = await dossierContact(id)
  const premiere = dossier.participations.at(-1) ?? null
  const derniere = dossier.participations[0] ?? null

  const src = premiere
    ? (await db().query<Record<string, any>>(`select utm_source, utm_medium, referrer, fbclid, gclid, device, landing_url from acquisition where session_id = $1`, [premiere.session_id])).rows[0]
    : null

  const rapports = await db().query<Record<string, any>>(
    `select r.id, r.status, r.created_at, r.editorial_version, r.snapshot_refs,
            coalesce(json_agg(json_build_object('id', n.id, 'template', n.template, 'recipient', n.recipient, 'status', n.status,
                                                 'attempts', n.attempts, 'last_error', n.last_error, 'created_at', n.created_at, 'updated_at', n.updated_at)
                              order by n.created_at desc) filter (where n.id is not null), '[]') as notifications
       from report r left join notification n on n.report_id = r.id
      where r.contact_id = $1 group by r.id order by r.created_at desc`,
    [id],
  )
  const notes = await db().query<Record<string, any>>(
    `select n.id, n.texte, n.created_at, n.source, a.prenom || ' ' || a.nom as auteur
       from prospect_note n left join admin_user a on a.id = n.author_id
      where n.contact_id = $1 order by n.created_at desc`,
    [id],
  )
  const consentements = await db().query<Record<string, any>>(
    `select type, statut, text_version, source, created_at from consent_record where contact_id = $1 order by created_at desc`,
    [id],
  )
  const historique = await db().query<Record<string, any>>(
    `select l.action, l.target_type, l.target_id, l.payload_min, l.ts, a.prenom || ' ' || a.nom as acteur
       from audit_log l left join admin_user a on a.id = l.actor_id
      where (l.target_type = 'contact' and l.target_id = $1::text)
         or (l.target_type = 'report' and l.target_id in (select id::text from report where contact_id = $1::uuid))
      order by l.ts desc limit 100`,
    [id],
  )
  const assignables = await db().query<{ id: string; nom: string }>(
    `select id, prenom || ' ' || nom as nom from admin_user where status = 'active' and role in ('commercial', 'analyste', 'admin') order by nom`,
  )

  const whatsapp = Boolean(c.phone_e164)
  const deux = Boolean(dossier.dirigeant && dossier.rayonnement)
  const priorite = prioriteCommerciale(dossier.constats, deux, whatsapp)
  const tous = await leviers()
  const dernierRapport = rapports.rows[0]
  const dernierNotif = dernierRapport?.notifications?.[0]

  const leviersRattaches = leviersPourConstats(tous, dossier.constats)
  const angle = angleEntretien({ constats: dossier.constats, leviers: leviersRattaches, dirigeant: dossier.dirigeant as any, contact: c as any })
  return {
    contact: {
      id: c.id,
      prenom: c.prenom,
      nom: c.nom,
      email: c.email,
      telephone: c.phone_e164,
      entreprise: c.entreprise,
      secteur: c.secteur === 'Autre' && c.secteur_autre ? c.secteur_autre : c.secteur,
      taille: c.taille,
      pays: c.pays,
      contactAllowed: c.contact_allowed,
      matchConflict: c.match_conflict,
      creeLe: c.created_at,
      whatsapp,
    },
    activite: {
      premiere: premiere?.started_at ?? c.created_at,
      derniere: derniere?.completed_at ?? derniere?.started_at ?? c.created_at,
      source: libelleSource(src),
      appareil: src?.device ?? null,
      landing: src?.landing_url ?? null,
    },
    suivi: {
      statut: c.suivi_statut ?? 'a_contacter',
      statutLabel: STATUTS_SUIVI[c.suivi_statut ?? 'a_contacter'],
      assigneeId: c.assignee_id,
      assigneeNom: c.assignee_nom,
      majLe: c.suivi_maj,
      statuts: Object.entries(STATUTS_SUIVI).map(([value, label]) => ({ value, label })),
      assignables: assignables.rows,
    },
    notes: notes.rows,
    priorite,
    deux,
    ...dossier,
    leviers: leviersRattaches,
    angle,
    rapports: rapports.rows,
    rapportStatut: statutRapport(dernierRapport?.status ?? null, dernierNotif?.status ?? null),
    consentements: consentements.rows,
    historique: historique.rows,
  }
})
