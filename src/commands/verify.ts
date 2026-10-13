import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BASE_RPC } from "../core/wallet.js";
import { deriveTrustLevel, verifySignature, type Passport, type VerifyResult } from "../core/passport.js";
import {
  CERTIFICATION_ISSUER_DID,
  CERTIFICATION_REGISTRY_URL,
  lookupCertification,
  type CertificationResult,
  type Registry,
} from "../core/registry.js";

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const LEVELS = ["L0", "L1", "L2", "L3"] as const;

/** A passport is a few KB; anything near this is not one. Same cap as the edge. */
export const MAX_PASSPORT_BYTES = 1024 * 1024;

/** Read a response body as text, refusing to buffer more than `max` bytes. */
async function readCapped(res: Response, max: number): Promise<string> {
  const tooBig = () => new Error(`the passport is larger than ${max / (1024 * 1024)} MB — refusing to read it`);
  if (Number(res.headers.get("content-length")) > max) throw tooBig();
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw tooBig();
    }
    chunks.push(value);
  }
  // TextDecoder drops a leading UTF-8 BOM (as res.json() did); Buffer#toString keeps it
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Fetch a passport document from a URL, with the same guards as the edge
 * `fetchPassport` (docs-site/functions/_lib/passport.js), so the CLI and the
 * hosted API fail the same way on the same bad URL.
 */
