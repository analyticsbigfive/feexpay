# Manuel de l'administration — Radar by FeexPay

À l'usage des équipes FeexPay. Livrable H.2, PLAN.md §9 étape 18. Version du
10 septembre 2026.

Adresse : `https://radar.feexpay.me/admin`. L'accès se fait sur invitation, avec une adresse
`@feexpay.me` ou `@bigfiveabidjan.com`. Aucune inscription libre.

---

## 1. Premier accès

Vous recevez un email d'invitation valable sept jours, avec un lien à usage unique.

1. Ouvrez le lien, vérifiez votre prénom et votre nom.
2. Choisissez un mot de passe d'**au moins 12 caractères**. Il est refusé s'il figure dans
   les bases de mots de passe ayant fuité — votre mot de passe n'est jamais transmis pour ce
   contrôle, seul un fragment de son empreinte l'est.
3. Si votre rôle l'exige (Analyste, Administrateur), enrôlez votre second facteur : scannez
   le QR code avec votre application d'authentification, saisissez le code à six chiffres.
4. **Notez vos dix codes de récupération.** Ils ne sont affichés qu'une seule fois. Chacun
   sert une fois, et débloque la perte de votre second facteur.

### Si vous perdez quelque chose

| Perdu | À faire |
|---|---|
| Mot de passe | « Mot de passe oublié ? » sur l'écran de connexion. Le lien reçu vaut une heure et ne sert qu'une fois. Votre second facteur reste en place. |
| Téléphone (second facteur) | Un code de récupération sur l'écran de vérification. Il retire le facteur : vous le ré-enrôlerez à la connexion suivante. |
| Les deux | Contactez un Administrateur : il vous réinvite. |

Après cinq tentatives de connexion échouées, le compte est verrouillé quinze minutes. L'écran affiche alors le même message qu'un mot de passe faux : c'est voulu, pour ne pas indiquer aux inconnus quelles adresses ont un compte.

---

## 2. Les quatre rôles

| | Lecture seule | Commercial | Analyste | Administrateur |
|---|:--:|:--:|:--:|:--:|
| Tableau de bord, listes, fiches | ✓ | ✓ | ✓ | ✓ |
| Statut de suivi, responsable, notes internes | | ✓ | ✓ | ✓ |
| Renvoyer un rapport, relancer les échecs | | ✓ | ✓ | ✓ |
| Leviers FeexPay (Réglages) | | | ✓ | ✓ |
| Versions du moteur : contrôles et publication | | | | ✓ |
| Comptes, invitations, réglages de tracking | | | | ✓ |
| Second facteur obligatoire | | | ✓ | ✓ |

L'export (CSV, PDF de fiche, JSON des réponses) dépend d'un réglage propre au compte,
indépendant du rôle : un Administrateur peut l'accorder ou le retirer compte par compte.

Le rôle est vérifié à chaque appel côté serveur. Un menu absent de votre interface n'est pas
seulement masqué : la route correspondante vous est refusée.

---

## 3. Les écrans

### A02 · Tableau de bord — `/admin`

Indicateurs sur une période glissante, comparés à la période précédente : participations
démarrées et terminées, taux de complétion, contacts obtenus, rapports envoyés. Répartition
des archétypes et des niveaux de rayonnement.

Un taux de complétion qui s'effondre sans raison apparente vient souvent de parcours
abandonnés jamais clôturés — voir `docs/RUNBOOK.md` §6.

### A03 · Prospects — `/admin/prospects`

Liste des contacts, filtres et pagination côté serveur. Chaque ligne mène à la fiche.
Export CSV si votre compte y est autorisé.

### A04 à A06 · Fiche prospect — `/admin/prospects/{id}`

Cinq onglets :

- **Synthèse** — identité, entreprise, résultats obtenus, difficultés déclarées.
- **Diagnostic commercial** — constats, gravité, forces et signaux, leviers FeexPay associés
  à chaque constat.
- **Participations** — chaque parcours, sa date, son statut, son résultat.
- **Rapports et emails** — ce qui a été envoyé, quand, et le statut de remise.
- **Historique** — suivi commercial et journal des actions.

Le suivi commercial — statut, responsable, notes internes — se modifie depuis la fiche à
partir du rôle Commercial. Les notes sont internes : elles ne sortent jamais vers le contact.

### A07 · Rapports et emails — `/admin/rapports`

Taux de remise, d'ouverture et de consultation en ligne, comparés à la période précédente.
Journal des envois filtrable par statut.

