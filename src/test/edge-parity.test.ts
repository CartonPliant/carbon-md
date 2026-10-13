import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKey } from "../core/keys.js";
import { canonicalize, deriveTrustLevel, sign, verifySignature, type Passport } from "../core/passport.js";
import { emptyRegistry, lookupCertification, signRegistry, verifyRegistrySignature } from "../core/registry.js";
// The edge runtime port: the hosted API must reach the same verdict as the CLI,
// or "verified" would quietly mean two different things. Loaded dynamically —
// it is plain JS for Cloudflare Workers and lives outside the TS rootDir.
// @ts-ignore — plain JS for Cloudflare Workers, no type declarations by design
const edge: any = await import("../../docs-site/functions/_lib/passport.js");
// @ts-ignore — same
const edgeRegistry: any = await import("../../docs-site/functions/_lib/registry.js");
const edgeCanonicalize = edge.canonicalize;
const edgeDerive = edge.deriveTrustLevel;
const edgeVerify = edge.verifySignature;

const passport = (over: Partial<Passport> = {}): Passport => ({
  carbon_passport: "0.1",
  subject: { id: "did:key:zTest", name: "demo", kind: "project" },
  period: { from: "2026-08-01", to: "2026-08-31" },
  methodology: "carbonmd-factors-2026-08",
  policy: { contribution_target: 1.1, portfolio: "removal-weighted" },
  estimated_gco2e: { low: 93, central: 285, high: 930, calls: 2, tokens: 306000 },
  contribution: {
    target_tonnes: 0.0003,
    contributed_tonnes: 0.0005,
    credited_tonnes: 0.0005,
    met: true,
    anchors: [{ rail: "x402:klima", tx_hash: "0xabc", tonnes: 0.0005, method: "removal" }],
  },
  trust_level: "L2",
  issued_at: "2026-08-15T00:00:00Z",
  expires_at: "2099-01-01T00:00:00Z",
  issuer: "did:key:zTest",
  ...over,
});

const avoidanceContribution = {
  target_tonnes: 0.0003,
  contributed_tonnes: 0.0005,
  credited_tonnes: 0.0005,
  met: true,
  anchors: [{ rail: "x402:klima", tx_hash: "0xabc", tonnes: 0.0005, method: "avoidance" as const }],
};

test("edge port canonicalizes identically — signatures must agree byte for byte", () => {
  const p = passport();
  assert.equal(edgeCanonicalize(p), canonicalize(p));
  assert.equal(edgeCanonicalize({ b: 1, a: [2, { d: 3, c: 4 }] }), canonicalize({ b: 1, a: [2, { d: 3, c: 4 }] }));
});

