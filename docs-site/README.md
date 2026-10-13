# docs.carbonmd.dev

Source for the carbon.md documentation site. Zero-dependency static generator — builds anywhere, offline.

```bash
node build.mjs                 # → dist/ (EN) and dist/fr/ (FR)
npx wrangler pages deploy dist --project-name carbonmd-docs
```

A bare `node build.mjs` builds **both** locales. Passing `--locale` or `--out` builds only what you named — the EN pass spares `dist/fr`, so an EN-only build leaves French frozen at its previous state rather than deleting it. Silent, and worse than a failure: a page added today would 404 in French with nothing to say why.

## Layout

| Path | Purpose |
|---|---|
| `nav.json` | sidebar structure + page registry (add pages here) |
| `nav-fr.json` | the same, for French — pages must be registered in **both** |
| `content/` | the docs, in Markdown |
| `content-fr/` | the French translations |
| `functions/` | Cloudflare Pages Functions: locale middleware + the `/v1` attestation API |
| `static/` | copied verbatim into `dist/` (e.g. `examples/passport.json`) |
| `build.mjs` | the generator (markdown subset + layout) |
| `style.css` | design system — matches carbonmd.dev (dark, `#0A0C0B` / `#4ADE80`) |
| `dist/` | build output (gitignored) |

## Adding a page

1. `content/<section>/<page>.md` and `content-fr/<section>/<page>.md`
2. register it in `nav.json` **and** `nav-fr.json`
3. `node build.mjs`

Nav, prev/next, sitemap and the on-page TOC update automatically.

## Convention

**A feature is not done until it's documented.** See [content/docs-conventions.md](content/docs-conventions.md) for what each kind of change must document.

## Deploy notes

- Cloudflare Pages project: `carbonmd-docs` → attach `docs.carbonmd.dev` (CNAME `docs` → `carbonmd-docs.pages.dev`, proxied).
- `functions/` is picked up automatically by `wrangler pages deploy` when run from this directory; the deploy log should say `Uploading Functions bundle`.
- Wrangler needs `NODE_OPTIONS=--dns-result-order=ipv4first` on hosts with IPv6 egress, or auth fails with a misleading error 10000.
- The build copies `../agent.txt` (or `../repo/agent.txt`) to `/agent.txt` and `/.well-known/carbon-md/agent.txt`, and writes `_headers` so they're served as `text/plain`. `/agent` itself is answered by `functions/agent.js` from `/agent.txt` — Pages never serves `index.txt` for a directory, so a static `/agent/` would fall through to HTML.
- The build writes `404.html` (and `fr/404.html`). Without a top-level `404.html`, Pages treats the project as a single-page app and answers every unknown path with the homepage and a 200.
