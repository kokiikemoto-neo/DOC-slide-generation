// オフライン・プレビュー: Google Slides を作らずに、render と同じ配置ロジックで
// 1枚を PNG 合成して out/preview.png に書き出す。認証不要・レイアウト確認用。
//   npx tsx scripts/preview.ts --input samples/content.example.json
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { ROOT } from "../src/config.js";
import { loadStyleSpec, loadComingSoonContent } from "../src/load.js";
import { composeComingSoon } from "../src/compose/layout.js";
import { warpToQuad } from "../src/render/perspective.js";
import { containRect } from "../src/render/util.js";
import type { FontStyle, Rect, Region, StyleSpec } from "../src/types.js";

const SCALE = 2; // px per pt（プレビュー解像度）

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function region(spec: StyleSpec, id: string): Region | undefined {
  return spec.regions[id];
}
function fontFor(spec: StyleSpec, r: Region): FontStyle {
  const key = r.type === "rect" ? r.style : undefined;
  return (key && spec.typography[key]) || spec.typography["body"]!;
}

/** fit.ts と同系の em 幅見積りで実際に行へ折り返す。 */
function wrapText(text: string, rectWpt: number, sizePt: number): string[] {
  const maxEm = rectWpt / sizePt;
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    let em = 0;
    for (const ch of para) {
      const cp = ch.codePointAt(0) ?? 0x20;
      const w = cp <= 0x2e7f && cp >= 0x20 ? 0.5 : 1.0;
      if (em + w > maxEm && line) {
        out.push(line);
        line = ch;
        em = w;
      } else {
        line += ch;
        em += w;
      }
    }
    out.push(line);
  }
  return out;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
}

/** テキストブロックを SVG(透明) に描いて Buffer 化。座標は px。 */
async function renderTextPng(
  text: string,
  rect: Rect,
  font: FontStyle,
  sizePt: number,
  valignMiddle: boolean
): Promise<Buffer> {
  const wPx = Math.round(rect.w * SCALE);
  const hPx = Math.round(rect.h * SCALE);
  const sizePx = sizePt * SCALE;
  const lineH = sizePx * 1.35;
  const lines = wrapText(text, rect.w, sizePt);
  const blockH = lines.length * lineH;
  const startY = valignMiddle ? Math.max(sizePx, (hPx - blockH) / 2 + sizePx * 0.8) : sizePx;
  const align = font.align ?? "left";
  const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
  const x = align === "center" ? wPx / 2 : align === "right" ? wPx : 0;
  const weight = font.weightHint === "bold" ? "bold" : "normal";
  const tspans = lines
    .map((ln, i) => `<tspan x="${x}" y="${startY + i * lineH}">${escapeXml(ln)}</tspan>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}">
    <text font-family="${font.family}, sans-serif" font-size="${sizePx}" font-weight="${weight}" fill="${font.color}" text-anchor="${anchor}">${tspans}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main(): Promise<void> {
  const stylePath = arg("style", path.join(ROOT, "samples", "stylespec-coming-soon.json"))!;
  const inputPath = arg("input", path.join(ROOT, "samples", "content.example.json"))!;
  const spec = loadStyleSpec(stylePath);
  const content = loadComingSoonContent(inputPath);
  const { plan, warnings } = composeComingSoon(spec, content);
  warnings.forEach((w) => console.warn(`⚠ ${w}`));

  const workDir = path.join(ROOT, "out");
  fs.mkdirSync(workDir, { recursive: true });

  const pageWpx = Math.round(spec.pageSize.w * SCALE);
  const pageHpx = Math.round(spec.pageSize.h * SCALE);

  // 背景
  const canvas = sharp(path.resolve(ROOT, spec.background!)).resize(pageWpx, pageHpx);
  const layers: sharp.OverlayOptions[] = [];
  const el = (id: string) => plan.slides[0]!.elements.find((e) => e.region === id);

  // frames（透視変換 → ページ全面）
  for (const fid of ["frame1", "frame2"]) {
    const e = el(fid);
    const r = region(spec, fid);
    if (!e?.value || !r || r.type !== "quad") continue;
    const src = path.resolve(ROOT, e.value);
    const warped = path.join(workDir, `preview-${fid}.png`);
    await warpToQuad({
      inputPath: src,
      outputPath: warped,
      quad: r.quad,
      pageW: spec.pageSize.w,
      pageH: spec.pageSize.h,
      scale: SCALE,
    });
    layers.push({ input: warped, top: 0, left: 0 });
  }

  // logo / qr（contain）
  for (const iid of ["logo", "qr"]) {
    const e = el(iid);
    const r = region(spec, iid);
    if (!e?.value || !r || r.type !== "rect") continue;
    const buf = fs.readFileSync(path.resolve(ROOT, e.value));
    const meta = await sharp(buf).metadata();
    const fit = containRect(r.rect, meta.width ?? 1, meta.height ?? 1);
    const resized = await sharp(buf)
      .resize(Math.round(fit.w * SCALE), Math.round(fit.h * SCALE), { fit: "fill" })
      .png()
      .toBuffer();
    layers.push({ input: resized, top: Math.round(fit.y * SCALE), left: Math.round(fit.x * SCALE) });
  }

  // text（role==="text" の全 region: tagline/heading1/body1/heading2/body2 …）
  for (const [slot, r] of Object.entries(spec.regions)) {
    if (r.type !== "rect" || r.role !== "text") continue;
    const e = el(slot);
    if (!e) continue;
    const font = fontFor(spec, r);
    const vmid = r.style !== "body"; // body は上揃え、それ以外は中央
    const png = await renderTextPng(e.value ?? "", r.rect, font, e.fontSizePt ?? font.sizePt, vmid);
    layers.push({ input: png, top: Math.round(r.rect.y * SCALE), left: Math.round(r.rect.x * SCALE) });
  }

  const outPath = path.join(workDir, "preview.png");
  await canvas.composite(layers).png().toFile(outPath);
  console.log(`preview written: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
