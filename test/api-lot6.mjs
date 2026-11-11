/**
 * Smoke test du lot 6 contre `pnpm dev` : A07 (indicateurs, journal, renvoi, correction
 * d'adresse, relance des échecs, aperçu des modèles), webhook Resend signé, T01 (registre,
 * contrôles, publication refusée sur version inconnue ou déjà publiée, RBAC).
 *
 *   nvm use 22 && node test/api-lot6.mjs
 */
import { readFileSync } from 'node:fs'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import pg from 'pg'
import * as OTPAuth from 'otpauth'
import { createClient } from '@supabase/supabase-js'
const BASE = process.env.APP_BASE_URL ?? 'http://localhost:3000'
const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf('='); let v = l.slice(i + 1).trim(); const q = /^(["'])(.*?)\1/.exec(v); v = q ? q[2] : v.replace(/\s+#.*$/, ''); return [l.slice(0, i), v.trim()] }),
)
const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await db.connect()
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
let fails = 0
const check = (label, cond, detail = '') => { console.log(`${cond ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`); if (!cond) fails++ }
const sha = (s) => createHash('sha256').update(s).digest('hex')
function session() {
  let cookie = ''
  return async (method, path, body, opts = {}) => {
    const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(opts.headers ?? {}) }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })
    for (const c of r.headers.getSetCookie?.() ?? []) if (c.startsWith('radar_admin=')) cookie = c.split(';')[0]
    if (opts.raw) return { status: r.status, text: await r.text(), type: r.headers.get('content-type') ?? '' }
    let data = null
    try { data = await r.json() } catch {}
    return { status: r.status, data }
  }
}
const suffixe = Date.now().toString(36)
const PWD = `Radar-Test-${suffixe}-Ok!!`
const inviter = (await db.query(`select id from admin_user where role = 'admin' limit 1`)).rows[0].id
async function compte(role, email) {
  const token = randomBytes(32).toString('base64url')
  await db.query(`insert into admin_invitation (email, prenom, nom, role, mfa_required, export_allowed, token_hash, inviter_id, expires_at) values ($1, 'Test', 'Lot6', $2, $3, true, $4, $5, now() + interval '1 day')`, [email, role, role === 'admin', sha(token), inviter])
  const call = session()
  const acc = await call('POST', '/api/admin/invitations/accept', { token, prenom: 'Test', nom: 'Lot6', password: PWD })
  check(`compte ${role} de test connecté`, acc.status === 200, JSON.stringify(acc.data?.data ?? ''))
  if (role === 'admin') {
    const enr = await call('POST', '/api/admin/auth/2fa/enroll')
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(enr.data.secret), digits: 6, period: 30 })
    const ver = await call('POST', '/api/admin/auth/2fa/verify', { code: totp.generate(), factorId: enr.data.factorId })
    check('admin de test en aal2', ver.status === 200)
  }
  return call
}
const COM = `test-lot6-com-${suffixe}@feexpay.me`
const ADM = `test-lot6-adm-${suffixe}@feexpay.me`
const com = await compte('commercial', COM)

// A07
const a07 = await com('GET', '/api/admin/rapports?jours=365')
check('A07 : indicateurs, totaux, liste', a07.status === 200 && a07.data.kpi?.actuel && typeof a07.data.totaux.echecs === 'number' && Array.isArray(a07.data.items), JSON.stringify(a07.data?.data ?? a07.data?.totaux))
check('A07 : modèle libellé selon les diagnostics', a07.data.items.every((l) => ['Rapport Dirigeant', 'Rapport Rayonnement', 'Rapport croisé complet'].includes(l.modele)))
const echecs = await com('GET', '/api/admin/rapports?jours=365&statut=echec')
check('A07 : filtre statut échec', echecs.status === 200 && echecs.data.items.every((l) => ['failed', 'bounced'].includes(l.statut)), `${echecs.data?.total} lignes`)
const ligne = a07.data.items[0]
if (ligne) {
  const renvoi = await com('POST', `/api/admin/rapports/${ligne.reportId}/renvoyer`, {})
  check('A07 : renvoi (nouveau jeton, notification créée)', renvoi.status === 200 && renvoi.data.reportId === ligne.reportId, JSON.stringify(renvoi.data?.email?.error ?? '').slice(0, 80))
  const apres = await com('GET', '/api/admin/rapports?jours=1')
  const derniere = apres.data.items.find((l) => l.reportId === ligne.reportId)
  check('A07 : journal de l’envoi renseigné (generated puis accepted ou failed)', derniere && derniere.events.length >= 2 && derniere.events[0].type === 'generated', JSON.stringify(derniere?.events?.map((e) => e.type)))
  const mauvais = await com('POST', `/api/admin/rapports/${ligne.reportId}/renvoyer`, { email: 'pas-une-adresse' })
  check('A07 : correction d’adresse invalide refusée', mauvais.status === 400)
  const autre = (await db.query(`select email_norm::text as e from contact where id <> (select contact_id from report where id = $1) limit 1`, [ligne.reportId])).rows[0]
  if (autre) {
    const doublon = await com('POST', `/api/admin/rapports/${ligne.reportId}/renvoyer`, { email: autre.e })
    check('A07 : correction vers une adresse déjà prise refusée', doublon.status === 400, doublon.data?.data?.message)
  }
}
const relance = await com('POST', '/api/admin/rapports/relancer')
check('A07 : relance des échecs exécutée et journalisée', relance.status === 200 && typeof relance.data.total === 'number', `${relance.data?.envoyes}/${relance.data?.total}`)
const apercu = await com('GET', '/api/admin/rapports/apercu?modele=croise', undefined, { raw: true })
check('A07 : aperçu HTML du modèle croisé', apercu.status === 200 && apercu.type.includes('text/html') && apercu.text.includes('Lecture croisée'))

