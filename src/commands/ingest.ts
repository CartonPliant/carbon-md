import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { estimateGco2e, FACTORS_VERSION, formatG } from "../core/factors.js";
import { appendEvents, LEDGER_DIR, type UsageEvent } from "../core/ledger.js";
import { findPolicyPath } from "../core/policy.js";

/**
 * Ingest usage data. Two shapes are auto-detected per line:
 *
 * 1. carbon.md usage report (spec v0.1) — one JSON object per line:
 *      model        model | model_name
 *      input        tokens_in | input_tokens | prompt_tokens   (also under `usage`)
 *      output       tokens_out | output_tokens | completion_tokens (also under `usage`)
 *      timestamp    ts | timestamp | startTime (optional)
 *      provider     provider | custom_llm_provider (optional)
 *      cache reads  cache_read_tokens (optional — recorded, excluded from estimate)
 *
 * 2. OTLP/JSON metric lines (OpenTelemetry Collector file exporter).
 *    Any metric named *.token.usage (claude_code, gemini_cli, …) or the
 *    GenAI semconv `gen_ai.client.token.usage` is flattened. Token-type
 *    mapping: input/cacheCreation/tool → tokens_in; output/thought →
 *    tokens_out; cacheRead/cache → recorded but excluded (prompt-cache
 *    serving costs far less than a fresh forward pass — we under-claim
 *    rather than inflate). Use DELTA temporality; cumulative sums would
 *    double-count and trigger a warning.
 *
 * Validation: token counts must be finite, non-negative numbers (numeric
 * strings like "123" are accepted — OTLP/JSON encodes asInt as a string, and
 * report producers do the same). Timestamps must parse; see normalizeTs. A
 * record failing either check is skipped and counted, never written: a NaN
 * poisons every total downstream, a negative count silently cancels real
 * usage, and an Invalid Date drops the event out of every period view.
 *
 * Idempotence: like the sync adapters, ingest keeps state in
 * .carbon-md/sources/ingest.json — the keys of every input line already
 * written to the ledger — so re-ingesting a file (or the same stdin) adds
 * nothing, and re-ingesting a file that has grown adds only the new lines.
 * Records without a ts are the exception: they can't be told apart from new
 * usage, so they are always ingested (see the loop in cmdIngest).
 * See lineKeys for why the key is the raw line, not the produced event.
 */

interface Rec {
  model: string;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  ts?: string;
  provider?: string;
}

const TOKEN_METRIC = /(^|\.)token\.usage$/;
const IN_TYPES = new Set(["input", "cacheCreation", "cache_creation", "tool"]);
const OUT_TYPES = new Set(["output", "completion", "thought"]);
const CACHE_TYPES = new Set(["cacheRead", "cache_read", "cache"]);

function attrsOf(dp: any): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const a of dp.attributes ?? []) {
    const v = a.value ?? {};
    attrs[a.key] = v.stringValue ?? String(v.intValue ?? v.doubleValue ?? v.boolValue ?? "");
  }
  return attrs;
}

const NUMERIC = /^\s*\d+(\.\d+)?\s*$/;

/**
 * A token count as a finite, non-negative number. Absent → 0; anything else
 * (NaN, negative, Infinity, booleans, "abc") → null, so the caller skips the
 * whole record rather than guess at what the producer meant.
 */
function toCount(v: unknown): number | null {
  if (v === undefined || v === null) return 0;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v === "string" && NUMERIC.test(v)) return Number(v);
  return null;
}

/** Below this a numeric epoch is read as seconds, at or above as milliseconds.
 *  1e12 ms is September 2001 and 1e12 s is ~33,000 years out, so the two
 *  readings never collide for any plausible usage timestamp. */
const EPOCH_MS_THRESHOLD = 1e12;

/**
 * Normalize a record timestamp to ISO 8601 (UTC).
 *   - absent (undefined/null/"") → undefined: the caller stamps ingestion time
 *   - date string (ISO 8601)     → re-serialized as ISO 8601 UTC
 *   - number or numeric string   → Unix epoch: seconds if < 1e12, else ms
 *   - anything unparseable       → null: the caller skips the record
 * Skipping instead of stamping "now" matters: a bad ts silently moved to
 * today would land the usage in the wrong month of every report.
 */
