import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
 * Validation: token counts must be non-negative safe integers (integer
 * strings like "123" are accepted — OTLP/JSON encodes asInt as a string, and
 * report producers do the same). Timestamps must be ISO 8601 or a Unix epoch,
 * and a plausible instant (2000 → now + 1 day); see normalizeTs. A
 * record failing either check is skipped and counted, never written: a NaN
 * poisons every total downstream, a negative count silently cancels real
 * usage, and an Invalid Date drops the event out of every period view.
 *
 * Idempotence: like the sync adapters, ingest keeps state in
 * .carbon-md/sources/ingest.json — the keys of every record already
 * written to the ledger (a report line, or one OTLP datapoint) — so
 * re-ingesting a file (or the same stdin) adds nothing, and re-ingesting a
 * file that has grown adds only the new records. Records without a ts are
 * the exception: they can't be told apart from new usage, so they are
 * always ingested (see the loop in ingestLines). See lineKeys for why the key
 * is the raw line, not the produced event. A run holds
 * .carbon-md/sources/ingest.lock from loading the state to committing it,
 * so overlapping runs can't overwrite each other's keys (see acquireLock).
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
const INTEGER = /^\s*\d+\s*$/;

/**
 * A token count as a non-negative safe integer. Absent → 0; anything else
 * (NaN, negative, Infinity, booleans, "abc", "12.5", 1e308) → null, so the
 * caller skips the whole record rather than guess at what the producer meant.
 * Tokens are whole by definition: a fraction means the field holds something
 * else (a cost, a ratio). Past Number.MAX_SAFE_INTEGER the value can't even
 * be represented exactly, and 1e308 tokens would book ~5e299 tCO2e.
 * No tighter cap: a delta OTLP datapoint or a daily report line aggregates
 * many calls, and no fixed ceiling separates a big org from a bad producer.
 */
function toCount(v: unknown): number | null {
  if (v === undefined || v === null) return 0;
  const n = typeof v === "number" ? v : typeof v === "string" && INTEGER.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** OTLP timeUnixNano: a non-negative integer (string or number). Not a token
 *  count — present-day values (~1.8e18) exceed the safe-integer range, and
 *  sub-ms precision lost in the float is irrelevant to a usage timestamp. */
function toUnixNano(v: unknown): number | null {
  if (v === undefined || v === null) return 0;
  const n = typeof v === "number" ? v : typeof v === "string" && INTEGER.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** A numeric epoch's unit is guessed from its magnitude: below 1e12 it is
 *  seconds, then milliseconds, microseconds from 1e15, nanoseconds from 1e18.
 *  A present-day instant is ~1.8e9 s, ~1.8e12 ms, ~1.8e15 µs, ~1.8e18 ns, so
 *  the tiers never collide for recent usage; a value they misread (e.g. ms
 *  from before Sept 2001, below 1e12) lands far outside the plausibility
 *  window below and is rejected rather than misdated. */
const EPOCH_TIERS: [limit: number, toMs: number][] = [
  [1e12, 1e3], // seconds
  [1e15, 1], // milliseconds
  [1e18, 1e-3], // microseconds
  [Infinity, 1e-6], // nanoseconds
];

/** 2000-01-01T00:00:00Z. No LLM usage predates it, so an earlier instant is
 *  a unit mistake (ns sent as s, a 0 "unset" sentinel) — never real. */
const TS_MIN_MS = Date.UTC(2000, 0, 1);
/** Clock skew between the producer and this machine is tolerated up to a day;
 *  beyond that a "future" record is a unit mistake too. */
const TS_MAX_SKEW_MS = 86_400_000;

/**
 * The instant as ISO 8601 UTC if it is a plausible usage time, else null.
 * Without this bound a µs epoch read as ms lands in year 57742 and a 0 in
 * 1970: both are valid Dates, both silently drop the usage out of every
 * period view, exactly what the Invalid Date check exists to prevent.
 */
function plausibleIso(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < TS_MIN_MS || ms > Date.now() + TS_MAX_SKEW_MS) return null;
  return new Date(ms).toISOString();
}

/** ISO 8601: a date, then optionally a time (minutes, seconds and a
 *  fraction) after 'T' or a space, then optionally Z or a ±HH:MM / ±HHMM
 *  offset. Date.parse is not used: it accepts "hello 2026", and reads a
 *  zone-less time in the host's local zone, so the same file would land in
 *  different hours (and months) depending on where it is ingested. */
const ISO_TS =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(Z|[+-]\d{2}:?\d{2})?)?$/i;

