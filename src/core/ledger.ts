import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Range } from "./factors.js";

export const LEDGER_DIR = ".carbon-md";
export const LEDGER_FILE = "ledger.jsonl";

export interface UsageEvent {
  type: "usage";
  ts: string;
  source: string;
  provider?: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  gco2e: Range;
  model_class: string;
  factors: string;
  /** extra source-specific data kept for future factor revisions (e.g. cache reads) */
  meta?: Record<string, unknown>;
}

/**
 * How a retired tonne is accounted for. A tonne avoided and a tonne removed are
 * not the same claim, and a `removal-weighted` policy is only meaningful if the
 * ledger can tell them apart. Rows written before this field existed report
 * `unspecified` — never silently counted as removal.
 */
export type CreditMethod = "removal" | "avoidance" | "mixed" | "unspecified";

export interface ContributionEvent {
  type: "contribution";
  ts: string;
  tonnes: number;
  cost: number;
  currency: string;
  rail: string;
  receipt: string;
  /** Credit class as the rail names it, e.g. "Ocean Alkalinity Enhancement". */
  credit_class?: string;
  /** Optional so older ledgers stay readable — see CreditMethod. */
  method?: CreditMethod;
  /** On-chain retirement transaction (Base for the x402 rail). It becomes the
   *  passport anchor that `verify` resolves — without it a retirement can only
   *  ever reach L1. */
  tx_hash?: string;
}

export function methodOf(c: ContributionEvent): CreditMethod {
  return c.method ?? "unspecified";
}

export type LedgerEvent = UsageEvent | ContributionEvent;

export function ledgerPath(cwd: string): string {
  return join(cwd, LEDGER_DIR, LEDGER_FILE);
}

export function ensureLedger(cwd: string): string {
  const dir = join(cwd, LEDGER_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = ledgerPath(cwd);
  if (!existsSync(path)) appendFileSync(path, "");
  return path;
}

export function appendEvents(cwd: string, events: LedgerEvent[]): void {
  ensureLedger(cwd);
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  appendFileSync(ledgerPath(cwd), lines, "utf8");
}

export function readLedger(cwd: string): LedgerEvent[] {
  const path = ledgerPath(cwd);
  if (!existsSync(path)) return [];
  const out: LedgerEvent[] = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // skip corrupt lines rather than dying on the whole ledger
    }
  }
  return out;
}

export interface Totals {
  usage: { low: number; central: number; high: number; calls: number; tokens: number };
  byModel: Map<string, { central: number; calls: number }>;
  contributedTonnes: number;
  contributedCost: Map<string, number>; // currency -> amount
  /** tonnes per accounting method — a removal-weighted policy is only honest
   *  if this is dominated by `removal`. */
  contributedByMethod: Map<CreditMethod, number>;
}

/**
 * Tonnes that actually discharge the policy target.
 *
 * Under `removal-only`, only removal counts: a mixed or unspecified tonne
 * cannot settle a removal obligation, however real the purchase was. Those
 * tonnes stay in the ledger and on the page — they just don't pay this debt.
 * Every other portfolio credits all verified contributions.
 */
export function creditedTonnes(t: Totals, portfolio: string): number {
  if (portfolio !== "removal-only") return t.contributedTonnes;
  return t.contributedByMethod.get("removal") ?? 0;
}

/**
 * Start of the current policy month: the first instant of the UTC calendar month.
 *
 * Ledger timestamps are UTC ISO strings, so the window has to be cut in UTC
 * too. Cutting it at local midnight shifted the boundary by the host's offset:
 * the same ledger reported a different "this month" — and, worse, enforced a
 * different monthly_budget_max — depending on the machine's timezone, and a
 * CI runner and a laptop could disagree about whether a cap was hit.
 */
export function monthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** ISO-like date or date-time with no zone designator ("Z" or "±hh:mm"). */
const ZONELESS_ISO = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?$/;

