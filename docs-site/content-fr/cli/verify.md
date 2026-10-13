# carbon-md verify

Vérifie un Passeport Carbone — signature, fourchettes et ancres on-chain — et annonce le niveau de confiance qu'il peut **réellement prouver**.

```bash
npx carbon-md verify <passport.json | https://…/passport.json> [--offline] [--min L0|L1|L2|L3] [--json]
```

## Sortie

```
carbon.md passport — ✔ VERIFIED L2
  subject     hermes did:key:z6Mko2Bjf9Tn…
  signature   valid
  methodology carbonmd-factors-2026-08
  emissions   285 gCO2e (93 – 930)
  contribution 0.005 / 0.000314 tCO2e credited · target met
  anchors     1 (resolved)
  certification none
```

Un document falsifié est démasqué immédiatement :

```
carbon.md passport — ✖ INVALID L0
  signature   signature does not match the document
  ⚠ document claims L3; evidence supports L0
  · signature invalid — nothing below can be trusted
```

## L'échelle de confiance

Le niveau est **re-dérivé à partir des preuves**, jamais lu dans le document :

| Niveau | Exige |
|---|---|
| **L0** Déclaré | un passeport existe (ou la signature a échoué) |
| **L1** Mesuré | signature valide · usage réel · low ≤ central ≤ high · méthodologie épinglée |
| **L2** Contribution vérifiée | L1 + ancres résolues on-chain + cible atteinte + chaque ancre comptée est bien du *removal* (sous une politique removal) |
| **L3** Certifié | L2 + une entrée active au [registre de certification signé](/fr/certification/). Le seul niveau que vous ne pouvez pas vous délivrer vous-même |

**Le removal est vérifié, pas cru sur parole.** Sous `removal-only` ou `removal-weighted`, une ancre dont la méthode est `avoidance` — ou simplement `unspecified` — ne compte pas pour le L2. C'est tout l'objet : transformer la politique en une propriété qu'un inconnu peut contrôler.

## Options

| Option | Signification |
|---|---|
| `--offline` | Ignore la consultation de la chaîne. Signature, fourchettes, fraîcheur et politique sont toujours vérifiées ; les ancres sont déclarées non vérifiées, donc le résultat plafonne à L1 |
| `--min <niveau>` | Sortie non nulle si le niveau dérivé n'atteint pas celui-ci (défaut `L1`) |
| `--json` | Résultat exploitable par une machine |
| `--registry <url>` | Contrôler la certification avec un autre registre — pour tests uniquement |
| `--registry-issuer <did>` | Faire confiance à un autre émetteur — pour tests uniquement |

Ces deux dernières existent pour les registres auto-hébergés et de test. Si vous les utilisez, `verify` le signale dans sa sortie, car le résultat n'est alors plus une certification carbon.md.

## Codes de sortie

`0` si la signature est valide, le passeport frais, et le niveau dérivé atteint `--min` ; `1` sinon ; `2` en cas d'erreur d'usage ou de récupération. De quoi en faire une barrière d'intégration continue :

```bash
npx carbon-md verify https://votre-registre/passport.json --min L2
```

## Ce qui est vérifié

1. **Signature** — Ed25519 sur le document canonicalisé. La moindre modification, où que ce soit, la casse.
2. **Fraîcheur** — les passeports expirent après 90 jours ; un passeport périmé affiche `⚠ STALE`.
3. **Mesure** — usage présent, fourchette d'incertitude bien formée, version de méthodologie épinglée.
4. **Ancres** — chaque transaction est récupérée sur Base ; elle doit exister et ne pas avoir échoué. Plusieurs endpoints sont essayés ; une chaîne injoignable rapporte `anchors unconfirmed, not disproved`, jamais `not found on chain`. Une panne de transport ne doit pas se lire comme une accusation.
5. **Politique** — tonnes créditées ≥ cible, et la règle removal ci-dessus.
6. **Certification** — le sujet est recherché dans le registre signé ; seule une entrée active atteint le L3, et tout échec de lecture du registre plafonne le résultat à L2 au lieu d'accorder ou de refuser quoi que ce soit.

La clé publique est incluse dans le `did:key` du sujet : les étapes 1 à 3 fonctionnent donc **sans aucun réseau**. `--offline` vérifie donc toujours un passeport ; il ne peut simplement pas confirmer les ancres ni la certification.

**Le signataire doit être le sujet.** Un passeport v0.1 est auto-émis : la clé de `proof.verification_method` doit être le même `did:key` que `subject.id` et `issuer`, écrit sous la forme de ce `did:key` suivi de `#` et de sa propre clé multibase (`did:key:z6Mk…#z6Mk…`). Sinon la signature est déclarée invalide — `signed by did:key:A but subject is did:key:B` — quelle que soit la solidité de la cryptographie, car la certification est recherchée par sujet et personne ne peut signer au nom d'un autre.

## Voir aussi

- [passport](/fr/cli/passport/) — en émettre un
- [Retraits et reçus](/fr/guides/retirements/) — d'où viennent les ancres
