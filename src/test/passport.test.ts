import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKey, publicKeyToDid, didToPublicKey, base58encode, base58decode } from "../core/keys.js";
import { canonicalize, deriveTrustLevel, sign, verifySignature, type Passport } from "../core/passport.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "carbon-md-passport-"));
}

const basePassport = (over: Partial<Passport> = {}): Passport => ({
  carbon_passport: "0.1",
  subject: { id: "did:key:zTest", name: "demo", kind: "project" },
  period: { from: "2026-08-01", to: "2026-08-31" },
  methodology: "carbonmd-factors-2026-08",
  policy: { contribution_target: 1.1, portfolio: "removal-weighted" },
  estimated_gco2e: { low: 93, central: 285, high: 930, calls: 2, tokens: 306000 },
  contribution: { target_tonnes: 0.0003, contributed_tonnes: 0, credited_tonnes: 0, met: false, anchors: [] },
  trust_level: "L1",
  issued_at: "2026-08-15T00:00:00Z",
  expires_at: "2026-11-13T00:00:00Z",
  issuer: "did:key:zTest",
  ...over,
});

test("base58 round-trips and did:key encodes an Ed25519 key", () => {
  const bytes = Uint8Array.from([0, 0, 1, 2, 250, 255]);
  assert.deepEqual([...base58decode(base58encode(bytes))], [...bytes]);
  const raw = Uint8Array.from({ length: 32 }, (_, i) => i);
  const did = publicKeyToDid(raw);
  assert.ok(did.startsWith("did:key:z6Mk"), `unexpected did prefix: ${did}`);
  assert.deepEqual([...didToPublicKey(did)], [...raw]);
});

test("canonicalization sorts keys so signer and verifier agree byte-for-byte", () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalize({ a: [3, { d: 1, c: 2 }] }), '{"a":[3,{"c":2,"d":1}]}');
  // undefined fields must not change the bytes
  assert.equal(canonicalize({ a: 1, b: undefined }), '{"a":1}');
});

