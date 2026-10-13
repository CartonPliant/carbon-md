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
| **JSON array** | an array of the same objects |
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

- an ISO 8601 string — `"2026-08-01T09:12:00Z"`
- a Unix epoch, as a number or a numeric string — below `1e12` it is read as **seconds**, otherwise as **milliseconds** (`1760000000` and `1760000000000` are the same instant)

A record with no timestamp is stamped with the time of ingestion. A record whose timestamp can't be parsed is **skipped**, not stamped with "now" — that would quietly move its usage into the wrong month.

## Validation

Token counts must be finite, non-negative numbers; numeric strings such as `"1200"` are accepted. A record with a count like `"abc"`, `-5000` or `Infinity` is **skipped** and counted in the `skipped` total — never written. A NaN would poison every total downstream, and a negative count would silently cancel real usage. OTLP datapoints get the same checks.

## Idempotency

Re-ingesting is safe. Every input line already written to the ledger is remembered in `.carbon-md/sources/ingest.json`, so:

- re-ingesting the same file — or piping the same data into stdin again — adds nothing;
- re-ingesting a log that has grown adds only the new lines;
- two genuinely identical lines in one input still count as two usages.

A line is identified by its content and its position among identical lines, not by file name — a renamed or rotated file isn't counted twice. Lines that were skipped as invalid are not remembered; they show up as skipped again on the next run.

## Output

```
✔ Ingested 412 records (3 skipped, 96 already ingested) → ~1.2 kg CO2e central estimate
  note: unrecognized model(s) mapped to class "medium": my-finetune-v2
```

When there's nothing new:

```
✔ Up to date — nothing new (511 already ingested, skipped).
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `No usable records found` | fields not recognised | check names against [usage-report](/usage-report/) |
| Records counted as `skipped` | non-numeric or negative token counts, or an unparseable `ts` | fix the producer; see [Validation](#validation) and [Timestamps](#timestamps) |
| Everything is `medium (guessed)` | model strings unknown to the classifier | fine — ranges widen; consider a PR to the factor table |
| Numbers look too high | cache reads counted as input | send them as `cache_read_tokens`; they're then excluded |
| Duplicate-looking totals | ingesting the same data through two paths | use one source per stream (`sync` **or** `ingest`) |
