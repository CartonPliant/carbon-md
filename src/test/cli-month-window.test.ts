import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvents, type UsageEvent } from "../core/ledger.js";

// Wiring checks: ledger.ts unit tests can't see a command that cuts its own
// window at local midnight. Run the built CLI under UTC+14, where the local
// month starts 14h before the UTC one, with a row 1h before the UTC month
// start — inside the local month, outside the policy month.
const CLI = fileURLToPath(new URL("../index.js", import.meta.url));
const TZ = "Pacific/Kiritimati";

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

const usage = (ts: string, central: number): UsageEvent => ({
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

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "carbon-md-tz-"));
  writeFileSync(join(dir, "carbon.md"), POLICY, "utf8");
  // Computed here, not via monthStartUtc(), so a regression there cannot move the fixture too.
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  appendEvents(dir, [
    usage(new Date(start).toISOString(), 2),
    usage(new Date(start - 60 * 60 * 1000).toISOString(), 7),
  ]);
  return dir;
}

const run = (dir: string, args: string[]) =>
  execFileSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    env: { ...process.env, TZ, NO_COLOR: "1" },
    encoding: "utf8",
    timeout: 20_000,
  }).replace(/\x1b\[[0-9;]*m/g, "");

test("status: 'This month' is the UTC month even under TZ=Pacific/Kiritimati", () => {
  const dir = project();
  try {
    // --offline and a zero target: no network, nothing outstanding, cannot hang.
    const out = run(dir, ["status", "--offline"]);
    const line = out.split("\n").find((l) => l.startsWith("This month"));
    assert.ok(line, out);
    assert.match(line, /2\.0 gCO2e/);
    assert.match(line, /· 1 calls/);
    assert.match(out.split("\n").find((l) => l.startsWith("All time"))!, /9\.0 gCO2e/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("export: the page's 'this month' is the UTC month even under TZ=Pacific/Kiritimati", () => {
  const dir = project();
  try {
    run(dir, ["export", "--out", "public"]);
    const html = readFileSync(join(dir, "public", "index.html"), "utf8");
    const m = html.match(/this month<\/div><div class="big">([^<]*)<\/div>\s*<div class="range">[^<]*· (\d+) calls/);
    assert.ok(m, "this-month block not found in index.html");
    assert.equal(m[1], "2.0 gCO2e");
    assert.equal(m[2], "1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
