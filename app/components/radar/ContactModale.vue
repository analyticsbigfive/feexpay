<script setup lang="ts">
/**
 * Demande de contact depuis le rapport (P12). Remplace le `mailto:` du bouton « Contacter
 * FeexPay », qui n'ouvrait souvent rien sur mobile et dans les webmails, et dont l'échec
 * était invisible : le message partait dans le vide.
 *
 * L'identité vient du rapport, elle n'est pas ressaisie. Restent le message — prérempli avec
 * une formulation neutre, modifiable —, le téléphone et le canal souhaité.
 *
 * L'adresse du contact commercial reste affichée en secours : si l'envoi échoue, ou si le
 * dirigeant préfère écrire lui-même, le chemin direct existe toujours.
 */
const ouvert = defineModel<boolean>({ required: true })
const props = defineProps<{
  token: string
  contact: { prenom: string; nom: string; email: string; entreprise: string | null; telephone: string | null }
  titre: string
  /** Adresse de repli, affichée tant que le serveur n'a pas renvoyé la sienne. */
  adresseParDefaut: string
}>()

const CANAUX = [
  { value: 'email', label: 'Email' },
  { value: 'telephone', label: 'Appel téléphonique' },
  { value: 'whatsapp', label: 'WhatsApp' },
] as const

const messageInitial = `Bonjour,\n\nJ’ai réalisé le diagnostic Radar by FeexPay (${props.titre}) et je souhaite échanger sur ce que ces résultats impliquent pour mon activité.\n\n${props.contact.prenom} ${props.contact.nom}`

const message = ref(messageInitial)
const telephone = ref(props.contact.telephone ?? '')
const canal = ref<(typeof CANAUX)[number]['value']>('email')
const envoi = ref(false)
const envoye = ref(false)
const erreur = ref<string | null>(null)
const adresse = ref(props.adresseParDefaut)

/** Même règle qu'en P10 : indicatif obligatoire, 7 à 15 chiffres. */
const TELEPHONE = /^\+[1-9][0-9]{6,14}$/
const telephoneValide = computed(() => !telephone.value.trim() || TELEPHONE.test(telephone.value.trim()))
const messageValide = computed(() => message.value.trim().length >= 10)
// Le champ part prérempli et valide : l'erreur n'apparaît qu'une fois le texte effacé.
const messageTropCourt = computed(() => !messageValide.value)
// Sans numéro, un rappel ou un message WhatsApp n'a pas de destination.
const telephoneRequis = computed(() => canal.value !== 'email')
const telephoneManquant = computed(() => telephoneRequis.value && !telephone.value.trim())
const peutEnvoyer = computed(() => messageValide.value && telephoneValide.value && !telephoneManquant.value)

// Réouverture après un envoi : le formulaire repart propre plutôt que sur l'écran de
// confirmation de la demande précédente.
watch(ouvert, (o) => {
  if (!o) return
  erreur.value = null
  if (!envoye.value) return
  envoye.value = false
  message.value = messageInitial
  canal.value = 'email'
})

async function envoyer() {
  if (envoi.value || !peutEnvoyer.value) return
  envoi.value = true
  erreur.value = null
  try {
    const r = await $fetch<{ envoye: boolean; destinataire: string }>(`/api/public/reports/${props.token}/contact`, {
      method: 'POST',
      body: { message: message.value.trim(), telephone: telephone.value.trim(), canal: canal.value },
    })
    adresse.value = r.destinataire
    envoye.value = true
  } catch (e) {
    const err = e as { data?: { data?: { message?: string } } }
    erreur.value = err?.data?.data?.message ?? 'Envoi impossible pour le moment. Réessayez dans un instant.'
  } finally {
    envoi.value = false
  }
}
</script>

