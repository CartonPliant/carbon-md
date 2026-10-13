import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fetchPassport, MAX_PASSPORT_BYTES } from "../commands/verify.js";
// The edge port must refuse the same responses, or the hosted API and the CLI
// would disagree about what a passport URL even returned.
// @ts-ignore — plain JS for Cloudflare Workers, no type declarations by design
const edge: any = await import("../../docs-site/functions/_lib/passport.js");

// Each path stands in for one way a "passport URL" goes wrong in the wild.
const routes: Record<string, (res: ServerResponse) => void> = {
  "/passport.json": (res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ carbon_passport: "0.1", subject: { id: "did:test" } }));
  },
  // carbonmd.dev and docs.carbonmd.dev both answer unknown paths like this
  "/spa-fallback": (res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><html><body>home</body></html>");
  },
  "/html-no-doctype": (res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("\n  hello, this is a page");
  },
  "/plain": (res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("not json");
  },
  "/missing": (res) => {
    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
  },
  "/huge": (res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"pad":"' + "x".repeat(MAX_PASSPORT_BYTES + 10) + '"}');
  },
  "/huge-chunked": (res) => {
    // no content-length: the cap must hold while streaming, not just on the header
    res.writeHead(200, { "content-type": "application/json", "transfer-encoding": "chunked" });
    const chunk = "x".repeat(64 * 1024);
    res.write('{"pad":"');
    for (let i = 0; i < Math.ceil(MAX_PASSPORT_BYTES / chunk.length) + 2; i++) res.write(chunk);
    res.end('"}');
  },
  "/slow": () => {
    // never answers
  },
};

const server = createServer((req, res) => (routes[req.url ?? ""] ?? routes["/missing"])(res));
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => {
  server.closeAllConnections(); // the /slow request is still open
  server.close();
});

test("verify <url>: a JSON passport loads", async () => {
  const p: any = await fetchPassport(`${base}/passport.json`);
  assert.equal(p.carbon_passport, "0.1");
});

test("verify <url>: an SPA answering 200 with its homepage is reported as HTML, not a JSON parse crash", async () => {
  await assert.rejects(fetchPassport(`${base}/spa-fallback`), /returned HTML, not a passport/);
  // text/html without a leading "<" is still HTML
  await assert.rejects(fetchPassport(`${base}/html-no-doctype`), /returned HTML, not a passport/);
});

test("verify <url>: other non-JSON bodies name the content type", async () => {
  await assert.rejects(fetchPassport(`${base}/plain`), /did not return JSON \(content-type: text\/plain\)/);
});

test("verify <url>: a non-2xx status is a clear error", async () => {
  await assert.rejects(fetchPassport(`${base}/missing`), /^Error: HTTP 404 fetching the passport$/);
});

test("verify <url>: bodies over the size cap are refused, with or without content-length", async () => {
  await assert.rejects(fetchPassport(`${base}/huge`), /larger than 1 MB/);
  await assert.rejects(fetchPassport(`${base}/huge-chunked`), /larger than 1 MB/);
});

test("verify <url>: a server that never answers times out", async () => {
  await assert.rejects(fetchPassport(`${base}/slow`, { timeoutMs: 200 }), /timed out/);
});

test("edge fetchPassport refuses the same responses as the CLI", async () => {
  const ok = await edge.fetchPassport(`${base}/passport.json`);
  assert.equal(ok.carbon_passport, "0.1");
  await assert.rejects(edge.fetchPassport(`${base}/spa-fallback`), /returned HTML, not a passport/);
  await assert.rejects(edge.fetchPassport(`${base}/html-no-doctype`), /returned HTML, not a passport/);
  await assert.rejects(edge.fetchPassport(`${base}/plain`), /did not return JSON \(content-type: text\/plain\)/);
  await assert.rejects(edge.fetchPassport(`${base}/missing`), /^Error: HTTP 404 fetching the passport$/);
  await assert.rejects(edge.fetchPassport(`${base}/huge`), /larger than 1 MB/);
  await assert.rejects(edge.fetchPassport(`${base}/huge-chunked`), /larger than 1 MB/);
});
