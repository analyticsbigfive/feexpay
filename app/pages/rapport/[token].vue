<script setup lang="ts">
/**
 * P12 — rapport détaillé. Cadres 390 et 1440 (docs/maquette/frames/*-P12.html) : sommaire
 * latéral persistant en desktop, sommaire en liste en mobile, cinq sections numérotées.
 * Consultable depuis le jeton de rapport (P11, email), sans session.
 */
import { METEO_ICONE, slugArchetype } from '~/composables/useParticipation'

definePageMeta({ layout: 'bare' })

const route = useRoute()
const token = route.params.token as string
const { data: r, error } = await useFetch<any>(`/api/public/reports/${token}`)
if (error.value || !r.value) throw createError({ statusCode: 404, statusMessage: 'Rapport introuvable' })

const nom = computed(() => `${r.value.contact.prenom} ${r.value.contact.nom}`)
const titre = computed(() => (r.value.dirigeant ? `${nom.value} · ${r.value.dirigeant.archetype.code}` : nom.value))
const date = computed(() =>
  new Date(r.value.etabliLe).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
)
const pdf = `/api/public/reports/${token}/pdf`
const partage = computed(() => `/partager/${r.value.dirigeant ? 'dirigeant' : 'rayonnement'}/${token}?rapport=1`)
const minuscule = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : '')
const phrase = (s: string) => (s ? s.replace(/\.?$/, '.') : '')

const sections = computed(() =>
  [
    r.value.dirigeant && { id: 'profil', n: '01', titre: 'Votre profil de dirigeant' },
    r.value.dirigeant && { id: 'dimensions', n: '02', titre: 'Vos huit dimensions' },
    r.value.rayonnement && { id: 'rayonnement', n: '03', titre: 'Rayonnement de votre entreprise' },
    r.value.croisement && { id: 'croisee', n: '04', titre: 'Lecture croisée' },
    { id: 'synthese', n: '05', titre: 'Synthèse et suites possibles' },
  ].filter(Boolean) as { id: string; n: string; titre: string }[],
)
const active = ref('')
onMounted(() => {
  useNuxtApp().$track('report_view', { rapport: token })
  const obs = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) active.value = e.target.id
    },
    { rootMargin: '-30% 0px -60% 0px' },
  )
  for (const s of sections.value) {
    const el = document.getElementById(s.id)
    if (el) obs.observe(el)
  }
  onUnmounted(() => obs.disconnect())
})

const dimsDirigeant = computed(() => [...(r.value.dirigeant?.dimensions ?? [])].sort((a: any, b: any) => b.score - a.score))
const meteoIcone = computed(() => METEO_ICONE[r.value.rayonnement?.meteo] ?? 'weather-cloudy')

/** Suites possibles : la zone à traiter, ce qui freine, la vigilance du profil, puis le second passage. */
const suites = computed(() => {
  const out: { titre: string; texte: string }[] = []
  const c = r.value.croisement
  if (c) out.push({ titre: c.prioriteMarketing, texte: c.ecartAction })
  if (r.value.rayonnement?.freine) out.push({ titre: 'Lever ce qui vous freine', texte: r.value.rayonnement.freine })
  if (r.value.dirigeant) out.push({ titre: 'Garder votre point de vigilance en vue', texte: phrase(r.value.dirigeant.archetype.risque) })
  out.push({
    titre: 'Refaire le diagnostic dans trois mois',
    texte: 'Le rayonnement bouge plus vite que le pilotage. Un second passage vous dira si l’effort a porté.',
  })
  return out.slice(0, 3)
})

/**
 * « Contacter FeexPay » ouvre une fenêtre modale plutôt qu'un `mailto:`. Le lien mail
 * n'ouvrait souvent rien sur mobile et dans les webmails, et son échec était invisible :
 * la demande partait dans le vide. Elle passe maintenant par le serveur, qui écrit au
 * conseiller et la dépose sur la fiche prospect. L'adresse reste offerte dans la fenêtre.
 */
const contactOuvert = ref(false)
function ouvrirContact() {
  contactOuvert.value = true
  // `feexpay_cta_clicked` : événement du plan de tracking pour ce bouton (PLAN.md §7).
  useNuxtApp().$track('feexpay_cta_clicked', { emplacement: 'rapport' })
}