test("a signed passport verifies; any edit breaks the signature", () => {
  const dir = tmp();
  try {
    const key = createKey(dir);
    const signed = sign(basePassport({ subject: { id: key.did, name: "demo", kind: "project" }, issuer: key.did }), key);
    assert.equal(verifySignature(signed).valid, true);

    const tampered = { ...signed, contribution: { ...signed.contribution, credited_tonnes: 99, met: true } };
    assert.equal(verifySignature(tampered).valid, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("trust level is re-derived from evidence, never read from the document", () => {
  // claims L3, has nothing: an invalid signature collapses everything to L0
  const bogus = basePassport({ trust_level: "L3" });
  assert.equal(deriveTrustLevel(bogus, { signatureValid: false, anchorsResolved: true }).level, "L0");

  // measured but never contributed -> L1
  assert.equal(deriveTrustLevel(bogus, { signatureValid: true, anchorsResolved: false }).level, "L1");
});

test("L2 requires resolved anchors that satisfy the removal policy", () => {
  const withRemoval = basePassport({
    contribution: {
      target_tonnes: 0.0003,
      contributed_tonnes: 0.0005,
      credited_tonnes: 0.0005,
      met: true,
      anchors: [{ rail: "x402:klima", tx_hash: "0xabc", tonnes: 0.0005, method: "removal" }],
    },
  });
  assert.equal(deriveTrustLevel(withRemoval, { signatureValid: true, anchorsResolved: true }).level, "L2");

  // same evidence, unresolved on-chain -> capped at L1
  assert.equal(deriveTrustLevel(withRemoval, { signatureValid: true, anchorsResolved: false }).level, "L1");

  // an avoidance anchor cannot satisfy a removal-weighted claim
  const withAvoidance = basePassport({
    contribution: {
      target_tonnes: 0.0003,
      contributed_tonnes: 0.0005,
      credited_tonnes: 0.0005,
      met: true,
      anchors: [{ rail: "x402:klima", tx_hash: "0xabc", tonnes: 0.0005, method: "avoidance" }],
    },
  });
  const r = deriveTrustLevel(withAvoidance, { signatureValid: true, anchorsResolved: true });
  assert.equal(r.removalOk, false);
  assert.equal(r.level, "L1");
});

// ---------------------------------------------------------------------------
// Signer binding. A valid signature only proves *someone* signed; L3 is then
// looked up by subject.id. Without binding the signer to the subject, anyone
// could put a certified subject's DID in the document, sign with their own
// key, and inherit that subject's certification.
// ---------------------------------------------------------------------------

test("a passport signed by a key other than its subject is invalid", () => {
  const dir = tmp();
  try {
    const victim = createKey(join(dir, "victim"));
    const attacker = createKey(join(dir, "attacker"));
    const forged = sign(
      basePassport({ subject: { id: victim.did, name: "victim", kind: "project" }, issuer: victim.did }),
      attacker
    );
    const r = verifySignature(forged);
    assert.equal(r.valid, false);
    assert.match(r.reason ?? "", new RegExp(`signed by ${attacker.did} but subject is ${victim.did}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a passport whose issuer is not the signer is invalid", () => {
  const dir = tmp();
  try {
    const key = createKey(join(dir, "self"));
    const other = createKey(join(dir, "other"));
    const forged = sign(
      basePassport({ subject: { id: key.did, name: "demo", kind: "project" }, issuer: other.did }),
      key
    );
    const r = verifySignature(forged);
    assert.equal(r.valid, false);
    assert.match(r.reason ?? "", new RegExp(`signed by ${key.did} but issuer is ${other.did}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a verification method whose fragment is not the did:key's own key is invalid", () => {
  const dir = tmp();
  try {
    const key = createKey(dir);
    const signed = sign(basePassport({ subject: { id: key.did, name: "demo", kind: "project" }, issuer: key.did }), key);
    const wrongFragment = { ...signed, proof: { ...signed.proof!, verification_method: `${key.did}#z6MkNotTheKey` } };
    const r = verifySignature(wrongFragment);
    assert.equal(r.valid, false);
    assert.match(r.reason ?? "", /fragment/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a verification method that is malformed or not a did:key is invalid, without throwing", () => {
  const dir = tmp();
  try {
    const key = createKey(dir);
    const signed = sign(basePassport({ subject: { id: key.did, name: "demo", kind: "project" }, issuer: key.did }), key);
    const withMethod = (vm: unknown) =>
      ({ ...signed, proof: { ...signed.proof!, verification_method: vm } }) as unknown as Passport;

    assert.deepEqual(verifySignature(withMethod(key.did)), {
      valid: false,
      reason: "verification method has no #fragment",
    });
    assert.deepEqual(verifySignature(withMethod("did:web:example.com#key-1")), {
      valid: false,
      reason: "verification method is not a did:key: did:web:example.com#key-1",
    });
    // An array would stringify to a valid-looking method; it must be refused, not crash .split.
    for (const vm of [[signed.proof!.verification_method], 42, undefined]) {
      assert.deepEqual(verifySignature(withMethod(vm)), {
        valid: false,
        reason: "verification method is not a string",
      });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a passport with no subject or no issuer is invalid", () => {
  const dir = tmp();
  try {
    const key = createKey(dir);
    const signed = sign(basePassport({ subject: { id: key.did, name: "demo", kind: "project" }, issuer: key.did }), key);
    const { subject: _s, ...noSubject } = signed;
    assert.deepEqual(verifySignature(noSubject as unknown as Passport), {
      valid: false,
      reason: `signed by ${key.did} but subject is missing`,
    });
    const { issuer: _i, ...noIssuer } = signed;
    assert.deepEqual(verifySignature(noIssuer as unknown as Passport), {
      valid: false,
      reason: `signed by ${key.did} but issuer is missing`,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
