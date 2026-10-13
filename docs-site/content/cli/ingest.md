# carbon-md ingest

Loads usage from a file or stdin. The universal path — if your stack can write JSON, it can be accounted for.

```bash
npx carbon-md ingest <file>
npx carbon-md ingest -          # read stdin
```

## Accepted inputs

Format is auto-detected:

| Input | Detection |
|---|---|
| **Usage-report JSONL** | one JSON object per line with token fields |
| **OTLP / OpenTelemetry JSON** | flattens `*.token.usage` and `gen_ai.client.token.usage` |

Field names and aliases are documented in [Usage report format](/usage-report/).

## Examples

```bash
# a usage log your agent writes
npx carbon-md ingest usage.jsonl

# an OpenTelemetry export — any OTel-instrumented agent works
npx carbon-md ingest otel-export.json

# straight from a pipeline
my-agent --emit-usage | npx carbon-md ingest -
```

## Timestamps

`ts` (or `timestamp`, `startTime`) is normalised to ISO 8601 UTC. Accepted:

- an ISO 8601 string: a date, optionally a time (`T` or a space, optional fraction), optionally `Z` or an offset (`+02:00`, `-0500`) — `"2026-08-01T09:12:00Z"`. A time **without a zone is read as UTC**, not in the machine's local time; a date alone is UTC midnight. Free-form dates such as `"Aug 1 2026"` are rejected.
- a Unix epoch, as a number or a numeric string — its unit follows its size: below `1e12` **seconds**, below `1e15` **milliseconds**, below `1e18` **microseconds**, above that **nanoseconds** (`1760000000`, `1760000000000` and `1760000000000000` are the same instant). A digits-only string such as `"2026"` is an epoch, not a year.

The instant must also be plausible: **before 2000-01-01 UTC or more than one day in the future is rejected**. Such values are unit mistakes (`0`, nanoseconds sent as seconds…) that would otherwise land in 1970 or year 57742. OTLP `timeUnixNano` is always nanoseconds and gets the same bound.

A record with no timestamp is stamped with the time of ingestion. A record whose timestamp is unparseable or implausible is **skipped**, not stamped with "now" — that would quietly move its usage into the wrong month.

## Validation

Token counts must be non-negative whole numbers up to `2^53 − 1` (JavaScript's safe-integer limit); integer strings such as `"1200"` are accepted. A record with a count like `"abc"`, `-5000`, `12.5`, `Infinity` or `1e308` is **skipped** and counted in the `skipped` total — never written. A NaN would poison every total downstream, a negative count would silently cancel real usage, and a fraction or an absurd value means the field holds something other than tokens. OTLP datapoints get the same checks.

## Idempotency

Re-ingesting timestamped records is safe. Every record already written to the ledger is remembered in `.carbon-md/sources/ingest.json`, so:

- re-ingesting the same file — or piping the same data into stdin again — adds nothing;
- re-ingesting a log that has grown adds only the new records;
- two genuinely identical lines in one input still count as two usages.

**Records without a `ts` are the exception.** They are stamped with the ingestion time and always ingested: the same `{model, tokens_in, tokens_out}` piped on two different days is two real usages, and dropping one would silently under-count. The run prints a note with their exact number. Add a `ts` to your records to make re-ingestion safe.

A record is a usage-report line, or one datapoint of an OTLP line — each is remembered on its own, so in an OTLP line mixing timed and untimed datapoints the timed ones are still counted once. A line is identified by its content and its position among identical lines, not by file name — a renamed or rotated file isn't counted twice. Records skipped as invalid are never remembered; they show up as skipped again on every run.

If `ingest.json` exists but can't be read or isn't a valid state, the run **fails without writing anything**: ignoring it would ingest everything again. Fix or restore the file — deleting it re-ingests (double-counts) everything already in the ledger. If the state directory isn't writable, the run also stops before touching the ledger.

Only one ingest runs at a time per project: a run holds `.carbon-md/sources/ingest.lock` while it works, and a second run started meanwhile **fails immediately without writing anything** — otherwise each would overwrite the other's state. If no ingest is running, the lock was left by a crashed run (it holds that run's pid): remove it and run again.

## Output

```
✔ Ingested 412 records (3 skipped, 96 already ingested) → ~1.2 kg CO2e central estimate
  note: unrecognized model(s) mapped to class "medium": my-finetune-v2
```

When there's nothing new:

```
✔ Up to date — nothing new (511 already ingested; 3 skipped).
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `No usable records found` | fields not recognised | check names against [usage-report](/usage-report/) |
| Records counted as `skipped` | non-integer or negative token counts, or a `ts` that is unparseable, before 2000 or more than a day in the future | fix the producer; see [Validation](#validation) and [Timestamps](#timestamps) |
| Everything is `medium (guessed)` | model strings unknown to the classifier | fine — ranges widen; consider a PR to the factor table |
| Numbers look too high | cache reads counted as input | send them as `cache_read_tokens`; they're then excluded |
| `Another ingest is running, or a stale lock` | a second ingest started while one was running, or a crashed run left its lock | wait for the other run; if none is running, remove `.carbon-md/sources/ingest.lock` |
| Duplicate-looking totals | ingesting the same data through two paths | use one source per stream (`sync` **or** `ingest`) |
