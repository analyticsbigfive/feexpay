<script setup lang="ts">
// A04 — fiche prospect, synthèse (docs/maquette/frames/admin-1440-A04.html).
definePageMeta({ layout: 'admin', middleware: 'admin', role: 'lecture', section: 'Prospects' })
const { fiche, error, pending, refresh } = useProspect()
useSeoMeta({ title: () => `${fiche.value ? fiche.value.contact.prenom + ' ' + fiche.value.contact.nom : 'Prospect'} — Administration Radar by FeexPay`, robots: 'noindex' })
const { me } = useAdmin()
const message = ref<{ texte: string; erreur: boolean } | null>(null)
const poser = (texte: string, erreur = false) => (message.value = { texte, erreur })

const dims = computed(() => (fiche.value?.dirigeant ? [...fiche.value.dirigeant.public.dimensions].sort((a: any, b: any) => b.score - a.score).slice(0, 3) : []))
const dimsRay = computed(() => {
  const d = fiche.value?.rayonnement?.public.dimensions ?? []
  if (!d.length) return []
  // Les deux dimensions les plus fortes, puis la plus faible en orange (cadre A04).
  const tri = [...d].sort((a: any, b: any) => b.score - a.score)
  const min = tri[tri.length - 1]
  return [...tri.filter((x: any) => x !== min).slice(0, 2), min].map((x: any) => ({ ...x, faible: x === min }))
})
const qualif = (score: number, type: 'pilotage' | 'rayonnement') => {
  if (type === 'pilotage') return score >= 75 ? 'structuré' : score >= 50 ? 'solide' : score >= 25 ? 'réactif' : 'informel'
  return score >= 80 ? 'dominant' : score >= 60 ? 'à activer' : score >= 40 ? 'à construire' : 'fragile'
}
const gravBg = (g: number) => (g >= 3 ? 'bg-red-100' : g === 2 ? 'bg-amber-100' : 'bg-gray-50')
const declare = (k: any) => `Constat ${k.code} · déclaré à la question ${k.questionCode.replace(/\D/g, '')}${k.diagnostic === 'rayonnement' ? ' du Rayonnement' : ''}`

const suivi = reactive({ statut: '', assigneeId: '' as string | null })
watch(fiche, (f) => {
  if (f) {
    suivi.statut = f.suivi.statut
    suivi.assigneeId = f.suivi.assigneeId ?? ''
  }
}, { immediate: true })
const peutEditer = computed(() => me.value && me.value.user.role !== 'lecture')
async function enregistrerSuivi() {
  try {
    await apiAdmin(`/api/admin/prospects/${fiche.value.contact.id}/suivi`, { method: 'PATCH', body: { statut: suivi.statut, assigneeId: suivi.assigneeId || null } })
    await refresh()
    poser('Suivi enregistré.')
  } catch (e) {
    poser(messageErreur(e), true)
  }
}
const noteOuverte = ref(false)
const note = ref('')
async function ajouterNote() {
  if (!note.value.trim()) return
  try {
    await apiAdmin(`/api/admin/prospects/${fiche.value.contact.id}/notes`, { method: 'POST', body: { texte: note.value } })
    note.value = ''
    noteOuverte.value = false
    await refresh()
    poser('Note ajoutée.')
  } catch (e) {
    poser(messageErreur(e), true)
  }
}
</script>

