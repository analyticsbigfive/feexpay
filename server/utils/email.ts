import { Resend } from 'resend'
import { nomRapport, type RapportPublic } from './report'
import { nomFichierPdf, rapportPdf } from './pdf'
import { journalEnvoi } from './rapports'
import { envoyerGa4 } from './ga4'
import { chargerModele, cleDuRapport, rendreTexte, variablesDuRapport, type ChampsModele } from './modeles-email'

/**
 * Envoi du rapport par email (Resend), PDF en pièce jointe. Chaque envoi laisse une ligne
 * dans `notification` : `accepted` quand Resend a pris le message, `failed` sinon, avec
 * l'erreur. Sans clé API, rien ne part et la notification est marquée `failed`.
 *
 * Sans domaine vérifié, l'expéditeur `onboarding@resend.dev` ne délivre qu'à l'adresse du
 * titulaire du compte Resend : les autres destinataires sont refusés par le fournisseur.
 */
export async function envoyerRapport(
  rapport: RapportPublic,
  reportToken: string,
  reportId: string,
): Promise<{ sent: boolean; to: string; error?: string }> {
  const config = useRuntimeConfig()
  const to = rapport.contact.email
  const base = config.public.appBaseUrl
  const lien = `${base}/rapport/${reportToken}`
  const template = 'rapport'

  const notif = await db().query<{ id: string }>(
    `insert into notification (report_id, template, recipient, status, attempts)
     values ($1, $2, $3, 'queued', 1) returning id`,
    [reportId, template, to],
  )
  const notifId = notif.rows[0]!.id
  await journalEnvoi(notifId, 'generated', `moteur ${rapport.dirigeant?.version ?? rapport.rayonnement?.version ?? ''}`.trim())

  const echec = async (message: string) => {
    await db().query(`update notification set status = 'failed', last_error = $2, updated_at = now() where id = $1`, [
      notifId,
      message.slice(0, 500),
    ])
    await journalEnvoi(notifId, 'failed', message.slice(0, 200))
    return { sent: false, to, error: message }
  }

  // Textes du modèle, réécrits ou non depuis l'admin ; les variables sont remplacées plus bas.
  const modele = await chargerModele(cleDuRapport(rapport))
  if (!modele.actif) {
    // Modèle désactivé depuis l'admin : le rapport existe et se lit en ligne, l'email ne part pas.
    await db().query(`update notification set status = 'cancelled', last_error = $2, updated_at = now() where id = $1`, [
      notifId,
      'Modèle désactivé',
    ])
    await journalEnvoi(notifId, 'cancelled', 'Modèle désactivé depuis l’admin')
    await db().query(`update report set status = 'ready', updated_at = now() where id = $1`, [reportId])
    return { sent: false, to, error: 'Modèle désactivé' }
  }

  if (!config.resendApiKey) return echec('RESEND_API_KEY absente')

  try {
    const pdf = rapportPdf(rapport, base)
    const { champs } = modele
    const resend = new Resend(config.resendApiKey)
    const { data, error } = await resend.emails.send({
      from: config.resendFrom,
      to,
      subject: rendreTexte(champs.sujet, variablesDuRapport(rapport, lien)),
      html: htmlRapport(rapport, lien, champs),
      text: texteRapport(rapport, lien, champs),
      attachments: [{ filename: nomFichierPdf(rapport), content: pdf.toString('base64') }],
    })
    if (error) return echec(`${error.name}: ${error.message}`)
    await db().query(
      `update notification set status = 'accepted', provider_id = $2, updated_at = now() where id = $1`,
      [notifId, data?.id ?? null],
    )
    await journalEnvoi(notifId, 'accepted')
    await db().query(`update report set status = 'ready', updated_at = now() where id = $1`, [reportId])
    // `report_sent` : GA4 Measurement Protocol seulement (PLAN.md §8). L'identifiant de la
    // notification sert d'`event_id` — un renvoi crée une nouvelle notification, donc un
    // nouvel événement, ce qui est le comportement attendu.
    await envoyerGa4(null, 'report_sent', notifId, { template }, reportId)
    return { sent: true, to }
  } catch (e) {
    return echec(e instanceof Error ? e.message : String(e))
  }
}

const NOMS_DIAGNOSTICS = { dirigeant: 'Profil du dirigeant', rayonnement: 'Rayonnement de l’entreprise' } as const

