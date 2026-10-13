import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  aggregate,
  inWindow,
  monthStartUtc,
  parseTs,
  spentSince,
  type ContributionEvent,
  type UsageEvent,
} from "../core/ledger.js";

const usage = (ts: string, central = 1): UsageEvent => ({
  type: "usage",
  ts,
  source: "test",
  model: "m",
  tokens_in: 10,
  tokens_out: 0,
  gco2e: { low: central, central, high: central },
  model_class: "small",
  factors: "test",
});

const contribution = (ts: string, cost: number): ContributionEvent => ({
  type: "contribution",
  ts,
  tonnes: 0.001,
  cost,
  currency: "USD",
  rail: "x402:klima",
  receipt: "https://example.test/receipt",
});

test("monthStartUtc: the policy month is the UTC calendar month, whatever the host timezone", () => {
  // 00:30 on 1 Oct in Paris is still 30 Sep in UTC: the window must not have rolled over yet.
  const now = new Date("2026-10-01T00:30:00+02:00");
  assert.equal(monthStartUtc(now).toISOString(), "2026-09-01T00:00:00.000Z");
  // 23:30 on 31 Oct in New York is already 1 Nov in UTC.
  assert.equal(monthStartUtc(new Date("2026-10-31T23:30:00-04:00")).toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(monthStartUtc(new Date("2026-01-15T12:00:00Z")).toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(monthStartUtc(now).getTime(), Date.UTC(2026, 8, 1));
});

// The assertions above pass on a UTC host even if monthStartUtc regresses to
// local midnight, because there local == UTC. Re-run them in a child process
// pinned to UTC+14 so a local-time regression fails on every machine.
test("monthStartUtc: same answer in a UTC+14 child process", () => {
  const ledger = new URL("../core/ledger.js", import.meta.url).href;
  const script = `
    const { monthStartUtc } = await import(${JSON.stringify(ledger)});
    const out = [
      new Date("2026-10-15T12:00:00Z"),
      new Date("2026-10-31T12:00:00Z"), // already 1 Nov in Kiritimati
      new Date(),
    ].map((d) => monthStartUtc(d).getTime());
    process.stdout.write(JSON.stringify(out));
  `;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, TZ: "Pacific/Kiritimati" },
    encoding: "utf8",
    timeout: 10_000,
  });
  const now = new Date();
  assert.deepEqual(JSON.parse(stdout), [
    Date.UTC(2026, 9, 1),
    Date.UTC(2026, 9, 1),
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ]);
});

test("inWindow: boundary is inclusive, unparseable ts is outside any window", () => {
  const since = new Date("2026-10-01T00:00:00Z");
  assert.equal(inWindow("2026-10-01T00:00:00Z", since), true);
  assert.equal(inWindow("2026-09-30T23:59:59.999Z", since), false);
  assert.equal(inWindow("not a date", since), false);
  assert.equal(inWindow("", since), false);
  // No window means all-time: every row counts, parseable or not.
  assert.equal(inWindow("not a date"), true);
});

test("aggregate: an unparseable ts no longer leaks into every month window", () => {
  const since = new Date("2026-10-01T00:00:00Z");
  const events = [usage("2026-10-02T00:00:00Z", 2), usage("garbage", 5), usage("2026-09-15T00:00:00Z", 7)];
  const month = aggregate(events, since);
  assert.equal(month.usage.central, 2);
  assert.equal(month.usage.calls, 1);
  // ...but it still counts all-time.
  assert.equal(aggregate(events).usage.central, 14);
});

test("spentSince: the money cap counts this month's spend and ignores earlier months", () => {
  const since = new Date("2026-10-01T00:00:00Z");
  const events = [
    contribution("2026-10-01T00:00:00Z", 3),
    contribution("2026-09-30T23:59:59Z", 100),
    usage("2026-10-02T00:00:00Z"),
  ];
  assert.equal(spentSince(events, since), 3);
});

test("spentSince: a contribution with an unparseable ts counts toward this month (fail closed)", () => {
  const since = new Date("2026-10-01T00:00:00Z");
  const events = [contribution("2026-10-05T00:00:00Z", 3), contribution("garbage", 40)];
  assert.equal(spentSince(events, since), 43);
});

