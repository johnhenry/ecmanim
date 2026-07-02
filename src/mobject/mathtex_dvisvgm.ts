// OPTIONAL Node-only backend: render LaTeX with a REAL TeX toolchain instead of
// MathJax. Some constructs (exotic packages, precise kerning, custom fonts) only
// render correctly through actual LaTeX. This backend shells out to
// `latex`/`pdflatex` to produce a DVI/PDF, then `dvisvgm --no-fonts` to convert
// that to an SVG whose glyphs are real vector paths. The SVG is then turned into
// animatable VMobjects via the shared SVGMobject path.
//
//   REQUIRES a TeX distribution (`latex` + `dvisvgm`) on PATH. Neither is
//   installed in every environment. When the toolchain is absent,
//   `texToSVGViaDvisvgm` throws a clear, actionable error, and callers should
//   fall back to MathTex (MathJax). `mathTexDvisvgmOrFallback` does exactly
//   that.
//
// Results are cached on disk keyed by a hash of the (wrapped) tex source, so
// repeated renders of the same equation skip the expensive toolchain run.

import { VGroup } from "./VMobject.ts";
import { SVGMobject } from "./svg_mobject.ts";
import { MathTex } from "./mathtex.ts";
import type { MathTexConfig } from "./mathtex.ts";

// Lazy Node builtins (kept out of module top-level so a browser bundle that
// merely imports the types doesn't choke on node: specifiers).
async function nodeModules() {
  const [fs, os, path, crypto, cp] = await Promise.all([
    import("node:fs"),
    import("node:os"),
    import("node:path"),
    import("node:crypto"),
    import("node:child_process"),
  ]);
  return { fs, os, path, crypto, cp };
}

function isNode(): boolean {
  return typeof process !== "undefined" && !!(process as any).versions?.node;
}

// Return the absolute path of `cmd` if it exists on PATH, else null. Uses a
// cross-platform `which`/`where` lookup; caches nothing (cheap, called rarely).
async function whichBin(cmd: string): Promise<string | null> {
  const { cp } = await nodeModules();
  const finder = process.platform === "win32" ? "where" : "which";
  return await new Promise<string | null>((resolve) => {
    const child = cp.execFile(finder, [cmd], (err: any, stdout: string) => {
      if (err) return resolve(null);
      const first = String(stdout).split(/\r?\n/).find((l) => l.trim().length);
      resolve(first ? first.trim() : null);
    });
    child.on("error", () => resolve(null));
  });
}

/** Which TeX->SVG binaries are available. Both must be present to render. */
export interface DvisvgmToolchain {
  latex: string | null;   // `latex` (dvi) preferred; `pdflatex` fallback
  pdflatex: string | null;
  dvisvgm: string | null;
  available: boolean;     // true iff (latex||pdflatex) && dvisvgm
}

/** Detect the on-PATH TeX toolchain. */
export async function detectDvisvgmToolchain(): Promise<DvisvgmToolchain> {
  if (!isNode()) {
    return { latex: null, pdflatex: null, dvisvgm: null, available: false };
  }
  const [latex, pdflatex, dvisvgm] = await Promise.all([
    whichBin("latex"),
    whichBin("pdflatex"),
    whichBin("dvisvgm"),
  ]);
  return {
    latex,
    pdflatex,
    dvisvgm,
    available: !!(latex || pdflatex) && !!dvisvgm,
  };
}

// A minimal standalone LaTeX document for one equation.
function buildLatexDoc(tex: string, texEnvironment?: string): string {
  const body = texEnvironment
    ? `\\begin{${texEnvironment}}${tex}\\end{${texEnvironment}}`
    : `\\[${tex}\\]`;
  return [
    "\\documentclass[preview]{standalone}",
    "\\usepackage{amsmath}",
    "\\usepackage{amssymb}",
    "\\usepackage{amsfonts}",
    "\\begin{document}",
    body,
    "\\end{document}",
    "",
  ].join("\n");
}

