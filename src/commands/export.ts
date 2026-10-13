import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { formatG } from "../core/factors.js";
import {
  aggregate,
  creditedTonnes,
  methodOf,
  monthStartUtc,
  readLedger,
  type ContributionEvent,
  type LedgerEvent,
} from "../core/ledger.js";
import { findPolicyPath, parsePolicy, type CarbonPolicy } from "../core/policy.js";

// Brand palette (see brand-prompts/00-brand-foundation.md)
export const C = { ink: "#131414", paper: "#F4F0E6", moss: "#2F5D3A", grey: "#71757C" };

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function projectName(cwd: string): string {
  return resolve(cwd).split(/[\\/]/).pop() || "project";
}

/** shields-style static SVG badge — no server needed */
export function badgeSvg(label: string, value: string, accent?: string): string {
  const w = (s: string) => Math.round(6.2 * s.length + 12);
  const lw = w(label), vw = w(value), tw = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">
<title>${esc(label)}: ${esc(value)}</title>
<rect width="${tw}" height="20" rx="3" fill="${C.ink}"/>
<rect x="${lw}" width="${vw}" height="20" rx="3" fill="${accent ?? C.moss}"/>
<rect x="${lw}" width="8" height="20" fill="${accent ?? C.moss}"/>
<g fill="#fff" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="11">
<text x="${lw / 2}" y="14" text-anchor="middle">${esc(label)}</text>
<text x="${lw + vw / 2}" y="14" text-anchor="middle">${esc(value)}</text>
</g></svg>`;
}

function ledgerHtml(opts: {
  name: string;
  policy: CarbonPolicy;
  all: ReturnType<typeof aggregate>;
  month: ReturnType<typeof aggregate>;
  contributions: ContributionEvent[];
  bySource: Map<string, number>;
  targetTonnes: number;
  credited: number;
  met: boolean;
  generatedAt: string;
}): string {
  const { name, policy, all, month, contributions, bySource, targetTonnes, credited, met, generatedAt } =
    opts;
  const pos = policy.policy.contribution_target * 100;

  // If the project is itself carbon(-|.)md, don't render the redundant "carbon-md · carbon.md".
  const redundant = /^carbon[-.]?md$/i.test(name.trim());
  const heading = redundant
    ? `carbon<span class="md">.md</span>`
    : `${esc(name)} <span class="dim" style="font-weight:400">·</span> carbon<span class="md">.md</span>`;
  const titleName = redundant ? "carbon.md" : `${esc(name)} — carbon.md`;

  const modelRows = [...all.byModel.entries()]
    .sort((a, b) => b[1].central - a[1].central)
    .map(
      ([m, v]) =>
        `<tr><td>${esc(m)}</td><td class="n">${formatG(v.central)}</td><td class="n dim">${v.calls}</td></tr>`
    )
    .join("");

  const sourceRows = [...bySource.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([s, g]) => `<tr><td>${esc(s)}</td><td class="n">${formatG(g)}</td></tr>`)
    .join("");

  const contribRows = contributions.length
    ? contributions
        .map(
          (c) =>
            `<tr><td class="dim">${esc(c.ts.slice(0, 10))}</td><td class="n">${c.tonnes} tCO₂e</td><td class="n">${c.cost} ${esc(c.currency)}</td><td>${
              c.credit_class ? esc(c.credit_class) : '<span class="dim">—</span>'
            } <span class="dim">${esc(methodOf(c))}</span></td><td>${esc(c.rail)}</td><td>${
              c.receipt ? `<a href="${esc(c.receipt)}">receipt →</a>` : '<span class="dim">—</span>'
            }</td></tr>`
        )
        .join("")
    : `<tr><td colspan="6" class="dim">No contributions recorded yet.</td></tr>`;

  // Removal and avoidance are different claims — never merge them into one number.
  const byMethod = [...all.contributedByMethod.entries()].sort((a, b) => b[1] - a[1]);
  const methodLine =
    byMethod.length && !(byMethod.length === 1 && byMethod[0][0] === "removal")
      ? `<br><span class="dim">of which ${byMethod
          .map(([m, t]) => `${t.toFixed(4)} ${esc(m)}`)
          .join(" · ")}</span>`
      : "";
  const creditedLine =
    credited < all.contributedTonnes
      ? `<br><span class="dim">Counting toward this <code>${esc(policy.policy.portfolio)}</code> target: <b>${credited.toFixed(4)} tCO₂e</b> — only removal settles it.</span>`
      : "";

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titleName} — ledger</title>
<meta name="description" content="Public carbon ledger for ${esc(name)}: agent emissions estimated and matched by verified carbon credits.">
<style>
:root{--ink:${C.ink};--paper:${C.paper};--moss:${C.moss};--grey:${C.grey}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
  font-family:ui-monospace,"JetBrains Mono","IBM Plex Mono",SFMono-Regular,Menlo,monospace;
  line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:820px;margin:0 auto;padding:48px 24px 80px}
.dashes{color:var(--moss);letter-spacing:.4em;font-size:14px}
h1{font-size:30px;font-weight:600;margin:.2em 0 .1em;letter-spacing:-.01em}
h1 .md{color:var(--moss)}
.tag{color:var(--grey);margin:0 0 2.4em}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:var(--grey);
  border-bottom:1px solid var(--ink);padding-bottom:6px;margin:2.6em 0 1em}
.big{font-size:26px;font-weight:600}
.range{color:var(--grey);font-size:14px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}
@media(max-width:620px){.grid{grid-template-columns:1fr}}
table{width:100%;border-collapse:collapse;font-size:14px}
td{padding:6px 4px;border-bottom:1px solid rgba(19,20,20,.1)}
.n{text-align:right;font-variant-numeric:tabular-nums}
.dim{color:var(--grey)}
a{color:var(--moss)}
.met{color:var(--moss);font-weight:600}
.due{color:#8a5a00;font-weight:600}
.foot{margin-top:3em;padding-top:1.2em;border-top:1px solid var(--ink);color:var(--grey);font-size:12.5px}
.chk{color:var(--moss)}
</style></head>
<body><div class="wrap">
<div class="dashes">— — —</div>
<h1>${heading}</h1>
<p class="tag">measure → govern → contribute → prove</p>

<h2>Emissions estimated</h2>
<div class="grid">
<div><div class="dim">this month</div><div class="big">${formatG(month.usage.central)}</div>
<div class="range">${formatG(month.usage.low)} – ${formatG(month.usage.high)} · ${month.usage.calls} calls</div></div>
<div><div class="dim">all time</div><div class="big">${formatG(all.usage.central)}</div>
<div class="range">${formatG(all.usage.low)} – ${formatG(all.usage.high)} · ${all.usage.calls} calls · ${all.usage.tokens.toLocaleString()} tokens</div></div>
</div>

<h2>Contribution position</h2>
<p>Target: <b>${pos.toFixed(0)}%</b> of estimated emissions → <b>${targetTonnes.toFixed(4)} tCO₂e</b><br>
Contributed: <b>${all.contributedTonnes.toFixed(4)} tCO₂e</b> ·
${met ? '<span class="met">✔ policy target met</span>' : '<span class="due">outstanding</span>'}${methodLine}${creditedLine}</p>
<table><tbody>${contribRows}</tbody></table>

<div class="grid">
<div><h2>By model</h2><table><tbody>${modelRows || '<tr><td class="dim">no usage yet</td></tr>'}</tbody></table></div>
<div><h2>By source</h2><table><tbody>${sourceRows || '<tr><td class="dim">no usage yet</td></tr>'}</tbody></table></div>
</div>

<p class="foot">
Emissions are <b>estimated, not measured</b> — cloud inference is a black box and ranges are wide by design.
Methodology <code>${esc(policy.methodology)}</code>. Policy portfolio: <code>${esc(policy.policy.portfolio)}</code>.
This project does not claim carbon neutrality; it measures its agents' emissions and matches them
<span class="chk">${pos.toFixed(0)}%</span> with verified carbon credits (see each contribution's receipt for the
project retired). Cache-read tokens are recorded but excluded from estimates.<br><br>
Generated ${esc(generatedAt)} by <a href="https://github.com/carbon-md/carbon-md">carbon-md</a> ·
data in <a href="./ledger.json">ledger.json</a> · stewarded by <a href="https://agentic-realism.com">Agentic Realism</a>.
</p>
</div></body></html>`;
}