/**
 * Relance à 7 jours (décision FeexPay du 11 septembre 2026, hors cahier des charges) : sept
 * jours après un rapport à un seul diagnostic, un email invite à faire le second pour obtenir
 * la lecture croisée. Textes figés ici, pas de modèle modifiable ni d'interrupteur dans A07.
 * Même gabarit HTML que le rapport ; le bouton mène au diagnostic manquant. Une ligne
 * `notification` au gabarit « relance », rattachée au rapport, pour le journal A07 et pour
 * garantir une seule relance par contact.
 */
export async function envoyerRelance(rapport: RapportPublic, reportId: string): Promise<{ sent: boolean; to: string; error?: string }> {
  const config = useRuntimeConfig()
  const to = rapport.contact.email
  const manquant: 'dirigeant' | 'rayonnement' | null = !rapport.dirigeant ? 'dirigeant' : !rapport.rayonnement ? 'rayonnement' : null
  if (!manquant) return { sent: false, to, error: 'Rapport complet, rien à relancer' }
  const base = config.public.appBaseUrl
  const lien = `${base}/diagnostic/${manquant}/introduction`
  const champs: ChampsModele = {
    sujet: 'Il vous manque un diagnostic pour votre lecture croisée — Radar by FeexPay',
    titre: 'Votre lecture croisée vous attend',
    salutation: 'Bonjour {{prenom}},',
    introduction: `Il y a une semaine, vous avez reçu votre rapport Radar. Le diagnostic « ${NOMS_DIAGNOSTICS[manquant]} » n’a pas encore été fait : il prend quelques minutes et débloque la lecture croisée, qui met en regard votre pilotage et votre rayonnement pour faire apparaître la zone à traiter en premier.`,
    bouton: 'Terminer mon diagnostic',
    mention: `Vous recevez ce message parce que vous avez demandé votre rapport Radar. C’est notre seule relance. Pour ne plus recevoir d’email et faire supprimer vos données : ${base}/supprimer-mes-donnees`,
    pied: 'Radar by FeexPay · Powered by FeexPay',
  }

  const notif = await db().query<{ id: string }>(
    `insert into notification (report_id, template, recipient, status, attempts) values ($1, 'relance', $2, 'queued', 1) returning id`,
    [reportId, to],
  )
  const notifId = notif.rows[0]!.id
  const echec = async (message: string) => {
    await db().query(`update notification set status = 'failed', last_error = $2, updated_at = now() where id = $1`, [notifId, message.slice(0, 500)])
    await journalEnvoi(notifId, 'failed', message.slice(0, 200))
    return { sent: false, to, error: message }
  }
  if (!config.resendApiKey) return echec('RESEND_API_KEY absente')

  try {
    const resend = new Resend(config.resendApiKey)
    const { data, error } = await resend.emails.send({
      from: config.resendFrom,
      to,
      subject: rendreTexte(champs.sujet, variablesDuRapport(rapport, lien)),
      html: htmlRapport(rapport, lien, champs),
      text: texteRapport(rapport, lien, champs),
    })
    if (error) return echec(`${error.name}: ${error.message}`)
    await db().query(`update notification set status = 'accepted', provider_id = $2, updated_at = now() where id = $1`, [notifId, data?.id ?? null])
    await journalEnvoi(notifId, 'accepted')
    await envoyerGa4(null, 'relance_sent', notifId, { template: 'relance' }, reportId)
    return { sent: true, to }
  } catch (e) {
    return echec(e instanceof Error ? e.message : String(e))
  }
}

function lignesResume(r: RapportPublic): string[] {
  return [
    r.dirigeant ? `Profil de dirigeant : ${r.dirigeant.archetype.code}` : null,
    r.rayonnement ? `Rayonnement : ${r.rayonnement.score} / 100 · ${r.rayonnement.niveauAffiche}` : null,
    r.croisement ? `Lecture croisée : ${r.croisement.lecture}` : null,
  ].filter(Boolean) as string[]
}

/** Version texte de l'email, mêmes champs que le HTML ; le lien suit l'introduction. */
export function texteRapport(r: RapportPublic, lien: string, champs: ChampsModele): string {
  const v = variablesDuRapport(r, lien)
  const t = (champ: keyof ChampsModele) => rendreTexte(champs[champ], v)
  return [
    t('salutation'),
    '',
    t('introduction'),
    lien,
    '',
    ...lignesResume(r),
    '',
    t('mention'),
    '',
    t('pied'),
  ].join('\n')
}

