import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The docs site is plain JS for Cloudflare Pages and lives outside the TS rootDir.
const BUILD = fileURLToPath(new URL("../../docs-site/build.mjs", import.meta.url));
// @ts-ignore — plain JS for Cloudflare Pages Functions, no type declarations by design
const agentFn: any = await import("../../docs-site/functions/agent.js");
// @ts-ignore — same
const middleware: any = await import("../../docs-site/functions/_middleware.js");

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
  // a miss is no page in the nav: nothing in the sidebar is marked current
  for (const html of [en, fr]) {
    assert.doesNotMatch(html, /aria-current="page"/);
    assert.doesNotMatch(html, /class="active"/);
  }
});

test("docs build: the agent contract is published as plain-text files", () => {
  const contract = readFileSync(join(out, "agent.txt"), "utf8");
  assert.ok(contract.length > 0);
  assert.equal(readFileSync(join(out, ".well-known", "carbon-md", "agent.txt"), "utf8"), contract);
  // Pages never serves index.txt for a directory; /agent is a Function instead
  assert.ok(!existsSync(join(out, "agent", "index.txt")));
  const headers = readFileSync(join(out, "_headers"), "utf8");
  assert.match(headers, /^\/agent\.txt\n  Content-Type: text\/plain; charset=utf-8$/m);
  assert.match(headers, /^\/\.well-known\/carbon-md\/agent\.txt\n  Content-Type: text\/plain; charset=utf-8$/m);
  // _headers never applies to Function responses, so a /agent rule would be dead
  assert.doesNotMatch(headers, /^\/agent$/m);
});

test("/agent answers GET and HEAD only, so Pages returns 405 for other methods", () => {
  assert.equal(typeof agentFn.onRequestGet, "function");
  // Pages does not route HEAD to onRequestGet (`wrangler pages dev` answers it 404)
  assert.equal(agentFn.onRequestHead, agentFn.onRequestGet);
  assert.equal(agentFn.onRequest, undefined);
});

test("/agent serves the plain-text contract with a 200, not HTML and not a redirect", async () => {
  const seen: string[] = [];
  const env = {
    ASSETS: {
      fetch: async (req: Request | URL | string) => {
        const u = new URL(req instanceof Request ? req.url : String(req));
        seen.push(u.pathname);
        return new Response("# carbon.md — agent install contract", {
          status: 200,
          headers: { "content-type": "application/octet-stream", etag: '"abc"' },
        });
      },
    },
  };
  const res: Response = await agentFn.onRequestGet({ request: new Request("https://docs.carbonmd.dev/agent"), env });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(await res.text(), "# carbon.md — agent install contract");
  assert.deepEqual(seen, ["/agent.txt"]);
});

test("/agent is language-neutral: the locale middleware passes it through untouched", async () => {
  for (const path of ["/agent", "/agent/", "/agent.txt"]) {
    const upstream = new Response("contract", { headers: { "content-type": "text/plain; charset=utf-8" } });
    const res: Response = await middleware.onRequest({
      request: new Request(`https://docs.carbonmd.dev${path}`, { headers: { "accept-language": "fr-FR,fr;q=0.9" } }),
      next: async () => upstream,
    });
    assert.equal(res, upstream, path);
  }
});
