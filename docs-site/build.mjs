#!/usr/bin/env node
/**
 * docs.carbonmd.dev — static docs generator.
 *
 * Zero dependencies on purpose: it must build anywhere, offline, including
 * from an agent on a VPS with no npm install. Markdown support is a compact
 * subset (headings, lists, tables, code, blockquotes, links, emphasis, hr)
 * — enough for these docs, which we author ourselves.
 *
 *   node build.mjs            # -> dist/
 *   node build.mjs --out foo  # custom output dir
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const localeIdx = process.argv.indexOf("--locale");
const LOCALE = localeIdx >= 0 ? process.argv[localeIdx + 1] : "en";
const BUILD_BOTH = localeIdx < 0 && process.argv.indexOf("--out") < 0;
const CONTENT = join(ROOT, LOCALE === "fr" ? "content-fr" : "content");
const navFile = LOCALE === "fr" ? "nav-fr.json" : "nav.json";
const outIdx = process.argv.indexOf("--out");
const defaultOut = LOCALE === "fr" ? "dist/fr" : "dist";
const OUT = resolve(ROOT, outIdx >= 0 ? process.argv[outIdx + 1] : defaultOut);

if (!existsSync(join(ROOT, navFile))) {
  console.error("Missing " + navFile);
  process.exit(1);
}
const nav = JSON.parse(readFileSync(join(ROOT, navFile), "utf8"));
const PREFIX = LOCALE === "fr" ? "/fr" : "";
if (LOCALE === "fr" && nav.site && nav.site.baseUrl && !String(nav.site.baseUrl).endsWith("/fr")) {
  nav.site.baseUrl = String(nav.site.baseUrl).replace(/\/$/, "") + "/fr";
}

/* ---------------------------------------------------------------- markdown */

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** inline: `code`, **bold**, *italic*, [text](url) — code spans are extracted
 *  first (so markup inside them is never interpreted) and restored last.
 *  Placeholders use NUL sentinels so bare numbers in prose are never swallowed. */
function inline(s) {
  const code = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${code.push(`<code>${esc(c)}</code>`) - 1}\u0000`);
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
    const ext = /^https?:/.test(u);
    return `<a href="${u}"${ext ? ' target="_blank" rel="noopener"' : ""}>${t}${ext ? " ↗" : ""}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => code[Number(i)]);
  return s;
}

const slugify = (s) =>
  s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");

function markdown(src) {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  const toc = [];
  let i = 0;

  const closeList = (stack) => { while (stack.length) out.push(`</${stack.pop()}>`); };
  const listStack = [];

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (/^```/.test(line)) {
      closeList(listStack);
      const lang = line.slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre class="code"${lang ? ` data-lang="${esc(lang)}"` : ""}><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // table
    if (/^\|/.test(line) && /^\|[\s:|-]+\|$/.test(lines[i + 1] || "")) {
      closeList(listStack);
      const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>` +
          rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("") +
          `</tbody></table></div>`
      );
      continue;
    }

    // heading
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      closeList(listStack);
      const level = h[1].length;
      const text = inline(h[2]);
      const id = slugify(h[2]);
      if (level === 2 || level === 3) toc.push({ level, id, text });
      out.push(`<h${level} id="${id}"><a class="anchor" href="#${id}">${text}</a></h${level}>`);
      i++;
      continue;
    }

    // hr
    if (/^---+$/.test(line.trim())) { closeList(listStack); out.push("<hr>"); i++; continue; }

    // blockquote / callout  (> **Note:** …)
    if (/^>\s?/.test(line)) {
      closeList(listStack);
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }

    // lists (one nesting level)
    const ul = /^(\s*)[-*]\s+(.*)$/.exec(line);
    const ol = /^(\s*)\d+\.\s+(.*)$/.exec(line);
    if (ul || ol) {
      const m = ul || ol;
      const tag = ul ? "ul" : "ol";
      const indent = m[1].length;
      const want = indent >= 2 ? 2 : 1;
      while (listStack.length > want) out.push(`</${listStack.pop()}>`);
      if (listStack.length < want) { out.push(`<${tag}>`); listStack.push(tag); }
      out.push(`<li>${inline(m[2])}</li>`);
      i++;
      continue;
    }

    // blank
    if (!line.trim()) { closeList(listStack); i++; continue; }

    // paragraph
    closeList(listStack);
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\||>|\s*[-*]\s|\s*\d+\.\s|---+$)/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  closeList(listStack);
  return { html: out.join("\n"), toc };
}

/* ------------------------------------------------------------------ layout */

const CSS = readFileSync(join(ROOT, "style.css"), "utf8");

function href(slug) { return slug ? `/${slug}/` : "/"; }

function sidebar(current) {
  return nav.sections
    .map(
      (s) => `<div class="nav-group"><div class="nav-title">${s.title}</div><ul>${s.pages
        .map((p) => `<li><a href="${href(p.slug)}"${p.slug === current ? ' class="active" aria-current="page"' : ""}>${p.title}</a></li>`)
        .join("")}</ul></div>`
    )
    .join("");
}

