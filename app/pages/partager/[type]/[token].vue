<script setup lang="ts">
/**
 * P13 / P14 — carte partageable. Cadres 390 et 1440.
 * P13 (dirigeant) : fond bleu nuit, emblème dans un disque blanc. P14 (rayonnement) :
 * seule surface où une grande zone orange est autorisée, icône météo blanche, logotype
 * monochrome blanc. La carte ne montre que le résultat : ni réponses, ni lectures internes.
 * L'image est dessinée sur un canvas au format choisi ; le lien partagé est la landing,
 * la page de résultat étant liée à la session.
 */
import {
  mdiWeatherCloudy,
  mdiWeatherLightningRainy,
  mdiWeatherPartlyCloudy,
  mdiWeatherRainy,
  mdiWeatherSunny,
} from '@mdi/js'
import { METEO_ICONE, slugArchetype, type DiagType } from '~/composables/useParticipation'

definePageMeta({ layout: 'bare' })

const route = useRoute()
const type = route.params.type as DiagType
const token = route.params.token as string
if (type !== 'dirigeant' && type !== 'rayonnement') throw createError({ statusCode: 404 })

const dirigeant = type === 'dirigeant'
/** Depuis P11/P12, le jeton est celui du rapport (sans session) ; depuis P08/P09, celui de la participation. */
const depuisRapport = route.query.rapport === '1'
const { data, error } = await useFetch<any>(depuisRapport ? `/api/public/reports/${token}` : `/api/public/results/${token}`)
if (error.value) throw createError({ statusCode: 404, statusMessage: 'Résultat introuvable ou expiré' })
const r = computed(() => (depuisRapport ? data.value?.[type] : data.value?.result))
if (!r.value) throw createError({ statusCode: 404, statusMessage: 'Ce rapport ne contient pas ce diagnostic' })
const retour = depuisRapport ? `/rapport/${token}` : `/resultat/${type}/${token}`

const config = useRuntimeConfig()
const lien = config.public.appBaseUrl
const meteoIcone = computed(() => METEO_ICONE[r.value?.meteo] ?? 'weather-cloudy')
const meteoMin = computed(() => String(r.value?.meteo ?? '').toLowerCase())

// Les quatre formats de l'énumération `share_format` (PLAN.md §4).
const FORMATS = [
  { nom: 'Carré · 1080 × 1080', w: 1080, h: 1080 },
  { nom: 'Portrait · 1080 × 1350', w: 1080, h: 1350 },
  { nom: 'Bannière · 1200 × 630', w: 1200, h: 630 },
  { nom: 'Story · 1080 × 1920', w: 1080, h: 1920 },
]
const format = ref(0)

const ETATS_METEO = [
  { meteo: 'Soleil', icone: 'weather-sunny', texte: 'Grand soleil · marque de référence' },
  { meteo: 'Éclaircies', icone: 'weather-partly-cloudy', texte: 'Éclaircies · challenger fort' },
  { meteo: 'Nuageux', icone: 'weather-cloudy', texte: 'Ciel voilé · présence à consolider' },
  { meteo: 'Pluie', icone: 'weather-rainy', texte: 'Averses · visibilité fragile' },
  { meteo: 'Tempête', icone: 'weather-lightning-rainy', texte: 'Orage · signal faible' },
]
const CHEMINS: Record<string, string> = {
  'weather-sunny': mdiWeatherSunny,
  'weather-partly-cloudy': mdiWeatherPartlyCloudy,
  'weather-cloudy': mdiWeatherCloudy,
  'weather-rainy': mdiWeatherRainy,
  'weather-lightning-rainy': mdiWeatherLightningRainy,
}

const texteLibre = computed(() =>
  dirigeant
    ? `Mon profil de dirigeant : ${r.value?.archetype?.code}. ${r.value?.archetype?.forces}.`
    : `Rayonnement de mon entreprise : ${r.value?.score} / 100, ${r.value?.niveauAffiche}.`,
)
/**
 * Adresse partagée. WhatsApp et LinkedIn ne savent recevoir qu'une URL et vont y lire un
 * aperçu : ce doit donc être la carte publique, qui porte l'image, et non la page d'accueil.
 * Tant qu'elle n'est pas prête, on retombe sur la page d'accueil — un lien qui marche.
 */
