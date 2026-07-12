// Scans examples/ and the top-level README to build a JSON manifest the
// gallery's build.ts (HTML) and thumbs.ts (thumbnail extraction) both read.
// Doesn't touch or import any demo file -- pure filesystem + markdown-table
// parsing, so adding a new demo just means re-running `npm run gallery:build`.

import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = dirname(HERE); // examples/
const REPO_ROOT = dirname(EXAMPLES_DIR);

export interface DemoEntry {
  id: string;
  file: string; // path relative to EXAMPLES_DIR, for display / source links
  name: string; // filename without extension, e.g. "11-treemap"
  description: string;
  video: string | null; // path relative to EXAMPLES_DIR, for <video src>
  thumb: string | null; // path relative to EXAMPLES_DIR, for <img src>
  sourceUrl: string | null; // link to the specific original example this demo recreates, when reliably known
}

export interface Category {
  key: string;
  title: string;
  kind: "feature" | "parity";
  scorecard: string | null;
  readme: string; // path relative to EXAMPLES_DIR
  demos: DemoEntry[];
  sourceUrl: string | null; // the original gallery/site this whole campaign recreates
  sourceLabel: string | null; // display text for sourceUrl
}

// Every URL below is copied verbatim from (or, where noted, trivially
// schemed from) text already committed in this repo -- see the campaign's
// own README.md / ref/README.md for the citation. Never invent a URL that
// isn't already written down somewhere in the repo: several campaigns
// (threeb1b-parity, reveal-slidev-parity) cite their originals only as
// plain-text titles with no URL at all, and get no link here rather than a
// guessed one.
const CAMPAIGN_SOURCE: Record<string, { url: string; label: string }> = {
  "manim-parity": { url: "https://docs.manim.community/en/stable/examples.html", label: "docs.manim.community" },
  "showcase-parity": { url: "https://www.remotion.dev/showcase", label: "remotion.dev/showcase" },
  "motion-canvas-parity": { url: "https://motioncanvas.io", label: "motioncanvas.io" },
  "lottie-parity": { url: "https://github.com/airbnb/lottie-web", label: "github.com/airbnb/lottie-web" },
  "mermaid-parity": { url: "https://github.com/mermaid-js/mermaid", label: "github.com/mermaid-js/mermaid" },
};

export interface Manifest {
  generatedAt: string;
  categories: Category[];
}

const DESCRIPTION_COLUMN_PRIORITY = ["proves", "features proven", "shows"];

function findVideoAndThumb(dir: string, name: string): { video: string | null; thumb: string | null } {
  const mp4 = join(dir, "out", `${name}.mp4`);
  const jpg = join(dir, "thumbs", `${name}.jpg`);
  return {
    video: existsSync(mp4) ? relFromExamples(mp4) : null,
    thumb: existsSync(jpg) ? relFromExamples(jpg) : null,
  };
}

function relFromExamples(absPath: string): string {
  return absPath.slice(EXAMPLES_DIR.length + 1);
}

// Parses a GitHub-flavored markdown table immediately following a
// `## Scorecard...` heading. Returns { number -> descriptionText }, choosing
// the column whose header matches DESCRIPTION_COLUMN_PRIORITY (falls back to
// the last column when no header matches -- see manim-parity's README,
// which has no "Proves"/"Features proven" column).
function parseScorecardTable(readmeText: string): { heading: string | null; byNumber: Map<string, string> } {
  const lines = readmeText.split("\n");
  const headingIdx = lines.findIndex((l) => /^## Scorecard/.test(l));
  const byNumber = new Map<string, string>();
  if (headingIdx === -1) return { heading: null, byNumber };
  const heading = lines[headingIdx].replace(/^##\s*/, "");

  const tableLines: string[] = [];
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("|")) tableLines.push(line);
    else if (tableLines.length > 0) break; // table ended
  }
  if (tableLines.length < 2) return { heading, byNumber };

  const cells = (line: string) =>
    line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());

  const header = cells(tableLines[0]).map((h) => h.toLowerCase());
  let descCol = header.length - 1;
  for (const wanted of DESCRIPTION_COLUMN_PRIORITY) {
    const idx = header.findIndex((h) => h.includes(wanted));
    if (idx !== -1) {
      descCol = idx;
      break;
    }
  }

  for (const line of tableLines.slice(2)) {
    // skip the |---|---| separator row
    if (/^\|[\s:-]+\|$/.test(line.replace(/\s/g, "")) && !/\d/.test(line)) continue;
    const row = cells(line);
    const num = row[0]?.replace(/\*/g, "").trim();
    if (!/^\d+$/.test(num ?? "")) continue;
    byNumber.set(num.padStart(2, "0"), row[descCol] ?? "");
  }
  return { heading, byNumber };
}

// Parses a `ref/README.md` provenance table whose rows are
// `| NN | [label](./NN-name.ext) ... | ... | URL |` (echarts-parity,
// gsap-parity, p5-parity all use this exact shape) into { number -> URL }.
// Scans cells right-to-left for the first one containing a bare http(s) URL,
// since the URL is always the last cell but a couple of rows (e.g. p5's 11)
// have trailing parenthetical prose *after* the URL in the same cell.
function parseRefSourceUrls(readmeText: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of readmeText.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const num = cells[0]?.replace(/\*/g, "").trim();
    if (!/^\d+$/.test(num ?? "")) continue;
    for (let i = cells.length - 1; i >= 0; i--) {
      const m = cells[i].match(/https?:\/\/\S+/);
      if (m) {
        map.set(num.padStart(2, "0"), m[0].replace(/[),.]+$/, ""));
        break;
      }
    }
  }
  return map;
}

