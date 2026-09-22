import { z } from 'zod'
import { requireAdmin, audit } from '../../utils/admin-auth'
import { invaliderReglages } from '../../utils/settings'

const CLES = ['tracking_enabled', 'ga4_measurement_id', 'ga4_api_secret', 'meta_pixel_id', 'meta_capi_access_token', 'meta_capi_test_event_code', 'contact_commercial_email'] as const
/** Clés masquées à l'affichage et jamais renvoyées au navigateur. */
const SECRETES = new Set<string>(['ga4_api_secret', 'meta_capi_access_token', 'meta_capi_test_event_code'])
const Body = z.record(z.enum(CLES), z.string().max(1000)).refine((o) => Object.keys(o).length > 0)

/** Modification des réglages. Une valeur vide efface ; les secrets ne sont journalisés que par leur clé. */
export default defineEventHandler(async (event) => {
  const ctx = await requireAdmin(event, 'admin')
  const parsed = Body.safeParse(await readBody(event).catch(() => null))
  if (!parsed.success) throw apiError(event, 'VALIDATION_ERROR', 'Réglage invalide.')
  // Une adresse invalide couperait les demandes de contact déposées depuis le rapport (P12)
  // sans que rien ne le signale : la valeur est vérifiée ici, pas seulement dans le navigateur.
  const adresse = parsed.data.contact_commercial_email?.trim()
  if (adresse !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adresse)) {
    throw apiError(event, 'VALIDATION_ERROR', 'Adresse email du contact commercial invalide.')
  }

  for (const [key, value] of Object.entries(parsed.data)) {
    await db().query(
      `insert into app_setting (key, value, secret, updated_by) values ($1, $2, $3, $4)
       on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
      [key, value.trim(), SECRETES.has(key), ctx.user.id],
    )
  }
  invaliderReglages()
  await audit(event, 'settings.updated', 'app_setting', null, { keys: Object.keys(parsed.data) })
  return { ok: true }
})