export async function cmdExport(cwd: string, argv: string[]): Promise<number> {
  const policyPath = findPolicyPath(cwd);
  if (!policyPath) {
    console.error("✖ No carbon.md here. Run `npx carbon-md init` first.");
    return 1;
  }
  const policy = parsePolicy(policyPath);
  const outIdx = argv.indexOf("--out");
  const outDir = resolve(cwd, outIdx >= 0 ? argv[outIdx + 1] ?? "public" : "public");

  const events = readLedger(cwd);
  const monthStart = monthStartUtc();
  const all = aggregate(events);
  const month = aggregate(events, monthStart);

  const contributions = events.filter((e): e is ContributionEvent => e.type === "contribution");
  const bySource = new Map<string, number>();
  for (const e of events) if (e.type === "usage") bySource.set(e.source, (bySource.get(e.source) ?? 0) + e.gco2e.central);

  const targetTonnes = (all.usage.central / 1_000_000) * policy.policy.contribution_target;
  const credited = creditedTonnes(all, policy.policy.portfolio);
  const met = credited >= targetTonnes;
  const name = projectName(cwd);
  const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

  mkdirSync(outDir, { recursive: true });

  writeFileSync(
    join(outDir, "index.html"),
    ledgerHtml({ name, policy, all, month, contributions, bySource, targetTonnes, credited, met, generatedAt }),
    "utf8"
  );

  // Static badge: "carbon.md" | "<contributed> matched ✔" (or "outstanding")
  const badgeVal = met
    ? `${formatG(credited * 1_000_000)} matched ✔`
    : `${formatG(all.usage.central)} tracked`;
  writeFileSync(join(outDir, "badge.svg"), badgeSvg("carbon.md", badgeVal), "utf8");

  // Verifiable data dump
  const summary = {
    project: name,
    generated_at: generatedAt,
    methodology: policy.methodology,
    policy: policy.policy,
    totals: {
      estimated_gco2e: all.usage,
      contributed_tonnes: all.contributedTonnes,
      contributed_tonnes_by_method: Object.fromEntries(all.contributedByMethod),
      credited_tonnes: credited,
      target_tonnes: targetTonnes,
      met,
    },
    contributions,
    events_count: events.length,
  };
  writeFileSync(join(outDir, "ledger.json"), JSON.stringify(summary, null, 2), "utf8");

  console.log(`✔ Exported public ledger to ${outDir}`);
  console.log("  index.html · badge.svg · ledger.json");
  if (!policy.reporting.public_ledger) {
    console.log('  ⚠ policy sets reporting.public_ledger: false — review before publishing this.');
  }
  console.log("\nPublish it:");
  console.log(`  Cloudflare Pages:  wrangler pages deploy ${outIdx >= 0 ? argv[outIdx + 1] : "public"} --project-name carbon-md-ledger`);
  console.log(`  GitHub Pages:      commit the folder and enable Pages`);
  console.log("  Badge in README:   ![carbon.md](https://YOUR-LEDGER-URL/badge.svg)");
  return 0;
}
