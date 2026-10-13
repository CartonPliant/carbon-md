import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { cmdIngest, lineKeys, mapReport, normalizeTs } from "../commands/ingest.js";
import { readLedger, type UsageEvent } from "../core/ledger.js";

const CLI = fileURLToPath(new URL("../index.js", import.meta.url));

const POLICY = `---\ncarbon_md: "0.1"\npolicy:\n  contribution_target: 1.10\n  monthly_budget_max: { amount: 5, currency: USD }\n  approval_above: { amount: 10, currency: USD }\nmethodology: carbonmd-factors-2026-07\n---\n`;

function workDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "carbon-test-ingest-"));
  writeFileSync(join(dir, "carbon.md"), POLICY, "utf8");
  return dir;
}

function usage(cwd: string): UsageEvent[] {
  return readLedger(cwd).filter((e): e is UsageEvent => e.type === "usage");
}

const line = (o: object) => JSON.stringify(o);

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

test("ingest: an OTLP datapoint with an implausible time is skipped", async () => {
  const cwd = workDir();
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
  rmSync(cwd, { recursive: true, force: true });
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

test("ingest: an OTLP datapoint with a fractional value is skipped, a real ns time is kept", async () => {
  const cwd = workDir();
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
  rmSync(cwd, { recursive: true, force: true });
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

test("ingest: invalid records are skipped and never reach the ledger", async () => {
  const cwd = workDir();
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

  rmSync(cwd, { recursive: true, force: true });
});

test("ingest: a record without ts is stamped with ingestion time", async () => {
  const cwd = workDir();
  const file = join(cwd, "usage.jsonl");
  writeFileSync(file, line({ model: "gpt-5.5", tokens_in: 10, tokens_out: 1 }) + "\n");
  const before = Date.now();
  assert.equal(await cmdIngest(cwd, [file]), 0);
  const [e] = usage(cwd);
  assert.ok(new Date(e.ts).getTime() >= before - 1000);
  rmSync(cwd, { recursive: true, force: true });
});

test("ingest: OTLP datapoints with negative values or bad timestamps are skipped", async () => {
  const cwd = workDir();
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
  rmSync(cwd, { recursive: true, force: true });
});

test("ingest: re-ingesting the same file is idempotent; appended lines are picked up", async () => {
  const cwd = workDir();
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

  rmSync(cwd, { recursive: true, force: true });
});

test("ingest: still fails when a fresh input has no usable records", async () => {
  const cwd = workDir();
  const file = join(cwd, "usage.jsonl");
  writeFileSync(file, "not json\n" + line({ model: "gpt-5.5", tokens_in: "abc" }) + "\n");
  assert.equal(await cmdIngest(cwd, [file]), 1);
  assert.equal(usage(cwd).length, 0);
  rmSync(cwd, { recursive: true, force: true });
});

test("ingest: stdin re-ingest is idempotent too", () => {
  const cwd = workDir();
  const input = line({ ts: 1760000000, model: "gpt-5.5", tokens_in: 1000, tokens_out: 100 }) + "\n";
  const run = () => execFileSync("node", [CLI, "ingest", "-"], { cwd, input, encoding: "utf8" });

  assert.match(run(), /Ingested 1 record/);
  const second = run();
  assert.match(second, /up to date/i);
  assert.match(second, /1 already ingested/);
  assert.equal(usage(cwd).length, 1);

  rmSync(cwd, { recursive: true, force: true });
});

test("ingest: records without ts are never deduplicated — a repeat is new usage", async () => {
  const cwd = workDir();
  const file = join(cwd, "usage.jsonl");
  // `{model, tokens_in, tokens_out}` piped once a day: same line, two real usages
  writeFileSync(file, line({ model: "gpt-5.5", tokens_in: 1000, tokens_out: 100 }) + "\n");

  assert.equal(await cmdIngest(cwd, [file]), 0);
  assert.equal(await cmdIngest(cwd, [file]), 0);
  assert.equal(usage(cwd).length, 2);

  rmSync(cwd, { recursive: true, force: true });
});
