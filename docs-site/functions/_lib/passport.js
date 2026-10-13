/**
 * Passport verification, in the edge runtime.
 *
 * A port of core/passport.ts + core/keys.ts. Kept dependency-free and in
 * sync by hand: the rules that decide a trust level must read identically
 * here and in the CLI, or "verified" would mean two different things.
 */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58decode(s) {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("invalid base58 character: " + c);
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of s) {
    if (c === "1") bytes.unshift(0);
    else break;
  }
  return Uint8Array.from(bytes);
}

export function didToPublicKey(did) {
  const m = /^did:key:z([1-9A-HJ-NP-Za-km-z]+)(#.*)?$/.exec(String(did).trim());
  if (!m) throw new Error("not a did:key: " + did);
  const bytes = base58decode(m[1]);
  if (bytes[0] !== 0xed || bytes[1] !== 0x01) throw new Error("did:key is not Ed25519");
  return bytes.slice(2);
}

/** RFC 8785-style canonicalization — must match the CLI byte for byte. */
export function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalize(v)).join(",") + "}";
}

export async function verifySignature(p) {
  if (!p || !p.proof) return { valid: false, reason: "no proof on the document" };
  if (p.proof.type !== "eddsa-jcs-2022") return { valid: false, reason: "unsupported proof type " + p.proof.type };
  if (typeof p.proof.signature !== "string" || !p.proof.signature.startsWith("z")) {
    return { valid: false, reason: "signature is not multibase base58btc" };
  }
  try {
    const did = String(p.proof.verification_method || "").split("#")[0];
    const raw = didToPublicKey(did);
    const { proof, ...unsigned } = p;
    const data = new TextEncoder().encode(canonicalize(unsigned));
    const key = await crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, base58decode(p.proof.signature.slice(1)), data);
    return ok ? { valid: true } : { valid: false, reason: "signature does not match the document" };
  } catch (e) {
    return { valid: false, reason: (e && e.message) || String(e) };
  }
}

/**
 * Several endpoints, because one of them refusing us must not become a
 * statement about somebody's retirement. mainnet.base.org does not answer
 * reliably from Cloudflare's egress; the fallbacks cover that.
 */
const BASE_RPCS = ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.llamarpc.com"];

/**
 * Ask one endpoint about one transaction.
 *
 * Returns "unknown" for anything that is not a clear answer. A JSON-RPC error
 * body has no `result` either, so treating a missing result as "not found"
 * would report a rate-limit as proof that a retirement never happened — an
 * accusation, from a transport failure.
 */
async function receiptFrom(rpc, hash, timeoutMs) {
  try {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { state: "unknown", why: "HTTP " + res.status };
    const body = await res.json();
    if (body && body.error) return { state: "unknown", why: "RPC error " + (body.error.message || body.error.code) };
    if (!body || !("result" in body)) return { state: "unknown", why: "malformed RPC response" };
    if (body.result === null) return { state: "absent" };
    return { state: "found", receipt: body.result };
  } catch (e) {
    return { state: "unknown", why: e && e.name === "TimeoutError" ? "timeout" : (e && e.message) || String(e) };
  }
}

/** Confirm each anchor's transaction exists on Base and did not revert. */
export async function resolveAnchors(p, timeoutMs = 6000) {
  const anchors = (p && p.contribution && p.contribution.anchors) || [];
  const hashes = anchors.map((a) => a.tx_hash).filter(Boolean);
  if (!hashes.length) return { resolved: false, notes: ["anchors carry no transaction hash"] };
  const notes = [];
  for (const hash of hashes) {
    let answer = null;
    const whys = [];
    for (const rpc of BASE_RPCS) {
      const r = await receiptFrom(rpc, hash, timeoutMs);
      if (r.state === "unknown") { whys.push(r.why); continue; }
      answer = r;
      break;
    }
    if (!answer) {
      notes.push("could not reach the chain (" + whys.join("; ") + ") — anchors unconfirmed, not disproved");
      return { resolved: false, notes };
    }
    if (answer.state === "absent") {
      notes.push(hash.slice(0, 10) + "… not found on chain");
      return { resolved: false, notes };
    }
    if (answer.receipt.status && answer.receipt.status !== "0x1") {
      notes.push(hash.slice(0, 10) + "… reverted on chain");
      return { resolved: false, notes };
    }
  }
  return { resolved: true, notes };
}