test("edge port verifies the same signatures, and rejects the same tampering", async () => {
  const dir = mkdtempSync(join(tmpdir(), "carbon-md-parity-"));
  try {
    const key = createKey(dir);
    const signed = sign(passport({ subject: { id: key.did, name: "demo", kind: "project" }, issuer: key.did }), key);
    assert.equal((await edgeVerify(signed)).valid, verifySignature(signed).valid);
    assert.equal((await edgeVerify(signed)).valid, true);

    const tampered = { ...signed, contribution: { ...signed.contribution, credited_tonnes: 999 } };
    assert.equal((await edgeVerify(tampered)).valid, false);
    assert.equal(verifySignature(tampered as Passport).valid, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("edge port rejects a signer that is not the subject or issuer, with the same reason", async () => {
  // The forgery that matters: a certified subject's DID, signed by someone
  // else's key. Both sides must refuse it, or the API would hand out the
  // victim's L3 while the CLI does not.
  const dir = mkdtempSync(join(tmpdir(), "carbon-md-binding-"));
  try {
    const victim = createKey(join(dir, "victim"));
    const attacker = createKey(join(dir, "attacker"));
    const forgedSubject = sign(
      passport({ subject: { id: victim.did, name: "victim", kind: "project" }, issuer: victim.did }),
      attacker
    );
    const forgedIssuer = sign(
      passport({ subject: { id: attacker.did, name: "demo", kind: "project" }, issuer: victim.did }),
      attacker
    );
    const signed = sign(passport({ subject: { id: attacker.did, name: "demo", kind: "project" }, issuer: attacker.did }), attacker);
    const withMethod = (vm: unknown) => ({ ...signed, proof: { ...signed.proof!, verification_method: vm } });
    const wrongFragment = withMethod(`${attacker.did}#z6MkNotTheKey`);
    const noFragment = withMethod(attacker.did);
    const notDidKey = withMethod("did:web:example.com#key-1");
    // String() would turn ["did:key:X#X"] into "did:key:X#X" and let it through.
    const arrayMethod = withMethod([signed.proof!.verification_method]);
    const numberMethod = withMethod(42);
    const { subject: _s, ...noSubject } = signed;
    const nullSubjectId = { ...signed, subject: { ...signed.subject, id: null } };
    const { issuer: _i, ...noIssuer } = signed;
    // Falsy non-objects and empty strings: `p.subject && p.subject.id` would
    // leak 0 / "" / false into the reason where optional chaining says missing.
    const zeroSubject = { ...signed, subject: 0 };
    const emptyStringSubject = { ...signed, subject: "" };
    const falseSubject = { ...signed, subject: false };
    const emptyIssuer = { ...signed, issuer: "" };
    const emptySubjectId = { ...signed, subject: { ...signed.subject, id: "" } };
    const numericSubjectId = { ...signed, subject: { ...signed.subject, id: 0 } };

    const docs = [
      forgedSubject,
      forgedIssuer,
      wrongFragment,
      noFragment,
      notDidKey,
      arrayMethod,
      numberMethod,
      noSubject,
      nullSubjectId,
      noIssuer,
      zeroSubject,
      emptyStringSubject,
      falseSubject,
      emptyIssuer,
      emptySubjectId,
      numericSubjectId,
    ];
    for (const doc of docs) {
      const cli = verifySignature(doc as Passport);
      const edgeResult = await edgeVerify(doc);
      assert.equal(cli.valid, false);
      assert.deepEqual(edgeResult, cli);
    }
    assert.match(verifySignature(forgedSubject).reason ?? "", /but subject is/);
    assert.match(verifySignature(forgedIssuer).reason ?? "", /but issuer is/);
    assert.match(verifySignature(noFragment as Passport).reason ?? "", /has no #fragment/);
    assert.match(verifySignature(arrayMethod as any).reason ?? "", /verification method is not a string/);
    assert.match(verifySignature(noSubject as any).reason ?? "", /but subject is missing/);
    assert.match(verifySignature(noIssuer as any).reason ?? "", /but issuer is missing/);
    const did = attacker.did;
    assert.equal(verifySignature(zeroSubject as any).reason, `signed by ${did} but subject is missing`);
    assert.equal(verifySignature(falseSubject as any).reason, `signed by ${did} but subject is missing`);
    assert.equal(verifySignature(emptySubjectId as any).reason, `signed by ${did} but subject is missing`);
    assert.equal(verifySignature(emptyIssuer as any).reason, `signed by ${did} but issuer is missing`);
    // A non-string id is shown as JSON, so 0 reads as 0 rather than vanishing.
    assert.equal(verifySignature(numericSubjectId as any).reason, `signed by ${did} but subject is 0`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the published example passport still verifies on both sides", async () => {
  // The docs link to this file as the thing to try first; a verifier rule that
  // rejected it would break the very first impression.
  const example = JSON.parse(readFileSync(new URL("../../docs-site/static/examples/passport.json", import.meta.url), "utf8"));
  assert.deepEqual(verifySignature(example), { valid: true });
  assert.deepEqual(await edgeVerify(example), { valid: true });
});

test("edge port derives the same trust level, warnings included", () => {
  const cases: Array<[boolean, boolean]> = [
    [true, true],
    [true, false],
    [false, true],
  ];
  for (const [signatureValid, anchorsResolved] of cases) {
    const p = passport();
    assert.deepEqual(
      edgeDerive(p, { signatureValid, anchorsResolved }),
      deriveTrustLevel(p, { signatureValid, anchorsResolved }),
      `mismatch for sig=${signatureValid} anchors=${anchorsResolved}`
    );
  }

  // and on the case that actually matters: avoidance under a removal policy
  const avoidance = passport({ contribution: avoidanceContribution });
  assert.deepEqual(
    edgeDerive(avoidance, { signatureValid: true, anchorsResolved: true }),
    deriveTrustLevel(avoidance, { signatureValid: true, anchorsResolved: true })
  );
});

// ---------------------------------------------------------------------------
// L3 / certification parity. This is where a drift would hurt most: L3 is the
// paid tier, so the two implementations disagreeing means either selling a
// stamp the API will not honour, or honouring one nobody paid for.
// ---------------------------------------------------------------------------

const CERT_CASES = [
  { status: "active", tier: "maker", valid_until: "2099-01-01T00:00:00Z", warnings: [] },
  { status: "none", warnings: [] },
  { status: "expired", tier: "maker", warnings: ["certification lapsed on 2026-01-01 — renew to restore L3"] },
  { status: "revoked", tier: "maker", warnings: ["certification revoked on 2026-08-01: prohibited neutrality claim"] },
  { status: "unchecked", warnings: ["certification registry unreachable (timeout)"] },
];

test("edge port grants L3 on exactly the same evidence", () => {
  for (const certification of CERT_CASES) {
    const p = passport({ trust_level: "L3" });
    assert.deepEqual(
      edgeDerive(p, { signatureValid: true, anchorsResolved: true, certification: { ...certification } }),
      deriveTrustLevel(p, { signatureValid: true, anchorsResolved: true, certification: { ...certification } as any }),
      `mismatch for certification=${certification.status}`
    );
  }
});

test("only an active certification reaches L3 — and never without L2 evidence", () => {
  const active = { status: "active", tier: "maker", warnings: [] } as any;

  // Full evidence plus an active certification is the only path to L3.
  assert.equal(
    deriveTrustLevel(passport(), { signatureValid: true, anchorsResolved: true, certification: active }).level,
    "L3"
  );

  // Certification cannot carry a passport whose anchors do not resolve: L3
  // attests to process, it is not a substitute for evidence.
  assert.equal(
    deriveTrustLevel(passport(), { signatureValid: true, anchorsResolved: false, certification: active }).level,
    "L1"
  );

  // Nor one whose contribution is avoidance under a removal policy.
  const avoidance = passport({ contribution: avoidanceContribution });
  assert.equal(
    deriveTrustLevel(avoidance, { signatureValid: true, anchorsResolved: true, certification: active }).level,
    "L1"
  );

  // A document claiming L3 with no entry is reported at its evidence level,
  // and says so rather than failing silently.
  const unearned = deriveTrustLevel(passport({ trust_level: "L3" }), {
    signatureValid: true,
    anchorsResolved: true,
    certification: { status: "none", warnings: [] } as any,
  });
  assert.equal(unearned.level, "L2");
  assert.ok(unearned.warnings.some((w) => w.includes("no entry for this subject")));
});

test("edge port checks registry signatures identically, and rejects a forged issuer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "carbon-md-registry-"));
  try {
    const key = createKey(dir);
    const signed = signRegistry(emptyRegistry(key.did), key);

    assert.equal(verifyRegistrySignature(signed, key.did).valid, true);
    assert.equal((await edgeRegistry.verifyRegistrySignature(signed, key.did)).valid, true);

    // Signed by a real key, but not the issuer the verifier pins.
    const other = createKey(join(dir, "other"));
    assert.equal(verifyRegistrySignature(signed, other.did).valid, false);
    assert.equal((await edgeRegistry.verifyRegistrySignature(signed, other.did)).valid, false);

    // Entries appended after signing must not survive the check.
    const stuffed = {
      ...signed,
      entries: [
        {
          subject: "did:key:zAttacker",
          name: "attacker",
          tier: "enterprise",
          status: "active",
          issued_at: "2026-01-01T00:00:00Z",
          valid_until: "2099-01-01T00:00:00Z",
          scope: { methodology: "carbonmd-factors-2026-08" },
        },
      ],
    };
    assert.equal(verifyRegistrySignature(stuffed as any, key.did).valid, false);
    assert.equal((await edgeRegistry.verifyRegistrySignature(stuffed, key.did)).valid, false);

    // ...so the lookup refuses to certify from it.
    assert.equal(
      lookupCertification(stuffed as any, "did:key:zAttacker", { expectedIssuer: key.did }).status,
      "unchecked"
    );
    assert.equal(
      (await edgeRegistry.lookupCertification(stuffed, "did:key:zAttacker", { expectedIssuer: key.did })).status,
      "unchecked"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("edge port resolves registry lookups identically", async () => {
  const dir = mkdtempSync(join(tmpdir(), "carbon-md-lookup-"));
  try {
    const key = createKey(dir);
    const base = emptyRegistry(key.did);
    const entry = {
      subject: "did:key:zSubject",
      name: "demo",
      tier: "maker" as const,
      status: "active" as const,
      issued_at: "2026-01-01T00:00:00Z",
      valid_until: "2099-01-01T00:00:00Z",
      scope: { methodology: "carbonmd-factors-2026-08" },
    };
    const signed = signRegistry({ ...base, entries: [entry] }, key);
    const opts = { expectedIssuer: key.did };

    for (const subject of ["did:key:zSubject", "did:key:zNobody"]) {
      const cli = lookupCertification(signed, subject, opts);
      const edgeResult = await edgeRegistry.lookupCertification(signed, subject, opts);
      assert.equal(edgeResult.status, cli.status, `mismatch for ${subject}`);
      assert.deepEqual(edgeResult.warnings, cli.warnings);
    }

    // A revoked row beats an active one for the same subject, on both sides.
    const withRevocation = signRegistry(
      {
        ...base,
        entries: [
          entry,
          {
            ...entry,
            status: "revoked" as const,
            revoked_at: "2026-08-01T00:00:00Z",
            revocation_reason: "lapsed removals",
          },
        ],
      },
      key
    );
    assert.equal(lookupCertification(withRevocation, "did:key:zSubject", opts).status, "revoked");
    assert.equal((await edgeRegistry.lookupCertification(withRevocation, "did:key:zSubject", opts)).status, "revoked");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an expired registry grants nothing, however valid its signature", async () => {
  const dir = mkdtempSync(join(tmpdir(), "carbon-md-expiry-"));
  try {
    const key = createKey(dir);
    const stale = signRegistry(
      {
        ...emptyRegistry(key.did),
        expires_at: "2026-01-01T00:00:00Z",
        entries: [
          {
            subject: "did:key:zSubject",
            name: "demo",
            tier: "maker" as const,
            status: "active" as const,
            issued_at: "2025-01-01T00:00:00Z",
            valid_until: "2099-01-01T00:00:00Z",
            scope: { methodology: "carbonmd-factors-2026-08" },
          },
        ],
      },
      key
    );
    const opts = { expectedIssuer: key.did };
    assert.equal(verifyRegistrySignature(stale, key.did).valid, true);
    assert.equal(lookupCertification(stale, "did:key:zSubject", opts).status, "unchecked");
    assert.equal((await edgeRegistry.lookupCertification(stale, "did:key:zSubject", opts)).status, "unchecked");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