/**
 * Gabarit HTML du rapport. Tout est en tables et en styles à la ligne : c'est la seule mise en
 * forme que les clients email honorent tous.
 *
 * Le bouton mérite une explication. Il portait `height` et `line-height` sur un `<a>` en
 * `inline-block` ; le raccourci `font:` déclaré ensuite réinitialisait `line-height` à `normal`,
 * et le texte se collait en haut du pavé orange. Il est désormais dans une cellule de table, sa
 * hauteur vient du `padding`, et `mso-line-height-rule:exactly` empêche Word d'arrondir
 * l'interligne à sa façon — Outlook Windows ignorant `height`, `inline-block` et `border-radius`.
 */
export function htmlRapport(r: RapportPublic, lien: string, champs: ChampsModele): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const v = variablesDuRapport(r, lien)
  // Texte d'un champ, variables remplacées puis échappé : un modèle ne porte jamais de HTML.
  const t = (champ: keyof ChampsModele) => esc(rendreTexte(champs[champ], v))
  const resume = lignesResume(r)
    .map((l) => `<li style="margin:0 0 6px;font:400 15px/1.5 Poppins,'Segoe UI',sans-serif;color:#373E4B">${esc(l)}</li>`)
    .join('')
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(nomRapport(r))}</title></head><body style="margin:0;padding:0;background:#F6F7F9">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F6F7F9;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #E0E4EB;border-radius:14px;overflow:hidden">
<tr><td style="background:#112C56;padding:28px 32px">
  <p style="margin:0 0 8px;font:600 12px/1 Poppins,'Segoe UI',sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#F6B684">Radar by FeexPay</p>
  <p style="margin:0;font:600 24px/1.25 Poppins,'Segoe UI',sans-serif;color:#fff">${t('titre')}</p>
</td></tr>
<tr><td style="padding:28px 32px">
  <p style="margin:0 0 16px;font:400 16px/1.6 Poppins,'Segoe UI',sans-serif;color:#373E4B">${t('salutation')}</p>
  <p style="margin:0 0 20px;font:400 16px/1.6 Poppins,'Segoe UI',sans-serif;color:#373E4B">${t('introduction')}</p>
  <ul style="margin:0 0 24px;padding:0 0 0 18px">${resume}</ul>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
    <td bgcolor="#D45D00" style="background:#D45D00;border-radius:12px">
      <a href="${esc(lien)}" style="display:block;padding:17px 28px;font:600 16px/18px Poppins,'Segoe UI',sans-serif;mso-line-height-rule:exactly;color:#ffffff;text-decoration:none">${t('bouton')}</a>
    </td>
  </tr></table>
  <p style="margin:24px 0 0;font:400 13px/1.55 Poppins,'Segoe UI',sans-serif;color:#6C7686">${t('mention')}</p>
