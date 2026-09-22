<script setup lang="ts">
// Réglages applicatifs : identifiants de tracking (GA4, Meta Pixel, CAPI) et adresse du
// contact commercial, modifiables par un Administrateur. Décision client du 8 septembre 2026.
definePageMeta({ layout: 'admin', middleware: 'admin', role: 'admin', section: 'Réglages' })
useSeoMeta({ title: 'Réglages — Administration Radar by FeexPay', robots: 'noindex' })

const { data, refresh } = await useFetch<{ settings: any[] }>('/api/admin/settings', { headers: useRequestHeaders(['cookie']) })
const CHAMPS = [
  { key: 'tracking_enabled', label: 'Tracking actif', aide: '« true » ou « false ». À false, aucun script de mesure n’est chargé, quel que soit le consentement.' },
  { key: 'ga4_measurement_id', label: 'GA4 · Measurement ID', aide: 'Chargé après acceptation de la catégorie statistique.' },
  { key: 'ga4_api_secret', label: 'GA4 · secret d’API (Measurement Protocol)', aide: 'Serveur uniquement. Sans lui, « Rapport généré » et « Rapport envoyé » ne remontent pas dans GA4. Laissez vide pour ne pas modifier.' },
  { key: 'meta_pixel_id', label: 'Meta · Pixel / dataset ID', aide: 'Chargé après acceptation de la catégorie publicitaire.' },
  { key: 'meta_capi_access_token', label: 'Meta · jeton d’accès Conversions API', aide: 'Serveur uniquement, jamais envoyé au navigateur. Laissez vide pour ne pas modifier.' },
  { key: 'meta_capi_test_event_code', label: 'Meta · code d’événement de test', aide: 'Recette seulement. Vider en production.' },
]
const CHAMPS_CONTACT = [
  {
    key: 'contact_commercial_email',
    label: 'Adresse du contact commercial',
    aide: 'Reçoit les demandes déposées depuis le bouton « Contacter FeexPay » du rapport. Le dirigeant est mis en réponse : répondre depuis la boîte lui écrit directement.',
  },
]
const TOUS = [...CHAMPS, ...CHAMPS_CONTACT]
const valeurs = reactive<Record<string, string>>({})
const info = ref<string | null>(null)
const erreur = ref<string | null>(null)
const envoi = ref(false)
const ligne = (key: string) => data.value?.settings.find((s) => s.key === key)

async function enregistrer() {
  if (envoi.value) return
  envoi.value = true
  erreur.value = null
  info.value = null
  const body: Record<string, string> = {}
  for (const c of TOUS) {
    const v = valeurs[c.key]
    if (v === undefined || v === '') continue
    body[c.key] = v
  }
  try {
    if (Object.keys(body).length) await apiAdmin('/api/admin/settings', { method: 'PATCH', body })
    Object.keys(valeurs).forEach((k) => Reflect.deleteProperty(valeurs, k))
    await refresh()
    info.value = 'Réglages enregistrés. Prise en compte dans la minute.'
  } catch (e) {
    erreur.value = messageErreur(e)
  } finally {
    envoi.value = false
  }
}
</script>

<template>
  <div>
    <AdminHeader titre="Réglages" sous-titre="Tracking du plan V1.2 et contact commercial · modifiables ici, lus côté serveur">
      <NuxtLink to="/admin/reglages/leviers" class="btn btn-outline h-10 gap-2 rounded-[10px] px-3.5 text-sm"><UiIcon name="storefront-outline" :size="18" class="text-gray-500" />Leviers FeexPay</NuxtLink>
    </AdminHeader>
    <form class="flex items-start gap-5 px-8 pt-7 pb-9" novalidate @submit.prevent="enregistrer">
      <div class="flex min-w-0 flex-1 flex-col gap-5">
        <div class="card p-7">
          <h3 class="mb-[22px] text-[17px] font-semibold text-navy-600">Mesure d’audience et publicité</h3>
          <div class="flex flex-col gap-5">
            <div v-for="c in CHAMPS" :key="c.key">
              <label :for="c.key" class="mb-2 block text-sm font-semibold text-navy-600">{{ c.label }}</label>
              <input :id="c.key" v-model="valeurs[c.key]" class="field h-11 font-mono text-sm" :placeholder="ligne(c.key)?.value || 'Non renseigné'" autocomplete="off" >
              <p class="mt-1.5 text-[13px] leading-[1.4] text-gray-500">{{ c.aide }}<span v-if="ligne(c.key)?.updated_by_name"> Modifié par {{ ligne(c.key).updated_by_name }}.</span></p>
            </div>
          </div>
        </div>
        <div class="card p-7">
          <h3 class="mb-[22px] text-[17px] font-semibold text-navy-600">Contact commercial</h3>
          <div class="flex flex-col gap-5">
            <div v-for="c in CHAMPS_CONTACT" :key="c.key">
              <label :for="c.key" class="mb-2 block text-sm font-semibold text-navy-600">{{ c.label }}</label>
              <input :id="c.key" v-model="valeurs[c.key]" type="email" class="field h-11 font-mono text-sm" :placeholder="ligne(c.key)?.value || 'Non renseigné'" autocomplete="off" >
              <p class="mt-1.5 text-[13px] leading-[1.4] text-gray-500">{{ c.aide }}<span v-if="ligne(c.key)?.updated_by_name"> Modifié par {{ ligne(c.key).updated_by_name }}.</span></p>
            </div>
          </div>
        </div>
      </div>
      <div class="flex w-[360px] shrink-0 flex-col gap-5">
        <div class="card flex flex-col gap-2.5 p-6">
          <p v-if="info" class="rounded-[10px] bg-green-100 px-3.5 py-3 text-[13px] text-green-600">{{ info }}</p>
          <p v-if="erreur" class="rounded-[10px] bg-red-100 px-3.5 py-3 text-[13px] text-red-600" role="alert">{{ erreur }}</p>
          <button type="submit" :disabled="envoi" class="btn btn-primary h-12 rounded-[10px] text-[15px]">{{ envoi ? 'Enregistrement…' : 'Enregistrer' }}</button>
          <p class="text-xs leading-[1.5] text-gray-500">Seules les valeurs saisies sont modifiées. Les champs vides gardent la valeur actuelle, affichée en filigrane (les secrets sont tronqués).</p>
        </div>
        <div class="rounded-[14px] border border-navy-100 bg-navy-50 p-6">
          <p class="eyebrow mb-3 text-navy-600">Événements suivis</p>
          <p class="text-[13px] leading-[1.55] text-gray-700">page_view, quiz_start, quiz_complete, generate_lead, report_view, share, feexpay_cta_clicked. Lead et quiz_complete partent aussi côté serveur par la Conversions API, avec le même event_id que le Pixel pour la déduplication.</p>
        </div>
      </div>
    </form>
  </div>
</template>
