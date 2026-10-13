import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The docs site is plain JS for Cloudflare Pages and lives outside the TS rootDir.
const BUILD = fileURLToPath(new URL("../../docs-site/build.mjs", import.meta.url));

const out = mkdtempSync(join(tmpdir(), "carbon-md-docs-"));
after(() => rmSync(out, { recursive: true, force: true }));
for (const args of [["--out", out], ["--locale", "fr", "--out", join(out, "fr")]]) {
  const r = spawnSync(process.execPath, [BUILD, ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}

test("docs build: emits a 404.html, so unknown paths stop answering 200 with the homepage", () => {
  // Cloudflare Pages treats a project without a top-level 404.html as an SPA
  // and serves index.html with 200 for every unknown path, /v1/* included.
  const en = readFileSync(join(out, "404.html"), "utf8");
  assert.match(en, /<html lang="en">/);
  assert.match(en, /Page not found/);
  assert.match(en, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(en, /rel="canonical"/);
  // Pages serves the nearest 404.html, so French paths get a French page
  const fr = readFileSync(join(out, "fr", "404.html"), "utf8");
  assert.match(fr, /<html lang="fr">/);
  assert.match(fr, /Page introuvable/);
});
