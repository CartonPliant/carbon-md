# The carbon.md file

Spec **v0.1 (draft)**. The file lives at your repository root. It is Markdown with a YAML front-matter policy block — readable by humans, parseable by tools, and ingestible by the agents it governs.

## Minimal example

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

Everything below the front matter is free-form Markdown for humans (and for agents reading the repo). Everything inside it is the machine contract.

## Field reference

### `carbon_md`

Spec version string. Currently `"0.1"`. Tools refuse files whose major version they don't understand rather than guessing.

### `policy.contribution_target`

Number. The fraction of estimated emissions to match. `1.0` matches 100%; `1.10` matches 110%.

The generated copy never calls this "neutral" or "positive" — it is a contribution ratio. See [Claims & compliance](/guides/claims/).

### `policy.portfolio`

Which credits to buy.

| Value | Meaning | Planning price (USD/tCO₂e) |
|---|---|---|
| `removal-only` | avoidance is **refused outright** — `contribute` hard-stops before quoting | 12 – 130 – 1400 |
| `removal-weighted` | **default** — removal preferred; avoidance warns but proceeds | 20 – 130 – 1400 |
| `balanced` | any verified credit | 8 – 30 – 200 |
| `custom` | you choose the projects; no price assumption | — |

A typo here silently downgrades what your project claims, so an unknown value is rejected loudly rather than defaulted.

**These are planning figures, not quotes** (`carbonmd-prices-2026-07`). The spread on removal is genuinely enormous, so a narrow range would be a lie in both directions. Anchors observed live on the Klima rail in July 2026:

| Class | Observed | Note |
|---|---|---|
| nature-based removal (forest) | ~$17/t | |
| durable removal — biochar | ~$127/t | whole tonnes only |
| durable removal — ocean alkalinity | ~$1,308/t | cheapest durable removal buyable *fractionally* today |

`removal-weighted` centres on durable biochar because that is what the name promises; the high end is OAE, which is what a small agent footprint actually ends up buying, since sub-tonne durable removal has no cheaper option yet. `contribute --execute` never uses these numbers — it prices against a live quote and refuses to spend past your caps.

### How removal is enforced, not just declared

A `removal-weighted` policy is only meaningful if the ledger can tell a removed tonne from an avoided one. Every contribution therefore records a **method** — `removal`, `avoidance`, `mixed`, or `unspecified` — classified from what the rail says it is selling. Rows written before this field existed report `unspecified` and are **never silently counted as removal**.

Under `removal-only`, only removal discharges the target: a mixed or unspecified tonne cannot settle a removal obligation, however real the purchase was. Those tonnes stay in the ledger and on the public page — they simply don't pay that debt. See [Retirements & receipts](/guides/retirements/).

### `policy.monthly_budget_max`

`{ amount, currency }`. A hard ceiling on contributions per calendar month (UTC). The CLI refuses an order that would push month-to-date spending past it.

### `policy.approval_above`

`{ amount, currency }`. The human-in-the-loop threshold. Orders costing more than this require explicit confirmation; below it, an agent with a funded wallet may settle autonomously.

> **Two caps, on purpose.** `monthly_budget_max` is a *policy* cap the tooling enforces. The prepaid wallet balance is a *physical* cap nothing can exceed. See [Retirements & receipts](/guides/retirements/).

### `reporting.mode`

`local` (default) or `hosted`. Local means the ledger never leaves your machine; `export` still produces a publishable static site.

### `reporting.public_ledger`

Boolean. Whether you intend to publish. `export` warns if you publish while this is `false`.

### `methodology`

The pinned factor-table version, e.g. `carbonmd-factors-2026-08`. Estimates are only comparable within a methodology version. See [Methodology & factors](/methodology/).

## Optional fields

### `organization_id`

An opaque organization identifier (WorkOS-compatible) used to roll several agents' ledgers up to one org. Enterprise/CSRD rollup builds on this. Currently accepted and carried through; hosted rollup is [planned](/roadmap/).

## Design rules

The spec is deliberately small. When considering an addition, we ask:

- **Agent-readable?** Agents already ingest repo Markdown; the file must stay parseable without a schema fetch.
- **Human-auditable?** Someone must be able to read the file and know exactly what their agents may do.
- **Honest by construction?** No field should make it easy to state something unprovable.
- **Local-first?** Nothing may require an account to function.

## The ledger

Alongside the policy file, `.carbon-md/` holds the append-only ledger at `.carbon-md/ledger.jsonl` — one JSON object per line, two event types:

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

Append-only and plain text on purpose: it is inspectable with `cat`, diffable in git if you choose to commit it, and impossible to silently rewrite through the tool.

## Related

- [Usage report format](/usage-report/) — how to push usage in from any agent.
- [CLI reference](/cli/) — the commands that read and write this file.
