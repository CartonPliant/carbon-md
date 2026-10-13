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

- une chaîne ISO 8601 : une date, éventuellement une heure (`T` ou une espace, fraction facultative), éventuellement `Z` ou un décalage (`+02:00`, `-0500`) — `"2026-08-01T09:12:00Z"`. Une heure **sans fuseau est lue en UTC**, pas dans l'heure locale de la machine ; une date seule vaut minuit UTC. Les dates en texte libre comme `"Aug 1 2026"` sont refusées.
- un epoch Unix, en nombre ou en chaîne numérique — son unité dépend de sa taille : sous `1e12` des **secondes**, sous `1e15` des **millisecondes**, sous `1e18` des **microsecondes**, au-delà des **nanosecondes** (`1760000000`, `1760000000000` et `1760000000000000` désignent le même instant). Une chaîne composée uniquement de chiffres comme `"2026"` est un epoch, pas une année.

L'instant doit aussi être plausible : **antérieur au 2000-01-01 UTC ou plus d'un jour dans le futur, il est refusé**. Ces valeurs sont des erreurs d'unité (`0`, des nanosecondes envoyées comme des secondes…) qui tomberaient sinon en 1970 ou en l'an 57742. Le `timeUnixNano` OTLP est toujours en nanosecondes et subit la même borne.

Un enregistrement sans horodatage reçoit l'heure de l'ingestion. Un enregistrement dont l'horodatage est illisible ou invraisemblable est **ignoré**, pas daté de « maintenant » — ce qui déplacerait discrètement son usage dans le mauvais mois.

## Validation

Les compteurs de tokens doivent être des entiers positifs ou nuls, jusqu'à `2^53 − 1` (la limite des entiers sûrs de JavaScript) ; les chaînes entières comme `"1200"` sont acceptées. Un enregistrement avec un compteur du type `"abc"`, `-5000`, `12.5`, `Infinity` ou `1e308` est **ignoré** et compté dans le total `skipped` — jamais écrit. Un NaN contaminerait tous les totaux en aval, un compteur négatif annulerait en silence un usage réel, et une fraction ou une valeur absurde signifie que le champ contient autre chose que des tokens. Les points de données OTLP passent les mêmes contrôles.

## Idempotence

Ré-ingérer des enregistrements horodatés est sans risque. Chaque enregistrement déjà écrit dans le registre est mémorisé dans `.carbon-md/sources/ingest.json`, donc :

- ré-ingérer le même fichier — ou renvoyer les mêmes données sur stdin — n'ajoute rien ;
- ré-ingérer un journal qui a grossi n'ajoute que les nouveaux enregistrements ;
- deux lignes réellement identiques dans une même entrée comptent bien comme deux usages.

**Exception : les enregistrements sans `ts`.** Ils sont horodatés à l'ingestion et toujours ingérés : le même `{model, tokens_in, tokens_out}` envoyé deux jours différents correspond à deux usages réels, et en écarter un sous-estimerait l'usage en silence. La commande indique leur nombre exact. Ajoutez un `ts` à vos enregistrements pour pouvoir ré-ingérer sans risque.

Un enregistrement est une ligne usage-report, ou un point de données d'une ligne OTLP — chacun est mémorisé séparément, donc dans une ligne OTLP qui mélange points horodatés et non horodatés, les points horodatés ne sont comptés qu'une fois. Une ligne est identifiée par son contenu et sa position parmi les lignes identiques, pas par le nom du fichier — un fichier renommé ou archivé par rotation n'est pas compté deux fois. Les enregistrements ignorés car invalides ne sont jamais mémorisés ; ils réapparaissent comme ignorés à chaque passage.

Si `ingest.json` existe mais est illisible ou n'est pas un état valide, la commande **échoue sans rien écrire** : l'ignorer ré-ingérerait tout. Corrigez ou restaurez le fichier — le supprimer ré-ingère (compte deux fois) tout ce qui est déjà dans le registre. Si le dossier d'état n'est pas accessible en écriture, la commande s'arrête aussi avant de toucher au registre.

Une seule ingestion tourne à la fois par projet : pendant son exécution, la commande détient `.carbon-md/sources/ingest.lock`, et une seconde ingestion lancée entre-temps **échoue immédiatement sans rien écrire** — sinon chacune écraserait l'état de l'autre. Si aucune ingestion n'est en cours, le verrou a été laissé par une exécution interrompue (il contient son pid) : supprimez-le et relancez.

## Sortie

```
✔ Ingested 412 records (3 skipped, 96 already ingested) → ~1.2 kg CO2e central estimate
  note: unrecognized model(s) mapped to class "medium": my-finetune-v2
```

Quand il n'y a rien de nouveau :

```
✔ Up to date — nothing new (511 already ingested; 3 skipped).
```

## Dépannage

| Symptôme | Cause | Correctif |
|---|---|---|
| `No usable records found` | champs non reconnus | vérifiez les noms dans [usage-report](/fr/usage-report/) |
| Des enregistrements comptés en `skipped` | compteurs de tokens non entiers ou négatifs, ou `ts` illisible, antérieur à 2000 ou plus d'un jour dans le futur | corrigez le producteur ; voir [Validation](#validation) et [Horodatages](#horodatages) |
| Tout est en `medium (guessed)` | chaînes de modèles inconnues du classifieur | ce n'est pas grave — les fourchettes s'élargissent ; envisagez une PR sur la table de facteurs |
| Les chiffres semblent trop élevés | lectures de cache comptées comme entrée | envoyez-les en `cache_read_tokens` ; elles sont alors exclues |
| `Another ingest is running, or a stale lock` | une seconde ingestion lancée pendant qu'une autre tournait, ou un verrou laissé par une exécution interrompue | attendez la fin de l'autre ; si aucune ne tourne, supprimez `.carbon-md/sources/ingest.lock` |
| Des totaux qui semblent dupliqués | mêmes données ingérées par deux chemins | une seule source par flux (`sync` **ou** `ingest`) |
