import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmdIngest, mapReport, normalizeTs } from "../commands/ingest.js";
import { readLedger, type UsageEvent } from "../core/ledger.js";

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

test("mapReport: non-numeric or negative token counts are rejected", () => {
  assert.equal(mapReport({ model: "gpt-5.5", tokens_in: "abc", tokens_out: 10 }), null);
  assert.equal(mapReport({ model: "gpt-5.5", tokens_in: -5000, tokens_out: 10 }), null);
  assert.equal(mapReport({ model: "gpt-5.5", tokens_in: 10, tokens_out: Infinity }), null);
  assert.equal(mapReport({ model: "gpt-5.5", tokens_in: 10, cache_read_tokens: "x" }), null);
  assert.equal(mapReport({ model: "gpt-5.5", tokens_in: true }), null);
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

test("ingest: still fails when a fresh input has no usable records", async () => {
  const cwd = workDir();
  const file = join(cwd, "usage.jsonl");
  writeFileSync(file, "not json\n" + line({ model: "gpt-5.5", tokens_in: "abc" }) + "\n");
  assert.equal(await cmdIngest(cwd, [file]), 1);
  assert.equal(usage(cwd).length, 0);
  rmSync(cwd, { recursive: true, force: true });
});