test("spentSince: a contribution with a missing or non-numeric cost blocks spending (fail closed)", () => {
  const since = new Date("2026-10-01T00:00:00Z");
  const ok = contribution("2026-10-05T00:00:00Z", 3);
  const bad = (cost: unknown) => ({ ...contribution("2026-10-06T00:00:00Z", 0), cost }) as ContributionEvent;
  // "04" used to string-concatenate to "304"; undefined/null used to give NaN or be ignored.
  for (const cost of [undefined, null, "04", "abc", NaN, Infinity, {}]) {
    assert.equal(spentSince([ok, bad(cost)], since), Infinity, `cost ${JSON.stringify(cost)}`);
  }
  const { cost: _drop, ...noCost } = contribution("2026-10-06T00:00:00Z", 1);
  assert.equal(spentSince([ok, noCost as ContributionEvent], since), Infinity);
});

test("spentSince: a negative cost cannot lower this month's spend", () => {
  const since = new Date("2026-10-01T00:00:00Z");
  assert.equal(spentSince([contribution("2026-10-05T00:00:00Z", 3), contribution("2026-10-06T00:00:00Z", -50)], since), Infinity);
});

test("spentSince: a corrupt cost in an unparseable-ts row also blocks; one in an earlier month does not", () => {
  const since = new Date("2026-10-01T00:00:00Z");
  const bad = { ...contribution("garbage", 0), cost: "x" } as unknown as ContributionEvent;
  assert.equal(spentSince([bad], since), Infinity);
  const old = { ...contribution("2026-09-01T00:00:00Z", 0), cost: "x" } as unknown as ContributionEvent;
  assert.equal(spentSince([contribution("2026-10-05T00:00:00Z", 3), old], since), 3);
});

test("parseTs: zone-less ISO timestamps are UTC, epoch ms pass through, garbage is NaN", () => {
  assert.equal(parseTs("2026-09-30T23:30:00"), Date.UTC(2026, 8, 30, 23, 30));
  assert.equal(parseTs("2026-10-01 00:30:00"), Date.UTC(2026, 9, 1, 0, 30));
  assert.equal(parseTs("2026-10-01T00:30"), Date.UTC(2026, 9, 1, 0, 30));
  assert.equal(parseTs("2026-10-01T00:30:00.250"), Date.UTC(2026, 9, 1, 0, 30, 0, 250));
  assert.equal(parseTs("2026-10-01"), Date.UTC(2026, 9, 1));
  assert.equal(parseTs("2026-10-01T00:30:00+02:00"), Date.UTC(2026, 8, 30, 22, 30));
  assert.equal(parseTs("2026-10-01T00:30:00Z"), Date.UTC(2026, 9, 1, 0, 30));
  assert.equal(parseTs(Date.UTC(2026, 9, 1)), Date.UTC(2026, 9, 1));
  assert.ok(Number.isNaN(parseTs("garbage")));
  assert.ok(Number.isNaN(parseTs("")));
  assert.ok(Number.isNaN(parseTs(NaN)));
  assert.ok(Number.isNaN(parseTs(undefined as unknown as string)));
});

test("inWindow: zone-less and epoch-ms timestamps are cut in UTC", () => {
  const since = new Date("2026-10-01T00:00:00Z");
  assert.equal(inWindow("2026-09-30T23:30:00", since), false);
  assert.equal(inWindow("2026-10-01 00:30:00", since), true);
  assert.equal(inWindow(Date.UTC(2026, 9, 1), since), true);
  assert.equal(inWindow(Date.UTC(2026, 9, 1) - 1, since), false);
});

// Date.parse reads zone-less ISO date-times as host-local, so the checks above
// would pass on a UTC host with the old code. Re-run them under UTC-10 and
// UTC+14, where local parsing moves both rows across the boundary.
for (const TZ of ["Pacific/Honolulu", "Pacific/Kiritimati"]) {
  test(`inWindow: zone-less timestamps are UTC under TZ=${TZ} too`, () => {
    const ledger = new URL("../core/ledger.js", import.meta.url).href;
    const script = `
      const { inWindow } = await import(${JSON.stringify(ledger)});
      const since = new Date("2026-10-01T00:00:00Z");
      process.stdout.write(JSON.stringify([
        inWindow("2026-09-30T23:30:00", since),
        inWindow("2026-10-01 00:30:00", since),
      ]));
    `;
    const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, TZ },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.deepEqual(JSON.parse(stdout), [false, true]);
  });
}