export async function fetchPassport(url: string, { timeoutMs = 8000 } = {}): Promise<Passport> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching the passport`);
    const body = await readCapped(res, MAX_PASSPORT_BYTES);
    try {
      return JSON.parse(body) as Passport;
    } catch {
      // Single-page sites answer 200 with index.html for any unknown path, so a
      // typo in the URL arrives here looking like a document. Say so plainly.
      const ct = res.headers.get("content-type") || "unknown";
      const looksHtml = body.trimStart().startsWith("<") || /text\/html/i.test(ct);
      throw new Error(
        looksHtml
          ? "the URL returned HTML, not a passport — check the path (many sites answer 200 with their index page for unknown paths)"
          : `the URL did not return JSON (content-type: ${ct})`
      );
    }
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new Error(`timed out after ${timeoutMs / 1000}s fetching the passport`);
    }
    throw e;
  }
}

async function load(target: string): Promise<Passport> {
  if (/^https?:\/\//.test(target)) return fetchPassport(target);
  const p = resolve(target);
  if (!existsSync(p)) throw new Error(`no such file: ${p}`);
  // Strip a leading UTF-8 BOM, as the URL branch does (editors and PowerShell add one)
  return JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
}

/** Several endpoints, so one refusing us never becomes a claim about a retirement. */
const BASE_RPCS = [BASE_RPC, "https://base-rpc.publicnode.com", "https://base.llamarpc.com"];

type Answer =
  | { state: "found"; receipt: any }
  | { state: "absent" }
  | { state: "unknown"; why: string };

/**
 * Ask one endpoint about one transaction.
 *
 * A JSON-RPC error body carries no `result` either, so treating a missing
 * result as "not found" would report a rate-limit as proof that a retirement
 * never happened — an accusation produced by a transport failure. Anything
 * that is not a clear answer is "unknown".
 */
async function receiptFrom(rpc: string, hash: string, timeoutMs: number): Promise<Answer> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return { state: "unknown", why: `HTTP ${res.status}` };
    const body: any = await res.json();
    if (body?.error) return { state: "unknown", why: `RPC error ${body.error.message ?? body.error.code}` };
    if (!body || !("result" in body)) return { state: "unknown", why: "malformed RPC response" };
    if (body.result === null) return { state: "absent" };
    return { state: "found", receipt: body.result };
  } catch (e: any) {
    return { state: "unknown", why: e?.name === "AbortError" ? "timeout" : e?.message ?? String(e) };
  }
}

/** Confirm each anchor's transaction actually exists on Base. */
async function resolveAnchors(p: Passport, timeoutMs = 8000): Promise<{ resolved: boolean; notes: string[] }> {
  const notes: string[] = [];
  const hashes = (p.contribution.anchors ?? []).map((a) => a.tx_hash).filter(Boolean) as string[];
  if (!hashes.length) return { resolved: false, notes: ["anchors carry no transaction hash"] };

  for (const hash of hashes) {
    let answer: Answer | null = null;
    const whys: string[] = [];
    for (const rpc of BASE_RPCS) {
      const r = await receiptFrom(rpc, hash, timeoutMs);
      if (r.state === "unknown") { whys.push(r.why); continue; }
      answer = r;
      break;
    }
    if (!answer) {
      notes.push(`could not reach the chain (${whys.join("; ")}) — anchors unconfirmed, not disproved`);
      return { resolved: false, notes };
    }
    if (answer.state === "absent") {
      notes.push(`${hash.slice(0, 10)}… not found on chain`);
      return { resolved: false, notes };
    }
    if (answer.receipt.status && answer.receipt.status !== "0x1") {
      notes.push(`${hash.slice(0, 10)}… reverted on chain`);
      return { resolved: false, notes };
    }
  }
  return { resolved: true, notes };
}

/**
 * Look the subject up in the signed certification registry.
 *
 * The URL and issuer are pinned, never taken from the passport: a document
 * that could name its own certifier would be certifying itself. Any failure
 * here yields "unchecked", which caps the result at L2 — an unreachable
 * registry must never read as an absent certification, nor grant one.
 */
async function checkCertification(
  subject: string,
  url: string,
  issuer: string,
  timeoutMs = 8000
): Promise<CertificationResult> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    clearTimeout(t);
    if (!res.ok) return { status: "unchecked", warnings: [`certification registry unreachable (HTTP ${res.status})`] };
    const registry = (await res.json()) as Registry;
    return lookupCertification(registry, subject, { expectedIssuer: issuer });
  } catch (e: any) {
    const why = e?.name === "AbortError" ? "timeout" : e?.message ?? String(e);
    return { status: "unchecked", warnings: [`certification registry unreachable (${why})`] };
  }
}

export async function cmdVerify(cwd: string, argv: string[]): Promise<number> {
  const target = argv.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error("Usage: carbon-md verify <passport.json | https://…/passport.json> [--offline] [--min L0|L1|L2|L3] [--json] [--registry <url>]");
    return 2;
  }
  const offline = argv.includes("--offline");
  const asJson = argv.includes("--json");
  const minIdx = argv.indexOf("--min");
  const min = (minIdx >= 0 ? argv[minIdx + 1] : "L1") as (typeof LEVELS)[number];

  let p: Passport;
  try {
    p = await load(target);
  } catch (e: any) {
    console.error(`✖ ${e.message}`);
    return 2;
  }
  // Valid JSON is not yet a passport (`null`, an error object, someone's API).
  if (!p || typeof p !== "object" || !p.carbon_passport) {
    console.error("✖ not a carbon.md passport document");
    return 2;
  }

  const sig = verifySignature(p);
  const stale = new Date(p.expires_at).getTime() < Date.now();

  let anchorsResolved = false;
  let notes: string[] = [];
  if (!offline && sig.valid) {
    const r = await resolveAnchors(p);
    anchorsResolved = r.resolved;
    notes = r.notes;
  } else if (offline) {
    notes.push("offline: anchors not checked against the chain");
  }


  const registryUrl = argv.includes("--registry") ? argv[argv.indexOf("--registry") + 1] : CERTIFICATION_REGISTRY_URL;
  const registryIssuer = argv.includes("--registry-issuer")
    ? argv[argv.indexOf("--registry-issuer") + 1]
    : CERTIFICATION_ISSUER_DID;
  if (registryUrl !== CERTIFICATION_REGISTRY_URL || registryIssuer !== CERTIFICATION_ISSUER_DID) {
    notes.push("certification checked against a non-canonical registry — this is not a carbon.md certification");
  }

  let certification: CertificationResult = {
    status: "unchecked",
    warnings: offline ? ["offline: certification not checked — L3 needs the registry"] : [],
  };
  if (!offline && sig.valid) {
    certification = await checkCertification(p.subject?.id ?? "", registryUrl, registryIssuer);
  }

  const derived = deriveTrustLevel(p, { signatureValid: sig.valid, anchorsResolved, certification });
  const warnings = [...derived.warnings, ...notes];
  if (stale) warnings.push(`expired on ${p.expires_at.slice(0, 10)} — re-issue with \`carbon-md passport\``);

  const result: VerifyResult = {
    subject: p.subject?.id ?? "unknown",
    verdict: !sig.valid ? "invalid" : stale ? "stale" : "verified",
    trust_level: derived.level,
    signature_valid: sig.valid,
    policy_target_met: derived.policyMet,
    removal_ok: derived.removalOk,
    anchors: p.contribution?.anchors?.length ?? 0,
    anchors_resolved: offline ? "offline" : anchorsResolved ? "resolved" : "none",
    certification: {
      status: certification.status,
      tier: certification.tier,
      valid_until: certification.valid_until,
      certificate_url: certification.certificate_url,
      revoked_at: certification.revoked_at,
      reason: certification.reason,
    },
    warnings,
    verified_at: new Date().toISOString(),
  };

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const badge =
      result.verdict === "invalid" ? red("✖ INVALID") : result.verdict === "stale" ? yellow("⚠ STALE") : green("✔ VERIFIED");
    console.log(`\n${bold("carbon.md passport")} — ${badge} ${bold(derived.level)}`);
    console.log(`  subject     ${p.subject?.name ?? "?"} ${dim(result.subject)}`);
    console.log(`  signature   ${sig.valid ? green("valid") : red(sig.reason ?? "invalid")}`);
    console.log(`  methodology ${p.methodology}`);
    console.log(`  emissions   ${p.estimated_gco2e?.central} gCO2e ${dim(`(${p.estimated_gco2e?.low} – ${p.estimated_gco2e?.high})`)}`);
    console.log(
      `  contribution ${p.contribution?.credited_tonnes} / ${p.contribution?.target_tonnes} tCO2e credited ${
        derived.policyMet ? green("· target met") : yellow("· outstanding")
      }`
    );
    console.log(`  anchors     ${result.anchors} ${dim(`(${result.anchors_resolved})`)}`);
    const certLine =
      certification.status === "active"
        ? green(`certified · ${certification.tier}${certification.valid_until ? ` · until ${certification.valid_until.slice(0, 10)}` : ""}`)
        : certification.status === "revoked"
          ? red("revoked")
          : dim(certification.status);
    console.log(`  certification ${certLine}`);
    if (p.trust_level && p.trust_level !== derived.level) {
      console.log(yellow(`  ⚠ document claims ${p.trust_level}; evidence supports ${derived.level}`));
    }
    for (const w of warnings) console.log(dim(`  · ${w}`));
    console.log("");
  }

  const meets = LEVELS.indexOf(derived.level) >= LEVELS.indexOf(min);
  return sig.valid && meets && !stale ? 0 : 1;
}
