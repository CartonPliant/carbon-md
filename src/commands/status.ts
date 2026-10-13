import { formatG, PORTFOLIO_PRICES } from "../core/factors.js";
import { aggregate, creditedTonnes, monthStartUtc, readLedger } from "../core/ledger.js";
import { findPolicyPath, parsePolicy } from "../core/policy.js";
import { DEFAULT_CLASS, MIN_TONNES, priceFor } from "../rails/x402.js";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

export async function cmdStatus(cwd: string, argv: string[] = []): Promise<number> {
  const policyPath = findPolicyPath(cwd);
  if (!policyPath) {
    console.error("✖ No carbon.md here. Run `npx carbon-md init` first.");
    return 1;
  }
  const policy = parsePolicy(policyPath);
  const events = readLedger(cwd);

  // UTC calendar month, matching the UTC timestamps in the ledger.
  const monthStart = monthStartUtc();

  const all = aggregate(events);
  const month = aggregate(events, monthStart);

  console.log("");
  console.log(bold("carbon.md status"));
  console.log(dim(`policy: ${policyPath} · methodology: ${policy.methodology}`));
  console.log("");

  const line = (label: string, t: typeof all) => {
    console.log(
      `${label.padEnd(12)} ${bold(formatG(t.usage.central))} ` +
        dim(`(range ${formatG(t.usage.low)} – ${formatG(t.usage.high)})`) +
        dim(` · ${t.usage.calls} calls · ${t.usage.tokens.toLocaleString()} tokens`)
    );
  };
  line("This month", month);
  line("All time", all);

  if (all.byModel.size) {
    console.log("");
    console.log(dim("By model (central estimate):"));
    const sorted = [...all.byModel.entries()].sort((a, b) => b[1].central - a[1].central);
    for (const [model, m] of sorted.slice(0, 6)) {
      console.log(`  ${model.padEnd(36)} ${formatG(m.central).padStart(12)} ${dim(`${m.calls} calls`)}`);
    }
  }

  // Contribution position (all-time)
  const targetTonnes = (all.usage.central / 1_000_000) * policy.policy.contribution_target;
  const credited = creditedTonnes(all, policy.policy.portfolio);
  const outstanding = Math.max(0, targetTonnes - credited);
  const prices = PORTFOLIO_PRICES[policy.policy.portfolio] ?? null;

  console.log("");
  console.log(bold("Contribution position"));
  console.log(
    `  target      ${(policy.policy.contribution_target * 100).toFixed(0)}% of estimated emissions → ${targetTonnes.toFixed(4)} tCO2e`
  );
  console.log(`  contributed ${all.contributedTonnes.toFixed(4)} tCO2e`);

  // Only silent when every tonne is removal — any other mix has to be visible,
  // or "removal-weighted" is just a word in a file.
  const byMethod = [...all.contributedByMethod.entries()].sort((a, b) => b[1] - a[1]);
  if (byMethod.length && !(byMethod.length === 1 && byMethod[0][0] === "removal")) {
    console.log(
      dim(`              ${byMethod.map(([m, t]) => `${t.toFixed(4)} ${m}`).join(" · ")}`)
    );
  }
  if (credited < all.contributedTonnes) {
    console.log(
      dim(`  credited    ${credited.toFixed(4)} tCO2e — only removal settles a ${policy.policy.portfolio} target`)
    );
  }
  if (outstanding > 0) {
    console.log(yellow(`  outstanding ${outstanding.toFixed(4)} tCO2e`));

    // What it actually costs beats what a price table guesses — durable removal
    // spans ~$20/t to ~$1,400/t, so the constants can only ever give a band.
    // Read-only call, no wallet, no signature; falls back when there's no network.
    const offline = argv.includes("--offline");
    let priced = false;
    if (!offline) {
      try {
        const p = await priceFor(DEFAULT_CLASS, outstanding);
        console.log(
          `  cost        ${bold("$" + p.totalUsdc.toFixed(2))} ` +
            dim(`live · ${p.className} · $${Math.round(p.usdcPerTonne).toLocaleString()}/t via Klima x402`)
        );
        if (p.tonnes > outstanding) {
          const reason =
            outstanding < MIN_TONNES
              ? `the rail can't retire below ${MIN_TONNES} t`
              : "retirements are priced in whole kilos";
          console.log(dim(`              quoted at ${p.tonnes} t — ${reason}`));
        }
        priced = true;
      } catch {
        /* no network, timeout, or the rail is down — the band still informs */
      }
    }
    if (!priced && prices) {
      console.log(
        `  cost        ${dim(`$${(outstanding * prices.low).toFixed(2)}–$${(outstanding * prices.high).toFixed(2)} planning band, ${policy.policy.portfolio} prices`)}`
      );
      console.log(dim(`              ${offline ? "--offline" : "no live quote"} — a real quote will land inside this band, not at its middle`));
    }
    console.log(dim("  → run `npx carbon-md contribute` to prepare the order"));
  } else {
    console.log(green(`  ✔ policy target met — nothing outstanding`));
  }
  console.log("");
  console.log(dim("Estimates, not measurements — ranges are wide by design."));
  console.log("");
  return 0;
}
