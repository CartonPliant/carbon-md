# carbon-md contribute

Prepares — and, within policy, executes — the contribution that matches your footprint.

```bash
npx carbon-md contribute [options]
```

> **Retirements are irreversible.** Everything here is designed around that fact: confirm-first by default, hard caps from the policy file, and a prepaid wallet whose balance is the blast radius.

## Default behaviour (confirm-first)

Run without arguments and nothing is spent. `contribute` computes what you owe, prices it, and prints an order for you to approve:

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

| Flag | Meaning |
|---|---|
| `--execute` | Retire on the on-chain rail (Klima x402 on Base) from the agent wallet, after the policy checks and a typed confirmation |
| `--record` | Record a purchase you made elsewhere (fiat, Carbonmark, CNaught…) |
| `--tonnes <n>` | With `--record`: tonnes retired. With `--execute`: tonnes to retire (default: what is outstanding) |
| `--cost <n>` | With `--record`: amount paid |
| `--currency <c>` | With `--record`: defaults to USD |
| `--rail <name>` | With `--record`: where it was purchased |
| `--receipt <url>` | With `--record`: the public receipt/certificate URL |
| `--method <m>` | With `--record`: `removal` | `avoidance` | `mixed` — how the tonne is accounted |
| `--class <name>` | Credit class to buy on the rail (e.g. `biochar`, `oae`) |
| `--dry-run` | Price the order, change nothing |

## Removal is enforced, not assumed

Every contribution records **how the tonne is accounted for** — `removal`, `avoidance`, `mixed` or `unspecified` — classified from what the rail says it is selling. This is what makes a `removal-weighted` policy mean something.

Under `portfolio: removal-only`, an avoidance credit is refused **before a quote is even requested** — there is no price at which it becomes acceptable:

```
✖ POLICY STOP: Avoided Deforestation is avoidance; carbon.md declares portfolio: removal-only.
  Nothing quoted, nothing signed. Removal classes available on this rail:
    --class "Biochar" — 127.00 USDC/t
    --class "Ocean Alkalinity Enhancement" — 1308.00 USDC/t
```

Recording what actually happened is always allowed — hiding it is not. `--record --method avoidance` under a removal-only policy is accepted and filed, with a warning that it is reported separately and never counts as removal.

> **Older ledgers stay readable.** Rows written before the method field existed report `unspecified` and are never silently promoted to removal.

## Policy enforcement

Two independent gates, both must pass:

1. **`approval_above`** — an order costing more is flagged as needing human confirmation. Every `--execute` stops for a typed `retire` before it signs anything, so nothing is spent without a human in the loop.
2. **`monthly_budget_max`** — month-to-date (UTC calendar month) contributions plus this order must stay under the cap. A contribution row from this month (or with an unreadable timestamp) whose cost is missing, non-numeric or negative blocks spending until it is fixed — the cap is never checked against a spend that can't be added up.

A third, physical gate applies on the on-chain rail: the [wallet](/cli/wallet/) is prepaid, so an agent cannot spend more than was deposited — regardless of what any config says.

## On-chain execution

```bash
npx carbon-md contribute --execute --class biochar --tonnes 0.02
```

Requires a funded wallet. Flow: `quote → policy check → typed confirmation → sign one USDC transfer → retire → certificate URL + transaction hash → ledger`. The transaction hash is what makes the retirement an anchor [`verify`](/cli/verify/) can resolve on-chain. The rail is Klima's x402 endpoint on Base; the wallet needs **USDC only** (no ETH — gas is relayed). Details in [Retirements & receipts](/guides/retirements/).

## Recording a manual purchase

Buying with a card at Carbonmark or CNaught is perfectly valid — and is how most first retirements happen. Record it so the ledger and the public receipt stay truthful:

```bash
npx carbon-md contribute --record \
  --tonnes 0.05 --cost 12.50 --currency USD \
  --rail carbonmark \
  --receipt "https://www.carbonmark.com/retirements/…"
```

## After contributing

```bash
npx carbon-md status    # position now shows contributed tonnes
npx carbon-md export    # rebuild the public ledger + badge
```