const adresse = computed(() => (jetonCarte.value ? `${lien}/carte/${jetonCarte.value}` : lien))
const messagePour = (url: string) => `${texteLibre.value} Faites le test avec Radar by FeexPay : ${url}`
const message = computed(() => messagePour(adresse.value))
const whatsapp = computed(() => `https://wa.me/?text=${encodeURIComponent(message.value)}`)
const linkedin = computed(() => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(adresse.value)}`)

const { $track } = useNuxtApp()
const info = ref<string | null>(null)
let minuterie: ReturnType<typeof setTimeout> | undefined
function signaler(t: string) {
  info.value = t
  clearTimeout(minuterie)
  minuterie = setTimeout(() => (info.value = null), 3000)
}

async function copier() {
  $track('share', { canal: 'lien', diagnostic: type })
  try {
    await navigator.clipboard.writeText(await lienPartage())
    signaler('Lien copié')
  } catch {
    signaler('Copie impossible sur ce navigateur')
  }
}

/**
 * Partage natif. L'image au format choisi part avec, quand l'appareil sait recevoir un
 * fichier : c'est le seul chemin par lequel la carte elle-même atteint WhatsApp ou LinkedIn.
 * Le lien de la carte publique est écrit dans le texte et non passé en `url` : avec un
 * fichier, WhatsApp ne garde que le texte, qui devient la légende de l'image (recette 1.12).
 * Sinon, texte et lien, comme avant.
 */
async function partagerNatif() {
  $track('share', { canal: 'natif', diagnostic: type })
  const f = FORMATS[format.value]!
  if (navigator.share) {
    try {
      // En parallèle : `navigator.share` doit partir peu après le geste de l'utilisateur.
      const [blob, url] = await Promise.all([dessiner(f).catch(() => null), lienPartage()])
      const fichier = blob ? new File([blob], nomFichier(f), { type: 'image/png' }) : null
      if (fichier && navigator.canShare?.({ files: [fichier] })) {
        await navigator.share({ files: [fichier], title: 'Radar by FeexPay', text: messagePour(url) })
        void publier(f)
        return
      }
      await navigator.share({ title: 'Radar by FeexPay', text: texteLibre.value, url })
      return
    } catch {}
  }
  window.open(whatsapp.value, '_blank', 'noopener')
}

// La carte publique est préparée dès l'arrivée : les liens WhatsApp et LinkedIn sont des
// ancres, ils ne peuvent pas attendre un aller-retour au moment du clic.
onMounted(() => {
  void assurerCartePublique()
})

function image(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/**
 * Dessine la carte au format demandé et rend l'image. PNG par défaut, pour le téléchargement
 * et le partage de fichier ; JPEG pour la bannière d'aperçu, voir `publier`.
 */
async function dessiner(f: (typeof FORMATS)[number], mime: 'image/png' | 'image/jpeg' = 'image/png'): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = f.w
  canvas.height = f.h
  const c = canvas.getContext('2d')!
  const s = Math.min(f.w, f.h) / 520 // échelle depuis l'aperçu 520 px
  const m = 36 * s

  if (dirigeant) {
    const g = c.createLinearGradient(0, 0, f.w, f.h)
    g.addColorStop(0, '#0E2445')
    g.addColorStop(1, '#23477E')
    c.fillStyle = g
  } else {
    c.fillStyle = '#D45D00'
  }
  c.fillRect(0, 0, f.w, f.h)

  const logo = await image(dirigeant ? '/brand/logo-feexpay-white.png' : '/brand/logo-feexpay-mono-white.png')
  const hl = 24 * s
  c.drawImage(logo, m, m, (logo.width / logo.height) * hl, hl)
  c.fillStyle = dirigeant ? '#F6B684' : '#FDEBDE'
  c.font = `600 ${11 * s}px Poppins, sans-serif`
  c.textAlign = 'right'
  c.fillText('RADAR', f.w - m, m + hl * 0.8)
  c.textAlign = 'left'

  const y0 = f.h / 2 - 150 * s
  if (dirigeant) {
    c.fillStyle = '#fff'
    c.beginPath()
    c.arc(m + 56 * s, y0 + 56 * s, 56 * s, 0, Math.PI * 2)
    c.fill()
    const emb = await image(`/brand/emb-${slugArchetype(r.value.archetype.code)}-256.png`)
    c.drawImage(emb, m + 11 * s, y0 + 11 * s, 90 * s, 90 * s)
    c.fillStyle = '#F6B684'
    c.font = `600 ${12 * s}px Poppins, sans-serif`
    c.fillText('PROFIL DE DIRIGEANT', m, y0 + 150 * s)
    c.fillStyle = '#fff'
    c.font = `700 ${58 * s}px Poppins, sans-serif`
    c.fillText(r.value.archetype.code, m, y0 + 212 * s)
    c.fillStyle = '#B5C5DC'
    c.font = `400 ${17 * s}px Poppins, sans-serif`
    lignes(c, `${r.value.archetype.forces}.`, m, y0 + 250 * s, 380 * s, 26 * s)
  } else {
    const p = new Path2D(CHEMINS[meteoIcone.value]!)
    c.save()
    c.translate(m, y0)
    c.scale((88 * s) / 24, (88 * s) / 24)
    c.fillStyle = '#fff'
    c.fill(p)
    c.restore()
    c.fillStyle = '#FDEBDE'
    c.font = `600 ${12 * s}px Poppins, sans-serif`
    c.fillText('RAYONNEMENT DE L’ENTREPRISE', m, y0 + 130 * s)
    c.fillStyle = '#fff'
    c.font = `700 ${72 * s}px Poppins, sans-serif`
    c.fillText(String(r.value.score), m, y0 + 210 * s)
    const w = c.measureText(String(r.value.score)).width
    c.fillStyle = '#FDEBDE'
    c.font = `400 ${20 * s}px Poppins, sans-serif`
    c.fillText('/ 100', m + w + 10 * s, y0 + 210 * s)
    c.fillStyle = '#fff'
    c.font = `600 ${24 * s}px Poppins, sans-serif`
    c.fillText(r.value.niveauAffiche, m, y0 + 252 * s)
    c.fillStyle = '#FDEBDE'
    c.font = `400 ${16 * s}px Poppins, sans-serif`
    lignes(c, `Météo : ${meteoMin.value}.`, m, y0 + 284 * s, 380 * s, 24 * s)
  }

  c.fillStyle = dirigeant ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.32)'
  c.fillRect(m, f.h - m - 32 * s, f.w - 2 * m, 1)
  c.fillStyle = '#fff'
  c.font = `500 ${14 * s}px Poppins, sans-serif`
  c.fillText('Powered by FeexPay', m, f.h - m - 6 * s)

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas vide'))), mime, 0.85),
  )
}

const nomFichier = (f: (typeof FORMATS)[number]) =>
  `radar-feexpay-${dirigeant ? slugArchetype(r.value.archetype.code) : 'rayonnement'}-${f.w}x${f.h}.png`

/**
 * Enregistre la carte côté serveur et rend son jeton public. La bannière 1200 × 630 part avec
 * l'image : c'est elle qui sert d'aperçu à WhatsApp et à LinkedIn, qui ne savent recevoir
 * qu'une URL. Les autres formats ne laissent qu'une trace.
 *
 * La bannière est envoyée en JPEG, pas en PNG : WhatsApp ignore toute image d'aperçu au-delà
 * de 300 Ko, et le dégradé de fond pèse 700 Ko en PNG contre moins de 100 Ko en JPEG.
 */
async function publier(f: (typeof FORMATS)[number]): Promise<string | null> {
  try {
    const banniere = f.w === 1200 && f.h === 630
    const blob = banniere ? await dessiner(f, 'image/jpeg').catch(() => null) : null
    const corps = new FormData()
    corps.set('format', `${f.w}x${f.h}`)
    corps.set('diagnostic', type)
    corps.set('rapport', depuisRapport ? '1' : '0')
    corps.set('objectKey', nomFichier(f))
    if (blob) corps.set('image', blob, nomFichier(f).replace(/\.png$/, '.jpg'))
    const r = await $fetch<{ jeton: string }>(`/api/public/shares/${token}`, { method: 'POST', body: corps })
    return r.jeton
  } catch {
    // La carte reste téléchargeable et partageable en texte : un échec ici n'arrête rien.
    return null
  }
}

/** Jeton de la carte publique, obtenu à la première demande puis conservé. */
const jetonCarte = ref<string | null>(null)
async function assurerCartePublique(): Promise<string | null> {
  if (jetonCarte.value) return jetonCarte.value
  const banniere = FORMATS.find((x) => x.w === 1200 && x.h === 630)!
  jetonCarte.value = await publier(banniere)
  return jetonCarte.value
}

/** L'adresse à partager : la carte publique si elle existe, la landing sinon. */
async function lienPartage(): Promise<string> {
  const j = await assurerCartePublique()
  return j ? `${lien}/carte/${j}` : lien
}

async function telecharger() {
  $track('share', { canal: 'image', diagnostic: type })
  const f = FORMATS[format.value]!
  let blob: Blob
  try {
    blob = await dessiner(f)
  } catch {
    return signaler('Génération impossible')
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomFichier(f)
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  await publier(f)
  void assurerCartePublique()
}

function lignes(c: CanvasRenderingContext2D, texte: string, x: number, y: number, largeur: number, interligne: number) {
  const mots = texte.split(' ')
  let ligne = ''
  for (const mot of mots) {
    const essai = ligne ? `${ligne} ${mot}` : mot
    if (c.measureText(essai).width > largeur && ligne) {
      c.fillText(ligne, x, y)
      ligne = mot
      y += interligne
    } else {
      ligne = essai
    }
  }
  if (ligne) c.fillText(ligne, x, y)
}

useSeoMeta({ title: `${dirigeant ? 'Partager mon profil' : 'Partager le rayonnement'} — Radar by FeexPay` })
</script>

<template>
  <div class="flex flex-1 flex-col">
    <RadarTopBar
      :back="retour"
      close
      :label="dirigeant ? 'Partager mon résultat' : 'Partager le rayonnement de votre entreprise'"
      :label-mobile="dirigeant ? 'Partager mon résultat' : 'Partager le rayonnement'"
    >
      <template #right>
        <NuxtLink :to="retour" class="hidden hover:underline lg:inline">{{ depuisRapport ? 'Retour au rapport' : 'Retour au résultat' }}</NuxtLink>
      </template>
    </RadarTopBar>

    <section class="flex-1 bg-gray-50 lg:py-14 lg:pb-[72px]">
      <div class="wrap lg:flex lg:items-start lg:gap-14 lg:!px-6">
        <!-- Aperçu -->
        <div class="px-0 py-6 lg:w-[520px] lg:shrink-0 lg:py-0">
          <p class="eyebrow mb-4 hidden text-gray-500 lg:block">Aperçu</p>
          <div
            class="carte mx-auto flex h-[350px] w-[280px] flex-col overflow-hidden rounded-[14px] lg:h-[520px] lg:w-[520px] lg:rounded-[20px]"
            :class="dirigeant ? 'carte--navy' : 'carte--orange'"
            role="img"
            :aria-label="texteLibre"
          >
            <div class="flex items-center justify-between px-[22px] pt-5 lg:px-9 lg:pt-9">
              <img :src="dirigeant ? '/brand/logo-feexpay-white.svg' : '/brand/logo-feexpay-mono-white.png'" alt="FeexPay" class="block h-4 w-auto lg:h-6" >
              <span class="text-[8px] leading-none font-semibold tracking-[0.12em] uppercase lg:text-[11px]" :class="dirigeant ? 'text-orange-300' : 'text-orange-100'">Radar</span>
            </div>
            <div class="flex flex-1 flex-col justify-center px-[22px] py-[18px] lg:px-9 lg:py-7">
              <template v-if="dirigeant">
                <span class="mb-4 inline-flex h-[62px] w-[62px] items-center justify-center rounded-full bg-white lg:mb-[26px] lg:h-28 lg:w-28">
                  <img :src="`/brand/emb-${slugArchetype(r.archetype.code)}-256.png`" :alt="`Emblème du profil ${r.archetype.code}`" class="block h-[50px] w-[50px] lg:h-[90px] lg:w-[90px]" >
                </span>
                <p class="mb-2 text-[9px] leading-none font-semibold tracking-[0.1em] text-orange-300 uppercase lg:mb-3 lg:text-xs">Profil de dirigeant</p>
                <p class="mb-2.5 text-4xl leading-none font-bold tracking-[-0.02em] text-white lg:mb-4 lg:text-[58px] lg:tracking-[-0.03em]">{{ r.archetype.code }}</p>
                <p class="text-[11px] leading-[1.5] text-navy-200 lg:max-w-[380px] lg:text-[17px] lg:leading-[1.55]">{{ r.archetype.forces }}.</p>
              </template>
              <template v-else>
                <UiIcon :name="meteoIcone" class="mb-3 text-white !h-14 !w-14 lg:mb-[22px] lg:!h-[88px] lg:!w-[88px]" />
                <p class="mb-2 text-[9px] leading-none font-semibold tracking-[0.1em] text-orange-100 uppercase lg:mb-3 lg:text-xs">Rayonnement de l’entreprise</p>
                <div class="mb-2 flex items-baseline gap-1.5 lg:mb-3 lg:gap-2.5">
                  <span class="text-[44px] leading-none font-bold tracking-[-0.02em] text-white lg:text-[72px] lg:tracking-[-0.03em]">{{ r.score }}</span>
                  <span class="text-[13px] leading-none text-orange-100 lg:text-xl">/ 100</span>
                </div>
                <p class="mb-1 text-[15px] leading-[1.25] font-semibold text-white lg:mb-1.5 lg:text-2xl lg:leading-[1.2]">{{ r.niveauAffiche }}</p>
                <p class="text-[11px] leading-[1.5] text-orange-100 lg:max-w-[380px] lg:text-base">Météo : {{ meteoMin }}.</p>
              </template>
            </div>
            <div class="px-[22px] pb-5 lg:px-9 lg:pb-8">
              <div class="mb-2 h-px lg:mb-[18px]" :style="{ background: dirigeant ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.32)' }" />
              <p class="text-[9px] leading-none text-white lg:text-sm lg:font-medium" :class="dirigeant ? 'text-navy-200 lg:text-white' : 'text-orange-100 lg:text-white'">Powered by FeexPay</p>
            </div>
          </div>
          <p class="mt-3.5 text-center text-xs leading-[1.5] text-gray-500 lg:hidden">Format final {{ FORMATS[format]!.w }} × {{ FORMATS[format]!.h }} px · aperçu réduit</p>
        </div>

        <!-- Actions -->
        <div class="flex flex-1 flex-col gap-5 pt-[22px] pb-7 lg:pt-0 lg:pb-0">
          <div class="lg:card lg:p-7">
            <h1 class="mb-2.5 hidden text-[30px] leading-[1.18] font-semibold tracking-[-0.02em] text-navy-600 lg:block">
              {{ dirigeant ? 'Partagez votre profil' : 'Partagez le rayonnement de votre entreprise' }}
            </h1>
            <p class="mb-6 hidden text-base leading-[1.65] text-gray-600 lg:block">
              {{
                dirigeant
                  ? 'La carte est générée au format carré pour les réseaux et en bannière pour LinkedIn.'
                  : 'Deuxième carte du parcours, indépendante de celle du dirigeant. Elle est générée aux mêmes formats et porte l’icône météo du niveau atteint.'
              }}
            </p>
            <div class="mb-6 hidden gap-2.5 lg:flex" role="radiogroup" aria-label="Format de la carte">
              <button
                v-for="(f, i) in FORMATS"
                :key="f.nom"
                type="button"
                role="radio"
                :aria-checked="format === i"
                class="inline-flex h-10 items-center justify-center rounded-full border-[1.5px] px-4 text-sm leading-none"
                :class="format === i ? 'border-orange-600 bg-orange-50 font-medium text-navy-600' : 'border-gray-300 text-gray-600 hover:border-navy-300'"
                @click="format = i"
              >
                {{ f.nom }}
              </button>
            </div>
            <!-- Mobile : trois actions empilées. Desktop : quatre, en grille. -->
            <div class="flex flex-col gap-2.5 lg:grid lg:grid-cols-2 lg:gap-3">
              <button type="button" class="btn h-[52px] text-base lg:hidden" :class="dirigeant ? 'btn-primary' : 'btn-navy'" @click="partagerNatif">
                <UiIcon name="share-variant-outline" :size="18" />Partager
              </button>
              <a :href="whatsapp" target="_blank" rel="noopener" class="btn hidden h-[52px] text-[15px] lg:inline-flex" :class="dirigeant ? 'btn-primary' : 'btn-navy'" @click="$track('share', { canal: 'whatsapp', diagnostic: type })">
                <UiIcon name="whatsapp" :size="19" />Partager sur WhatsApp
              </a>
              <a :href="linkedin" target="_blank" rel="noopener" class="btn btn-outline hidden h-[52px] text-[15px] lg:inline-flex" @click="$track('share', { canal: 'linkedin', diagnostic: type })">
                <UiIcon name="linkedin" :size="19" />Partager sur LinkedIn
              </a>
              <button type="button" class="btn btn-outline h-[52px] text-base lg:text-[15px]" @click="telecharger">
                <UiIcon name="download-outline" :size="18" /><span class="lg:hidden">Enregistrer l’image</span><span class="hidden lg:inline">Télécharger l’image</span>
              </button>
              <button type="button" class="btn btn-outline h-[52px] text-base lg:text-[15px]" @click="copier">
                <UiIcon name="link-variant" :size="18" />Copier le lien
              </button>
            </div>
            <p v-if="info" class="mt-3 flex items-center gap-3.5 rounded-[10px] bg-navy-600 px-4 py-3.5 text-[13px] leading-[1.4] font-medium text-white" role="status">
              <UiIcon name="content-copy" :size="18" class="text-orange-300" />{{ info }}
            </p>
          </div>

          <div v-if="dirigeant" class="card hidden p-7 lg:block">
            <p class="eyebrow mb-4 text-gray-500">Ce que la carte affiche</p>
            <ul class="flex flex-col gap-[11px]">
              <li class="flex items-start gap-2.5"><UiIcon name="check" :size="18" class="shrink-0 text-green-600" /><span class="text-[15px] leading-[1.5] text-gray-700">Votre archétype et sa description courte</span></li>
              <li class="flex items-start gap-2.5"><UiIcon name="check" :size="18" class="shrink-0 text-green-600" /><span class="text-[15px] leading-[1.5] text-gray-700">L’emblème de votre profil, dans son disque blanc</span></li>
              <li class="flex items-start gap-2.5"><UiIcon name="close" :size="18" class="shrink-0 text-red-600" /><span class="text-[15px] leading-[1.5] text-gray-400">Vos réponses question par question</span></li>
              <li class="flex items-start gap-2.5"><UiIcon name="close" :size="18" class="shrink-0 text-red-600" /><span class="text-[15px] leading-[1.5] text-gray-400">Les constats et lectures internes</span></li>
            </ul>
          </div>
          <div v-else class="card hidden p-7 lg:block">
            <p class="eyebrow mb-4 text-gray-500">Les cinq états météo</p>
            <ul class="flex flex-col gap-2.5">
              <li
                v-for="e in ETATS_METEO"
                :key="e.meteo"
                class="flex items-center gap-3"
                :class="e.meteo === r.meteo ? '-mx-3 -my-2 rounded-[10px] bg-orange-50 px-3 py-2' : undefined"
              >
                <UiIcon :name="e.icone" :size="22" class="shrink-0" :class="e.meteo === r.meteo ? 'text-orange-700' : 'text-navy-600'" />
                <span class="flex-1 text-[15px] leading-[1.4]" :class="e.meteo === r.meteo ? 'font-medium text-navy-600' : 'text-gray-700'">{{ e.texte }}</span>
                <span v-if="e.meteo === r.meteo" class="font-mono text-[13px] leading-none font-semibold text-orange-600">votre niveau</span>
              </li>
            </ul>
          </div>

          <div class="flex items-start gap-2.5 rounded-xl bg-navy-50 px-4 py-3.5 lg:gap-3.5 lg:rounded-[14px] lg:border lg:border-navy-100 lg:p-6">
            <UiIcon name="shield-check-outline" class="shrink-0 text-navy-600 !h-5 !w-5 lg:!h-6 lg:!w-6" />
            <p class="text-[13px] leading-[1.5] text-gray-700 lg:text-[15px] lg:leading-[1.6]">
              {{
                dirigeant
                  ? 'La carte ne montre que votre résultat. Vos réponses et les lectures internes n’y apparaissent jamais.'
                  : 'Le score et son niveau apparaissent seuls. Le détail des cinq dimensions, la différenciation déclarée et le nom de l’entreprise n’y figurent pas.'
              }}
            </p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.carte--navy {
  background: linear-gradient(135deg, #0e2445 0%, #23477e 100%);
  box-shadow: 0 12px 30px rgba(17, 44, 86, 0.18);
}
.carte--orange {
  background: #d45d00;
  box-shadow: 0 12px 30px rgba(17, 44, 86, 0.18);
}
@media (min-width: 1024px) {
  .carte {
    box-shadow: 0 16px 40px rgba(17, 44, 86, 0.16);
  }
}
</style>
