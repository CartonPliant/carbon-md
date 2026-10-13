# Le fichier carbon.md

Spécification **v0.1 (brouillon)**. Le fichier se place à la racine de votre dépôt. C'est du Markdown avec un bloc de politique en front-matter YAML — lisible par des humains, analysable par des outils, et ingérable par les agents qu'il gouverne.

## Exemple minimal

```markdown
---
carbon_md: "0.1"
policy:
  contribution_target: 1.10
  portfolio: removal-weighted
  monthly_budget_max: { amount: 25, currency: USD }
  approval_above: { amount: 10, currency: USD }
reporting:
  mode: local
  public_ledger: true
methodology: carbonmd-factors-2026-08
---

# Carbon Policy — my-project

This project's agents measure their inference emissions and fund
verified carbon removal per the policy above. Ledger: <link>
```

Tout ce qui suit le front matter est du Markdown libre, destiné aux humains (et aux agents qui lisent le dépôt). Tout ce qui s'y trouve à l'intérieur est le contrat machine.

## Référence des champs

### `carbon_md`

Chaîne de version de la spécification. Actuellement `"0.1"`. Les outils refusent les fichiers dont ils ne comprennent pas la version majeure, plutôt que de deviner.

### `policy.contribution_target`

Nombre. La fraction des émissions estimées à laquelle la contribution correspond. `1.0` = 100 % ; `1.10` = 110 %.

Le texte généré n'appelle jamais cela « neutre » ni « positif » — c'est un ratio de contribution. Voir [Claims & conformité](/fr/guides/claims/).

### `policy.portfolio`

Quels crédits acheter.

| Valeur | Signification | Prix de planification (USD/tCO₂e) |
|---|---|---|
| `removal-only` | l'évitement est **refusé net** — `contribute` s'arrête avant même de demander un devis | 12 – 130 – 1400 |
| `removal-weighted` | **défaut** — removal privilégié ; l'évitement déclenche un avertissement mais passe | 20 – 130 – 1400 |
| `balanced` | n'importe quel crédit vérifié | 8 – 30 – 200 |
| `custom` | vous choisissez les projets ; aucune hypothèse de prix | — |

Une faute de frappe ici dégraderait en silence ce que votre projet revendique : une valeur inconnue est donc rejetée bruyamment plutôt que remplacée par un défaut.

**Ce sont des chiffres de planification, pas des devis** (`carbonmd-prices-2026-07`). L'écart sur le removal est réellement énorme ; une fourchette étroite serait un mensonge dans les deux sens. Points de repère observés en direct sur le rail Klima en juillet 2026 :

| Classe | Observé | Note |
|---|---|---|
| removal fondé sur la nature (forêt) | ~17 $/t | |
| removal durable — biochar | ~127 $/t | tonnes entières uniquement |
| removal durable — alcalinité océanique | ~1 308 $/t | le removal durable le moins cher achetable *fractionnellement* aujourd'hui |

`removal-weighted` se centre sur le biochar durable, car c'est ce que le nom promet ; le haut de fourchette est l'OAE, c'est-à-dire ce qu'une petite empreinte d'agent finit réellement par acheter, faute d'option moins chère pour du removal durable sous la tonne. `contribute --execute` n'utilise jamais ces chiffres — il se base sur un devis en direct et refuse de dépasser vos plafonds.

### Comment le removal est imposé, et pas seulement déclaré

Une politique `removal-weighted` n'a de sens que si le registre sait distinguer une tonne retirée d'une tonne évitée. Chaque contribution enregistre donc une **méthode** — `removal`, `avoidance`, `mixed` ou `unspecified` — classée d'après ce que le rail déclare vendre. Les lignes écrites avant l'existence de ce champ sont déclarées `unspecified` et ne sont **jamais silencieusement comptées comme du removal**.

Sous `removal-only`, seul le removal acquitte la cible : une tonne mixte ou non spécifiée ne peut pas solder une obligation de removal, aussi réel qu'ait été l'achat. Ces tonnes restent dans le registre et sur la page publique — elles ne paient simplement pas cette dette. Voir [Retirements & reçus](/fr/guides/retirements/).

### `policy.monthly_budget_max`

`{ amount, currency }`. Un plafond strict sur les contributions par mois calendaire (UTC). La CLI refuse un ordre qui ferait dépasser ce plafond au cumul du mois.

### `policy.approval_above`

`{ amount, currency }`. Le seuil de l'humain dans la boucle. Les ordres plus coûteux exigent une confirmation explicite ; en dessous, un agent doté d'un wallet approvisionné peut régler de façon autonome.

> **Deux plafonds, volontairement.** `monthly_budget_max` est un plafond *de politique*, appliqué par l'outillage. Le solde du wallet prépayé est un plafond *physique* que rien ne peut dépasser. Voir [Retirements & reçus](/fr/guides/retirements/).

### `reporting.mode`

`local` (défaut) ou `hosted`. Local signifie que le registre ne quitte jamais votre machine ; `export` produit malgré tout un site statique publiable.

### `reporting.public_ledger`

Booléen. Indique si vous avez l'intention de publier. `export` vous avertit si vous publiez alors que ce champ vaut `false`.

### `methodology`

La version épinglée de la table de facteurs, par ex. `carbonmd-factors-2026-08`. Les estimations ne sont comparables qu'au sein d'une même version de méthodologie. Voir [Méthodologie & facteurs](/fr/methodology/).

## Champs optionnels

### `organization_id`

Un identifiant d'organisation opaque (compatible WorkOS) permettant de consolider les registres de plusieurs agents au niveau d'une organisation. La consolidation entreprise/CSRD s'appuiera dessus. Actuellement accepté et transmis ; la consolidation hébergée est [prévue](/fr/roadmap/).

## Règles de conception

La spécification est délibérément petite. Face à un ajout envisagé, nous demandons :

- **Lisible par un agent ?** Les agents ingèrent déjà le Markdown des dépôts ; le fichier doit rester analysable sans aller chercher un schéma.
- **Auditable par un humain ?** Quelqu'un doit pouvoir lire le fichier et savoir exactement ce que ses agents ont le droit de faire.
- **Honnête par construction ?** Aucun champ ne doit rendre facile l'affirmation de quelque chose d'invérifiable.
- **Local d'abord ?** Rien ne doit exiger un compte pour fonctionner.

## Le registre

À côté du fichier de politique, `.carbon-md/` contient le registre en append-only à `.carbon-md/ledger.jsonl` — un objet JSON par ligne, deux types d'événements :

```jsonc
// usage
{ "type":"usage", "ts":"2026-08-01T09:12:00Z", "source":"claude-code",
  "provider":"anthropic", "model":"claude-sonnet-4", "tokens_in":18400,
  "tokens_out":2100, "gco2e":{"low":1.2,"central":3.6,"high":12.1},
  "model_class":"large", "factors":"carbonmd-factors-2026-08",
  "meta":{"cache_read_tokens":91000} }

// contribution
{ "type":"contribution", "ts":"2026-08-01T10:00:00Z", "tonnes":0.005,
  "cost":1.10, "currency":"USD", "rail":"x402:klima",
  "receipt":"https://…/certificate" }
```

Append-only et en texte brut, délibérément : il s'inspecte avec `cat`, se compare dans git si vous choisissez de le committer, et ne peut pas être réécrit en silence par l'outil.

## Voir aussi

- [Format usage-report](/fr/usage-report/) — comment y pousser l'usage depuis n'importe quel agent.
- [Référence CLI](/fr/cli/) — les commandes qui lisent et écrivent ce fichier.
