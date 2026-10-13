# carbon-md status

Votre empreinte et votre position par rapport à la politique.

```bash
npx carbon-md status
```

## Sortie

```
carbon.md — my-project

  This month     412 g CO2e     (220 g – 780 g)     128 calls
  All time       1.51 kg CO2e   (810 g – 2.9 kg)    873,412 tokens

  By model
    claude-sonnet-4        980 g    large
    gpt-5.5                420 g    frontier
    kimi-k2.7-code         110 g    medium (guessed)

  Policy         110% contribution · removal-weighted
  Target         0.0017 tCO2e
  Contributed    0.0000 tCO2e
  Outstanding    0.0017 tCO2e   (~$0.10 at removal-weighted prices)

  Next: npx carbon-md contribute
```

## Comment le lire

- **Des fourchettes partout.** Le chiffre central est une estimation ponctuelle à l'intérieur d'une bande large et honnête. Voir [Méthodologie](/fr/methodology/).
- **`(guessed)`** signifie que la chaîne du modèle ne correspond à aucune classe connue — l'estimation compte quand même, avec une fourchette plus large.
- **Target** = émissions estimées depuis toujours × `contribution_target`.
- **Outstanding** = cible − déjà contribué. Le montant en dollars est une *hypothèse* tirée de la bande de prix de votre portefeuille, pas un devis.
- **Calls vs tokens** — les *calls* comptent les événements du registre ; les *tokens* sont entrée + sortie (lectures de cache exclues).

## Notes

- `status` est en lecture seule. Il n'écrit jamais dans le registre et ne contacte pas le réseau.
- S'il n'affiche rien, c'est qu'aucun usage n'a encore été capturé — voir [`sync`](/fr/cli/sync/) ou [`ingest`](/fr/cli/ingest/).
- Les chiffres mensuels suivent les mois calendaires en UTC, comme les horodatages du registre ; les contributions sont préparées mensuellement par défaut.