function parseIsoMs(s: string): number | null {
  const m = ISO_TS.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", sec = "0", frac = "", zone] = m;
  const ms = Number((frac + "000").slice(0, 3));
  const t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec, ms);
  // Date.UTC rolls 2026-02-30 over to March 2 and 25:00 to the next day;
  // round-tripping the fields catches every out-of-range component.
  const back = new Date(t);
  if (
    back.getUTCFullYear() !== +y ||
    back.getUTCMonth() !== +mo - 1 ||
    back.getUTCDate() !== +d ||
    back.getUTCHours() !== +h ||
    back.getUTCMinutes() !== +mi ||
    back.getUTCSeconds() !== +sec
  ) {
    return null;
  }
  // No zone means UTC (not host-local time — see ISO_TS).
  if (!zone || zone.toUpperCase() === "Z") return t;
  const oh = Number(zone.slice(1, 3));
  const om = Number(zone.slice(-2));
  if (oh > 23 || om > 59) return null;
  const sign = zone[0] === "+" ? 1 : -1;
  return t - sign * (oh * 60 + om) * 60_000;
}

/**
 * Normalize a record timestamp to ISO 8601 (UTC).
 *   - absent (undefined/null/"") → undefined: the caller stamps ingestion time
 *   - number or numeric string   → Unix epoch, unit from EPOCH_TIERS
 *   - other string               → must be ISO 8601 (see ISO_TS); a time
 *                                  without a zone is UTC, a bare date is
 *                                  UTC midnight
 *   - anything else, or an instant before 2000 or more than a day ahead
 *                                → null: the caller skips the record
 * Skipping instead of stamping "now" matters: a bad ts silently moved to
 * today would land the usage in the wrong month of every report.
 */
export function normalizeTs(v: unknown): string | undefined | null {
  if (v === undefined || v === null || v === "") return undefined;
  let ms: number | null;
  if (typeof v === "number" || (typeof v === "string" && NUMERIC.test(v))) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    const [, toMs] = EPOCH_TIERS.find(([limit]) => n < limit)!;
    ms = n * toMs;
  } else if (typeof v === "string") {
    ms = parseIsoMs(v);
  } else {
    return null;
  }
  return ms === null ? null : plausibleIso(ms);
}

/**
 * Each usable datapoint with its index among the line's datapoints — the
 * index is what dedup keys a datapoint by (see lineKeys). `invalid.n` counts
 * datapoints dropped by validation (bad value or time).
 */