// Webhook Resend
const notif = (await db.query(`select id, provider_id, status from notification where provider_id is not null order by created_at desc limit 1`)).rows[0]
const secret = env.RESEND_WEBHOOK_SECRET
if (notif && secret) {
  const corps = JSON.stringify({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: notif.provider_id } })
  const ts = String(Math.floor(Date.now() / 1000))
  const svixId = `msg_${suffixe}`
  const sig = createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${svixId}.${ts}.${corps}`).digest('base64')
  const ok = await session()('POST', '/api/public/webhooks/resend', corps, { headers: { 'svix-id': svixId, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` } })
  check('webhook signé accepté', ok.status === 200 && ok.data.ok === true, JSON.stringify(ok.data))
  const maj = (await db.query(`select status, events from notification where id = $1`, [notif.id])).rows[0]
  check('webhook : statut remis et journal complété', ['delivered', 'opened'].includes(maj.status) && maj.events.some((e) => e.type === 'delivered'), maj.status)
  const faux = await session()('POST', '/api/public/webhooks/resend', corps, { headers: { 'svix-id': svixId, 'svix-timestamp': ts, 'svix-signature': 'v1,AAAA' } })
  check('webhook : signature invalide refusée', faux.status === 401)
} else {
  console.log(`· webhook non testé (${notif ? 'RESEND_WEBHOOK_SECRET absent' : 'aucune notification avec provider_id'})`)
}

// T01
const refusCom = await com('GET', '/api/admin/versions')
check('T01 : registre refusé au commercial', refusCom.status === 403)
const adm = await compte('admin', ADM)
const reg = await adm('GET', '/api/admin/versions')
check('T01 : registre lu, 2.2 publiée et 2.1 archivée', reg.status === 200 && reg.data.versions.find((v) => v.version === '2.2')?.status === 'published' && reg.data.versions.find((v) => v.version === '2.1')?.status === 'archived', JSON.stringify(reg.data?.versions?.map((v) => [v.version, v.status])))
check('T01 : checksums base = code', reg.data.versions.every((v) => v.checksumOk))
const ctrl = await adm('GET', '/api/admin/versions/2.2/controler')
check('T01 : 2.2 publiée conforme, sans écart', ctrl.status === 200 && ctrl.data.ok === true && ctrl.data.controles.every((c) => c.ok) && ctrl.data.erreurs.length === 0, JSON.stringify(ctrl.data?.erreurs))
check('T01 : 2.2 non republiable, signalée en remarque', ctrl.data.publiable === false && ctrl.data.remarques.length === 1, JSON.stringify(ctrl.data?.remarques))
check('T01 : empreinte 2.2 en base = moteur déployé', ctrl.data.empreinte?.identique === true && ctrl.data.empreinte.base === ctrl.data.empreinte.code, JSON.stringify(ctrl.data?.empreinte))
const inconnue = await adm('POST', '/api/admin/versions/9.9/publier')
check('T01 : version inconnue refusée (422)', inconnue.status === 422 && inconnue.data.action === 'refusee')
const deja = await adm('POST', '/api/admin/versions/2.2/publier')
check('T01 : version déjà publiée refusée', deja.status === 422)
const ctrl21 = await adm('GET', '/api/admin/versions/2.1/controler')
check('T01 : 2.1 réactivable (contrôles ok)', ctrl21.status === 200 && ctrl21.data.ok === true, JSON.stringify(ctrl21.data?.erreurs))
const rollback = await adm('POST', '/api/admin/versions/2.1/publier')
check('T01 : réactivation de 2.1', rollback.status === 200 && rollback.data.action === 'reactivee')
const retour = await adm('POST', '/api/admin/versions/2.2/publier')
check('T01 : retour à 2.2 (réactivation)', retour.status === 200 && retour.data.action === 'reactivee')
const final = (await db.query(`select version, status from scoring_version order by version`)).rows
check('T01 : état final 2.1 archivée, 2.2 publiée', final.find((v) => v.version === '2.2').status === 'published' && final.find((v) => v.version === '2.1').status === 'archived')
const journal = await adm('GET', '/api/admin/versions')
check('T01 : journal alimenté', journal.data.journal.length >= 2 && journal.data.journal[0].action === 'version.reactivate')

// Nettoyage
for (const email of [COM, ADM]) {
  await db.query(`delete from admin_invitation where email = $1`, [email])
  const r = await db.query(`select id from admin_user where email = $1`, [email])
  if (r.rows[0]) {
    await db.query(`delete from admin_recovery_code where admin_user_id = $1`, [r.rows[0].id])
    await db.query(`update admin_user set status = 'revoked', role = 'lecture' where id = $1`, [r.rows[0].id])
    await sb.auth.admin.deleteUser(r.rows[0].id).catch(() => null)
  }
}
await db.end()
console.log(fails ? `\n${fails} contrôle(s) en échec.` : '\nTous les contrôles passent.')
process.exit(fails ? 1 : 0)