export function normalizeTs(v: unknown): string | undefined | null {
  if (v === undefined || v === null || v === "") return undefined;
  let ms: number;
  if (typeof v === "number" || (typeof v === "string" && NUMERIC.test(v))) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    ms = n < EPOCH_MS_THRESHOLD ? n * 1000 : n;
  } else if (typeof v === "string") {
    ms = Date.parse(v);
  } else {
    return null;
  }
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** `invalid.n` counts datapoints dropped by validation (bad value or time). */
function flattenOtlp(obj: any, warnings: Set<string>, invalid: { n: number }): Rec[] {
  const recs: Rec[] = [];
  for (const rm of obj.resourceMetrics ?? []) {
    for (const sm of rm.scopeMetrics ?? []) {
      for (const metric of sm.metrics ?? []) {
        const name: string = metric.name ?? "";
        if (!TOKEN_METRIC.test(name) && name !== "gen_ai.client.token.usage") continue;
        const sum = metric.sum ?? metric.histogram;
        // OTLP AggregationTemporality: 1 = delta, 2 = cumulative
        if (metric.sum && Number(metric.sum.aggregationTemporality) === 2) {
          warnings.add(
            `metric ${name} uses CUMULATIVE temporality — values may double-count; configure delta temporality`
          );
        }
        for (const dp of sum?.dataPoints ?? []) {
          const attrs = attrsOf(dp);
          const model =
            attrs["model"] ?? attrs["gen_ai.response.model"] ?? attrs["gen_ai.request.model"];
          const type = attrs["type"] ?? attrs["gen_ai.token.type"];
          if (!model || !type) continue;
          const value = toCount(dp.asInt ?? dp.asDouble ?? dp.sum);
          if (value === null) {
            invalid.n++;
            continue;
          }
          if (!value) continue;
          // OTLP's unit is unambiguous (ns), so no seconds/ms heuristic here;
          // 0 is OTLP's "unset" and falls back to ingestion time.
          const ns = toCount(dp.timeUnixNano);
          const when = ns ? new Date(ns / 1e6) : undefined;
          if (ns === null || (when && Number.isNaN(when.getTime()))) {
            invalid.n++;
            continue;
          }
          const ts = when?.toISOString();
          const rec: Rec = { model, tokensIn: 0, tokensOut: 0, cacheRead: 0, ts };
          if (IN_TYPES.has(type)) rec.tokensIn = value;
          else if (OUT_TYPES.has(type)) rec.tokensOut = value;
          else if (CACHE_TYPES.has(type)) rec.cacheRead = value;
          else continue; // unknown token type — leave for a future spec rev
          recs.push(rec);
        }
      }
    }
  }
  return recs;
}

export function mapReport(obj: any): Rec | null {
  const usage = obj.usage ?? obj;
  const model: string | undefined = obj.model ?? obj.model_name;
  const tokensIn = toCount(usage.tokens_in ?? usage.input_tokens ?? usage.prompt_tokens);
  const tokensOut = toCount(
    usage.tokens_out ?? usage.output_tokens ?? usage.completion_tokens
  );
  const cacheRead = toCount(usage.cache_read_tokens);
  if (tokensIn === null || tokensOut === null || cacheRead === null) return null;
  if (!model || (!tokensIn && !tokensOut && !cacheRead)) return null;
  const ts = normalizeTs(obj.ts ?? obj.timestamp ?? obj.startTime);
  if (ts === null) return null;
  return {
    model,
    tokensIn,
    tokensOut,
    cacheRead,
    ts,
    provider: obj.provider ?? obj.custom_llm_provider,
  };
}

/**
 * One key per input line: sha256 of the trimmed line + "#" + its occurrence
 * index among identical lines in this input. Hashing the raw line (not the
 * produced event) is what makes this work for records without a ts — those
 * are stamped with ingestion time, so their events differ on every run. The
 * occurrence index keeps two genuinely identical lines (same model, same
 * counts, no ts) as two usages, while a re-run maps them to the same keys.
 * For an OTLP line the key covers all of its datapoints.
 *
 * State is global to the project, not per file: stdin has no path, and a
 * renamed or rotated file should not be counted again.
 */
export function lineKeys(lines: string[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const hash = createHash("sha256").update(line.trim()).digest("hex");
    const n = seen.get(hash) ?? 0;
    seen.set(hash, n + 1);
    return `${hash}#${n}`;
  });
}

interface IngestState {
  ingested: string[];
}

function statePath(cwd: string): string {
  return join(cwd, LEDGER_DIR, "sources", "ingest.json");
}

function loadState(cwd: string): IngestState {
  const p = statePath(cwd);
  if (!existsSync(p)) return { ingested: [] };
  try {
    const s = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(s?.ingested) ? s : { ingested: [] };
  } catch {
    return { ingested: [] };
  }
}

/** Written to a temp file then renamed: a crash mid-write must not leave a
 *  truncated state that forgets what was ingested and double-counts it all. */
