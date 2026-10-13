import * as readline from "node:readline/promises";
import { PORTFOLIO_PRICES } from "../core/factors.js";
import {
  aggregate,
  appendEvents,
  creditedTonnes,
  monthStartUtc,
  readLedger,
  spentSince,
  type ContributionEvent,
  type CreditMethod,
  type LedgerEvent,
} from "../core/ledger.js";
import { findPolicyPath, parsePolicy, type CarbonPolicy } from "../core/policy.js";
import { accountFor, loadWallet, usdcBalance } from "../core/wallet.js";
import {
  certificate,
  classifyMethod,
  quote as x402quote,
  removalClasses,
  resolveClass,
  retire,
} from "../rails/x402.js";

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

/**
 * The monthly_budget_max gate, as the lines to print when it stops an order
 * (null when the order fits).
 *
 * spentSince() returns Infinity when a contribution row in this month has a
 * missing, non-numeric or negative cost. That has to stop the order — and say
 * why: "spent this month (Infinity)" would read like a bug, not like a ledger
 * row a human has to fix.
 */
export function budgetStop(
  spent: number,
  total: number,
  budget: { amount: number; currency: string }
): string[] | null {
  if (!Number.isFinite(spent)) {
    return [
      `\n✖ POLICY STOP: a corrupt contribution row in .carbon-md/ledger.jsonl (missing, non-numeric or negative cost) blocks spending until it is fixed.`,
      "  monthly_budget_max can't be checked against a spend it can't add up. Fix or remove the row, then retry.",
    ];
  }
  if (spent + total > budget.amount) {
    return [
      `\n✖ POLICY STOP: this order (${total.toFixed(2)}) + spent this month (${spent.toFixed(2)}) exceeds monthly_budget_max (${budget.amount} ${budget.currency}).`,
      "  Raise the cap in carbon.md (a human decision, in the file) or reduce the amount.",
    ];
  }
  return null;
}

/**
 * The monthly_budget_max gate as executeX402 runs it: this UTC month's spend
 * from the ledger, plus this order, against the cap. `now` is injectable so
 * the window can be tested away from the real clock.
 */
export function monthlyBudgetStop(
  events: LedgerEvent[],
  total: number,
  budget: { amount: number; currency: string },
  now: Date = new Date()
): string[] | null {
  // UTC calendar month; unparseable timestamps count as spent and a corrupt
  // cost blocks the order (fail closed).
  return budgetStop(spentSince(events, monthStartUtc(now)), total, budget);
}

function getFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/**
 * Flows:
 *   carbon-md contribute
 *       → outstanding tonnes + order summary (read-only).
 *   carbon-md contribute --record --tonnes … --cost … [--rail …] [--receipt …]
 *       → record an externally-executed retirement.
 *   carbon-md contribute --execute [--rail x402] [--class oae] [--tonnes …]
 *                        [--beneficiary "name"] [--beneficiary-address 0x…] [--message "…"]
 *       → v0.2: execute a retirement through the Klima x402 relay, policy-checked:
 *         hard stop at monthly_budget_max, typed confirmation above approval_above.
 *         Retirements are IRREVERSIBLE — the human confirms in the loop.
 */
