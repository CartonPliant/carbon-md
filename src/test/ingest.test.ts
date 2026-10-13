import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { _io, cmdIngest, lineKeys, mapReport, normalizeTs } from "../commands/ingest.js";
import { readLedger, type UsageEvent } from "../core/ledger.js";

const CLI = fileURLToPath(new URL("../index.js", import.meta.url));

const POLICY = `---\ncarbon_md: "0.1"\npolicy:\n  contribution_target: 1.10\n  monthly_budget_max: { amount: 5, currency: USD }\n  approval_above: { amount: 10, currency: USD }\nmethodology: carbonmd-factors-2026-07\n---\n`;

/** A temp project with a carbon.md, removed when the test ends — pass or fail. */
function workDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "carbon-test-ingest-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "carbon.md"), POLICY, "utf8");
  return dir;
}

function usage(cwd: string): UsageEvent[] {
  return readLedger(cwd).filter((e): e is UsageEvent => e.type === "usage");
}

const line = (o: object) => JSON.stringify(o);

/** Runs fn with console.error captured; returns what it printed. */
async function captureStderr<T>(fn: () => Promise<T>): Promise<{ result: T; err: string }> {
  const orig = console.error;
  let err = "";
  console.error = (...a: unknown[]) => {
    err += a.join(" ") + "\n";
  };
  try {
    return { result: await fn(), err };
  } finally {
    console.error = orig;
  }
}

test("normalizeTs: ISO strings and numeric epochs become ISO 8601", () => {
  assert.equal(normalizeTs("2026-08-01T09:12:00Z"), "2026-08-01T09:12:00.000Z");
  // below 1e12 → seconds, otherwise milliseconds
  assert.equal(normalizeTs(1760000000), "2025-10-09T08:53:20.000Z");
  assert.equal(normalizeTs(1760000000000), "2025-10-09T08:53:20.000Z");
  assert.equal(normalizeTs("1760000000"), "2025-10-09T08:53:20.000Z");
});

test("normalizeTs: absent → undefined, unparseable → null", () => {
  assert.equal(normalizeTs(undefined), undefined);
  assert.equal(normalizeTs(null), undefined);
  assert.equal(normalizeTs("not-a-date"), null);
  assert.equal(normalizeTs(-5), null);
  assert.equal(normalizeTs(1e20), null);
  assert.equal(normalizeTs({}), null);
});

test("normalizeTs: µs and ns epochs are read in their own unit", () => {
  assert.equal(normalizeTs(1760000000000000), "2025-10-09T08:53:20.000Z");
  assert.equal(normalizeTs("1760000000000000000"), "2025-10-09T08:53:20.000Z");
});

test("normalizeTs: instants before 2000 or more than a day in the future are rejected", () => {
  assert.equal(normalizeTs(0), null); // 1970
  assert.equal(normalizeTs(999999999999), null); // seconds → year 33658
  assert.equal(normalizeTs(946684799), null); // 1999-12-31T23:59:59Z
  assert.equal(normalizeTs(946684800), "2000-01-01T00:00:00.000Z");
  assert.equal(normalizeTs("+275760-09-13T00:00:00Z"), null);
  assert.equal(normalizeTs("1999-12-31T23:59:59Z"), null);
  const soon = new Date(Date.now() + 3600_000).toISOString();
  assert.equal(normalizeTs(soon), soon);
  assert.equal(normalizeTs(new Date(Date.now() + 2 * 86400_000).toISOString()), null);
});

test("normalizeTs: only ISO 8601 date strings are accepted", () => {
  assert.equal(normalizeTs("hello 2026"), null);
  assert.equal(normalizeTs("Aug 1 2026"), null);
  assert.equal(normalizeTs("2026-08-01T25:00:00Z"), null);
  assert.equal(normalizeTs("2026-02-30"), null);
  assert.equal(normalizeTs("2026-08-01T09:12:00+0000junk"), null);
  // "2026" is all digits, so it is an epoch (seconds → 1970) — and implausible
  assert.equal(normalizeTs("2026"), null);
  // date only → UTC midnight
  assert.equal(normalizeTs("2026-08-01"), "2026-08-01T00:00:00.000Z");
  // a time without a zone is UTC, whatever the host's TZ
  assert.equal(normalizeTs("2026-08-01T09:12:00"), "2026-08-01T09:12:00.000Z");
  assert.equal(normalizeTs("2026-08-01 09:12"), "2026-08-01T09:12:00.000Z");
  assert.equal(normalizeTs("2026-08-01T09:12:00.123456Z"), "2026-08-01T09:12:00.123Z");
  assert.equal(normalizeTs("2026-08-01T11:12:00+02:00"), "2026-08-01T09:12:00.000Z");
  assert.equal(normalizeTs("2026-08-01T04:12:00-0500"), "2026-08-01T09:12:00.000Z");
});