/**
 * A ledger `ts` as epoch milliseconds, or NaN when it can't be placed in time.
 *
 * Rows we write are UTC ISO strings, but ledgers are hand-edited and imported:
 * - a number is taken as epoch ms, as `new Date(number)` used to;
 * - an ISO-like string without a zone ("2026-09-30T23:30:00",
 *   "2026-10-01 00:30:00") is read as UTC. `Date.parse` reads those as
 *   host-local, which would put the month boundary back on the host's clock;
 * - anything else goes to `Date.parse`.
 */
export function parseTs(ts: string | number): number {
  if (typeof ts === "number") return Number.isFinite(ts) ? ts : NaN;
  if (typeof ts !== "string") return NaN;
  const m = ZONELESS_ISO.exec(ts.trim());
  if (m) return Date.parse(`${m[1]}T${m[2] ?? "00:00"}Z`);
  return Date.parse(ts);
}

/**
 * Whether a ledger row falls in the window starting at `since` (inclusive).
 *
 * With no window every row counts — all-time totals must not lose data. With
 * a window, a row whose `ts` does not parse is *outside* it: `new Date(bad)`
 * is Invalid Date, and `Invalid Date < since` is false, so a naive
 * "skip if before" check used to count such rows in every month at once.
 * We can't say which month a row belongs to, so for reporting it belongs to
 * none. Money is the exception — see spentSince.
 */
export function inWindow(ts: string | number, since?: Date): boolean {
  if (!since) return true;
  const t = parseTs(ts);
  return !Number.isNaN(t) && t >= since.getTime();
}

/**
 * Contribution spend since `since`, as checked against monthly_budget_max.
 *
 * Unlike reporting, a cap must fail closed: a contribution whose `ts` does not
 * parse counts as spent in the current window. Ignoring it could only let a
 * bad row raise the effective cap; counting it can only make the cap
 * stricter, and a human can fix the row.
 *
 * The same goes for `cost`. A missing or non-numeric cost used to turn the sum
 * into NaN (and `NaN > cap` is false) or string-concatenate ("0" + "4" + "03"),
 * and a negative cost lowered the month's spend — each one a way past the cap.
 * Any such row that is (or may be) in the window makes the spend Infinity, so
 * every order stops until a human fixes the row. Sums `cost` across
 * currencies as-is.
 */
export function spentSince(events: LedgerEvent[], since: Date): number {
  let spent = 0;
  for (const e of events) {
    if (e.type !== "contribution") continue;
    if (!inWindow(e.ts, since) && !Number.isNaN(parseTs(e.ts))) continue;
    const cost: unknown = e.cost;
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) return Infinity;
    spent += cost;
  }
  return spent;
}

export function aggregate(events: LedgerEvent[], since?: Date): Totals {
  const t: Totals = {
    usage: { low: 0, central: 0, high: 0, calls: 0, tokens: 0 },
    byModel: new Map(),
    contributedTonnes: 0,
    contributedCost: new Map(),
    contributedByMethod: new Map(),
  };
  for (const e of events) {
    if (!inWindow(e.ts, since)) continue;
    if (e.type === "usage") {
      t.usage.low += e.gco2e.low;
      t.usage.central += e.gco2e.central;
      t.usage.high += e.gco2e.high;
      t.usage.calls += 1;
      t.usage.tokens += e.tokens_in + e.tokens_out;
      const m = t.byModel.get(e.model) ?? { central: 0, calls: 0 };
      m.central += e.gco2e.central;
      m.calls += 1;
      t.byModel.set(e.model, m);
    } else if (e.type === "contribution") {
      t.contributedTonnes += e.tonnes;
      t.contributedCost.set(e.currency, (t.contributedCost.get(e.currency) ?? 0) + e.cost);
      const m = methodOf(e);
      t.contributedByMethod.set(m, (t.contributedByMethod.get(m) ?? 0) + e.tonnes);
    }
  }
  return t;
}
