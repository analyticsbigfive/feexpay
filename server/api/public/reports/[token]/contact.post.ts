import { z } from 'zod'
import { CANAUX_CONTACT, envoyerDemandeContact } from '../../../../utils/email'
import { reportByToken } from '../../../../utils/report'
import { reglages } from '../../../../utils/settings'

/**
 * POST /api/public/reports/{token}/contact — demande de contact déposée depuis P12.
 *
 * Remplace le `mailto:` du bouton « Contacter FeexPay » : sur mobile et dans les webmails,
 * il n'ouvrait souvent rien, et la demande partait sans laisser de trace.
 *
 * Le jeton de rapport suffit, comme pour la lecture du rapport : il est reçu par email et
 * n'est pas lié à une session. Il désigne aussi le contact, ce qui évite de redemander une
 * identité déjà connue — seuls le message, le téléphone et le canal souhaité sont saisis.
 *
 * Ordre des opérations : la note est posée sur la fiche prospect **avant** l'envoi de
 * l'email. Si Resend échoue, la demande reste visible par l'équipe dans A04 plutôt que
 * d'être perdue ; la réponse dit alors que l'email n'est pas parti.
 */
const Body = z
  .object({
    message: z.string().trim().min(10, 'Message trop court.').max(1500),
    telephone: z
      .string()
      .trim()
      .regex(/^\+[1-9][0-9]{6,14}$/, 'Numéro attendu au format international, ex. +2250700000000')
      .optional()
      .or(z.literal('')),
    canal: z.enum(Object.keys(CANAUX_CONTACT) as [keyof typeof CANAUX_CONTACT, ...(keyof typeof CANAUX_CONTACT)[]]),
  })
  .strict()

/** Un même rapport ne dépose pas deux demandes coup sur coup : double clic, ou réémission. */
const DELAI_MIN = '2 minutes'

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')
  if (!token || token.length < 20) throw apiError(event, 'VALIDATION_ERROR', 'Jeton manquant.')

  const parsed = Body.safeParse(await readBody(event).catch(() => null))
  if (!parsed.success) throw apiError(event, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Formulaire invalide.')
  const { message, canal } = parsed.data
  const telephone = parsed.data.telephone || null
  // Un rappel ou un message WhatsApp sans numéro n'a pas de destination.
  if (canal !== 'email' && !telephone) {
    throw apiError(event, 'VALIDATION_ERROR', 'Indiquez un numéro pour être joint par ce canal.')
  }

  const { rows } = await db().query<{ contact_id: string }>(
    `select r.contact_id from report r where r.token_hash = $1 and r.status <> 'revoked'`,
    [hashToken(token)],
  )
  const contactId = rows[0]?.contact_id
  if (!contactId) throw apiError(event, 'NOT_FOUND', 'Rapport introuvable.')

  const recente = await db().query(
    `select 1 from prospect_note
      where contact_id = $1 and source = 'dirigeant' and created_at > now() - interval '${DELAI_MIN}'`,
    [contactId],
  )
  if (recente.rowCount) {
    throw apiError(event, 'DUPLICATE_SUBMISSION', 'Votre demande vient d’être enregistrée. Un conseiller vous répond au plus vite.')
  }

  const rapport = await reportByToken(event, token)
  const lien = `${useRuntimeConfig().public.appBaseUrl}/rapport/${token}`

  // Note et suivi commercial dans la même transaction : l'équipe voit la demande et le
  // prospect remonte dans sa file. Un prospect déjà pris en main ou converti ne redescend
  // pas à « à contacter » — la demande n'est pas une régression de son suivi.
  await tx(async (c) => {
    await c.query(
      `insert into prospect_note (contact_id, author_id, texte, source) values ($1, null, $2, 'dirigeant')`,
      [
        contactId,
        [
          `Demande de contact depuis le rapport (${CANAUX_CONTACT[canal]}${telephone ? ` · ${telephone}` : ''}) :`,
          message,
        ]
          .join('\n')
          .slice(0, 2000),
      ],
    )
    await c.query(
      `insert into prospect_suivi (contact_id, statut, updated_at) values ($1, 'a_contacter', now())
       on conflict (contact_id) do update
         set statut = case when prospect_suivi.statut in ('en_cours', 'rendez_vous', 'converti')
                           then prospect_suivi.statut else 'a_contacter' end,
             updated_at = now()`,
      [contactId],
    )
    // Un numéro donné ici complète une fiche qui n'en portait pas ; il ne remplace jamais
    // celui déjà enregistré (même règle qu'en P10, audit du 11 septembre 2026).
    if (telephone) {
      await c.query(`update contact set phone_e164 = coalesce(phone_e164, $2) where id = $1`, [contactId, telephone])
    }
  })

  const destinataire = (await reglages()).contact_commercial_email || 'contact.ci@feexpay.me'
  const envoi = await envoyerDemandeContact(rapport, lien, destinataire, { message, telephone, canal })

  setResponseStatus(event, 201)
  return { ok: true, envoye: envoi.sent, destinataire, correlation_id: event.context.correlationId }
})
