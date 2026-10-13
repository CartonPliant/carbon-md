import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregate,
  inWindow,
  monthStartUtc,
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