</td></tr>
<tr><td style="padding:18px 32px;border-top:1px solid #E0E4EB"><p style="margin:0;font:400 12px/1.5 Poppins,'Segoe UI',sans-serif;color:#7E97BF">${t('pied')}</p></td></tr>
</table></td></tr></table></body></html>`
}

/** Canaux proposés par la fenêtre de contact du rapport (P12). */
export const CANAUX_CONTACT = { email: 'Email', telephone: 'Appel téléphonique', whatsapp: 'WhatsApp' } as const
export type CanalContact = keyof typeof CANAUX_CONTACT

export interface DemandeContact {
  message: string
  telephone: string | null
  canal: CanalContact
}

/**
 * Demande de contact déposée depuis le rapport (P12). L'email part vers l'adresse commerciale
 * réglée en admin (`contact_commercial_email`), avec le dirigeant en `Reply-To` : répondre
 * depuis la boîte suffit, sans recopier l'adresse.
 *
 * L'échec n'est pas silencieux mais il n'est pas non plus perdant : la demande est déjà posée
 * sur la fiche prospect par la route appelante avant cet envoi. C'est la raison pour laquelle
 * cette fonction renvoie l'erreur au lieu de la lever.
 */
export async function envoyerDemandeContact(
  rapport: RapportPublic,
  lien: string,
  destinataire: string,
  demande: DemandeContact,
): Promise<{ sent: boolean; error?: string }> {
  const config = useRuntimeConfig()
  if (!config.resendApiKey) return { sent: false, error: 'RESEND_API_KEY absente' }
  try {
    const resend = new Resend(config.resendApiKey)
    const { error } = await resend.emails.send({
      from: config.resendFrom,
      to: destinataire,
      replyTo: rapport.contact.email,
      subject: `Demande de contact · ${rapport.contact.prenom} ${rapport.contact.nom}${rapport.contact.entreprise ? ` (${rapport.contact.entreprise})` : ''}`,
      html: htmlDemandeContact(rapport, lien, demande),
      text: texteDemandeContact(rapport, lien, demande),
    })
    if (error) return { sent: false, error: `${error.name}: ${error.message}` }
    return { sent: true }
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Lignes « identité » de la demande, communes aux deux versions de l'email. */
function lignesDemande(r: RapportPublic, demande: DemandeContact): [string, string][] {
  return [
    ['Nom', `${r.contact.prenom} ${r.contact.nom}`],
    ['Entreprise', r.contact.entreprise ?? '—'],
    ['Email', r.contact.email],
    ['Téléphone', demande.telephone ?? r.contact.telephone ?? '—'],
    ['Souhaite être joint par', CANAUX_CONTACT[demande.canal]],
  ]
}

export function texteDemandeContact(r: RapportPublic, lien: string, demande: DemandeContact): string {
  return [
    `${r.contact.prenom} ${r.contact.nom} demande à être contacté après son diagnostic Radar.`,
    '',
    ...lignesDemande(r, demande).map(([k, v]) => `${k} : ${v}`),
    '',
    'Son message :',
    demande.message,
    '',
    ...lignesResume(r),
    '',
    `Rapport complet : ${lien}`,
  ].join('\n')
}

/**
 * Email interne : même grammaire visuelle que le rapport, en plus sobre. Tables et styles à
 * la ligne, pour les mêmes raisons qu'en haut de ce fichier.
 */
export function htmlDemandeContact(r: RapportPublic, lien: string, demande: DemandeContact): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const ligne = ([k, v]: [string, string]) =>
    `<tr><td style="padding:6px 16px 6px 0;font:600 13px/1.5 Poppins,'Segoe UI',sans-serif;color:#6C7686;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;font:400 14px/1.5 Poppins,'Segoe UI',sans-serif;color:#373E4B">${esc(v)}</td></tr>`
  const resume = lignesResume(r)
    .map((l) => `<li style="margin:0 0 6px;font:400 14px/1.5 Poppins,'Segoe UI',sans-serif;color:#373E4B">${esc(l)}</li>`)
    .join('')
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Demande de contact</title></head><body style="margin:0;padding:0;background:#F6F7F9">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F6F7F9;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #E0E4EB;border-radius:14px;overflow:hidden">
<tr><td style="background:#112C56;padding:24px 32px">
  <p style="margin:0 0 8px;font:600 12px/1 Poppins,'Segoe UI',sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#F6B684">Radar by FeexPay</p>
  <p style="margin:0;font:600 22px/1.25 Poppins,'Segoe UI',sans-serif;color:#fff">Demande de contact</p>
</td></tr>
<tr><td style="padding:24px 32px">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0 0 20px">${lignesDemande(r, demande).map(ligne).join('')}</table>
  <p style="margin:0 0 8px;font:600 12px/1 Poppins,'Segoe UI',sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#6C7686">Son message</p>
  <p style="margin:0 0 22px;padding:14px 16px;background:#F6F7F9;border-radius:10px;font:400 15px/1.6 Poppins,'Segoe UI',sans-serif;color:#373E4B;white-space:pre-wrap">${esc(demande.message)}</p>
  <p style="margin:0 0 8px;font:600 12px/1 Poppins,'Segoe UI',sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#6C7686">Ses résultats</p>
  <ul style="margin:0 0 22px;padding:0 0 0 18px">${resume}</ul>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
    <td bgcolor="#112C56" style="background:#112C56;border-radius:12px">
      <a href="${esc(lien)}" style="display:block;padding:15px 24px;font:600 15px/17px Poppins,'Segoe UI',sans-serif;mso-line-height-rule:exactly;color:#ffffff;text-decoration:none">Ouvrir le rapport</a>
    </td>
  </tr></table>
</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #E0E4EB"><p style="margin:0;font:400 12px/1.5 Poppins,'Segoe UI',sans-serif;color:#7E97BF">Répondre à ce message écrit directement au dirigeant. La demande figure aussi sur sa fiche dans l’administration.</p></td></tr>
</table></td></tr></table></body></html>`
}