async function cacheDir(): Promise<string> {
  const { os, path, fs } = await nodeModules();
  const dir = path.join(os.tmpdir(), "ecmanim-dvisvgm-cache");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function hashTex(doc: string): Promise<string> {
  const { crypto } = await nodeModules();
  return crypto.createHash("sha256").update(doc).digest("hex").slice(0, 32);
}

function runProcess(
  cp: any,
  bin: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = cp.spawn(bin, args, { cwd });
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code: number) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

/**
 * Render `tex` to an SVG string via a real TeX toolchain (latex/pdflatex +
 * dvisvgm --no-fonts), with an on-disk cache keyed by the tex source.
 *
 * @throws a clear "TeX toolchain not found; falls back to MathJax" error when
 *         `latex`/`pdflatex`/`dvisvgm` are not installed, so the caller can
 *         degrade to MathTex.
 */
export async function texToSVGViaDvisvgm(
  tex: string,
  config: MathTexConfig = {},
): Promise<string> {
  if (!isNode()) {
    throw new Error(
      "texToSVGViaDvisvgm is a Node-only backend (needs a TeX toolchain); " +
      "falls back to MathJax in the browser.",
    );
  }
  const { fs, path, cp } = await nodeModules();
  const tc = await detectDvisvgmToolchain();
  if (!tc.available) {
    const missing = [
      !tc.latex && !tc.pdflatex ? "latex/pdflatex" : null,
      !tc.dvisvgm ? "dvisvgm" : null,
    ].filter(Boolean).join(" and ");
    throw new Error(
      `TeX toolchain not found (missing ${missing}); falls back to MathJax. ` +
      "Install a TeX distribution (e.g. TeX Live) providing `latex` and `dvisvgm` to use this backend.",
    );
  }

  const doc = buildLatexDoc(String(tex), config.texEnvironment);
  const key = await hashTex(doc);
  const dir = await cacheDir();
  const cachedSvg = path.join(dir, key + ".svg");
  if (fs.existsSync(cachedSvg)) {
    return fs.readFileSync(cachedSvg, "utf-8");
  }

  // Scratch working directory for this compile.
  const work = fs.mkdtempSync(path.join(dir, "work-"));
  const jobname = "eq";
  const texFile = path.join(work, jobname + ".tex");
  fs.writeFileSync(texFile, doc, "utf-8");

  try {
    let svgSource: string; // path to the dvi or pdf dvisvgm will read
    if (tc.latex) {
      const r = await runProcess(cp, tc.latex, [
        "-interaction=nonstopmode", "-halt-on-error", jobname + ".tex",
      ], work);
      const dvi = path.join(work, jobname + ".dvi");
      if (r.code !== 0 || !fs.existsSync(dvi)) {
        throw new Error("latex failed:\n" + (r.stdout || r.stderr).slice(-2000));
      }
      svgSource = dvi;
    } else {
      // pdflatex -> PDF; dvisvgm reads PDF with --pdf.
      const r = await runProcess(cp, tc.pdflatex!, [
        "-interaction=nonstopmode", "-halt-on-error", jobname + ".tex",
      ], work);
      const pdf = path.join(work, jobname + ".pdf");
      if (r.code !== 0 || !fs.existsSync(pdf)) {
        throw new Error("pdflatex failed:\n" + (r.stdout || r.stderr).slice(-2000));
      }
      svgSource = pdf;
    }

    const outSvg = path.join(work, jobname + ".svg");
    const dvisvgmArgs = svgSource.endsWith(".pdf")
      ? ["--pdf", "--no-fonts", "-o", outSvg, svgSource]
      : ["--no-fonts", "-o", outSvg, svgSource];
    const dr = await runProcess(cp, tc.dvisvgm!, dvisvgmArgs, work);
    if (dr.code !== 0 || !fs.existsSync(outSvg)) {
      throw new Error("dvisvgm failed:\n" + (dr.stdout || dr.stderr).slice(-2000));
    }

    const svg = fs.readFileSync(outSvg, "utf-8");
    fs.writeFileSync(cachedSvg, svg, "utf-8"); // populate cache
    return svg;
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/**
 * Animatable LaTeX math rendered through a real TeX toolchain. Because the
 * toolchain is optional and slow, construct it with the async factory
 * `mathTexDvisvgm(tex, config)` (below). The class extends VGroup and holds the
 * glyph VMobjects parsed from the dvisvgm SVG.
 */
export class MathTexDvisvgm extends VGroup {
  tex: string;

  constructor(tex: string, svgMobject?: SVGMobject) {
    super();
    this.tex = String(tex);
    if (svgMobject) this.add(...svgMobject.submobjects);
  }
}

/**
 * Async factory: render `tex` with the TeX toolchain and build VMobjects from
 * the resulting SVG (reusing SVGMobject's path parser). Sizes by
 * `config.fontSize` (default 0.7, matching MathTex).
 *
 * @throws the toolchain-not-found error from texToSVGViaDvisvgm when latex/
 *         dvisvgm are unavailable. Use `mathTexDvisvgmOrFallback` to degrade to
 *         MathTex automatically.
 */
export async function mathTexDvisvgm(
  tex: string,
  config: MathTexConfig = {},
): Promise<MathTexDvisvgm> {
  const svg = await texToSVGViaDvisvgm(tex, config);
  const fontSize = config.fontSize ?? 0.7;
  const svgMob = new SVGMobject(svg, {
    height: fontSize,
    color: config.color as any,
    fillColor: config.fillColor as any,
    strokeColor: config.strokeColor as any,
    point: config.point,
  });
  const mob = new MathTexDvisvgm(tex, svgMob);
  if (config.point) mob.moveTo(config.point);
  else mob.center();
  return mob;
}

/**
 * Try the dvisvgm (real TeX) backend; if the toolchain isn't installed (or any
 * render error occurs), gracefully fall back to a normal MathTex (MathJax).
 * Always resolves to an animatable VGroup-derived mobject.
 */
export async function mathTexDvisvgmOrFallback(
  tex: string,
  config: MathTexConfig = {},
): Promise<MathTexDvisvgm | MathTex> {
  try {
    return await mathTexDvisvgm(tex, config);
  } catch {
    // Toolchain missing or render failed — degrade to the MathJax path. Note
    // MathTex is synchronous but requires initMathTex(); callers that use this
    // fallback should ensure `await initMathTex()` has run.
    return new MathTex(tex, config);
  }
}
