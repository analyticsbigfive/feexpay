import { answersFromLetters, CAS_CONTROLE, crossReading, CURRENT_VERSION, scoreDirigeant, scoreRayonnement, toPublicDirigeant, toPublicRayonnement } from '@radar/scoring'
import type { RapportPublic } from './report'
import type { CleModele } from './modeles-email'

/**
 * Rapport fictif servant d'aperçu aux modèles d'email : le cas de contrôle principal du moteur,
 * sous la forme qui correspond au modèle demandé. Aucune donnée réelle n'y figure.
 */
export function rapportDeControle(modele: CleModele): RapportPublic {
  const cas = CAS_CONTROLE[0]
  const answersDir = answersFromLetters('dirigeant', cas.dir)
  const answersRay = answersFromLetters('rayonnement', cas.ray)
  const rDir = scoreDirigeant(answersDir)
  const rRay = scoreRayonnement(answersRay)
  const cr = crossReading(rDir, rRay)
  return {
    id: 'apercu',
    status: 'ready',
    etabliLe: new Date().toISOString(),
    version: CURRENT_VERSION,
    contact: { prenom: 'Aya', nom: 'Konan', email: 'aya.konan@exemple.ci', entreprise: 'Atelier Nyamien', telephone: '+2250700000000' },
    dirigeant: modele === 'rayonnement' ? null : toPublicDirigeant(rDir),
    rayonnement: modele === 'dirigeant' ? null : toPublicRayonnement(rRay, answersRay),
    croisement:
      modele === 'croise'
        ? { code: cr.code, pilotage: Math.round(cr.pilotage), rayonnement: Math.round(cr.rayonnement), ecart: Math.round(cr.ecart), qualificatif: cr.qualificatif, ecartLecture: cr.ecartLecture, ecartAction: cr.ecartAction, lecture: cr.lecture, interpretation: cr.interpretation, formulation: cr.formulation, prioriteMarketing: cr.prioriteMarketing }
        : null,
  }
}