<template>
  <div>
    <AdminProspectEntete v-if="fiche" :fiche="fiche" onglet="synthese" @message="poser" />
    <AdminProspectCadre :fiche="fiche" :error="error" :pending="pending" :refresh="refresh" />
    <div v-if="fiche" class="flex items-start gap-5 px-8 pt-7 pb-9">
      <div class="flex min-w-0 flex-1 flex-col gap-5">
        <p v-if="message" class="rounded-[10px] px-4 py-3 text-sm" :class="message.erreur ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'">{{ message.texte }}</p>
        <div class="grid grid-cols-2 gap-5">
          <div v-if="fiche.dirigeant" class="rounded-[14px] bg-navy-600 p-6">
            <p class="mb-3.5 text-xs leading-none font-semibold tracking-[0.08em] text-orange-300 uppercase">Profil de dirigeant</p>
            <div class="mb-1 flex items-center gap-3.5">
              <span class="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white"><img :src="`/brand/emb-${slugArchetype(fiche.dirigeant.public.archetype.code)}-64.png`" :alt="`Emblème du profil ${fiche.dirigeant.public.archetype.code}`" class="block h-11 w-11" ></span>
              <p class="text-[30px] leading-[1.1] font-semibold tracking-[-0.02em] text-white">{{ fiche.dirigeant.public.archetype.code }}</p>
            </div>
            <p class="mb-[18px] text-[13px] leading-[1.4] text-navy-200">{{ fiche.dirigeant.public.secondaire ? `Profil secondaire : ${fiche.dirigeant.public.secondaire.code} · ` : '' }}inspiré par {{ fiche.dirigeant.public.archetype.inspirePar }}</p>
            <div class="flex flex-col gap-2.5">
              <div v-for="d in dims" :key="d.code">
                <div class="mb-[5px] flex justify-between"><span class="text-[13px] leading-[1.2] text-navy-100">{{ d.nom }}</span><span class="font-mono text-[13px] leading-[1.2] font-semibold text-orange-300">{{ Math.round(d.score) }}</span></div>
                <div class="h-1.5 overflow-hidden rounded-full bg-white/15"><div class="h-full bg-orange-300" :style="{ width: `${Math.round(d.score)}%` }" /></div>
              </div>
            </div>
          </div>
          <AdminVide v-else titre="Profil de dirigeant non réalisé" texte="Ce contact n’a pas terminé le diagnostic Dirigeant." icone="account-outline" />
          <div v-if="fiche.rayonnement" class="card p-6">
            <p class="mb-3.5 text-xs leading-none font-semibold tracking-[0.08em] text-gray-500 uppercase">Rayonnement</p>
            <div class="mb-1 flex items-baseline gap-1.5"><span class="text-[30px] leading-[1.1] font-semibold tracking-[-0.02em] text-navy-600">{{ fiche.rayonnement.public.score }}</span><span class="text-sm text-gray-500">/ 100</span></div>
            <p class="mb-[18px] flex items-center gap-1.5 text-[13px] leading-[1.4] text-gray-600"><UiIcon :name="METEO_ICONE[fiche.rayonnement.public.meteo] ?? 'weather-cloudy'" :size="16" class="text-orange-600" />{{ fiche.rayonnement.public.niveauAffiche }} · météo « {{ fiche.rayonnement.public.meteo.toLowerCase() }} »</p>
            <div class="flex flex-col gap-2.5">
              <div v-for="d in dimsRay" :key="d.cle">
                <div class="mb-[5px] flex justify-between"><span class="text-[13px] leading-[1.2] text-gray-700">{{ d.nom }}</span><span class="font-mono text-[13px] leading-[1.2] font-semibold" :class="d.faible ? 'text-orange-600' : 'text-navy-600'">{{ Math.round(d.score) }}</span></div>
                <div class="h-1.5 overflow-hidden rounded-full bg-gray-100"><div class="h-full" :class="d.faible ? 'bg-orange-600' : 'bg-navy-500'" :style="{ width: `${Math.round(d.score)}%` }" /></div>
              </div>
            </div>
          </div>
          <AdminVide v-else titre="Rayonnement non réalisé" texte="Ce contact n’a pas terminé le diagnostic Rayonnement." icone="compass-outline" />
        </div>

        <div v-if="fiche.croisement" class="card p-6">
          <div class="mb-3.5 flex items-center gap-2.5">
            <UiIcon name="vector-intersection" :size="20" class="text-orange-600" />
            <h3 class="text-[17px] leading-[1.3] font-semibold text-navy-600">Lecture croisée · {{ fiche.croisement.lecture }}</h3>
            <span class="ml-auto font-mono text-xs leading-none text-gray-400">règle {{ fiche.croisement.code }} · moteur {{ fiche.croisement.version }}</span>
          </div>
          <p class="mb-[18px] text-[15px] leading-[1.6] text-gray-700">{{ fiche.croisement.interpretation }} {{ fiche.croisement.formulation }}</p>
          <div class="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-gray-200">
            <div class="bg-gray-50 px-5 py-[18px]"><p class="mb-1.5 text-xs leading-none font-semibold tracking-[0.06em] text-gray-500 uppercase">Pilotage interne</p><p class="text-xl leading-[1.2] font-semibold text-navy-600">{{ fiche.croisement.pilotage }} · {{ qualif(fiche.croisement.pilotage, 'pilotage') }}</p></div>
            <div class="bg-gray-50 px-5 py-[18px]"><p class="mb-1.5 text-xs leading-none font-semibold tracking-[0.06em] text-gray-500 uppercase">Rayonnement externe</p><p class="text-xl leading-[1.2] font-semibold text-orange-600">{{ fiche.croisement.rayonnement }} · {{ qualif(fiche.croisement.rayonnement, 'rayonnement') }}</p></div>
          </div>
        </div>
        <AdminVide v-else titre="Lecture croisée indisponible" :texte="`Ce contact n’a réalisé que le diagnostic ${fiche.dirigeant ? 'Dirigeant' : fiche.rayonnement ? 'Rayonnement' : '—'}. La lecture croisée exige les deux.`" icone="vector-intersection">
          <button v-if="fiche.rapports.length && peutEditer" type="button" class="btn btn-navy h-10 gap-2 rounded-[10px] px-4 text-sm" @click="poser('Le rapport renvoyé invite au second diagnostic. Utilisez « Renvoyer le rapport ».')"><UiIcon name="email-fast-outline" :size="18" />Inviter au second diagnostic</button>
        </AdminVide>

        <div class="card p-6">
          <h3 class="mb-4 text-[17px] leading-[1.3] font-semibold text-navy-600">Difficultés déclarées, par gravité</h3>
          <div v-if="fiche.constats.length" class="flex flex-col gap-3">
            <div v-for="k in fiche.constats" :key="k.code" class="flex items-start gap-3.5 rounded-xl p-4" :class="gravBg(k.gravite)">
              <AdminGravite :gravite="k.gravite" class="mt-[3px]" />
              <div><p class="mb-[3px] text-[15px] leading-[1.45] font-medium text-navy-600">{{ k.difficulte }}</p><p class="text-[13px] leading-[1.45] text-gray-600">{{ declare(k) }}</p></div>
            </div>
          </div>
          <p v-else class="text-sm leading-[1.5] text-gray-500">Aucune difficulté déclarée dans les réponses. Les forces et signaux déclarés figurent dans l’onglet Diagnostic commercial.</p>
        </div>
      </div>

      <div class="flex w-[340px] shrink-0 flex-col gap-5">
        <div class="card p-[22px]">
          <p class="mb-4 text-xs leading-none font-semibold tracking-[0.08em] text-gray-500 uppercase">Contact</p>
          <div class="mb-4 flex flex-col gap-3 border-b border-gray-100 pb-4">
            <div class="flex items-center justify-between gap-3"><span class="truncate text-sm leading-[1.4] font-medium text-navy-600">{{ fiche.contact.email }}</span><span class="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-600">Vérifiée</span></div>
            <div class="flex items-center justify-between gap-3"><span class="text-sm leading-[1.4] font-medium text-navy-600">{{ fiche.contact.telephone ?? 'Téléphone non renseigné' }}</span><span v-if="fiche.contact.telephone" class="shrink-0 rounded-full bg-navy-50 px-2 py-0.5 text-[11px] font-medium text-navy-600">WhatsApp renseigné</span></div>
            <div><p class="text-sm leading-[1.4] font-medium text-navy-600">{{ fiche.contact.entreprise ?? '—' }}</p><p class="text-xs leading-[1.4] text-gray-500">{{ [fiche.contact.secteur, fiche.contact.taille ? fiche.contact.taille + ' personnes' : null].filter(Boolean).join(' · ') }}</p></div>
          </div>
          <div class="flex flex-col gap-2.5">
            <div class="flex justify-between gap-3"><span class="text-[13px] leading-[1.4] text-gray-500">Première participation</span><span class="text-[13px] leading-[1.4] font-medium text-navy-600">{{ dateLongue(fiche.activite.premiere) }}</span></div>
            <div class="flex justify-between gap-3"><span class="text-[13px] leading-[1.4] text-gray-500">Dernière activité</span><span class="text-[13px] leading-[1.4] font-medium text-navy-600">{{ dateLongue(fiche.activite.derniere) }}</span></div>
            <div class="flex justify-between gap-3"><span class="text-[13px] leading-[1.4] text-gray-500">Source</span><span class="text-[13px] leading-[1.4] font-medium text-navy-600">{{ fiche.activite.source }}</span></div>
            <div class="flex justify-between gap-3"><span class="text-[13px] leading-[1.4] text-gray-500">Joignable sur WhatsApp</span><span class="inline-flex items-center gap-1 text-[13px] leading-[1.4] font-medium" :class="fiche.contact.whatsapp ? 'text-green-600' : 'text-gray-500'"><UiIcon :name="fiche.contact.whatsapp ? 'check' : 'minus'" :size="15" />{{ fiche.contact.whatsapp ? 'Oui' : 'Non' }}</span></div>
            <div class="flex justify-between gap-3"><span class="text-[13px] leading-[1.4] text-gray-500">Contact FeexPay accepté</span><span class="text-[13px] leading-[1.4] font-medium" :class="fiche.contact.contactAllowed ? 'text-green-600' : 'text-gray-500'">{{ fiche.contact.contactAllowed ? 'Oui' : 'Non' }}</span></div>
          </div>
        </div>

        <div class="card p-[22px]">
          <p class="mb-4 text-xs leading-none font-semibold tracking-[0.08em] text-gray-500 uppercase">Suivi commercial</p>
          <div class="mb-[18px] flex flex-col gap-2.5">
            <label class="relative flex h-11 items-center rounded-[10px] border-[1.5px] border-gray-300 px-3.5">
              <select v-model="suivi.statut" class="w-full appearance-none bg-transparent text-sm leading-none font-medium text-navy-600 outline-none" :disabled="!peutEditer" aria-label="Statut" @change="enregistrerSuivi">
                <option v-for="s in fiche.suivi.statuts" :key="s.value" :value="s.value">{{ s.label }}</option>
              </select>
              <UiIcon name="chevron-down" :size="18" class="pointer-events-none absolute right-3.5 text-gray-500" />
            </label>
            <label class="relative flex h-11 items-center rounded-[10px] border-[1.5px] border-gray-300 px-3.5">
              <select v-model="suivi.assigneeId" class="w-full appearance-none bg-transparent text-sm leading-none font-medium text-navy-600 outline-none" :disabled="!peutEditer" aria-label="Responsable" @change="enregistrerSuivi">
                <option value="">Non attribué</option>
                <option v-for="a in fiche.suivi.assignables" :key="a.id" :value="a.id">{{ a.nom }}</option>
              </select>
              <UiIcon name="chevron-down" :size="18" class="pointer-events-none absolute right-3.5 text-gray-500" />
            </label>
          </div>
          <button v-if="peutEditer" type="button" class="btn btn-outline mb-2.5 h-11 w-full rounded-[10px] text-sm" @click="noteOuverte = !noteOuverte">Ajouter une note interne</button>
          <div v-if="noteOuverte" class="mb-2.5">
            <textarea v-model="note" rows="3" maxlength="2000" class="field w-full text-sm" placeholder="Note visible par l’équipe uniquement" />
            <div class="mt-2 flex justify-end gap-2"><button type="button" class="btn btn-ghost h-9 px-3 text-sm" @click="noteOuverte = false">Annuler</button><button type="button" class="btn btn-navy h-9 rounded-[10px] px-3.5 text-sm" @click="ajouterNote">Enregistrer</button></div>
          </div>
          <NuxtLink v-if="fiche.rapports.length" :to="`/admin/prospects/${fiche.contact.id}/rapports`" class="btn btn-navy h-11 w-full gap-2 rounded-[10px] text-sm"><UiIcon name="open-in-new" :size="17" />Ouvrir le rapport client</NuxtLink>
          <div v-if="fiche.notes.length" class="mt-4 flex flex-col gap-2.5 border-t border-gray-100 pt-4">
            <div v-for="n in fiche.notes.slice(0, 3)" :key="n.id" :class="n.source === 'dirigeant' ? 'rounded-[10px] border border-orange-200 bg-orange-50 p-3' : undefined">
              <p class="text-[13px] leading-[1.5] whitespace-pre-line text-gray-700">{{ n.texte }}</p>
              <p class="mt-0.5 text-[11px] leading-[1.4]" :class="n.source === 'dirigeant' ? 'font-semibold text-orange-700' : 'text-gray-500'">{{ n.source === 'dirigeant' ? 'Le dirigeant, depuis son rapport' : (n.auteur ?? 'Compte supprimé') }} · {{ dateCourte(n.created_at) }}</p>
            </div>
          </div>
        </div>

        <div class="rounded-[14px] border border-orange-200 bg-orange-50 p-[22px]">
          <p class="mb-2.5 text-xs leading-none font-semibold tracking-[0.08em] text-orange-700 uppercase">Rappel de portée</p>
          <p class="text-[13px] leading-[1.55] text-gray-700">La fiche est un support de préparation d’entretien. Les constats reprennent les déclarations du dirigeant, sans interprétation ajoutée.</p>
        </div>
      </div>
    </div>
  </div>
</template>