/** Re-derive the level from evidence. Never reads p.trust_level. */
export function deriveTrustLevel(p, opts) {
  const warnings = [];
  if (!opts.signatureValid) {
    return { level: "L0", warnings: ["signature invalid — nothing below can be trusted"], policyMet: false, removalOk: false };
  }
  const e = p.estimated_gco2e || {};
  const hasUsage = e.calls > 0 && e.central > 0;
  const hasRanges = e.low <= e.central && e.central <= e.high;
  const hasMethodology = typeof p.methodology === "string" && p.methodology.length > 0;
  if (!hasUsage) warnings.push("no usage recorded — cannot claim measurement");
  if (!hasRanges) warnings.push("uncertainty range is malformed");
  if (!hasMethodology) warnings.push("no methodology version pinned");
  if (!(hasUsage && hasRanges && hasMethodology)) return { level: "L0", warnings, policyMet: false, removalOk: false };

  const c = p.contribution || {};
  const anchors = c.anchors || [];
  const policyMet = c.credited_tonnes >= c.target_tonnes && c.target_tonnes > 0;

  const portfolio = p.policy && p.policy.portfolio;
  const removalPolicy = portfolio === "removal-only" || portfolio === "removal-weighted";
  const nonRemoval = anchors.filter((a) => a.method && a.method !== "removal");
  const unspecified = anchors.filter((a) => !a.method || a.method === "unspecified");
  const removalOk = !removalPolicy || (nonRemoval.length === 0 && unspecified.length === 0);

  if (!anchors.length) {
    warnings.push("no retirement anchors — measurement only");
    return { level: "L1", warnings, policyMet, removalOk };
  }
  if (!opts.anchorsResolved) warnings.push("anchors not resolved on-chain");
  if (removalPolicy && unspecified.length) {
    warnings.push(unspecified.length + " anchor(s) of unspecified method under a " + portfolio + " policy");
  }
  if (removalPolicy && nonRemoval.length) {
    warnings.push(nonRemoval.length + " anchor(s) are not removal under a " + portfolio + " policy");
  }
  if (!policyMet) warnings.push("contribution target not met");

  const level2 = policyMet && removalOk && opts.anchorsResolved;
  if (!level2) return { level: "L1", warnings, policyMet, removalOk };

  // L3 sits on top of a genuine L2: certification attests to the process
  // behind the evidence, it never substitutes for the evidence.
  const cert = opts.certification;
  if (cert && cert.status !== "none") warnings.push(...(cert.warnings || []));
  if (cert && cert.status === "active") return { level: "L3", warnings, policyMet, removalOk };
  if (p.trust_level === "L3" && cert && cert.status === "none") {
    warnings.push("document claims L3 but the certification registry has no entry for this subject");
  }
  return { level: "L2", warnings, policyMet, removalOk };
}

/** Verify a passport document. Shared by /v1/verify and /v1/badge. */
export async function verifyPassport(passport, options) {
  const offline = !!(options && options.offline);
  const sig = await verifySignature(passport);
  const expiresAt = passport && passport.expires_at ? Date.parse(passport.expires_at) : NaN;
  const stale = Number.isFinite(expiresAt) && expiresAt < Date.now();

  let anchorsResolved = false;
  let notes = [];
  if (!offline && sig.valid) {
    const r = await resolveAnchors(passport);
    anchorsResolved = r.resolved;
    notes = r.notes;
  } else if (offline) {
    notes = ["offline: anchors not checked against the chain"];
  }

  let certification = {
    status: "unchecked",
    warnings: offline ? ["offline: certification not checked — L3 needs the registry"] : [],
  };
  if (!offline && sig.valid) {
    const { checkCertification } = await import("./registry.js");
    certification = await checkCertification((passport.subject && passport.subject.id) || "");
  }

  const derived = deriveTrustLevel(passport, { signatureValid: sig.valid, anchorsResolved, certification });
  const warnings = derived.warnings.concat(notes);
  if (stale) warnings.push("expired on " + String(passport.expires_at).slice(0, 10) + " — re-issue with carbon-md passport");

  const anchorCount = (passport && passport.contribution && passport.contribution.anchors && passport.contribution.anchors.length) || 0;

  return {
    subject: (passport && passport.subject && passport.subject.id) || "unknown",
    subject_name: (passport && passport.subject && passport.subject.name) || null,
    verdict: !sig.valid ? "invalid" : stale ? "stale" : "verified",
    trust_level: derived.level,
    claimed_trust_level: (passport && passport.trust_level) || null,
    signature_valid: sig.valid,
    signature_reason: sig.valid ? undefined : sig.reason,
    policy_target_met: derived.policyMet,
    removal_ok: derived.removalOk,
    anchors: anchorCount,
    anchors_resolved: offline ? "offline" : anchorsResolved ? "resolved" : "none",
    certification: {
      status: certification.status,
      tier: certification.tier,
      valid_until: certification.valid_until,
      certificate_url: certification.certificate_url,
      revoked_at: certification.revoked_at,
      reason: certification.reason,
    },
    methodology: (passport && passport.methodology) || null,
    warnings,
    verified_at: new Date().toISOString(),
  };
}

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export function json(body, status, extra) {
  return new Response(JSON.stringify(body, null, 2), {
    status: status || 200,
    headers: Object.assign({ "content-type": "application/json; charset=utf-8" }, CORS, extra || {}),
  });
}

/** A passport is a few KB; anything near this is not one. Same cap as the CLI. */
const MAX_PASSPORT_BYTES = 1024 * 1024;

/** Read a response body as text, refusing to buffer more than `max` bytes. */
async function readCapped(res, max) {
  const tooBig = () => new Error("the passport is larger than " + max / (1024 * 1024) + " MB — refusing to read it");
  if (Number(res.headers.get("content-length")) > max) throw tooBig();
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks = [];
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
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** Fetch a passport document from a URL, with guards. Same messages as the CLI. */
export async function fetchPassport(url, { timeoutMs = 8000 } = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error("invalid url");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("url must be http(s)");
  try {
    const res = await fetch(u.toString(), { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    if (!res.ok) throw new Error("HTTP " + res.status + " fetching the passport");
    const body = await readCapped(res, MAX_PASSPORT_BYTES);
    try {
      return JSON.parse(body);
    } catch {
      // Single-page sites answer 200 with index.html for any unknown path, so a
      // typo in the URL arrives here looking like a document. Say so plainly.
      const ct = res.headers.get("content-type") || "unknown";
      const looksHtml = body.trimStart().startsWith("<") || /text\/html/i.test(ct);
      throw new Error(
        looksHtml
          ? "the URL returned HTML, not a passport — check the path (many sites answer 200 with their index page for unknown paths)"
          : "the URL did not return JSON (content-type: " + ct + ")"
      );
    }
  } catch (e) {
    // the timeout covers the body read too, which aborts with the same error names
    if (e && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new Error("timed out after " + timeoutMs / 1000 + "s fetching the passport");
    }
    throw e;
  }
}