// d3-parity's ref/ files aren't numbered (bar-chart.js, treemap.js, ...) --
// match by exact basename against the demo's name with its "NN-" prefix
// stripped, and only link when that match is exact (a fuzzy/best-guess
// match risks a broken link more than it's worth -- ~5/25 demo names don't
// exactly match their ref file, e.g. "radial-stacked-bar" vs the ref file
// "radial-stacked-bar-chart.js", and those get no link rather than a guess).
// The https://observablehq.com/@d3/<slug> URL form itself is documented in
// ref/README.md as the exact fetch template these files came from.
function d3SourceUrl(dir: string, demoName: string): string | null {
  const base = demoName.replace(/^\d+-/, "");
  return existsSync(join(dir, "ref", `${base}.js`)) ? `https://observablehq.com/@d3/${base}` : null;
}

const REF_SOURCE_TABLE_CAMPAIGNS = new Set(["echarts-parity", "gsap-parity", "p5-parity"]);

function parityCategory(dirName: string): Category {
  const dir = join(EXAMPLES_DIR, dirName);
  const readmePath = join(dir, "README.md");
  const readmeText = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : "";
  const { heading, byNumber } = parseScorecardTable(readmeText);

  let refUrlsByNumber = new Map<string, string>();
  if (REF_SOURCE_TABLE_CAMPAIGNS.has(dirName)) {
    const refReadmePath = join(dir, "ref", "README.md");
    if (existsSync(refReadmePath)) refUrlsByNumber = parseRefSourceUrls(readFileSync(refReadmePath, "utf8"));
  }

  const files = readdirSync(dir)
    .filter((f) => /^\d+.*\.ts$/.test(f))
    .sort((a, b) => parseInt(a) - parseInt(b));

  const demos: DemoEntry[] = files.map((f) => {
    const name = f.replace(/\.ts$/, "");
    const num = (name.match(/^(\d+)/)?.[1] ?? "").padStart(2, "0");
    const { video, thumb } = findVideoAndThumb(dir, name);
    const sourceUrl = dirName === "d3-parity" ? d3SourceUrl(dir, name) : refUrlsByNumber.get(num) ?? null;
    return {
      id: `${dirName}/${name}`,
      file: `${dirName}/${f}`,
      name,
      description: byNumber.get(num) ?? "",
      video,
      thumb,
      sourceUrl,
    };
  });

  const campaignSource = CAMPAIGN_SOURCE[dirName] ?? null;
  return {
    key: dirName,
    title: dirName.replace(/-parity$/, "").replace(/-/g, " "),
    kind: "parity",
    scorecard: heading,
    readme: `${dirName}/README.md`,
    demos,
    sourceUrl: campaignSource?.url ?? null,
    sourceLabel: campaignSource?.label ?? null,
  };
}

// Parses README.md's `## Examples` table for the loose top-level feature
// demos (examples/*.ts, not inside a *-parity/ subdirectory).
function featureCategory(): Category {
  const readmeText = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
  const lines = readmeText.split("\n");
  const headingIdx = lines.findIndex((l) => /^## Examples$/.test(l));
  const rows = new Map<string, string>(); // filename (no ext) -> description
  if (headingIdx !== -1) {
    for (let i = headingIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith("|")) {
        if (rows.size > 0) break;
        continue;
      }
      const m = line.match(/`examples\/([\w-]+)\.ts`\s*\|\s*(.+?)\s*\|\s*$/);
      if (m) rows.set(m[1], m[2]);
    }
  }

  const files = readdirSync(EXAMPLES_DIR).filter((f) => /\.ts$/.test(f) && !f.startsWith("_"));
  const demos: DemoEntry[] = files.map((f) => {
    const name = f.replace(/\.ts$/, "");
    const { video, thumb } = findVideoAndThumb(EXAMPLES_DIR, name);
    return {
      id: `feature-demos/${name}`,
      file: f,
      name,
      description: rows.get(name) ?? "",
      video,
      thumb,
      sourceUrl: null,
    };
  });

  return {
    key: "feature-demos",
    title: "feature demos",
    kind: "feature",
    scorecard: `${demos.filter((d) => d.video).length}/${demos.length} rendered`,
    sourceUrl: null,
    sourceLabel: null,
    readme: "../README.md",
    demos,
  };
}

export function buildManifest(): Manifest {
  const parityDirs = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith("-parity"));
  const categories = [featureCategory(), ...parityDirs.map(parityCategory)];
  return { generatedAt: new Date().toISOString(), categories };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = buildManifest();
  const out = join(HERE, "manifest.json");
  writeFileSync(out, JSON.stringify(manifest, null, 2));
  const totalDemos = manifest.categories.reduce((n, c) => n + c.demos.length, 0);
  const withVideo = manifest.categories.reduce((n, c) => n + c.demos.filter((d) => d.video).length, 0);
  const withThumb = manifest.categories.reduce((n, c) => n + c.demos.filter((d) => d.thumb).length, 0);
  console.log(`manifest.json: ${manifest.categories.length} categories, ${totalDemos} demos (${withVideo} rendered, ${withThumb} thumbnailed)`);
}
