import { reportByToken } from '../../../utils/report'
import { reglages } from '../../../utils/settings'

/**
 * GET /api/public/reports/{token} — rapport détaillé (P12), consultable depuis le lien
 * remis en P11 et envoyé par email. Le jeton de rapport suffit : pas de session exigée.
 */
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')
  if (!token || token.length < 20) throw apiError(event, 'VALIDATION_ERROR', 'Jeton manquant.')
  const rapport = await reportByToken(event, token)
  // Première consultation en ligne : indicateur « Rapport ouvert en ligne » (A07).
  await db().query(`update report set opened_at = coalesce(opened_at, now()) where id = $1`, [rapport.id])
  // Adresse du contact commercial : la fenêtre « Contacter FeexPay » l'affiche en secours,
  // pour le cas où l'envoi échoue ou où le dirigeant préfère écrire lui-même.
  const contactCommercial = (await reglages()).contact_commercial_email || 'contact.ci@feexpay.me'
  return { ...rapport, contactCommercial, correlation_id: event.context.correlationId }
})
