/**
 * GET /agent — the agent install contract, as plain text.
 *
 * Pages serves index.html for a directory but never index.txt, so a static
 * /agent/index.txt fell through to HTML (labelled text/plain by _headers).
 * A _redirects rewrite would depend on how the asset server and Functions
 * interact; this answers directly with the same bytes as /agent.txt, a 200
 * and an explicit content type — what `curl` (no -L) and agents expect.
 * GET and HEAD only; any other method gets a 405 from Pages. HEAD needs its
 * own export: Pages does not route it to onRequestGet (it fell through to 404).
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  const asset = await env.ASSETS.fetch(new URL("/agent.txt", request.url));
  if (!asset.ok) return asset;
  const out = new Response(asset.body, asset);
  out.headers.set("content-type", "text/plain; charset=utf-8");
  return out;
}

export const onRequestHead = onRequestGet;