test("normalizeTs: a zone-less time is UTC regardless of the host TZ", () => {
  const out = execFileSync(
    "node",
    [
      "--input-type=module",
      "-e",
      `import { normalizeTs } from ${JSON.stringify(new URL("../commands/ingest.js", import.meta.url).href)};
       console.log(normalizeTs("2026-08-01T09:12:00"));`,
    ],
    { env: { ...process.env, TZ: "America/New_York" }, encoding: "utf8" }
  );
  assert.equal(out.trim(), "2026-08-01T09:12:00.000Z");
});

test("ingest: an OTLP datapoint with an implausible time is skipped", async (t) => {
  const cwd = workDir(t);
  const otlp = {
    resourceMetrics: [{ scopeMetrics: [{ metrics: [{
      name: "claude_code.token.usage",
      sum: { aggregationTemporality: 1, dataPoints: [
        { attributes: [
            { key: "model", value: { stringValue: "claude-sonnet-4" } },
            { key: "type", value: { stringValue: "input" } },
          ], asInt: "500", timeUnixNano: "1760000000" }, // seconds sent as ns → 1970
      ] },
    }] }] }],
  };
  const file = join(cwd, "otel.jsonl");
  writeFileSync(file, line(otlp) + "\n");
  assert.equal(await cmdIngest(cwd, [file]), 1);
  assert.equal(usage(cwd).length, 0);
});

test("mapReport: non-numeric or negative token counts are rejected", () => {
  assert.equal(mapReport({ model: "gpt-5.5", tokens_in: "abc", tokens_out: 10 }), null);
  assert.equal(mapReport({ model: "gpt-5.5", tokens_in: -5000, tokens_out: 10 }), null);
  assert.equal(mapReport({ model: "gpt-5.5", tokens_in: 10, tokens_out: Infinity }), null);
  assert.equal(mapReport({ model: "gpt-5.5", tokens_in: 10, cache_read_tokens: "x" }), null);
  assert.equal(mapReport({ model: "gpt-5.5", tokens_in: true }), null);
});

test("mapReport: fractional or unsafe-integer token counts are rejected", () => {
  assert.equal(mapReport({ model: "gpt-5.5", tokens_in: "12.5", tokens_out: 1 }), null);
  assert.equal(mapReport({ model: "gpt-5.5", tokens_in: 0.4, tokens_out: 1 }), null);
  assert.equal(mapReport({ model: "gpt-5.5", tokens_in: 1e308, tokens_out: 1 }), null);
  assert.equal(mapReport({ model: "gpt-5.5", tokens_in: "99999999999999999999", tokens_out: 1 }), null);
  assert.equal(mapReport({ model: "gpt-5.5", tokens_in: 10, cache_read_tokens: 2.5 }), null);
  // an integral double is still an integer
  assert.equal(mapReport({ model: "gpt-5.5", tokens_in: 12.0, tokens_out: 1 })?.tokensIn, 12);
});

test("ingest: an OTLP datapoint with a fractional value is skipped, a real ns time is kept", async (t) => {
  const cwd = workDir(t);
  const dp = (value: unknown) => ({
    attributes: [
      { key: "model", value: { stringValue: "claude-sonnet-4" } },
      { key: "type", value: { stringValue: "input" } },
    ],
    asDouble: value,
    // well beyond Number.MAX_SAFE_INTEGER: a timestamp, not a count
    timeUnixNano: "1760000000123456789",
  });
  const otlp = {
    resourceMetrics: [{ scopeMetrics: [{ metrics: [{
      name: "claude_code.token.usage",
      sum: { aggregationTemporality: 1, dataPoints: [dp(500), dp(0.5)] },
    }] }] }],
  };
  const file = join(cwd, "otel.jsonl");
  writeFileSync(file, line(otlp) + "\n");
  assert.equal(await cmdIngest(cwd, [file]), 0);
  const events = usage(cwd);
  assert.equal(events.length, 1);
  assert.equal(events[0].tokens_in, 500);
  assert.equal(events[0].ts, "2025-10-09T08:53:20.123Z");
});