function flattenOtlp(
  obj: any,
  warnings: Set<string>,
  invalid: { n: number }
): { idx: number; rec: Rec }[] {
  const recs: { idx: number; rec: Rec }[] = [];
  let idx = -1;
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
          idx++;
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
          // OTLP's unit is unambiguous (ns), so no epoch-unit heuristic here;
          // 0 is OTLP's "unset" and falls back to ingestion time. Any other
          // value still has to be a plausible instant (see plausibleIso).
          const ns = toUnixNano(dp.timeUnixNano);
          const ts = ns ? plausibleIso(ns / 1e6) : undefined;
          if (ns === null || ts === null) {
            invalid.n++;
            continue;
          }
          const rec: Rec = { model, tokensIn: 0, tokensOut: 0, cacheRead: 0, ts };
          if (IN_TYPES.has(type)) rec.tokensIn = value;
          else if (OUT_TYPES.has(type)) rec.tokensOut = value;
          else if (CACHE_TYPES.has(type)) rec.cacheRead = value;
          else continue; // unknown token type — leave for a future spec rev
          recs.push({ idx, rec });
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
 * That key identifies a report line's single record; an OTLP line holds
 * many, so each datapoint is keyed `${lineKey}/${index}` and remembered on
 * its own (a line mixing timed and untimed datapoints must still dedup the
 * timed ones).
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

/** Test seam: lets a test make the state commit fail after the ledger
 *  append, which no real filesystem setup reproduces deterministically. */
export const _io = { renameSync };

interface IngestState {
  ingested: string[];
}

function statePath(cwd: string): string {
  return join(cwd, LEDGER_DIR, "sources", "ingest.json");
}

function lockPath(cwd: string): string {
  return join(cwd, LEDGER_DIR, "sources", "ingest.lock");
}

/**
 * Take the ingest lock, or return why not. A run loads the whole state at
 * the start and writes a full copy at the end, so two overlapping runs
 * would each drop the other's keys (and re-ingest those records next
 * time). The lock is created with O_EXCL ("wx"): exactly one run gets it.
 * No waiting and no stale-lock guessing: a run that finds it fails fast,
 * and a lock left by a crash is for the user to remove — the pid in it
 * says which run took it.
 */
function acquireLock(cwd: string): { error: string } | undefined {
  const p = lockPath(cwd);
  try {
    mkdirSync(join(cwd, LEDGER_DIR, "sources"), { recursive: true });
  } catch (e) {
    return { error: `Can't create ingest lock ${p} (${errMsg(e)})` };
  }
  try {
    writeFileSync(p, `${process.pid}\n`, { flag: "wx" });
    return undefined;
  } catch (e: any) {
    if (e?.code !== "EEXIST") return { error: `Can't create ingest lock ${p} (${errMsg(e)})` };
    let holder = "";
    try {
      const pid = readFileSync(p, "utf8").trim();
      if (pid) holder = ` (taken by pid ${pid})`;
    } catch {}
    return {
      error:
        `Another ingest is running, or a stale lock from a crashed run${holder} — ` +
        `remove ${p} if no ingest is running`,
    };
  }
}

function releaseLock(cwd: string): void {
  // Best effort: a lock we can't remove is reported by the next run.
  try {
    rmSync(lockPath(cwd), { force: true });
  } catch {}
}

/** "1 record" / "N records". */
function records(n: number): string {
  return `${n} record${n === 1 ? "" : "s"}`;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * The ingest state, or an error message if the file exists but is unusable.
 * Falling back to an empty state here would be the worst option: every
 * input already in the ledger would be ingested again (double-counted), and
 * the state overwritten, erasing the evidence. A missing file is the only
 * legitimate "nothing ingested yet".
 */
function loadState(cwd: string): IngestState | { error: string } {
  const p = statePath(cwd);
  if (!existsSync(p)) return { ingested: [] };
  let s: any;
  try {
    s = JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    return { error: `can't read ${p} (${errMsg(e)})` };
  }
  const ok =
    s && typeof s === "object" && Array.isArray(s.ingested) &&
    s.ingested.every((k: unknown) => typeof k === "string");
  return ok ? s : { error: `${p} is not a valid ingest state (expected {"ingested": [string, ...]})` };
}

/**
 * Commit a batch: state to a temp file, then ledger append, then rename.
 * The temp write comes first so an unwritable state dir aborts before the
 * ledger is touched — otherwise each retry would append the batch again
 * without ever recording it. The rename is the commit point: a crash
 * mid-write never leaves a truncated state that forgets everything. Only a
 * failure between the append and the rename can still duplicate, and that
 * one is reported in full. Returns the exit code.
 */
function commitBatch(cwd: string, events: UsageEvent[], state: IngestState): number {
  const p = statePath(cwd);
  const tmp = `${p}.${process.pid}.tmp`;
  // Best effort: the error being reported matters more than a stray tmp file.
  const dropTmp = () => {
    try {
      rmSync(tmp, { force: true });
    } catch {}
  };
  try {
    mkdirSync(join(cwd, LEDGER_DIR, "sources"), { recursive: true });
    writeFileSync(tmp, JSON.stringify(state), "utf8");
  } catch (e) {
    dropTmp();
    console.error(`✖ Can't write ingest state ${p} (${errMsg(e)}) — nothing was written.`);
    return 1;
  }
  try {
    appendEvents(cwd, events);
  } catch (e) {
    dropTmp();
    console.error(`✖ Can't append to the ledger (${errMsg(e)}) — nothing was recorded.`);
    return 1;
  }
  try {
    _io.renameSync(tmp, p);
  } catch (e) {
    dropTmp();
    console.error(
      `✖ ${events.length} events were written to the ledger but not recorded as ingested in ${p} (${errMsg(e)}).\n` +
        `  Re-running ingest on the same input will duplicate them; fix the state file's permissions first.`
    );
    return 1;
  }
  return 0;
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

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const keys = lineKeys(lines);

  const lockErr = acquireLock(cwd);
  if (lockErr) {
    console.error(`✖ ${lockErr.error}. Nothing was written.`);
    return 1;
  }
  try {
    return ingestLines(cwd, lines, keys, source);
  } finally {
    releaseLock(cwd);
  }
}

/** The run proper, under the ingest lock: dedup against the state, then
 *  commit. Returns the exit code. */
function ingestLines(cwd: string, lines: string[], keys: string[], source: string): number {
  const recs: Rec[] = [];
  const warnings = new Set<string>();
  let skipped = 0;
  const invalidDatapoints = { n: 0 };

  const state = loadState(cwd);
  if ("error" in state) {
    console.error(
      `✖ ${state.error} — nothing was written.\n` +
        `  Fix or restore it; deleting it re-ingests (double-counts) everything already in the ledger.`
    );
    return 1;
  }
  const done = new Set(state.ingested);
  const newKeys: string[] = [];
  let already = 0;
  let untimed = 0;

  for (const [i, trimmed] of lines.entries()) {
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      skipped++;
      continue;
    }
    // Dedup is per record: a report line is one record keyed by its line
    // key, an OTLP datapoint is keyed by line key + its index in the line.
    let lineRecs: { key: string; rec: Rec }[];
    if (obj?.resourceMetrics) {
      lineRecs = flattenOtlp(obj, warnings, invalidDatapoints).map(({ idx, rec }) => ({
        key: `${keys[i]}/${idx}`,
        rec,
      }));
    } else {
      const rec = obj && typeof obj === "object" ? mapReport(obj) : null;
      if (!rec) {
        skipped++;
        continue;
      }
      lineRecs = [{ key: keys[i], rec }];
    }
    for (const { key, rec } of lineRecs) {
      if (done.has(key)) {
        already++;
        continue;
      }
      // Only records that passed validation get here: an invalid one is
      // never remembered, so it stays visible as skipped on every run
      // instead of being silently "done". And only timestamped ones are
      // remembered: without a ts, two identical lines from two different
      // runs (`{model, tokens_in, tokens_out}` piped daily, as init
      // suggests) are two real usages we cannot tell apart from a re-run.
      // Dropping one would silently under-count, so those records are
      // always ingested and the run says so.
      if (rec.ts) newKeys.push(key);
      else untimed++;
      recs.push(rec);
    }
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
      const skippedNote = skipped ? `; ${skipped} skipped` : "";
      console.log(`✔ Up to date — nothing new (${already} already ingested${skippedNote}).`);
      return 0;
    }
    console.error(`✖ No usable records found (${skipped} skipped).`);
    return 1;
  }

  // Ledger before the state commit: a crash in between re-ingests this batch
  // on the next run (visible, fixable) rather than losing it for good.
  const code = commitBatch(cwd, events, { ingested: [...state.ingested, ...newKeys] });
  if (code) return code;
  const total = events.reduce((s, e) => s + e.gco2e.central, 0);
  console.log(
    `✔ Ingested ${records(events.length)} (${skipped} skipped${alreadyNote}) → ~${formatG(total)} central estimate`
  );
  if (cacheReadTotal) {
    console.log(
      `  ${cacheReadTotal.toLocaleString()} cache-read tokens recorded but excluded from the estimate`
    );
  }
  if (untimed) {
    console.log(
      `  note: ${records(untimed)} had no ts — stamped now and not deduplicated; ingesting them again counts them again`
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
