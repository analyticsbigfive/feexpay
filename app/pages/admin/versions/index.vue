<script setup lang="ts">
// T01 — versions du moteur de scoring : registre, contrôles automatiques, publication et
// réactivation. Aucun cadre dédié dans la maquette V1.2 : construit avec les composants A02/A03.
definePageMeta({ layout: 'admin', middleware: 'admin', role: 'analyste', section: 'Versions' })
useSeoMeta({ title: 'Versions — Administration Radar by FeexPay', robots: 'noindex' })
const { peut } = useAdmin()
const { data, error, pending, refresh } = await useFetch<any>('/api/admin/versions', { headers: useRequestHeaders(['cookie']) })
const STATUT: Record<string, [string, string]> = { published: ['Publiée', 'bg-green-100 text-green-600'], archived: ['Archivée', 'bg-gray-100 text-gray-500'], draft: ['Brouillon', 'bg-amber-100 text-amber-600'], absente: ['Dans le code, non publiée', 'bg-navy-50 text-navy-600'] }
const selection = ref<string | null>(null)
const controles = ref<any | null>(null)
const occupe = ref(false)
const message = ref<{ texte: string; erreur: boolean } | null>(null)
async function controler(v: string) {
  selection.value = v
  controles.value = null
  try {
    controles.value = await apiAdmin(`/api/admin/versions/${v}/controler`)
  } catch (e) {
    message.value = { texte: messageErreur(e), erreur: true }
  }
}
async function publier(v: string) {
  if (occupe.value) return
  if (!confirm(`Publier la version ${v} ? La version publiée actuelle passe en archivée. Les participations en cours gardent leur version.`)) return
  occupe.value = true
  message.value = null
  try {
    const r = await apiAdmin(`/api/admin/versions/${v}/publier`, { method: 'POST' })
    controles.value = r
    message.value = { texte: r.action === 'publiee' ? `Version ${v} publiée.` : `Version ${v} réactivée.`, erreur: false }
    await refresh()
  } catch (e) {
    const d = (e as any)?.data
    if (d?.controles) controles.value = d
    message.value = { texte: d?.erreurs?.join(' ') ?? messageErreur(e), erreur: true }
  } finally {
    occupe.value = false
  }
}
const rates = computed(() => controles.value?.controles?.filter((c: any) => !c.ok) ?? [])
/** Défauts de conformité. Le message « N contrôles en échec » résume les contrôles rouges : il n'est pas recompté. */
const ecarts = computed(() => rates.value.length + (controles.value?.erreurs?.filter((e: string) => !/contrôles? en échec/.test(e)).length ?? 0))
const ACTIONS: Record<string, string> = { 'version.publish': 'Publication', 'version.reactivate': 'Réactivation' }
</script>