test("mapReport: numeric strings are accepted as counts", () => {
  const rec = mapReport({ model: "gpt-5.5", tokens_in: "123", tokens_out: 7 });
  assert.ok(rec);
  assert.equal(rec.tokensIn, 123);
  assert.equal(rec.tokensOut, 7);
});

test("mapReport: an unparseable ts rejects the record", () => {
  assert.equal(mapReport({ model: "gpt-5.5", tokens_in: 10, ts: "not-a-date" }), null);
  const rec = mapReport({ model: "gpt-5.5", tokens_in: 10, ts: 1760000000 });
  assert.equal(rec?.ts, "2025-10-09T08:53:20.000Z");
});

test("lineKeys: identical lines get distinct occurrence-indexed keys", () => {
  const keys = lineKeys(["a", "b", "a", "a"]);
  assert.equal(new Set(keys).size, 4);
  assert.equal(keys[0].split("#")[0], keys[2].split("#")[0]);
  assert.ok(keys[0].endsWith("#0"));
  assert.ok(keys[2].endsWith("#1"));
  assert.ok(keys[3].endsWith("#2"));
  // keys only depend on content + position among duplicates, not on the batch
  assert.deepEqual(lineKeys(["a", "b"]), keys.slice(0, 2));
});

test("ingest: invalid records are skipped and never reach the ledger", async (t) => {
  const cwd = workDir(t);
  const file = join(cwd, "usage.jsonl");
  writeFileSync(
    file,
    [
      line({ ts: "2026-08-01T09:12:00Z", model: "gpt-5.5", tokens_in: 1000, tokens_out: 100 }),
      line({ ts: "2026-08-01T09:13:00Z", model: "gpt-5.5", tokens_in: "abc", tokens_out: 100 }),
      line({ ts: "2026-08-01T09:14:00Z", model: "gpt-5.5", tokens_in: -5000, tokens_out: 100 }),
      line({ ts: "not-a-date", model: "gpt-5.5", tokens_in: 1000, tokens_out: 100 }),
      line({ ts: 1760000000, model: "gpt-5.5", tokens_in: "2000", tokens_out: 0 }),
    ].join("\n") + "\n",
    "utf8"
  );

  assert.equal(await cmdIngest(cwd, [file]), 0);
  const events = usage(cwd);
  assert.equal(events.length, 2);
  for (const e of events) {
    assert.ok(Number.isFinite(e.gco2e.central) && e.gco2e.central > 0);
    assert.ok(e.tokens_in >= 0 && e.tokens_out >= 0);
    assert.ok(!Number.isNaN(new Date(e.ts).getTime()), `bad ts ${e.ts}`);
  }
  assert.equal(events[0].ts, "2026-08-01T09:12:00.000Z");
  assert.equal(events[1].ts, "2025-10-09T08:53:20.000Z");
  assert.equal(events[1].tokens_in, 2000);
});

test("ingest: a record without ts is stamped with ingestion time", async (t) => {
  const cwd = workDir(t);
  const file = join(cwd, "usage.jsonl");
  writeFileSync(file, line({ model: "gpt-5.5", tokens_in: 10, tokens_out: 1 }) + "\n");
  const before = Date.now();
  assert.equal(await cmdIngest(cwd, [file]), 0);
  const [e] = usage(cwd);
  assert.ok(new Date(e.ts).getTime() >= before - 1000);
});