function saveState(cwd: string, state: IngestState): void {
  const p = statePath(cwd);
  mkdirSync(join(cwd, LEDGER_DIR, "sources"), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state), "utf8");
  renameSync(tmp, p);
}

export async function cmdIngest(cwd: string, argv: string[]): Promise<number> {
  if (!findPolicyPath(cwd)) {
    console.error("✖ No carbon.md here. Run `npx carbon-md init` first.");
    return 1;
  }
  const fileArg = argv.find((a) => !a.startsWith("--"));
  if (!fileArg) {
    console.error("Usage: carbon-md ingest <usage.jsonl | -> [--source <label>]");
    return 1;
  }
  const sourceIdx = argv.indexOf("--source");
  const source = sourceIdx >= 0 ? argv[sourceIdx + 1] ?? "ingest" : "ingest";

  const raw = fileArg === "-" ? readFileSync(0, "utf8") : readFileSync(fileArg, "utf8");

  const recs: Rec[] = [];
  const warnings = new Set<string>();
  let skipped = 0;
  const invalidDatapoints = { n: 0 };

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const keys = lineKeys(lines);
  const state = loadState(cwd);
  const done = new Set(state.ingested);
  const newKeys: string[] = [];
  let already = 0;
  let untimed = 0;

  for (const [i, trimmed] of lines.entries()) {
    if (done.has(keys[i])) {
      already++;
      continue;
    }
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      skipped++;
      continue;
    }
    let lineRecs: Rec[];
    if (obj?.resourceMetrics) {
      lineRecs = flattenOtlp(obj, warnings, invalidDatapoints);
    } else {
      const rec = obj && typeof obj === "object" ? mapReport(obj) : null;
      if (!rec) {
        skipped++;
        continue;
      }
      lineRecs = [rec];
    }
    // Only lines that yielded usage are remembered: a skipped line stays
    // visible as skipped on every run instead of being silently "done".
    // And only timestamped ones: without a ts, two identical lines from two
    // different runs (`{model, tokens_in, tokens_out}` piped daily, as init
    // suggests) are two real usages we cannot tell apart from a re-run.
    // Dropping one would silently under-count, so those lines are always
    // ingested and the run says so.
    if (lineRecs.length && lineRecs.every((r) => r.ts)) newKeys.push(keys[i]);
    else untimed += lineRecs.length;
    recs.push(...lineRecs);
  }
  skipped += invalidDatapoints.n;

  const events: UsageEvent[] = [];
  const guessedModels = new Set<string>();
  let cacheReadTotal = 0;

  for (const rec of recs) {
    cacheReadTotal += rec.cacheRead;
    if (!rec.tokensIn && !rec.tokensOut) continue; // cache-only record: noted, not estimated
    const est = estimateGco2e(rec.model, rec.tokensIn, rec.tokensOut);
    if (est.guessed) guessedModels.add(rec.model);
    events.push({
      type: "usage",
      ts: rec.ts ?? new Date().toISOString(),
      source,
      provider: rec.provider,
      model: rec.model,
      tokens_in: rec.tokensIn,
      tokens_out: rec.tokensOut,
      gco2e: { low: est.low, central: est.central, high: est.high },
      model_class: est.cls,
      factors: FACTORS_VERSION,
      meta: rec.cacheRead ? { cache_read_tokens: rec.cacheRead } : undefined,
    });
  }

  const alreadyNote = already ? `, ${already} already ingested` : "";
  if (!events.length) {
    if (already) {
      const invalid = skipped ? `; ${skipped} invalid skipped` : "";
      console.log(`✔ Up to date — nothing new (${already} already ingested, skipped${invalid}).`);
      return 0;
    }
    console.error(`✖ No usable records found (${skipped} skipped).`);
    return 1;
  }

  // Ledger first, state second: a crash in between re-ingests this batch on
  // the next run (visible, fixable) rather than losing it for good.
  appendEvents(cwd, events);
  saveState(cwd, { ingested: [...state.ingested, ...newKeys] });
  const total = events.reduce((s, e) => s + e.gco2e.central, 0);
  console.log(
    `✔ Ingested ${events.length} records (${skipped} skipped${alreadyNote}) → ~${formatG(total)} central estimate`
  );
  if (cacheReadTotal) {
    console.log(
      `  ${cacheReadTotal.toLocaleString()} cache-read tokens recorded but excluded from the estimate`
    );
  }
  if (untimed) {
    console.log(
      `  note: ${untimed} record(s) had no ts — stamped now and not deduplicated; ingesting them again counts them again`
    );
  }
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  if (guessedModels.size) {
    console.log(
      `  note: unrecognized model(s) mapped to class "medium": ${[...guessedModels].join(", ")}`
    );
  }
  return 0;
}
