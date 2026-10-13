# Référence CLI

L'implémentation de référence, publiée sur npm sous le nom [`carbon-md`](https://www.npmjs.com/package/carbon-md). TypeScript/ESM, MIT.

```bash
npx carbon-md <commande> [options]
```

Aucune installation nécessaire — `npx` s'en charge. Pour épingler une version : `npx carbon-md@0.1.11 …`.

## Commandes

| Commande | Ce qu'elle fait |
|---|---|
| [`init`](/fr/cli/init/) | Détecte la stack, écrit `carbon.md` + `.carbon-md/` |
| [`sync`](/fr/cli/sync/) | Récupère l'usage depuis une source connue (Claude Code aujourd'hui) |
| [`ingest`](/fr/cli/ingest/) | Charge l'usage depuis JSONL / OTLP / stdin |
| [`status`](/fr/cli/status/) | Empreinte avec fourchettes + position de contribution |
| [`contribute`](/fr/cli/contribute/) | Prépare (ou exécute) l'ordre de contribution |
| [`wallet`](/fr/cli/wallet/) | Crée/inspecte le wallet prépayé de l'agent |
| [`export`](/fr/cli/export/) | Construit la page publique du registre, le badge et le JSON |
| [`verify`](/fr/cli/verify/) | Re-dérive le niveau de confiance d'un passeport à partir des preuves |
| [`registry`](/fr/cli/registry/) | Maintient le registre de certification signé (émetteurs) |
| [`factors`](/fr/cli/factors/) | Affiche la table de facteurs active |

## Comportement global

- **Local d'abord.** Chaque commande fonctionne hors ligne, sauf les rails de retrait et la consultation de solde. Jamais de compte.
- **Consciente de la politique.** Les commandes qui touchent à l'argent lisent `carbon.md` et refusent de dépasser `approval_above` ou `monthly_budget_max`.
- **Ingestion idempotente.** `sync` et `ingest` conservent un état par source dans `.carbon-md/sources/` — relancer ne compte jamais deux fois les enregistrements horodatés.
- **Codes de sortie.** `0` succès, `1` erreur d'usage ou de configuration. Les erreurs vont sur stderr ; sortie exploitable par machine là où c'est documenté.

## Session typique

```bash
npx carbon-md init                # une fois
npx carbon-md sync claude-code    # régulièrement (compatible cron)
npx carbon-md status              # quand vous voulez
npx carbon-md contribute          # tous les mois
npx carbon-md export              # publier la preuve
```

## Arborescence

```
votre-projet/
├── carbon.md                 # la politique (à committer)
└── .carbon-md/               # stockage local (gitignoré)
    ├── ledger.jsonl          # événements en append-only
    ├── sources/              # état de synchronisation par source
    │   └── claude-code.json
    └── agent-wallet.json     # créé uniquement par `wallet init` (mode 0600)
```

> **Ne committez jamais `.carbon-md/`.** `init` l'ajoute au `.gitignore`. Ce dossier peut contenir une clé privée de wallet.