useSeoMeta({ title: () => `Rapport complet · ${titre.value} — Radar by FeexPay` })
</script>

<template>
  <div class="flex flex-1 flex-col">
    <!-- Barre supérieure -->
    <header class="border-b border-gray-200 bg-white">
      <div class="wrap flex items-center justify-between py-3.5 lg:h-[76px] lg:py-0 lg:!px-6">
        <div class="flex items-center gap-4">
          <NuxtLink :to="`/confirmation/${token}`" class="-ml-2.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-navy-600 hover:bg-navy-50 lg:ml-0 lg:h-auto lg:w-auto lg:rounded-none lg:hover:bg-transparent" aria-label="Retour"><UiIcon name="arrow-left" :size="22" /></NuxtLink>
          <NuxtLink to="/" aria-label="Radar by FeexPay, accueil"><img src="/brand/logo-feexpay.svg" alt="FeexPay" class="h-[18px] w-auto lg:h-6" ></NuxtLink>
          <span class="hidden h-6 w-px bg-gray-200 lg:block" />
          <img v-if="r.dirigeant" :src="`/brand/emb-${slugArchetype(r.dirigeant.archetype.code)}-64.png`" :alt="`Emblème du profil ${r.dirigeant.archetype.code}`" class="hidden h-[26px] w-[26px] lg:block" >
          <span class="hidden text-[15px] leading-none font-medium text-navy-600 lg:inline">Rapport complet · {{ titre }}</span>
        </div>
        <div class="-my-2.5 -mr-2.5 flex gap-1.5 lg:my-0 lg:mr-0 lg:gap-3">
          <a :href="pdf" class="inline-flex h-11 w-11 items-center justify-center rounded-full text-navy-600 hover:bg-navy-50 lg:hidden" aria-label="Télécharger le PDF"><UiIcon name="download-outline" :size="20" /></a>
          <NuxtLink :to="partage" class="inline-flex h-11 w-11 items-center justify-center rounded-full text-navy-600 hover:bg-navy-50 lg:hidden" aria-label="Partager"><UiIcon name="share-variant-outline" :size="20" /></NuxtLink>
          <NuxtLink :to="partage" class="btn btn-outline hidden h-11 rounded-[10px] px-4 text-sm lg:inline-flex"><UiIcon name="share-variant-outline" :size="17" />Partager</NuxtLink>
          <a :href="pdf" class="btn btn-navy hidden h-11 rounded-[10px] px-[18px] text-sm lg:inline-flex"><UiIcon name="download-outline" :size="17" />Télécharger le PDF</a>
        </div>
      </div>
    </header>

    <!-- Mobile : en-tête du rapport et sommaire en liste -->
    <div class="border-b border-gray-200 px-5 pt-[26px] pb-[22px] md:px-10 lg:hidden">
      <p class="eyebrow mb-2 text-orange-600">Rapport complet</p>
      <div class="mb-2.5 flex items-center gap-3.5">
        <img v-if="r.dirigeant" :src="`/brand/emb-${slugArchetype(r.dirigeant.archetype.code)}-64.png`" :alt="`Emblème du profil ${r.dirigeant.archetype.code}`" class="h-11 w-11 shrink-0" >
        <h1 class="text-[28px] leading-[1.2] font-semibold tracking-[-0.015em] text-navy-600">{{ titre }}</h1>
      </div>
      <p class="text-[13px] leading-[1.5] text-gray-500">Établi le {{ date }} · moteur version {{ r.version }} · les résultats restent consultables avec leur instantané d’origine.</p>
    </div>
    <nav class="border-b border-gray-200 bg-gray-50 p-5 md:px-10 lg:hidden" aria-label="Sommaire">
      <p class="eyebrow mb-3 tracking-[0.06em] text-gray-500">Sommaire</p>
      <ol class="flex flex-col gap-px overflow-hidden rounded-[10px] bg-gray-200">
        <li v-for="s in sections" :key="s.id">
          <a :href="`#${s.id}`" class="flex items-center gap-3 bg-white p-3.5">
            <span class="font-mono text-xs leading-none font-semibold text-gray-400">{{ s.n }}</span>
            <span class="flex-1 text-[15px] leading-[1.3] font-medium text-navy-600">{{ s.titre }}</span>
            <UiIcon name="chevron-right" :size="18" class="text-gray-400" />
          </a>
        </li>
      </ol>
    </nav>

    <section class="flex-1 lg:bg-gray-50 lg:py-14 lg:pb-[72px]">
      <div class="wrap lg:flex lg:items-start lg:gap-10 lg:!px-6">
        <!-- Desktop : sommaire persistant -->
        <aside class="sticky top-6 hidden w-[280px] shrink-0 lg:block">
          <div class="card p-6">
            <p class="eyebrow mb-[18px] text-gray-500">Sommaire</p>
            <ol class="flex flex-col gap-1">
              <li v-for="s in sections" :key="s.id">
                <a
                  :href="`#${s.id}`"
                  class="flex items-center gap-3 px-3 py-[11px]"
                  :class="active === s.id ? 'rounded-r-lg border-l-2 border-orange-600 bg-orange-50' : 'rounded-lg hover:bg-gray-50'"
                >
                  <span class="font-mono text-xs leading-none font-semibold" :class="active === s.id ? 'text-orange-700' : 'text-gray-400'">{{ s.n }}</span>
                  <span class="text-sm leading-[1.35]" :class="active === s.id ? 'font-semibold text-navy-600' : 'text-gray-600'">{{ s.titre }}</span>
                </a>
              </li>
            </ol>
            <div class="my-[18px] h-px bg-gray-100" />
            <p class="text-xs leading-[1.55] text-gray-500">Établi le {{ date }} · moteur version {{ r.version }}. Les résultats restent consultables avec leur instantané d’origine.</p>
          </div>
        </aside>

        <div class="flex min-w-0 flex-1 flex-col gap-6 pt-6 pb-2 md:pt-8 lg:py-0">
          <!-- 01 · Profil -->
          <article v-if="r.dirigeant" id="profil" class="scroll-mt-6 px-0 lg:card lg:p-9">
            <p class="mb-1.5 font-mono text-xs leading-none font-semibold text-gray-400 lg:mb-2">01</p>
            <h2 class="mb-3.5 text-2xl leading-[1.25] font-semibold text-navy-600 lg:mb-7 lg:text-[30px] lg:leading-[1.2] lg:tracking-[-0.02em]">Votre profil de dirigeant</h2>
            <div class="mb-5 flex items-center gap-4 lg:mb-6">
              <span class="inline-flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-full bg-navy-600 lg:h-24 lg:w-24">
                <img :src="`/brand/emb-${slugArchetype(r.dirigeant.archetype.code)}-256.png`" :alt="`Emblème du profil ${r.dirigeant.archetype.code}`" class="h-[60px] w-[60px] rounded-full bg-white lg:h-[76px] lg:w-[76px]" >
              </span>
              <div>
                <p class="eyebrow mb-2 text-orange-600">Profil de dirigeant</p>
                <p class="text-[32px] leading-[1.1] font-semibold tracking-[-0.02em] text-navy-600 lg:text-[40px]">{{ r.dirigeant.archetype.code }}</p>
                <p class="mt-1 text-sm leading-[1.5] text-gray-500">Inspiré par {{ r.dirigeant.archetype.inspirePar }}</p>
              </div>
            </div>
            <div class="mb-4 rounded-xl bg-navy-50 p-[18px]">
              <p class="eyebrow mb-1.5 tracking-[0.06em] text-gray-500">Ce que ce profil dit de votre pilotage</p>
              <p class="mb-2 text-[17px] leading-[1.35] font-semibold text-navy-600">{{ r.dirigeant.pilotage.niveau }}</p>
              <p class="text-sm leading-[1.55] text-gray-700 lg:text-base lg:leading-[1.6]">{{ r.dirigeant.pilotage.lecture }} {{ phrase(r.dirigeant.archetype.traits) }}</p>
            </div>
            <div class="grid gap-3.5 md:grid-cols-2 lg:gap-5">
              <div class="card p-5">
                <div class="mb-2.5 flex items-center gap-2.5"><UiIcon name="arm-flex-outline" :size="20" class="text-green-600" /><p class="eyebrow tracking-[0.06em] text-green-600">Vos forces</p></div>
                <p class="text-base leading-[1.55] text-gray-700">{{ phrase(r.dirigeant.archetype.forces) }}</p>
              </div>
              <div class="card p-5">
                <div class="mb-2.5 flex items-center gap-2.5"><UiIcon name="alert-outline" :size="20" class="text-amber-600" /><p class="eyebrow tracking-[0.06em] text-amber-600">Point de vigilance</p></div>
                <p class="text-base leading-[1.55] text-gray-700">{{ phrase(r.dirigeant.archetype.risque) }}</p>
              </div>
            </div>
            <div v-if="r.dirigeant.secondaire" class="card mt-3.5 bg-gray-50 p-5 lg:mt-5">
              <p class="eyebrow mb-1.5 tracking-[0.06em] text-gray-500">Profil secondaire</p>
              <div class="mb-2 flex items-center gap-3"><img :src="`/brand/emb-${slugArchetype(r.dirigeant.secondaire.code)}-64.png`" alt="" class="h-10 w-10" ><p class="text-lg leading-[1.3] font-semibold text-navy-600">{{ r.dirigeant.secondaire.code }}</p></div>
              <p class="text-sm leading-[1.55] text-gray-600">Une seconde tendance nette : {{ minuscule(r.dirigeant.secondaire.forces) }}. Elle nuance votre profil principal sans le remplacer.</p>
            </div>
          </article>

          <!-- 02 · Dimensions -->
          <article v-if="r.dirigeant" id="dimensions" class="scroll-mt-6 lg:card lg:p-9">
            <p class="mb-1.5 font-mono text-xs leading-none font-semibold text-gray-400 lg:mb-2">02</p>
            <h2 class="mb-2 text-2xl leading-[1.25] font-semibold text-navy-600 lg:text-[30px] lg:leading-[1.2] lg:tracking-[-0.02em]">Vos huit dimensions</h2>
            <p class="mb-5 text-[15px] leading-[1.5] text-gray-500 lg:mb-7">Chaque dimension est exprimée sur 100. La plus présente est mise en avant.</p>
            <div class="card p-5 lg:p-[26px]">
              <RadarDimensionBars :dims="dimsDirigeant" :epaisseur="10" :libelle="15" />
            </div>
            <dl class="mt-4 grid gap-x-6 gap-y-3 md:grid-cols-2 lg:mt-6">
              <div v-for="d in dimsDirigeant" :key="d.code">
                <dt class="text-sm leading-[1.35] font-semibold text-navy-600">{{ d.nom }}</dt>
                <dd class="text-[13px] leading-[1.5] text-gray-600">{{ d.definition }}</dd>
              </div>
            </dl>
          </article>

          <!-- 03 · Rayonnement -->
          <article v-if="r.rayonnement" id="rayonnement" class="scroll-mt-6 lg:card lg:p-9">
            <p class="mb-1.5 font-mono text-xs leading-none font-semibold text-gray-400 lg:mb-2">03</p>
            <h2 class="mb-5 text-2xl leading-[1.25] font-semibold text-navy-600 lg:mb-7 lg:text-[30px] lg:leading-[1.2] lg:tracking-[-0.02em]">Rayonnement de votre entreprise</h2>
            <div class="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:gap-8">
              <div class="flex items-end gap-2.5"><span class="text-[56px] leading-none font-bold tracking-[-0.03em] text-navy-600">{{ r.rayonnement.score }}</span><span class="pb-1 text-xl text-gray-500">/ 100</span></div>
              <div class="card flex items-center gap-3.5 p-4">
                <UiIcon :name="meteoIcone" :size="40" class="shrink-0 text-navy-600" />
                <div><p class="text-[19px] leading-[1.25] font-semibold text-navy-600">{{ r.rayonnement.niveauAffiche }}</p><p class="mt-[3px] text-sm text-gray-600">Météo : {{ minuscule(r.rayonnement.meteo) }}</p></div>
              </div>
            </div>
            <p class="mb-5 text-base leading-[1.6] text-gray-700" style="text-wrap: pretty">{{ r.rayonnement.lecture }}</p>
            <div class="grid gap-3.5 md:grid-cols-2 lg:gap-5">
              <div class="card p-5 lg:p-[26px]">
                <p class="eyebrow mb-3.5 tracking-[0.06em] text-gray-500">Vos cinq dimensions</p>
                <RadarDimensionBars :dims="r.rayonnement.dimensions" surligne="min" :epaisseur="8" :libelle="14" />
              </div>
              <div class="flex flex-col gap-3.5 lg:gap-5">
                <div v-if="r.rayonnement.porte" class="card p-5">
                  <div class="mb-2.5 flex items-center gap-2.5"><UiIcon name="arm-flex-outline" :size="20" class="text-green-600" /><p class="eyebrow tracking-[0.06em] text-green-600">Ce qui vous porte</p></div>
                  <p class="text-base leading-[1.55] text-gray-700">{{ r.rayonnement.porte }}</p>
                </div>
                <div v-if="r.rayonnement.freine" class="card border-orange-200 p-5">
                  <div class="mb-2.5 flex items-center gap-2.5"><UiIcon name="alert-outline" :size="20" class="text-orange-700" /><p class="eyebrow tracking-[0.06em] text-orange-700">Ce qui vous freine</p></div>
                  <p class="text-base leading-[1.55] text-gray-700">{{ r.rayonnement.freine }}</p>
                </div>
                <div class="card bg-gray-50 p-5">
                  <p class="eyebrow mb-1.5 tracking-[0.06em] text-gray-500">Différenciation déclarée</p>
                  <p class="text-[15px] leading-[1.55] text-gray-700"><span class="font-semibold text-navy-600">{{ r.rayonnement.differenciation.valeur }}.</span> Prix, proximité, qualité et avantage distinctif sont quatre natures de différenciation, sans hiérarchie entre elles.</p>
                </div>
              </div>
            </div>
          </article>

          <!-- 04 · Lecture croisée -->
          <article v-if="r.croisement" id="croisee" class="scroll-mt-6 lg:card lg:p-9">
            <p class="mb-1.5 font-mono text-xs leading-none font-semibold text-gray-400 lg:mb-2">04</p>
            <h2 class="mb-3.5 text-2xl leading-[1.25] font-semibold text-navy-600 lg:mb-2 lg:text-[30px] lg:leading-[1.2] lg:tracking-[-0.02em]">Lecture croisée</h2>
            <p class="mb-4 hidden text-[15px] leading-[1.5] text-gray-500 lg:mb-7 lg:block">Ce que la mise en regard de vos deux diagnostics fait apparaître.</p>
            <div class="mb-4 flex gap-3 lg:mb-7 lg:grid lg:grid-cols-2 lg:gap-px lg:overflow-hidden lg:rounded-xl lg:bg-gray-200">
              <div class="flex-1 rounded-xl border border-gray-200 p-4 lg:rounded-none lg:border-0 lg:bg-gray-50 lg:p-6">
                <p class="mb-1.5 text-xs leading-[1.3] text-gray-500 lg:eyebrow lg:mb-2 lg:tracking-[0.06em]">Pilotage interne</p>
                <p class="text-[26px] leading-none font-bold text-navy-600 lg:text-[32px] lg:tracking-[-0.02em]">{{ r.croisement.pilotage }}</p>
                <p class="mt-1.5 text-xs leading-[1.35] text-gray-600 lg:mt-1 lg:text-sm">{{ r.dirigeant?.pilotage.niveau }}</p>
              </div>
              <div class="flex-1 rounded-xl border border-gray-200 p-4 lg:rounded-none lg:border-0 lg:bg-orange-50 lg:p-6">
                <p class="mb-1.5 text-xs leading-[1.3] text-gray-500 lg:eyebrow lg:mb-2 lg:tracking-[0.06em] lg:text-orange-700">Rayonnement<span class="hidden lg:inline"> externe</span></p>
                <p class="text-[26px] leading-none font-bold text-navy-600 lg:text-[32px] lg:tracking-[-0.02em] lg:text-orange-600">{{ r.croisement.rayonnement }}</p>
                <p class="mt-1.5 text-xs leading-[1.35] text-gray-600 lg:mt-1 lg:text-sm">{{ r.rayonnement?.niveauAffiche }}</p>
              </div>
            </div>
            <div class="mb-4 rounded-xl bg-navy-50 p-[18px] lg:mb-5 lg:bg-white lg:p-0">
              <p class="eyebrow mb-1.5 tracking-[0.06em] text-gray-500 lg:hidden">{{ r.croisement.lecture }}</p>
              <h3 class="mb-2 hidden text-[22px] leading-[1.28] font-semibold text-navy-600 lg:mb-3 lg:block">{{ r.croisement.lecture }}</h3>
              <p class="mb-2 text-[17px] leading-[1.35] font-semibold text-navy-600 lg:mb-5 lg:text-[17px] lg:leading-[1.7] lg:font-normal lg:text-gray-700" style="text-wrap: pretty">{{ r.croisement.formulation }}</p>
              <p class="text-sm leading-[1.55] text-gray-700 lg:mb-5 lg:text-[17px] lg:leading-[1.7]" style="text-wrap: pretty">{{ r.croisement.interpretation }} {{ r.croisement.ecartLecture }}</p>
            </div>
            <div class="rounded-xl border border-gray-200 p-[18px] lg:border-0 lg:bg-navy-50 lg:p-6">
              <p class="eyebrow mb-1.5 tracking-[0.06em] text-gray-500 lg:mb-3 lg:text-navy-600">La zone à traiter en premier</p>
              <p class="text-[15px] leading-[1.55] text-gray-700 lg:text-base lg:leading-[1.65]"><span class="font-semibold text-navy-600">{{ r.croisement.prioriteMarketing }}.</span> {{ r.croisement.ecartAction }}</p>
            </div>
          </article>

          <!-- 05 · Synthèse -->
          <article id="synthese" class="scroll-mt-6 lg:card lg:p-9">
            <p class="mb-1.5 font-mono text-xs leading-none font-semibold text-gray-400 lg:mb-2">05</p>
            <h2 class="mb-4 text-2xl leading-[1.25] font-semibold text-navy-600 lg:mb-7 lg:text-[30px] lg:leading-[1.2] lg:tracking-[-0.02em]">Synthèse et suites possibles</h2>
            <ol class="flex flex-col gap-3.5 lg:gap-4">
              <li v-for="(s, i) in suites" :key="s.titre" class="flex items-start gap-3.5 rounded-xl border border-gray-200 p-[18px] lg:gap-[18px] lg:p-[22px]">
                <span class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-[15px] leading-none font-semibold" :class="i === 0 ? 'bg-orange-50 text-orange-700' : 'bg-navy-50 text-navy-600'">{{ i + 1 }}</span>
                <div>
                  <p class="mb-1.5 text-[17px] leading-[1.35] font-semibold text-navy-600">{{ s.titre }}</p>
                  <p class="text-[15px] leading-[1.6] text-gray-600">{{ s.texte }}</p>
                </div>
              </li>
            </ol>
          </article>

          <!-- Contact -->
          <div class="mb-7 rounded-2xl border border-gray-200 bg-gray-50 px-5 py-6 lg:mb-0 lg:flex lg:items-center lg:justify-between lg:gap-8 lg:rounded-[14px] lg:p-7">
            <div>
              <p class="mb-2 text-xl leading-[1.3] font-semibold text-navy-600">Envie d’en discuter ?</p>
              <p class="mb-[18px] text-[15px] leading-[1.55] text-gray-600 lg:mb-0 lg:max-w-[520px]">Échangez avec un conseiller FeexPay sur ce que ces résultats impliquent pour votre activité.</p>
            </div>
            <button type="button" class="btn btn-primary h-[52px] w-full text-base lg:w-auto lg:shrink-0 lg:px-7" @click="ouvrirContact">Contacter FeexPay</button>
          </div>
        </div>
      </div>
    </section>

    <RadarContactModale
      v-model="contactOuvert"
      :token="token"
      :contact="r.contact"
      :titre="titre"
      :adresse-par-defaut="r.contactCommercial ?? 'contact.ci@feexpay.me'"
    />
  </div>
</template>
