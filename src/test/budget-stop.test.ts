import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { budgetStop, monthlyBudgetStop } from "../commands/contribute.js";
import { readLedger, type LedgerEvent } from "../core/ledger.js";

test("budgetStop: a corrupt contribution row (spent not finite) blocks with its own message", () => {
  const budget = { amount: 25, currency: "USD" };
  assert.equal(budgetStop(3, 5, budget), null);
  const over = budgetStop(20, 10, budget);
  assert.ok(over && /exceeds monthly_budget_max/.test(over.join("\n")));
  const corrupt = budgetStop(Infinity, 1, budget);
  assert.ok(corrupt);
  const text = corrupt.join("\n");
  assert.match(text, /POLICY STOP/);
  assert.match(text, /corrupt contribution/i);
  assert.doesNotMatch(text, /Infinity/);
});

const contribution = (ts: string, cost: unknown): LedgerEvent =>
  ({
    type: "contribution",
    ts,
    tonnes: 0.001,
    cost,
    currency: "USD",
    rail: "x402:klima",
    receipt: "https://example.test/receipt",
  }) as LedgerEvent;

// Away from the real clock, so a helper that ignores `now` is caught too.
const NOW = new Date("2026-03-15T12:00:00Z");
const BUDGET = { amount: 25, currency: "USD" };

test("monthlyBudgetStop: counts this UTC month's spend from the ledger, not last month's", () => {
  const events = [
    contribution("2026-03-01T00:00:00Z", 20), // this month
    contribution("2026-02-28T23:59:59Z", 100), // last month
  ];
  assert.equal(monthlyBudgetStop(events, 3, BUDGET, NOW), null);
  const stop = monthlyBudgetStop(events, 10, BUDGET, NOW);
  assert.ok(stop);
  assert.match(stop.join("\n"), /spent this month \(20\.00\)/);
});

test("monthlyBudgetStop: a corrupt cost blocks in this month, not in a past one", () => {
  const past = [contribution("2026-02-10T00:00:00Z", -5)];
  assert.equal(monthlyBudgetStop(past, 1, BUDGET, NOW), null);
  const current = [contribution("2026-03-10T00:00:00Z", "12")];
  const stop = monthlyBudgetStop(current, 1, BUDGET, NOW);
  assert.ok(stop);
  assert.match(stop.join("\n"), /corrupt contribution/i);
});

const CLI = fileURLToPath(new URL("../index.js", import.meta.url));
const POLICY = `---
carbon_md: "0.1"
policy:
  contribution_target: 0
  portfolio: removal-weighted
  monthly_budget_max: { amount: 25, currency: USD }
  approval_above: { amount: 10, currency: USD }
reporting:
  mode: local
  public_ledger: true
methodology: test
---
`;

test("contribute --record refuses a negative --cost and writes nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "carbon-md-record-"));
  try {
    writeFileSync(join(dir, "carbon.md"), POLICY, "utf8");
    const r = spawnSync(
      process.execPath,
      [CLI, "contribute", "--record", "--tonnes", "0.01", "--cost", "-5"],
      { cwd: dir, env: { ...process.env, NO_COLOR: "1" }, encoding: "utf8", timeout: 20_000 }
    );
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /Usage: carbon-md contribute --record/);
    assert.deepEqual(readLedger(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
