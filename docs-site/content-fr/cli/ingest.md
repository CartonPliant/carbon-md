# carbon-md ingest

Charge l'usage depuis un fichier ou stdin. Le chemin universel — si votre stack sait écrire du JSON, elle peut être comptabilisée.

```bash
npx carbon-md ingest <fichier>
npx carbon-md ingest -          # lire stdin
```

## Entrées acceptées

Le format est détecté automatiquement :

| Entrée | Détection |
|---|---|
| **JSONL usage-report** | un objet JSON par ligne, avec des champs de tokens |
| **Tableau JSON** | un tableau des mêmes objets |
| **JSON OTLP / OpenTelemetry** | aplatit `*.token.usage` et `gen_ai.client.token.usage` |

Les noms de champs et leurs alias sont documentés dans [Format usage-report](/fr/usage-report/).

## Exemples

```bash
# un journal d'usage écrit par votre agent
npx carbon-md ingest usage.jsonl

# un export OpenTelemetry — n'importe quel agent instrumenté OTel convient
npx carbon-md ingest otel-export.json

# directement depuis un pipeline
my-agent --emit-usage | npx carbon-md ingest -
```

## Horodatages

`ts` (ou `timestamp`, `startTime`) est normalisé en ISO 8601 UTC. Formats acceptés :

- une chaîne ISO 8601 — `"2026-08-01T09:12:00Z"`
- un epoch Unix, en nombre ou en chaîne numérique — sous `1e12` il est lu en **secondes**, au-delà en **millisecondes** (`1760000000` et `1760000000000` désignent le même instant)

Un enregistrement sans horodatage reçoit l'heure de l'ingestion. Un enregistrement dont l'horodatage est illisible est **ignoré**, pas daté de « maintenant » — ce qui déplacerait discrètement son usage dans le mauvais mois.

## Validation

Les compteurs de tokens doivent être des nombres finis et positifs ou nuls ; les chaînes numériques comme `"1200"` sont acceptées. Un enregistrement avec un compteur du type `"abc"`, `-5000` ou `Infinity` est **ignoré** et compté dans le total `skipped` — jamais écrit. Un NaN contaminerait tous les totaux en aval, et un compteur négatif annulerait en silence un usage réel. Les points de données OTLP passent les mêmes contrôles.

## Idempotence

Ré-ingérer est sans risque. Chaque ligne d'entrée déjà écrite dans le registre est mémorisée dans `.carbon-md/sources/ingest.json`, donc :

- ré-ingérer le même fichier — ou renvoyer les mêmes données sur stdin — n'ajoute rien ;
- ré-ingérer un journal qui a grossi n'ajoute que les nouvelles lignes ;
- deux lignes réellement identiques dans une même entrée comptent bien comme deux usages.

Une ligne est identifiée par son contenu et sa position parmi les lignes identiques, pas par le nom du fichier — un fichier renommé ou tourné n'est pas compté deux fois. Les lignes ignorées car invalides ne sont pas mémorisées ; elles réapparaissent comme ignorées au passage suivant.

## Sortie

```
✔ Ingested 412 records (3 skipped, 96 already ingested) → ~1.2 kg CO2e central estimate
  note: unrecognized model(s) mapped to class "medium": my-finetune-v2
```

Quand il n'y a rien de nouveau :

```
✔ Up to date — nothing new (511 already ingested, skipped).
```

## Dépannage

| Symptôme | Cause | Correctif |
|---|---|---|
| `No usable records found` | champs non reconnus | vérifiez les noms dans [usage-report](/fr/usage-report/) |
| Des enregistrements comptés en `skipped` | compteurs de tokens non numériques ou négatifs, ou `ts` illisible | corrigez le producteur ; voir [Validation](#validation) et [Horodatages](#horodatages) |
| Tout est en `medium (guessed)` | chaînes de modèles inconnues du classifieur | ce n'est pas grave — les fourchettes s'élargissent ; envisagez une PR sur la table de facteurs |
| Les chiffres semblent trop élevés | lectures de cache comptées comme entrée | envoyez-les en `cache_read_tokens` ; elles sont alors exclues |
| Des totaux qui semblent dupliqués | mêmes données ingérées par deux chemins | une seule source par flux (`sync` **ou** `ingest`) |