function flatPages() {
  return nav.sections.flatMap((s) => s.pages);
}

function layout({ title, description, bodyHtml, toc, slug, notFound = false }) {
  const pages = flatPages();
  const idx = notFound ? -1 : pages.findIndex((p) => p.slug === slug);
  const prev = idx > 0 ? pages[idx - 1] : null;
  const next = idx >= 0 && idx < pages.length - 1 ? pages[idx + 1] : null;
  const canonical = `${nav.site.baseUrl}${href(slug)}`;
  const full = slug === "" && !notFound ? nav.site.title : `${title} — ${nav.site.title}`;
  // A 404 is served at whatever URL was missed: no canonical, not indexable.
  const urlMeta = notFound
    ? `<meta name="robots" content="noindex">`
    : `<link rel="canonical" href="${canonical}">\n<meta property="og:url" content="${canonical}">`;

  const tocHtml = toc.filter((t) => t.level === 2).length
    ? `<aside class="toc"><div class="toc-title">On this page</div><ul>${toc
        .map((t) => `<li class="lvl${t.level}"><a href="#${t.id}">${t.text}</a></li>`)
        .join("")}</ul></aside>`
    : `<aside class="toc"></aside>`;

  return `<!doctype html>
<html lang="${LOCALE}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description || "Documentation for carbon.md — the open standard for carbon-governed AI agents.")}">
${urlMeta}
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(description || "Documentation for carbon.md")}">
<meta name="theme-color" content="#0A0C0B">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230A0C0B'/%3E%3Cg stroke='%234ADE80' stroke-width='2.4' stroke-linecap='round'%3E%3Cline x1='9' y1='11' x2='16' y2='11'/%3E%3Cline x1='9' y1='16' x2='23' y2='16'/%3E%3Cline x1='9' y1='21' x2='19' y2='21'/%3E%3C/g%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<nav class="topbar">
  <div class="bar">
    <a class="brand" href="/">
      <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#0E1110"/><g stroke="#4ADE80" stroke-width="2.4" stroke-linecap="round"><line x1="9" y1="11" x2="16" y2="11"/><line x1="9" y1="16" x2="23" y2="16"/><line x1="9" y1="21" x2="19" y2="21"/></g></svg>
      carbon<span class="dot">.md</span> <span class="docs-tag">docs</span>
    </a>
    <div class="bar-links">
      <span class="lang-switch" aria-label="Language">
        <a href="${slug ? ("/" + slug + "/") : "/"}" hreflang="en" lang="en"${LOCALE === "en" ? " aria-current=\"true\"" : ""}>EN</a>
        <a href="${slug ? ("/fr/" + slug + "/") : "/fr/"}" hreflang="fr" lang="fr"${LOCALE === "fr" ? " aria-current=\"true\"" : ""}>FR</a>
      </span>
      <a href="${LOCALE === "fr" ? nav.site.siteUrl + "/fr/" : nav.site.siteUrl}">${LOCALE === "fr" ? "Accueil" : "Home"}</a>
      <a href="${nav.site.siteUrl}/ledger/">${LOCALE === "fr" ? "Ledger live" : "Live ledger"}</a>
      <a href="${nav.site.repo}" target="_blank" rel="noopener">GitHub ↗</a>
    </div>
    <button class="menu-btn" aria-label="Toggle navigation" onclick="document.body.classList.toggle('nav-open')">☰</button>
  </div>
</nav>
<div class="shell">
  <aside class="sidebar">${sidebar(notFound ? null : slug)}</aside>
  <main id="main">
    <article class="prose">${bodyHtml}</article>
    <nav class="pager">
      ${prev ? `<a class="prev" href="${href(prev.slug)}"><span>${LOCALE === "fr" ? "← Précédent" : "← Previous"}</span><b>${prev.title}</b></a>` : "<span></span>"}
      ${next ? `<a class="next" href="${href(next.slug)}"><span>${LOCALE === "fr" ? "Suivant →" : "Next →"}</span><b>${next.title}</b></a>` : "<span></span>"}
    </nav>
    <footer class="foot">
      <p>${LOCALE === "fr" ? "Estimations, pas des mesures — les fourchettes sont voulues. carbon.md ne revendique jamais la neutralité carbone." : "Estimates, not measurements — ranges are shown by design. carbon.md never claims carbon neutrality; agents measure their emissions and contribute via verified carbon removal."}</p>
      <p>${LOCALE === "fr" ? "Porté par" : "Stewarded by"} <a href="https://agentic-realism.com" target="_blank" rel="noopener">Agentic Realism</a> · MIT · <a href="${nav.site.repo}" target="_blank" rel="noopener">${LOCALE === "fr" ? "Éditer sur GitHub" : "Edit on GitHub"}</a></p>
    </footer>
  </main>
  ${tocHtml}
</div>
</body>
</html>`;
}

/* ------------------------------------------------------------------- build */