- **Renvoyer** — réémet le même rapport avec un nouveau lien. **L'ancien lien devient
  invalide.** Le contenu n'est pas recalculé : c'est le rapport d'origine.
- **Corriger et renvoyer** — modifie l'adresse du contact, puis renvoie.
- **Relancer les échecs** — reprend en une fois tous les envois en échec de la période.
- **Aperçu des modèles** — le rendu de l'email sur un cas de contrôle.

Les statuts « remis », « ouvert » et « rejeté » viennent du fournisseur d'envoi. S'ils
restent bloqués sur « accepté », le webhook n'est pas configuré : voir `docs/RUNBOOK.md` §5.

### Participations — `/admin/participations`

Toutes les participations, y compris celles sans contact (parcours non convertis). Le détail
montre les réponses données et le résultat calculé, avec la version du moteur employée.

### T01 · Versions du moteur — `/admin/versions`

Registre des versions du code et de la base. Une seule version est publiée à la fois ; une
version publiée est gelée et ne peut plus être modifiée.

Avant toute publication, lancez les **contrôles automatiques** proposés par l'écran : cas
normatifs, huit archétypes, règle de départage, condensat de la matrice. La publication est
refusée si un contrôle échoue.

Les résultats déjà calculés ne changent jamais : chaque résultat garde la version qui l'a
produit.

### Réglages — `/admin/reglages`

Identifiants de mesure d'audience et de publicité. `tracking_enabled` à `false` coupe toute
mesure, quel que soit le consentement des visiteurs.

Les valeurs secrètes — secret d'API GA4, jeton Meta CAPI, code d'événement de test — sont
masquées à l'affichage. Laisser un champ vide ne l'efface pas : il faut saisir une nouvelle
valeur pour la remplacer.

Le **code d'événement de test Meta** doit être vidé en production : il détourne les
événements vers l'outil de test.

L'**adresse du contact commercial** reçoit les demandes déposées depuis le bouton
« Contacter FeexPay » du rapport. Le dirigeant est mis en réponse : répondre depuis la boîte
lui écrit directement. La même demande apparaît sur sa fiche prospect, encadrée en orange,
et remet son suivi à « à contacter » — sauf s'il est déjà en cours, en rendez-vous ou
converti.

### Réglages → Leviers FeexPay — `/admin/reglages/leviers`

Les leviers proposés dans l'onglet Diagnostic commercial d'une fiche, rattachés à la
dimension des constats. Modifiables à partir du rôle Analyste.

### A09 · Comptes — `/admin/comptes`

Liste des comptes et de leurs réglages : rôle, équipe, second facteur imposé, périmètre
géographique, autorisation d'export. Suspension, réactivation, révocation.

Trois gardes s'appliquent :

- un Administrateur ne peut pas retirer son propre rôle ni se suspendre ;
- le dernier compte Administrateur actif ne peut être ni suspendu, ni révoqué, ni
  rétrogradé ;
- toute réduction de privilèges ferme immédiatement les sessions ouvertes du compte visé.

### A10 · Inviter — `/admin/comptes/nouveau`

Invitation de sept jours. Le lien est aussi affiché à l'écran (« Copier le lien ») : tant que
le domaine d'envoi n'est pas vérifié, l'email peut ne pas arriver, et le lien se transmet
alors par un autre canal.

Une nouvelle invitation pour une adresse déjà invitée annule la précédente.

---

## 4. Ce qui est journalisé

Chaque action sensible laisse une trace dans le journal d'audit : connexions réussies et
échouées, enrôlement et vérification du second facteur, usage d'un code de récupération,
réinitialisation de mot de passe, invitations, modifications de comptes, exports,
publications de version, renvois de rapport.

**Ce journal ne peut être ni modifié ni effacé**, y compris par un Administrateur : la base
le refuse. Il est consultable depuis l'onglet Historique d'une fiche pour ce qui la concerne.

---

## 5. Données personnelles

Les contacts ont un droit d'accès, de rectification, d'effacement, d'opposition et de
portabilité. Les demandes arrivent à `donnees@feexpay.me` et doivent recevoir une réponse
sous un mois.

Une demande d'effacement se traite aujourd'hui en base, par une intervention technique :
l'interface n'expose pas de suppression de contact. Passez par l'équipe technique et
consignez la demande.

Les durées de conservation annoncées dans la politique de confidentialité — 24 mois pour les
réponses, 36 mois après le dernier contact pour les fiches, 14 mois pour la mesure
d'audience, 5 ans pour la preuve de consentement, 12 mois pour les journaux — **ne sont pas
encore appliquées automatiquement**. Leur mise en œuvre reste à faire.
