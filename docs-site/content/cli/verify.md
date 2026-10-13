# carbon-md verify

Checks a Carbon Passport — signature, ranges, and on-chain anchors — and reports the trust level **it can actually prove**.

```bash
npx carbon-md verify <passport.json | https://…/passport.json> [--offline] [--min L0|L1|L2|L3] [--json]
```

## Output

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

A tampered document is caught immediately:

```
carbon.md passport — ✖ INVALID L0
  signature   signature does not match the document
  ⚠ document claims L3; evidence supports L0
  · signature invalid — nothing below can be trusted
```

## The trust ladder

The level is **re-derived from evidence**, never read from the document:

| Level | Requires |
|---|---|
| **L0** Declared | a passport exists (or the signature failed) |
| **L1** Measured | valid signature · real usage · low ≤ central ≤ high · methodology pinned |
| **L2** Contribution-verified | L1 + anchors resolved on-chain + target met + every counted anchor is removal (under a removal policy) |
| **L3** Certified | L2 + an active entry in the [signed certification registry](/certification/). The only level you cannot issue yourself |

**Removal is checked, not taken on faith.** Under `removal-only` or `removal-weighted`, an anchor whose method is `avoidance` — or merely `unspecified` — does not count toward L2. That is the whole point: it turns the policy into a property a stranger can verify.

## Options

| Flag | Meaning |
|---|---|
| `--offline` | Skip the chain lookup. Signature, ranges, freshness and policy checks still run; anchors are reported as unverified, so the result caps at L1 |
| `--min <level>` | Exit non-zero unless the derived level reaches this (default `L1`) |
| `--json` | Machine-readable result |
| `--registry <url>` | Check certification against a different registry — testing only |
| `--registry-issuer <did>` | Trust a different issuer — testing only |

The last two exist for self-hosted and test registries. Use either and `verify` says so in its output, because the result is then no longer a carbon.md certification.

## Exit codes

`0` when the signature is valid, the passport is fresh, and the derived level meets `--min`; `1` otherwise; `2` on usage or fetch errors. That makes it usable as a CI gate:

```bash
npx carbon-md verify https://your-ledger/passport.json --min L2
```

## What is checked

1. **Signature** — Ed25519 over the canonicalized document. Any edit, anywhere, breaks it.
2. **Freshness** — passports expire after 90 days; a stale one reports `⚠ STALE`.
3. **Measurement** — usage present, uncertainty range well-formed, methodology version pinned.
4. **Anchors** — each transaction is fetched from Base and must exist and not have reverted. Several endpoints are tried; an unreachable chain reports `anchors unconfirmed, not disproved`, never `not found on chain`. A transport failure must not read as an accusation.
5. **Policy** — credited tonnes ≥ target, and the removal rule above.
6. **Certification** — the subject is looked up in the signed registry; only an active entry reaches L3, and any failure to read the registry caps the result at L2 rather than granting or denying anything.

The public key is embedded in the subject's `did:key`, so steps 1–3 work with **no network at all**. `--offline` therefore still verifies a passport; it simply cannot confirm anchors or certification.

**The signer must be the subject.** A v0.1 passport is self-issued: the key in `proof.verification_method` must be the same `did:key` as `subject.id` and `issuer`, written as that `did:key` followed by `#` and its own multibase key (`did:key:z6Mk…#z6Mk…`). Otherwise the signature is reported invalid — `signed by did:key:A but subject is did:key:B` — however sound the cryptography, because certification is looked up by subject and nobody may sign in someone else's name.

## Related

- [passport](/cli/passport/) — issue one
- [Retirements & receipts](/guides/retirements/) — where anchors come from
