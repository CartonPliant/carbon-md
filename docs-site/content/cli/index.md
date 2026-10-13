# CLI reference

The reference implementation, published on npm as [`carbon-md`](https://www.npmjs.com/package/carbon-md). TypeScript/ESM, MIT.

```bash
npx carbon-md <command> [options]
```

No install needed — `npx` fetches it. To pin a version: `npx carbon-md@0.1.11 …`.

## Commands

| Command | What it does |
|---|---|
| [`init`](/cli/init/) | Detect the stack, write `carbon.md` + `.carbon-md/` |
| [`sync`](/cli/sync/) | Pull usage from a known source (Claude Code today) |
| [`ingest`](/cli/ingest/) | Load usage from JSONL / OTLP / stdin |
| [`status`](/cli/status/) | Footprint with ranges + contribution position |
| [`contribute`](/cli/contribute/) | Prepare (or execute) the contribution order |
| [`wallet`](/cli/wallet/) | Create/inspect the prepaid agent wallet |
| [`export`](/cli/export/) | Build the public ledger page, badge, and JSON |
| [`verify`](/cli/verify/) | Re-derive a passport's trust level from evidence |
| [`registry`](/cli/registry/) | Maintain the signed certification registry (issuers) |
| [`factors`](/cli/factors/) | Show the active factor table |

## Global behaviour

- **Local-first.** Every command works offline except retirement rails and balance lookups. No account, ever.
- **Policy-aware.** Commands that touch money read `carbon.md` and refuse to exceed `approval_above` or `monthly_budget_max`.
- **Idempotent ingestion.** `sync` and `ingest` keep per-source state in `.carbon-md/sources/` — re-running never double-counts timestamped records.
- **Exit codes.** `0` success, `1` user/config error. Errors go to stderr; machine-readable output where documented.

## Typical session

```bash
npx carbon-md init                # once
npx carbon-md sync claude-code    # regularly (cron-friendly)
npx carbon-md status              # anytime
npx carbon-md contribute          # monthly
npx carbon-md export              # publish the proof
```

## File layout

```
your-project/
├── carbon.md                 # the policy (commit this)
└── .carbon-md/               # local store (gitignored)
    ├── ledger.jsonl          # append-only events
    ├── sources/              # per-source sync state
    │   └── claude-code.json
    └── agent-wallet.json     # created only by `wallet init` (mode 0600)
```

> **Never commit `.carbon-md/`.** `init` adds it to `.gitignore`. It can contain a wallet private key.