<template>
  <div>
    <AdminHeader titre="Versions du moteur" :sous-titre="data ? `${data.versions.filter((v: any) => v.enBase).length} en base · version courante ${data.versions.find((v: any) => v.courante)?.version ?? '—'}` : undefined" />
    <div class="px-8 pt-7 pb-9">
      <p v-if="message" class="mb-5 rounded-[10px] px-4 py-3 text-sm" :class="message.erreur ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'">{{ message.texte }}</p>
      <AdminVide v-if="error" erreur titre="Les données n’ont pas pu être chargées" texte="Le registre n’a pas répondu.">
        <button type="button" class="btn btn-navy h-10 gap-2 rounded-[10px] px-4 text-sm" @click="refresh()"><UiIcon name="refresh" :size="18" />Réessayer</button>
      </AdminVide>
      <AdminSquelette v-else-if="pending && !data" />
      <div v-else-if="data" class="flex items-start gap-5">
        <div class="flex min-w-0 flex-1 flex-col gap-5">
          <div class="card overflow-hidden">
            <div class="grid grid-cols-[minmax(0,.7fr)_minmax(0,1.3fr)_minmax(0,1.9fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.4fr)] border-b border-gray-200 bg-gray-50">
              <span v-for="c in ['Version', 'Statut', 'Publiée le', 'Questions · options', 'Participations', 'Checksum']" :key="c" class="px-4 py-[13px] text-xs font-semibold text-gray-600">{{ c }}</span>
            </div>
            <button v-for="v in data.versions" :key="v.version" type="button" class="grid w-full grid-cols-[minmax(0,.7fr)_minmax(0,1.3fr)_minmax(0,1.9fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.4fr)] border-b border-gray-100 text-left hover:bg-orange-50" :class="{ 'bg-orange-50': selection === v.version }" @click="controler(v.version)">
              <span class="px-4 py-3.5 font-mono text-sm font-semibold text-navy-600">{{ v.version }}</span>
              <span class="flex items-center gap-2 px-4 py-3.5"><span class="rounded-full px-[9px] py-1 text-xs font-medium" :class="STATUT[v.status]?.[1]">{{ STATUT[v.status]?.[0] }}</span><span v-if="!v.enCode" class="text-xs text-red-600">absente du code déployé</span></span>
              <span class="px-4 py-3.5 text-[13px] whitespace-nowrap text-gray-700">{{ v.publishedAt ? dateHeure(v.publishedAt) : '—' }}</span>
              <span class="px-4 py-3.5 font-mono text-[13px] text-navy-600">{{ v.enBase ? `${v.questions} · ${v.options}` : '—' }}</span>
              <span class="px-4 py-3.5 font-mono text-[13px] text-navy-600">{{ nombre(v.participations) }}</span>
              <span class="px-4 py-3.5 font-mono text-xs" :class="v.checksumOk ? 'text-gray-500' : 'text-red-600'">{{ (v.checksum ?? v.checksumCode ?? '').slice(0, 16) }}…<template v-if="!v.checksumOk"> ≠ code</template></span>
            </button>
          </div>
          <div class="card p-6">
            <h3 class="mb-1 text-[17px] font-semibold text-navy-600">Contrôles automatiques{{ selection ? ` · version ${selection}` : '' }}</h3>
            <p class="mb-4 text-[13px] leading-[1.4] text-gray-500">Cas de contrôle §5.5 de la matrice normative, accessibilité des huit archétypes, départage V2.2, checksum du code contre la base. Une publication est refusée tant qu’un contrôle échoue.</p>
            <p v-if="!selection" class="text-sm text-gray-500">Sélectionnez une version dans le registre.</p>
            <AdminSquelette v-else-if="!controles" :lignes="3" />
            <template v-else>
              <div class="mb-4 flex flex-wrap items-center gap-3">
                <span class="rounded-full px-3 py-1 text-xs font-semibold" :class="controles.ok ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'">{{ controles.ok ? 'Conforme' : `${ecarts} écart${ecarts > 1 ? 's' : ''}` }}</span>
                <span class="text-[13px] text-gray-500">{{ controles.controles.length - rates.length }} / {{ controles.controles.length }} contrôles passent</span>
                <button v-if="peut('admin') && controles.publiable" type="button" class="btn btn-primary ml-auto h-10 rounded-[10px] px-4 text-sm" :disabled="occupe" @click="publier(selection!)">
                  {{ data.versions.find((v: any) => v.version === selection)?.status === 'archived' ? 'Réactiver cette version' : 'Publier cette version' }}
                </button>
              </div>
              <p v-if="controles.empreinte?.code" class="mb-3 flex items-start gap-2 text-sm" :class="controles.empreinte.identique ? 'text-gray-700' : 'text-red-600'">
                <UiIcon :name="controles.empreinte.identique ? 'check-circle-outline' : 'alert-circle-outline'" :size="16" class="mt-0.5 shrink-0" :class="controles.empreinte.identique ? 'text-green-600' : ''" />
                <span v-if="!controles.empreinte.base">Empreinte du moteur déployé <code class="font-mono text-xs">{{ controles.empreinte.code.slice(0, 16) }}…</code> · version pas encore enregistrée en base.</span>
                <span v-else-if="controles.empreinte.identique">Empreinte en base identique à celle du moteur déployé : <code class="font-mono text-xs">{{ controles.empreinte.code.slice(0, 16) }}…</code></span>
                <span v-else>Empreinte en base <code class="font-mono text-xs">{{ controles.empreinte.base.slice(0, 16) }}…</code> ≠ moteur déployé <code class="font-mono text-xs">{{ controles.empreinte.code.slice(0, 16) }}…</code></span>
              </p>
              <ul v-if="controles.remarques?.length" class="mb-3 flex flex-col gap-1.5">
                <li v-for="e in controles.remarques" :key="e" class="flex items-start gap-2 text-sm text-gray-600"><UiIcon name="information-outline" :size="16" class="mt-0.5 shrink-0 text-navy-600" />{{ e }}</li>
              </ul>
              <ul v-if="controles.erreurs?.length" class="mb-4 flex flex-col gap-1.5">
                <li v-for="e in controles.erreurs" :key="e" class="flex items-start gap-2 text-sm text-red-600"><UiIcon name="alert-circle-outline" :size="16" class="mt-0.5 shrink-0" />{{ e }}</li>
              </ul>
              <div class="grid grid-cols-2 gap-x-6 gap-y-1">
                <div v-for="c in controles.controles" :key="c.nom" class="flex items-center gap-2 text-[13px]">
                  <UiIcon :name="c.ok ? 'check-circle-outline' : 'close-circle-outline'" :size="15" :class="c.ok ? 'text-green-600' : 'text-red-600'" />
                  <span class="text-gray-700">{{ c.nom }}</span>
                  <span class="ml-auto font-mono text-xs" :class="c.ok ? 'text-gray-400' : 'text-red-600'">{{ c.ok ? c.obtenu : `${c.obtenu} ≠ ${c.attendu}` }}</span>
                </div>
              </div>
            </template>
          </div>
        </div>
        <div class="flex w-[360px] shrink-0 flex-col gap-5">
          <div class="rounded-[14px] bg-navy-600 p-6">
            <p class="mb-3 text-xs leading-none font-semibold tracking-[0.08em] text-orange-300 uppercase">Règles</p>
            <ul class="flex flex-col gap-2.5 text-sm leading-[1.5] text-navy-100">
              <li>Une seule version publiée à la fois.</li>
              <li>Une version publiée est immuable : corriger la matrice, c’est publier une nouvelle version.</li>
              <li>Chaque participation garde la version qui l’a calculée. Rien n’est recalculé.</li>
              <li>Le retour arrière est la réactivation d’une version archivée, journalisée.</li>
            </ul>
          </div>
          <div class="card p-6">
            <p class="mb-4 text-xs leading-none font-semibold tracking-[0.08em] text-gray-500 uppercase">Journal</p>
            <p v-if="!data.journal.length" class="text-sm text-gray-500">Aucune publication depuis l’admin. Les versions initiales ont été amorcées par script.</p>
            <div v-for="(j, i) in data.journal" :key="i" class="flex gap-3 border-b border-gray-100 py-3 last:border-0">
              <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-50 text-navy-600"><UiIcon name="source-branch" :size="16" /></span>
              <div class="min-w-0 flex-1"><p class="text-sm font-medium text-navy-600">{{ ACTIONS[j.action] ?? j.action }} · {{ j.version }}</p><p class="text-xs text-gray-500">{{ j.acteur ?? 'Système' }} · {{ dateHeure(j.ts) }}</p></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
