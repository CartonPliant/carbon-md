# carbon-md contribute

Prépare — et, dans les limites de la politique, exécute — la contribution correspondant à votre empreinte.

```bash
npx carbon-md contribute [options]
```

> **Les retraits sont irréversibles.** Tout ici est conçu autour de ce fait : confirmation d'abord par défaut, plafonds stricts issus du fichier de politique, et un wallet prépayé dont le solde constitue le rayon d'explosion.

## Comportement par défaut (confirmation d'abord)

Lancée sans argument, la commande ne dépense rien. `contribute` calcule ce que vous devez, en établit le prix, et affiche un ordre à approuver :

```
Contribution order — my-project

  Outstanding      0.0050 tCO2e   (110% of 4.5 kg estimated)
  Portfolio        removal-weighted
  Estimated cost   ~$1.10 USD

  Policy check     ✔ below approval_above ($10)
                   ✔ within monthly_budget_max ($25, $0 used)

  Execute:  npx carbon-md contribute --execute --class biochar
  Or record a manual purchase:
            npx carbon-md contribute --record --tonnes 0.005 --cost 1.10 \
              --rail carbonmark --receipt https://…
```

## Options

| Flag | Signification |
|---|---|
| `--execute` | Retirer via le rail on-chain (Klima x402 sur Base) depuis le wallet de l'agent, après les contrôles de politique et une confirmation tapée |
| `--record` | Enregistrer un achat effectué ailleurs (fiat, Carbonmark, CNaught…) |
| `--tonnes <n>` | Avec `--record` : tonnes retirées. Avec `--execute` : tonnes à retirer (par défaut : ce qui reste dû) |
| `--cost <n>` | Avec `--record` : montant payé |
| `--currency <c>` | Avec `--record` : USD par défaut |
| `--rail <nom>` | Avec `--record` : où l'achat a eu lieu |
| `--receipt <url>` | Avec `--record` : l'URL publique du reçu/certificat |
| `--method <m>` | Avec `--record` : `removal` | `avoidance` | `mixed` — comment la tonne est comptabilisée |
| `--class <nom>` | Classe de crédit à acheter sur le rail (par ex. `biochar`, `oae`) |
| `--dry-run` | Chiffrer l'ordre, ne rien changer |

## Le removal est imposé, pas supposé

Chaque contribution enregistre **comment la tonne est comptabilisée** — `removal`, `avoidance`, `mixed` ou `unspecified` — classée d'après ce que le rail déclare vendre. C'est ce qui donne un sens à une politique `removal-weighted`.

Sous `portfolio: removal-only`, un crédit d'évitement est refusé **avant même qu'un devis soit demandé** — aucun prix ne le rend acceptable :

```
✖ POLICY STOP: Avoided Deforestation is avoidance; carbon.md declares portfolio: removal-only.
  Nothing quoted, nothing signed. Removal classes available on this rail:
    --class "Biochar" — 127.00 USDC/t
    --class "Ocean Alkalinity Enhancement" — 1308.00 USDC/t
```

Enregistrer ce qui s'est réellement passé est toujours permis — le dissimuler ne l'est pas. `--record --method avoidance` sous une politique removal-only est accepté et consigné, avec un avertissement indiquant qu'il est déclaré séparément et ne compte jamais comme du removal.

> **Les anciens registres restent lisibles.** Les lignes écrites avant l'existence du champ `method` sont déclarées `unspecified` et ne sont jamais silencieusement promues en removal.

## Application de la politique

Deux garde-fous indépendants, tous deux obligatoires :

1. **`approval_above`** — un ordre plus coûteux est signalé comme nécessitant une confirmation humaine. Chaque `--execute` s'arrête sur un `retire` à taper avant de signer quoi que ce soit : rien n'est dépensé sans un humain dans la boucle.
2. **`monthly_budget_max`** — les contributions du mois en cours (mois calendaire UTC) plus cet ordre doivent rester sous le plafond. Une ligne de contribution du mois en cours (ou à l'horodatage illisible) dont le coût est absent, non numérique ou négatif bloque toute dépense jusqu'à ce qu'elle soit corrigée : le plafond n'est jamais vérifié contre une dépense impossible à additionner.

Un troisième garde-fou, physique celui-là, s'applique sur le rail on-chain : le [wallet](/fr/cli/wallet/) est prépayé, donc un agent ne peut pas dépenser plus que ce qui y a été déposé — quoi que dise n'importe quelle configuration.

## Exécution on-chain

```bash
npx carbon-md contribute --execute --class biochar --tonnes 0.02
```

Exige un wallet approvisionné. Déroulé : `devis → contrôle de politique → confirmation tapée → signature d'un unique transfert USDC → retrait → URL du certificat + hash de transaction → registre`. Le hash de transaction est ce qui fait du retrait une ancre que [`verify`](/fr/cli/verify/) peut résoudre on-chain. Le rail est l'endpoint x402 de Klima sur Base ; le wallet n'a besoin que d'**USDC** (pas d'ETH — le gas est relayé). Détails dans [Retirements & reçus](/fr/guides/retirements/).

## Enregistrer un achat manuel

Acheter par carte chez Carbonmark ou CNaught est parfaitement valable — et c'est ainsi que se déroulent la plupart des premiers retraits. Enregistrez-le pour que le registre et le reçu public restent véridiques :

```bash
npx carbon-md contribute --record \
  --tonnes 0.05 --cost 12.50 --currency USD \
  --rail carbonmark \
  --receipt "https://www.carbonmark.com/retirements/…"
```

## Après avoir contribué

```bash
npx carbon-md status    # la position affiche désormais les tonnes contribuées
npx carbon-md export    # reconstruire le registre public + le badge
```