test("ingest: OTLP datapoints with negative values or bad timestamps are skipped", async (t) => {
  const cwd = workDir(t);
  const dp = (type: string, value: unknown, timeUnixNano: unknown) => ({
    attributes: [
      { key: "model", value: { stringValue: "claude-sonnet-4" } },
      { key: "type", value: { stringValue: type } },
    ],
    asInt: value,
    timeUnixNano,
  });
  const otlp = {
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics: [
              {
                name: "claude_code.token.usage",
                sum: {
                  aggregationTemporality: 1,
                  dataPoints: [
                    dp("input", "500", "1760000000000000000"),
                    dp("output", "-50", "1760000000000000000"),
                    dp("output", "50", "garbage"),
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };
  const file = join(cwd, "otel.jsonl");
  writeFileSync(file, line(otlp) + "\n");
  assert.equal(await cmdIngest(cwd, [file]), 0);
  const events = usage(cwd);
  assert.equal(events.length, 1);
  assert.equal(events[0].tokens_in, 500);
  assert.equal(events[0].ts, "2025-10-09T08:53:20.000Z");
});

test("ingest: re-ingesting the same file is idempotent; appended lines are picked up", async (t) => {
  const cwd = workDir(t);
  const file = join(cwd, "usage.jsonl");
  // two genuinely identical lines — both are real usage and both must count
  const dup = line({ ts: "2026-10-01T10:00:00Z", model: "gpt-5.5", tokens_in: 1000, tokens_out: 100 });
  writeFileSync(file, [dup, dup].join("\n") + "\n");

  assert.equal(await cmdIngest(cwd, [file]), 0);
  assert.equal(usage(cwd).length, 2);

  // same file again → nothing new, and that is success, not an error
  assert.equal(await cmdIngest(cwd, [file]), 0);
  assert.equal(usage(cwd).length, 2);

  // append one more identical line and a new one → only those two are added
  appendFileSync(
    file,
    dup + "\n" + line({ ts: "2026-10-01T11:00:00Z", model: "gpt-5.5", tokens_in: 5, tokens_out: 5 }) + "\n"
  );
  assert.equal(await cmdIngest(cwd, [file]), 0);
  assert.equal(usage(cwd).length, 4);
});

test("ingest: still fails when a fresh input has no usable records", async (t) => {
  const cwd = workDir(t);
  const file = join(cwd, "usage.jsonl");
  writeFileSync(file, "not json\n" + line({ model: "gpt-5.5", tokens_in: "abc" }) + "\n");
  assert.equal(await cmdIngest(cwd, [file]), 1);
  assert.equal(usage(cwd).length, 0);
});

test("ingest: stdin re-ingest is idempotent too", (t) => {
  const cwd = workDir(t);
  const input = line({ ts: 1760000000, model: "gpt-5.5", tokens_in: 1000, tokens_out: 100 }) + "\n";
  const run = () => execFileSync("node", [CLI, "ingest", "-"], { cwd, input, encoding: "utf8" });

  assert.match(run(), /Ingested 1 record \(/);
  const second = run();
  assert.match(second, /Up to date — nothing new \(1 already ingested\)\./);
  assert.equal(usage(cwd).length, 1);
});

test("ingest: records without ts are never deduplicated — a repeat is new usage", async (t) => {
  const cwd = workDir(t);
  const file = join(cwd, "usage.jsonl");
  // `{model, tokens_in, tokens_out}` piped once a day: same line, two real usages
  const daily = line({ model: "gpt-5.5", tokens_in: 1000, tokens_out: 100 });
  writeFileSync(file, daily + "\n");

  assert.equal(await cmdIngest(cwd, [file]), 0);
  assert.equal(await cmdIngest(cwd, [file]), 0);
  assert.equal(usage(cwd).length, 2);

  writeFileSync(file, daily + "\n" + daily + "\n");
  const { result, out } = await captureStdout(() => cmdIngest(cwd, [file]));
  assert.equal(result, 0);
  assert.match(out, /Ingested 2 records \(/);
  assert.match(out, /note: 2 records had no ts/);
  assert.equal(usage(cwd).length, 4);
});

test("ingest: a corrupt or wrong-shape state file fails the run and writes nothing", async (t) => {
  for (const bad of ["{not json", '{"ingested":"x"}', '{"ingested":[1]}', "[]", "null"]) {
    const cwd = workDir(t);
    const file = join(cwd, "usage.jsonl");
    writeFileSync(file, line({ ts: "2026-10-01T10:00:00Z", model: "gpt-5.5", tokens_in: 10, tokens_out: 1 }) + "\n");
    const sources = join(cwd, ".carbon-md", "sources");
    mkdirSync(sources, { recursive: true });
    const state = join(sources, "ingest.json");
    writeFileSync(state, bad);

    const { result, err } = await captureStderr(() => cmdIngest(cwd, [file]));
    assert.equal(result, 1, `state ${bad}`);
    assert.match(err, /ingest\.json/);
    assert.match(err, /nothing was written/i);
    assert.equal(usage(cwd).length, 0);
    assert.equal(readFileSync(state, "utf8"), bad);
    assert.ok(!existsSync(join(sources, "ingest.lock")), "lock released on failure");
  }
});

test("ingest: an unwritable state dir aborts before any ledger write", async (t) => {
  if (process.getuid?.() === 0) return t.skip("root ignores directory permissions");
  const cwd = workDir(t);
  const file = join(cwd, "usage.jsonl");
  writeFileSync(file, line({ ts: "2026-10-01T10:00:00Z", model: "gpt-5.5", tokens_in: 10, tokens_out: 1 }) + "\n");
  assert.equal(await cmdIngest(cwd, [file]), 0);
  appendFileSync(file, line({ ts: "2026-10-01T11:00:00Z", model: "gpt-5.5", tokens_in: 20, tokens_out: 2 }) + "\n");

  const sources = join(cwd, ".carbon-md", "sources");
  chmodSync(sources, 0o555);
  try {
    for (let run = 0; run < 2; run++) {
      const { result, err } = await captureStderr(() => cmdIngest(cwd, [file]));
      assert.equal(result, 1);
      assert.match(err, /nothing was written/i);
      assert.equal(usage(cwd).length, 1, "no retry may duplicate the batch");
    }
  } finally {
    chmodSync(sources, 0o755);
  }
  assert.deepEqual(readdirSync(sources), ["ingest.json"]);
});

test("ingest: a state commit failing after the ledger append says so explicitly", async (t) => {
  const cwd = workDir(t);
  const file = join(cwd, "usage.jsonl");
  writeFileSync(
    file,
    [
      line({ ts: "2026-10-01T10:00:00Z", model: "gpt-5.5", tokens_in: 10, tokens_out: 1 }),
      line({ ts: "2026-10-01T11:00:00Z", model: "gpt-5.5", tokens_in: 20, tokens_out: 2 }),
    ].join("\n") + "\n"
  );
  const orig = _io.renameSync;
  _io.renameSync = () => {
    throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
  };
  try {
    const { result, err } = await captureStderr(() => cmdIngest(cwd, [file]));
    assert.equal(result, 1);
    assert.match(err, /2 events were written to the ledger but not recorded as ingested/);
    assert.match(err, /re-running .*duplicate/i);
  } finally {
    _io.renameSync = orig;
  }
  assert.equal(usage(cwd).length, 2);
  const sources = join(cwd, ".carbon-md", "sources");
  assert.ok(!existsSync(join(sources, "ingest.json")));
  assert.deepEqual(readdirSync(sources), [], "tmp file cleaned up");
});

/** One OTLP line; each datapoint is [type, value, timeUnixNano]. */
function otlpLine(points: [string, unknown, unknown][]): string {
  return line({
    resourceMetrics: [{ scopeMetrics: [{ metrics: [{
      name: "claude_code.token.usage",
      sum: {
        aggregationTemporality: 1,
        dataPoints: points.map(([type, asInt, timeUnixNano]) => ({
          attributes: [
            { key: "model", value: { stringValue: "claude-sonnet-4" } },
            { key: "type", value: { stringValue: type } },
          ],
          asInt,
          timeUnixNano,
        })),
      },
    }] }] }],
  });
}

async function captureStdout<T>(fn: () => Promise<T>): Promise<{ result: T; out: string }> {
  const orig = console.log;
  let out = "";
  console.log = (...a: unknown[]) => {
    out += a.join(" ") + "\n";
  };
  try {
    return { result: await fn(), out };
  } finally {
    console.log = orig;
  }
}

test("ingest: OTLP dedup is per datapoint — timed ones once, untimed ones every run", async (t) => {
  const cwd = workDir(t);
  const file = join(cwd, "otel.jsonl");
  const T = "1760000000000000000";
  writeFileSync(file, otlpLine([["input", "100", T], ["output", "10", T], ["input", "7", "0"]]) + "\n");

  const first = await captureStdout(() => cmdIngest(cwd, [file]));
  assert.equal(first.result, 0);
  assert.match(first.out, /Ingested 3 records/);
  assert.match(first.out, /note: 1 record had no ts/);
  assert.equal(usage(cwd).length, 3);

  const second = await captureStdout(() => cmdIngest(cwd, [file]));
  assert.equal(second.result, 0);
  assert.match(second.out, /Ingested 1 record \(0 skipped, 2 already ingested\)/);
  assert.match(second.out, /note: 1 record had no ts/);
  const events = usage(cwd);
  assert.equal(events.length, 4);
  assert.equal(events.filter((e) => e.tokens_in === 100).length, 1, "timed datapoint counted once");
});

test("ingest: an OTLP line's invalid datapoints keep being reported as skipped", async (t) => {
  const cwd = workDir(t);
  const file = join(cwd, "otel.jsonl");
  const T = "1760000000000000000";
  writeFileSync(file, otlpLine([["input", "100", T], ["output", "-5", T]]) + "\n");

  const first = await captureStdout(() => cmdIngest(cwd, [file]));
  assert.match(first.out, /Ingested 1 record \(1 skipped\)/);

  const second = await captureStdout(() => cmdIngest(cwd, [file]));
  assert.equal(second.result, 0);
  assert.match(second.out, /Up to date — nothing new \(1 already ingested; 1 skipped\)\./);
  assert.equal(usage(cwd).length, 1);
});

test("ingest: a mixed OTLP line (timed + untimed + invalid) ingested three times", async (t) => {
  const cwd = workDir(t);
  const file = join(cwd, "otel.jsonl");
  const T = "1760000000000000000";
  writeFileSync(
    file,
    otlpLine([["input", "100", T], ["output", "10", T], ["input", "7", "0"], ["output", "-5", T]]) + "\n"
  );

  const first = await captureStdout(() => cmdIngest(cwd, [file]));
  assert.equal(first.result, 0);
  assert.match(first.out, /Ingested 3 records \(1 skipped\)/);
  assert.match(first.out, /note: 1 record had no ts/);
  assert.equal(usage(cwd).length, 3);

  for (const [run, ledger] of [[2, 4], [3, 5]]) {
    const { result, out } = await captureStdout(() => cmdIngest(cwd, [file]));
    assert.equal(result, 0, `run ${run}`);
    assert.match(out, /Ingested 1 record \(1 skipped, 2 already ingested\)/, `run ${run}`);
    assert.match(out, /note: 1 record had no ts/, `run ${run}`);
    assert.equal(usage(cwd).length, ledger, `run ${run}`);
  }

  const events = usage(cwd);
  assert.equal(events.length, 5);
  assert.equal(events.filter((e) => e.tokens_in === 100).length, 1, "timed input once");
  assert.equal(events.filter((e) => e.tokens_out === 10).length, 1, "timed output once");
  assert.equal(events.filter((e) => e.tokens_in === 7).length, 3, "untimed every run");
  assert.ok(events.every((e) => e.tokens_out !== 5 && e.tokens_out >= 0), "invalid never written");
});

test("ingest: a held lock fails the run fast and writes nothing", async (t) => {
  const cwd = workDir(t);
  const file = join(cwd, "usage.jsonl");
  writeFileSync(file, line({ ts: "2026-10-01T10:00:00Z", model: "gpt-5.5", tokens_in: 10, tokens_out: 1 }) + "\n");
  assert.equal(await cmdIngest(cwd, [file]), 0);
  const sources = join(cwd, ".carbon-md", "sources");
  const state = join(sources, "ingest.json");
  const lock = join(sources, "ingest.lock");
  assert.ok(!existsSync(lock), "a normal run leaves no lock behind");
  const stateBefore = readFileSync(state, "utf8");

  appendFileSync(file, line({ ts: "2026-10-01T11:00:00Z", model: "gpt-5.5", tokens_in: 20, tokens_out: 2 }) + "\n");
  writeFileSync(lock, "4242\n");
  const { result, err } = await captureStderr(() => cmdIngest(cwd, [file]));
  assert.equal(result, 1);
  assert.match(err, /another ingest is running/i);
  assert.match(err, /stale lock/i);
  assert.match(err, /ingest\.lock/);
  assert.match(err, /4242/);
  assert.equal(usage(cwd).length, 1);
  assert.equal(readFileSync(state, "utf8"), stateBefore);
  assert.equal(readFileSync(lock, "utf8"), "4242\n", "someone else's lock is left alone");

  rmSync(lock);
  assert.equal(await cmdIngest(cwd, [file]), 0);
  assert.equal(usage(cwd).length, 2);
  assert.ok(!existsSync(lock));
});

test("ingest: a run whose state commit fails still releases the lock", async (t) => {
  const cwd = workDir(t);
  const file = join(cwd, "usage.jsonl");
  writeFileSync(file, line({ ts: "2026-10-01T10:00:00Z", model: "gpt-5.5", tokens_in: 10, tokens_out: 1 }) + "\n");
  const orig = _io.renameSync;
  _io.renameSync = () => {
    throw new Error("boom");
  };
  try {
    await captureStderr(() => cmdIngest(cwd, [file]));
  } finally {
    _io.renameSync = orig;
  }
  assert.ok(!existsSync(join(cwd, ".carbon-md", "sources", "ingest.lock")));
});