<template>
  <UiModale
    v-model="ouvert"
    titre="Envie d’en discuter ?"
    :sous-titre="envoye ? undefined : 'Un conseiller FeexPay vous répond sous deux jours ouvrés.'"
  >
    <div v-if="envoye">
      <div class="py-2 text-center">
        <span class="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-600"><UiIcon name="email-check-outline" :size="28" /></span>
        <p class="mb-2.5 text-xl leading-[1.3] font-semibold text-navy-600">Votre demande est partie</p>
        <p class="mx-auto max-w-[440px] text-[15px] leading-[1.6] text-gray-600">
          Un conseiller la reçoit avec vos résultats sous les yeux et vous répond
          {{ canal === 'email' ? `à ${contact.email}` : canal === 'whatsapp' ? `sur WhatsApp au ${telephone}` : `au ${telephone}` }}.
        </p>
      </div>
    </div>

    <div v-else>
      <div class="mb-5 rounded-xl bg-gray-50 p-4">
        <p class="eyebrow mb-1.5 tracking-[0.06em] text-gray-500">Vous écrivez en tant que</p>
        <p class="text-[15px] leading-[1.4] font-semibold text-navy-600">{{ contact.prenom }} {{ contact.nom }}<template v-if="contact.entreprise"> · {{ contact.entreprise }}</template></p>
        <p class="mt-0.5 text-[13px] leading-[1.4] text-gray-500">{{ contact.email }}</p>
      </div>

      <form novalidate @submit.prevent="envoyer">
        <label for="contact-message" class="mb-2 block text-sm leading-[1.3] font-semibold text-navy-600">Votre message <span class="text-orange-600">*</span></label>
        <textarea
          id="contact-message"
          v-model="message"
          rows="6"
          maxlength="1500"
          class="field py-3 text-[15px] leading-[1.6]"
          style="height: auto"
          :class="{ 'field-error': messageTropCourt }"
        />
        <p v-if="messageTropCourt" class="mt-1.5 text-[13px] leading-[1.4] text-red-600" role="alert">Écrivez quelques mots sur ce dont vous voulez parler.</p>
        <p v-else class="mt-1.5 text-[13px] leading-[1.4] text-gray-500">Texte prérempli, modifiable. Il ne cite aucun produit.</p>

        <div class="mt-5 grid gap-5 md:grid-cols-2">
          <div>
            <label for="contact-telephone" class="mb-2 block text-sm leading-[1.3] font-semibold text-navy-600">
              Téléphone <span v-if="telephoneRequis" class="text-orange-600">*</span><span v-else class="font-normal text-gray-500">(facultatif)</span>
            </label>
            <input
              id="contact-telephone"
              v-model="telephone"
              type="tel"
              autocomplete="tel"
              placeholder="+2250700000000"
              class="field"
              :class="{ 'field-error': !telephoneValide }"
            >
            <p v-if="!telephoneValide" class="mt-1.5 text-[13px] leading-[1.4] text-red-600" role="alert">Numéro attendu au format international, ex. +2250700000000</p>
            <p v-else-if="telephoneManquant" class="mt-1.5 text-[13px] leading-[1.4] text-red-600" role="alert">Indiquez un numéro pour être joint par ce canal.</p>
          </div>
          <fieldset>
            <legend class="mb-2 block text-sm leading-[1.3] font-semibold text-navy-600">Vous joindre par</legend>
            <div class="flex flex-wrap gap-2">
              <label
                v-for="c in CANAUX"
                :key="c.value"
                class="cursor-pointer rounded-full border-[1.5px] px-3.5 py-[11px] text-sm leading-none"
                :class="canal === c.value ? 'border-orange-600 bg-orange-50 font-medium text-navy-600' : 'border-gray-300 text-gray-600 hover:border-navy-300'"
              >
                <input v-model="canal" type="radio" name="canal" :value="c.value" class="sr-only" >
                {{ c.label }}
              </label>
            </div>
          </fieldset>
        </div>

        <p v-if="erreur" class="mt-5 flex gap-3 rounded-[10px] bg-red-100 px-4 py-3.5 text-sm leading-[1.5] text-gray-700" role="alert">
          <UiIcon name="alert-circle-outline" :size="20" class="shrink-0 text-red-600" />
          <span><span class="block font-semibold text-red-600">Envoi impossible</span>{{ erreur }} Vous pouvez aussi écrire à <a :href="`mailto:${adresse}`" class="text-orange-600 underline-offset-2 hover:underline">{{ adresse }}</a>.</span>
        </p>
      </form>
    </div>

    <template #pied>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p v-if="!envoye" class="text-[13px] leading-[1.4] text-gray-500">Ou écrivez-nous à <a :href="`mailto:${adresse}`" class="text-orange-600 underline-offset-2 hover:underline">{{ adresse }}</a></p>
        <span v-else />
        <div class="flex gap-2.5">
          <button v-if="!envoye" type="button" class="btn btn-ghost h-11 px-4 text-sm" @click="ouvert = false">Annuler</button>
          <button v-if="!envoye" type="button" :disabled="envoi || !peutEnvoyer" class="btn btn-primary h-11 rounded-[10px] px-6 text-sm" @click="envoyer">{{ envoi ? 'Envoi…' : 'Envoyer ma demande' }}</button>
          <button v-else type="button" class="btn btn-primary h-11 rounded-[10px] px-6 text-sm" @click="ouvert = false">Revenir au rapport</button>
        </div>
      </div>
    </template>
  </UiModale>
</template>