export async function cmdContribute(cwd: string, argv: string[]): Promise<number> {
  const policyPath = findPolicyPath(cwd);
  if (!policyPath) {
    console.error("✖ No carbon.md here. Run `npx carbon-md init` first.");
    return 1;
  }
  const policy = parsePolicy(policyPath);

  if (argv.includes("--execute")) {
    return executeX402(cwd, argv, policy);
  }

  if (argv.includes("--record")) {
    const tonnes = parseFloat(getFlag(argv, "--tonnes") ?? "");
    const cost = parseFloat(getFlag(argv, "--cost") ?? "");
    const rail = getFlag(argv, "--rail") ?? "manual";
    const receipt = getFlag(argv, "--receipt") ?? "";
    const creditClass = getFlag(argv, "--class");
    const methodArg = getFlag(argv, "--method");
    const usage =
      "Usage: carbon-md contribute --record --tonnes <t> --cost <amount> [--rail cnaught|carbonmark|manual]\n" +
      "                            [--receipt <url>] [--class \"<credit class>\"] [--method removal|avoidance|mixed]";
    // A negative cost would be read back as a corrupt row and block every --execute.
    if (!Number.isFinite(tonnes) || tonnes <= 0 || !Number.isFinite(cost) || cost < 0) {
      console.error(usage);
      return 1;
    }
    const allowed: CreditMethod[] = ["removal", "avoidance", "mixed"];
    if (methodArg && !allowed.includes(methodArg as CreditMethod)) {
      console.error(`✖ --method must be one of: ${allowed.join(" | ")}\n${usage}`);
      return 1;
    }
    appendEvents(cwd, [
      {
        type: "contribution",
        ts: new Date().toISOString(),
        tonnes,
        cost,
        currency: policy.policy.monthly_budget_max.currency,
        rail,
        receipt,
        ...(creditClass ? { credit_class: creditClass } : {}),
        ...(methodArg ? { method: methodArg as CreditMethod } : {}),
      },
    ]);
    console.log(`✔ Recorded contribution: ${tonnes} tCO2e · ${cost} ${policy.policy.monthly_budget_max.currency} via ${rail}`);
    if (!receipt) console.log(dim("  tip: add --receipt <url> so the ledger stays provable."));
    if (!methodArg) {
      console.log(
        dim("  tip: add --method removal|avoidance so this tonne isn't filed as unspecified.")
      );
    } else if (methodArg !== "removal" && policy.policy.portfolio === "removal-only") {
      // Recording what actually happened is always allowed — hiding it is not.
      console.log(
        yellow(`  ⚠ filed as ${methodArg} under a removal-only policy: it is reported separately and never counts as removal.`)
      );
    }
    return 0;
  }

  const all = aggregate(readLedger(cwd));
  const targetTonnes = (all.usage.central / 1_000_000) * policy.policy.contribution_target;
  const outstanding = Math.max(0, targetTonnes - creditedTonnes(all, policy.policy.portfolio));

  console.log("");
  console.log(bold("Contribution order — summary"));
  if (outstanding <= 0) {
    console.log("✔ Nothing outstanding. Your policy target is currently met.\n");
    return 0;
  }

  const prices = PORTFOLIO_PRICES[policy.policy.portfolio];
  console.log(`  outstanding   ${outstanding.toFixed(4)} tCO2e (${(policy.policy.contribution_target * 100).toFixed(0)}% of central estimate)`);
  console.log(`  portfolio     ${policy.policy.portfolio}`);
  let worstCase = NaN;
  if (prices) {
    worstCase = outstanding * prices.high;
    console.log(
      `  est. cost     $${(outstanding * prices.low).toFixed(2)} – $${worstCase.toFixed(2)} ` +
        dim(`(planning band, ~$${(outstanding * prices.central).toFixed(2)} mid — the live quote decides)`)
    );
  } else {
    console.log(`  est. cost     ${dim("custom portfolio — set your own price basis")}`);
  }

  // Warn off the top of the band, not the middle: durable removal spans
  // ~$20/t to ~$1,400/t, so a mid-price check would silently under-warn.
  const approval = policy.policy.approval_above;
  const budget = policy.policy.monthly_budget_max;
  if (Number.isFinite(worstCase) && worstCase > budget.amount) {
    console.log(yellow(`  ⚠ could exceed monthly_budget_max (${budget.amount} ${budget.currency}) — --execute hard-stops and you carry the rest forward`));
  } else if (Number.isFinite(worstCase) && worstCase > approval.amount) {
    console.log(yellow(`  ⚠ could land above approval_above (${approval.amount} ${approval.currency}) — typed confirmation required at execution`));
  } else {
    console.log(dim(`  under approval_above (${approval.amount} ${approval.currency}) across the whole band`));
  }

  console.log("");
  console.log(bold("Execute:"));
  console.log(
    `  ${green("carbon-md contribute --execute --class oae")}  ${dim("— retire via Klima x402 relay (policy-checked, confirm-first)")}`
  );
  console.log(dim("  or retire externally, then: carbon-md contribute --record --tonnes … --cost … --receipt <url>"));
  console.log("");
  return 0;
}

/** The ledger row for a retirement executed on the x402 rail. Keeps the
 *  transaction hash: it is what the passport anchors and `verify` resolves. */
export function retirementEvent(r: {
  tonnes: number;
  cost: number;
  certificateUrls: string[];
  txHash?: string;
  creditClass: string;
  method: CreditMethod;
  ts?: string;
}): ContributionEvent {
  return {
    type: "contribution",
    ts: r.ts ?? new Date().toISOString(),
    tonnes: r.tonnes,
    cost: r.cost,
    currency: "USDC",
    rail: "x402-klima",
    receipt: r.certificateUrls[0] ?? (r.txHash ? `https://basescan.org/tx/${r.txHash}` : ""),
    credit_class: r.creditClass,
    method: r.method,
    ...(r.txHash ? { tx_hash: r.txHash } : {}),
  };
}