function firstParagraph(md) {
  const m = md.split("\n").find((l) => l.trim() && !l.startsWith("#") && !l.startsWith(">"));
  return m ? m.replace(/[*`\[\]]/g, "").slice(0, 180) : "";
}

if (LOCALE === "en") {
  // wipe EN outputs but keep dist/fr if present
  if (existsSync(OUT)) {
    for (const name of readdirSync(OUT)) {
      if (name === "fr") continue;
      rmSync(join(OUT, name), { recursive: true, force: true });
    }
  } else {
    mkdirSync(OUT, { recursive: true });
  }
} else {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
}

let count = 0;
for (const section of nav.sections) {
  for (const page of section.pages) {
    const src = join(CONTENT, page.file);
    if (!existsSync(src)) { console.warn(`⚠ missing content: ${page.file}`); continue; }
    const md = readFileSync(src, "utf8");
    const { html, toc } = markdown(md);
    const dir = page.slug ? join(OUT, page.slug) : OUT;
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "index.html"),
      layout({ title: page.title, description: firstParagraph(md), bodyHtml: html, toc, slug: page.slug }),
      "utf8"
    );
    count++;
  }
}

// 404.html — without a top-level one, Cloudflare Pages assumes a single-page
// app and answers every unknown path (fake /v1/* routes included) with
// index.html and a 200. With it, misses get a real 404. Pages serves the
// nearest 404.html up the tree, so dist/fr/404.html covers /fr/*.
{
  const notFoundMd = LOCALE === "fr"
    ? `# Page introuvable\n\nIl n'y a pas de page à cette adresse. Elle a peut-être été déplacée, ou l'URL contient une faute de frappe.\n\n- [Accueil de la documentation](${PREFIX}/)\n- [Démarrage rapide](${PREFIX}/quickstart/)\n- [API d'attestation](${PREFIX}/api/) — les endpoints sont \`/v1/verify\` et \`/v1/badge\`\n`
    : `# Page not found\n\nThere is no page at this address. It may have moved, or the URL may have a typo.\n\n- [Docs home](${PREFIX}/)\n- [Quickstart](${PREFIX}/quickstart/)\n- [Attestation API](${PREFIX}/api/) — the endpoints are \`/v1/verify\` and \`/v1/badge\`\n`;
  const { html } = markdown(notFoundMd);
  const title = LOCALE === "fr" ? "Page introuvable" : "Page not found";
  writeFileSync(join(OUT, "404.html"), layout({ title, description: title, bodyHtml: html, toc: [], slug: "", notFound: true }), "utf8");
}

// static/ is copied verbatim into dist — fixtures the docs need to be checkable
function copyTree(from, to) {
  if (!existsSync(from)) return;
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const src = join(from, entry);
    const dst = join(to, entry);
    if (statSync(src).isDirectory()) copyTree(src, dst);
    else copyFileSync(src, dst);
  }
}
copyTree(join(ROOT, "static"), OUT);

// static extras: /agent (the agent install contract), robots, sitemap
// In the public repo the contract is one level up; in the private workspace
// the CLI mirror lives in repo/. Support both layouts without inventing a
// contract or changing the landing site. Fail loudly rather than serving
// fallback HTML under a text/plain content type.
const agentCandidates = [join(ROOT, "..", "agent.txt"), join(ROOT, "..", "repo", "agent.txt")];
const agentTxt = agentCandidates.find((path) => existsSync(path));
if (!agentTxt) {
  throw new Error("agent.txt not found at " + agentCandidates.join(" or ") + " — /agent would serve fallback HTML labelled text/plain");
}
{
  // /agent itself is served by functions/agent.js from agent.txt: Pages never
  // serves index.txt for a directory, so a static /agent/ fell through to HTML.
  copyFileSync(agentTxt, join(OUT, "agent.txt"));
  mkdirSync(join(OUT, ".well-known", "carbon-md"), { recursive: true });
  copyFileSync(agentTxt, join(OUT, ".well-known", "carbon-md", "agent.txt"));
}

writeFileSync(join(OUT, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${nav.site.baseUrl}/sitemap.xml\n`, "utf8");
writeFileSync(
  join(OUT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    flatPages().map((p) => `  <url><loc>${nav.site.baseUrl}${href(p.slug)}</loc></url>`).join("\n") +
    `\n</urlset>\n`,
  "utf8"
);
// serve the agent contract files as text/plain. No /agent rule: that path is a
// Function (functions/agent.js sets its own type) and _headers skips Functions.
writeFileSync(join(OUT, "_headers"), `/agent.txt\n  Content-Type: text/plain; charset=utf-8\n/.well-known/carbon-md/agent.txt\n  Content-Type: text/plain; charset=utf-8\n`, "utf8");

console.log(`✔ built ${count} pages → ${OUT}`);

// A bare `node build.mjs` should build the whole site, not half of it.
// The FR pass writes dist/fr and the EN pass deliberately spares it, so
// building only EN leaves French silently frozen at its last build — a page
// added today would 404 in French and nothing would say so.
if (BUILD_BOTH) {
  const { status, error } = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--locale", "fr"], { stdio: "inherit" });
  if (error) throw error;
  if (status !== 0) process.exit(status);
}
