<script setup lang="ts">
// Onglet « Historique » : participations, consentements, notes et actions admin journalisées.
definePageMeta({ layout: 'admin', middleware: 'admin', role: 'lecture', section: 'Prospects' })
const { fiche, error, pending, refresh } = useProspect()
useSeoMeta({ title: 'Historique du prospect — Administration Radar by FeexPay', robots: 'noindex' })
const message = ref<{ texte: string; erreur: boolean } | null>(null)
const poser = (texte: string, erreur = false) => (message.value = { texte, erreur })
const ACTIONS: Record<string, string> = { 'report.resend': 'Rapport renvoyé', 'prospect.suivi': 'Suivi commercial modifié', 'prospect.note': 'Note interne ajoutée', 'export.create': 'Export' }
const CONSENT: Record<string, string> = { cookies: 'Cookies', traitement: 'Traitement des données', contact: 'Contact FeexPay' }
const evenements = computed(() => {
  const f = fiche.value
  if (!f) return []
  const e: { quand: string; titre: string; detail: string; icone: string }[] = []
  e.push({ quand: f.contact.creeLe, titre: 'Contact créé', detail: `Coordonnées laissées en P10 · ${f.contact.email}`, icone: 'account-plus-outline' })
  for (const p of f.participations) {
    e.push({ quand: p.started_at, titre: `${p.diagnostic_type === 'dirigeant' ? 'Profil du dirigeant' : 'Rayonnement'} commencé`, detail: `${p.identifiant} · moteur ${p.version}`, icone: 'clipboard-list-outline' })
    if (p.completed_at) e.push({ quand: p.completed_at, titre: `${p.diagnostic_type === 'dirigeant' ? 'Profil du dirigeant' : 'Rayonnement'} terminé`, detail: `${p.identifiant} · ${duree(p.duration_s)}`, icone: 'check-circle-outline' })
  }
  for (const c of f.consentements) e.push({ quand: c.created_at, titre: `${CONSENT[c.type] ?? c.type} : ${c.statut}`, detail: `${c.source} · texte ${c.text_version}`, icone: 'shield-check-outline' })
  for (const r of f.rapports) {
    e.push({ quand: r.created_at, titre: 'Rapport créé', detail: `édition ${r.editorial_version}`, icone: 'file-document-outline' })
    for (const n of r.notifications) e.push({ quand: n.created_at, titre: `Email « ${n.template} » : ${n.status}`, detail: `${n.recipient}${n.last_error ? ' · ' + n.last_error : ''}`, icone: 'email-outline' })
  }
  for (const n of f.notes) {
    const duDirigeant = n.source === 'dirigeant'
    e.push({
      quand: n.created_at,
      titre: duDirigeant ? 'Demande de contact' : 'Note interne',
      detail: `${duDirigeant ? 'Le dirigeant, depuis son rapport' : (n.auteur ?? 'Compte supprimé')} · ${n.texte}`,
      icone: duDirigeant ? 'email-fast-outline' : 'note-plus-outline',
    })
  }
  for (const h of f.historique) e.push({ quand: h.ts, titre: ACTIONS[h.action] ?? h.action, detail: `${h.acteur ?? 'Système'}${h.payload_min ? ' · ' + JSON.stringify(h.payload_min) : ''}`, icone: 'history' })
  return e.sort((a, b) => new Date(b.quand).getTime() - new Date(a.quand).getTime())
})
</script>

<template>
  <div>
    <AdminProspectEntete v-if="fiche" :fiche="fiche" onglet="historique" @message="poser" />
    <AdminProspectCadre :fiche="fiche" :error="error" :pending="pending" :refresh="refresh" />
    <div v-if="fiche" class="px-8 pt-7 pb-9">
      <p v-if="message" class="mb-5 rounded-[10px] px-4 py-3 text-sm" :class="message.erreur ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'">{{ message.texte }}</p>
      <div class="card p-6">
        <div class="flex flex-col">
          <div v-for="(e, i) in evenements" :key="i" class="flex gap-4 border-b border-gray-100 py-3.5 last:border-0">
            <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-50 text-navy-600"><UiIcon :name="e.icone" :size="16" /></span>
            <div class="min-w-0 flex-1"><p class="text-sm leading-[1.4] font-medium text-navy-600">{{ e.titre }}</p><p class="truncate text-xs leading-[1.4] text-gray-500">{{ e.detail }}</p></div>
            <span class="shrink-0 text-xs leading-[1.4] text-gray-500">{{ dateHeure(e.quand) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