async function executeX402(cwd: string, argv: string[], policy: CarbonPolicy): Promise<number> {
  const wallet = loadWallet(cwd);
  if (!wallet) {
    console.error("✖ No agent wallet. Create one with `carbon-md wallet init`, fund it with USDC on Base.");
    return 1;
  }

  const events = readLedger(cwd);
  const all = aggregate(events);
  const targetTonnes = (all.usage.central / 1_000_000) * policy.policy.contribution_target;
  const outstanding = Math.max(0, targetTonnes - creditedTonnes(all, policy.policy.portfolio));

  const tonnesArg = getFlag(argv, "--tonnes");
  const tonnes = tonnesArg ?? Math.max(0.001, Math.ceil(outstanding * 1000) / 1000).toFixed(3);
  const classArg = getFlag(argv, "--class") ?? "oae";
  const beneficiary = getFlag(argv, "--beneficiary") ?? "carbon.md - Agentic Realism";
  const beneficiaryAddress = getFlag(argv, "--beneficiary-address");
  const message =
    getFlag(argv, "--message") ??
    "Emissions matched under a carbon.md policy - github.com/carbon-md/carbon-md";

  console.log(dim("\nresolving carbon class + live quote (read-only)…"));
  const cls = await resolveClass(classArg);
  const method = classifyMethod(cls);

  // Refused before the quote: under removal-only there is no price at which an
  // avoidance credit becomes acceptable, so don't even ask for one.
  if (policy.policy.portfolio === "removal-only" && method !== "removal") {
    console.error(`\n✖ POLICY STOP: ${cls.name} is ${method}; carbon.md declares portfolio: removal-only.`);
    console.error("  Nothing quoted, nothing signed. Removal classes available on this rail:");
    for (const c of await removalClasses()) {
      const price = c.priceUsdcPerTonneFormatted ? ` — ${c.priceUsdcPerTonneFormatted} USDC/t` : "";
      console.error(`    --class "${c.name}"${price}`);
    }
    return 1;
  }

  const q = await x402quote(cls.carbonClassId, tonnes);
  const total = parseFloat(q.totalFormatted);

  // Policy enforcement — the whole point of the file.
  const budget = policy.policy.monthly_budget_max;
  const approval = policy.policy.approval_above;

  console.log(`\n${bold("Retirement order — Klima x402 relay (Base)")}`);
  console.log(`  class        ${cls.name} ${dim("(" + method + ")")}`);
  console.log(`  amount       ${q.tonnesFormatted} tCO₂e`);
  console.log(`  quote        ${q.humanSummary}`);
  console.log(`  beneficiary  ${beneficiary}${beneficiaryAddress ? dim(" · " + beneficiaryAddress) : ""}`);
  console.log(`  message      ${dim(message)}`);
  console.log(`  wallet       ${wallet.address}`);

  // Before anything else can fail: say what this tonne will actually claim.
  // A cheap avoidance credit under a removal-weighted policy is the exact
  // mistake this ledger now refuses to hide.
  if (policy.policy.portfolio === "removal-weighted" && method !== "removal") {
    console.log("");
    console.log(yellow(`⚠ ${cls.name} is ${method}, but carbon.md declares portfolio: removal-weighted.`));
    console.log(yellow(`  It will be filed as ${method} and cannot be presented as removal.`));
  }

  // Policy before funds: what the file forbids is worth knowing before, not
  // after, you top the wallet up for an order it was never going to allow.
  const stop = monthlyBudgetStop(events, total, budget);
  if (stop) {
    for (const l of stop) console.error(l);
    return 1;
  }

  try {
    const bal = await usdcBalance(wallet.address as `0x${string}`);
    const suggested = parseFloat(q.suggestedMaxInputFormatted);
    console.log(`  balance      ${bal.formatted} USDC`);
    if (parseFloat(bal.formatted) < suggested) {
      console.error(
        `\n✖ Insufficient USDC: need ~${q.suggestedMaxInputFormatted} (incl. slippage buffer), have ${bal.formatted}.`
      );
      return 1;
    }
  } catch {
    console.log(dim("  balance      (unavailable — proceeding on quote only)"));
  }

  const needsApproval = total > approval.amount;
  console.log("");
  if (needsApproval) {
    console.log(yellow(`⚠ ${total.toFixed(2)} USDC is above approval_above (${approval.amount} ${approval.currency}) — human confirmation required.`));
  }
  console.log(yellow("⚠ Retirement is IRREVERSIBLE — the credit is permanently burned."));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`Type ${bold("retire")} to execute, anything else to abort: `)).trim();
  rl.close();
  if (answer !== "retire") {
    console.log("Aborted — nothing signed, nothing spent.");
    return 1;
  }

  console.log(dim("\nprepare-auth → signing USDC authorization → relay…"));
  const result = await retire(accountFor(wallet), cls.carbonClassId, tonnes, {
    beneficiaryString: beneficiary,
    beneficiaryAddress,
    retirementMessage: message,
  });

  let urls = result.certificateUrls;
  if (!urls.length && result.txHash) {
    for (let i = 0; i < 6 && !urls.length; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        urls = await certificate(result.txHash);
      } catch {
        /* subgraph indexing lag — keep polling */
      }
    }
  }

  appendEvents(cwd, [
    retirementEvent({
      tonnes: parseFloat(q.tonnesFormatted),
      cost: total,
      certificateUrls: urls,
      txHash: result.txHash,
      creditClass: cls.name,
      method,
    }),
  ]);

  console.log(`\n${green("✔ Retired " + q.tonnesFormatted + " tCO₂e")} (${result.status})`);
  if (result.txHash) console.log(`  tx           https://basescan.org/tx/${result.txHash}`);
  if (urls.length) console.log(`  certificate  ${bold(urls[0])}`);
  else console.log(dim("  certificate  still indexing — run: carbon-md contribute --certificate " + (result.txHash ?? "")));
  console.log(dim("  recorded in the ledger — regenerate the public page with `carbon-md export`\n"));
  return 0;
}
