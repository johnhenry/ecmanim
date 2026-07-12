// Generates static HTML for the examples gallery from manifest.ts's data.
// Writes examples/gallery/index.html + one examples/gallery/<category>.html
// per category. No client-side JS, no build tooling, no dependencies -- just
// template literals -- since this is example tooling for a library, not a
// product. Serve the REPO ROOT as the static root (not examples/ -- the
// top-level README.md lives one level above examples/, so it's unreachable
// if examples/ is the root) and open /examples/gallery/index.html. Every
// page sets <base href="/examples/gallery/">, which pins relative-link
// resolution to that fixed path regardless of the URL bar -- several static
// servers (e.g. `serve`'s clean-URL redirect) rewrite index.html -> index or
// strip it entirely, which silently breaks plain relative hrefs otherwise.

// Paths in manifest.ts (video/thumb/readme) are stored relative to
// EXAMPLES_DIR; gallery pages live one level inside it (examples/gallery/),
// so every emitted src/href needs one extra "../".
function fromGallery(examplesRelativePath: string): string {
  return `../${examplesRelativePath}`;
}

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest, type Manifest, type Category, type DemoEntry } from "./manifest.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Minimal inline markdown: `code` spans and **bold** -- descriptions are
// pulled verbatim from README tables, which use both.
function mdInline(s: string): string {
  return escapeHtml(s)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [text](url) -> text; doc-relative urls don't resolve from gallery/
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<base href="/examples/gallery/">
<link rel="stylesheet" href="style.css">
</head>
<body>
${body}
</body>
</html>
`;
}

function demoCard(demo: DemoEntry): string {
  const media = demo.video
    ? `<video controls preload="none" poster="${escapeHtml(demo.thumb ? fromGallery(demo.thumb) : "")}"><source src="${escapeHtml(fromGallery(demo.video))}" type="video/mp4"></video>`
    : `<div class="unrendered">not yet rendered — run <code>npm run gallery:render-missing</code><br>(or just this one: <code>npx tsx examples/${escapeHtml(demo.file)}</code>)</div>`;
  return `<figure class="card">
  ${media}
  <figcaption>
    <span class="name">${escapeHtml(demo.name)}</span>
    <p class="desc">${mdInline(demo.description || "—")}</p>
    <code class="path">${escapeHtml(demo.file)}</code>
  </figcaption>
</figure>`;
}

function buildIndex(manifest: Manifest): string {
  const totalDemos = manifest.categories.reduce((n, c) => n + c.demos.length, 0);
  const totalRendered = manifest.categories.reduce((n, c) => n + c.demos.filter((d) => d.video).length, 0);
  const cards = manifest.categories
    .map((cat) => {
      const previewDemo = cat.demos.find((d) => d.thumb) ?? cat.demos[0];
      const preview = previewDemo?.thumb
        ? `<img src="${escapeHtml(fromGallery(previewDemo.thumb))}" alt="">`
        : `<div class="unrendered">no renders yet</div>`;
      const rendered = cat.demos.filter((d) => d.video).length;
      return `<a class="cat-card" href="${escapeHtml(cat.key)}.html">
  ${preview}
  <h3>${escapeHtml(cat.title)}</h3>
  <p class="scorecard">${escapeHtml(cat.scorecard ?? "")}</p>
  <p class="count">${rendered}/${cat.demos.length} rendered</p>
</a>`;
    })
    .join("\n");
  const missing = totalDemos - totalRendered;
  const setupBanner =
    missing > 0
      ? `<div class="setup-banner">
  <strong>${missing} demo${missing === 1 ? "" : "s"} not yet rendered on this machine.</strong>
  Rendered videos aren't committed to git (they're regenerated locally), so a fresh clone starts empty.
  From the repo root: <code>npm install</code>, then <code>npm run gallery:render-missing</code>
  (renders everything missing at low quality, then rebuilds this site — safe to re-run, skips
  anything already rendered). Pass <code>-- --category d3-parity</code> to render one gallery at a
  time, or <code>-- --limit 5</code> to try a few first. If a render fails, run
  <code>npx ecmanim checkhealth</code> to check for a missing system dependency (ffmpeg, canvas, fonts).
</div>`
      : "";
  return page(
    "ecmanim examples gallery",
    `<header>
  <h1>ecmanim examples gallery</h1>
  <p>${manifest.categories.length} galleries · ${totalDemos} demos · ${totalRendered} rendered</p>
  <p><a href="../../README.md">← back to README</a></p>
</header>
${setupBanner}
<main class="cat-grid">
${cards}
</main>`,
  );
}

function buildCategoryPage(cat: Category): string {
  const cards = cat.demos.map(demoCard).join("\n");
  return page(
    `${cat.title} — ecmanim gallery`,
    `<header>
  <p><a href="index.html">← all galleries</a></p>
  <h1>${escapeHtml(cat.title)}</h1>
  <p class="scorecard">${escapeHtml(cat.scorecard ?? "")}</p>
  <p><a href="${escapeHtml(fromGallery(cat.readme))}">README</a></p>
</header>
<main class="demo-grid">
${cards}
</main>`,
  );
}

const manifest = buildManifest();
mkdirSync(HERE, { recursive: true });
writeFileSync(join(HERE, "manifest.json"), JSON.stringify(manifest, null, 2));
writeFileSync(join(HERE, "index.html"), buildIndex(manifest));
for (const cat of manifest.categories) {
  writeFileSync(join(HERE, `${cat.key}.html`), buildCategoryPage(cat));
}

console.log(`Built ${manifest.categories.length + 1} pages -> examples/gallery/`);
console.log(`Serve with (from the repo root): npx serve . -- then open /examples/gallery/index.html`);
