// 暫定の固定下地 assets/background.png をプログラムで生成する。
// 正式版は元テンプレ画像から文字を消した下地を用意すること(README の TODO 参照)。
// ここでは StyleSpec の palette と regions から、発光フレーム枠・グラデ帯・番号丸・
// 区切り線・ロゴ白カードを近似描画した SVG を sharp で PNG 化する。
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { ROOT } from "../src/config.js";
import { loadStyleSpec } from "../src/load.js";
import type { Quad, Rect, Region, StyleSpec } from "../src/types.js";

const SCALE = 2; // px per pt

function region(spec: StyleSpec, id: string): Region | undefined {
  return spec.regions.find((r) => r.id === id);
}

function quadPoints(q: Quad): string {
  return [q.tl, q.tr, q.br, q.bl].map(([x, y]) => `${x},${y}`).join(" ");
}

function roundedRect(rect: Rect, fill: string, opts: { stroke?: string; sw?: number; rx?: number; opacity?: number } = {}): string {
  const { stroke = "none", sw = 0, rx = 8, opacity = 1 } = opts;
  return `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" rx="${rx}" ry="${rx}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="${sw}"/>`;
}

function buildSvg(spec: StyleSpec): string {
  const { w: W, h: H } = spec.meta.pageSize;
  const p = spec.palette;
  const parts: string[] = [];

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}">`);

  // defs: タグライン帯のグラデ + フレームのソフト発光
  parts.push(`<defs>
    <linearGradient id="band" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${p.gradFrom ?? "#C3CEFC"}"/>
      <stop offset="100%" stop-color="${p.gradTo ?? "#E6CCFB"}"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="${p.frameGlow ?? "#8AA0FF"}" flood-opacity="0.9"/>
    </filter>
  </defs>`);

  // 背景
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${p.background ?? "#EEEDFD"}"/>`);

  // ロゴ白カード
  const logo = region(spec, "logo");
  if (logo) parts.push(roundedRect(logo.rect, "#FFFFFF", { rx: 10, stroke: p.boxFill ?? "#DFDEFD", sw: 1 }));

  // タグライン グラデ帯
  const tagline = region(spec, "tagline");
  if (tagline) parts.push(roundedRect(tagline.rect, "url(#band)", { rx: 14 }));

  // QR プレースホルダ枠
  const qr = region(spec, "qr");
  if (qr)
    parts.push(
      `<rect x="${qr.rect.x}" y="${qr.rect.y}" width="${qr.rect.w}" height="${qr.rect.h}" rx="8" ry="8" fill="#FFFFFF" stroke="${p.numberCircle ?? "#C3C3FF"}" stroke-width="1.5" stroke-dasharray="5 4"/>`
    );

  // 発光フレーム(傾き): quad ポリゴンを描く
  for (const id of ["frame1", "frame2"]) {
    const f = region(spec, id);
    if (f?.quad) {
      parts.push(
        `<polygon points="${quadPoints(f.quad)}" fill="${p.boxFill ?? "#DFDEFD"}" stroke="${p.frameGlow ?? "#8AA0FF"}" stroke-width="2.5" filter="url(#glow)"/>`
      );
    }
  }

  // 番号丸 + 区切り線
  const numbers: Array<{ id: string; label: string }> = [
    { id: "number1", label: "①" },
    { id: "number2", label: "②" },
  ];
  for (const { id, label } of numbers) {
    const n = region(spec, id);
    if (!n) continue;
    const cy = n.rect.y + n.rect.h / 2;
    const cx = n.rect.x + n.rect.h / 2;
    const r = n.rect.h / 2;
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${p.numberCircle ?? "#C3C3FF"}"/>`,
      `<text x="${cx}" y="${cy}" font-family="Noto Sans JP, sans-serif" font-size="${r * 1.1}" fill="${p.ink ?? "#1E1D56"}" text-anchor="middle" dominant-baseline="central">${label}</text>`,
      `<line x1="${cx + r + 6}" y1="${cy}" x2="${n.rect.x + n.rect.w}" y2="${cy}" stroke="${p.ink ?? "#1E1D56"}" stroke-width="1" stroke-opacity="0.4"/>`
    );
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}

async function main(): Promise<void> {
  const styleArg = process.argv[2] ?? path.join(ROOT, "samples", "stylespec-coming-soon-v1.json");
  const spec = loadStyleSpec(styleArg);
  const outPath = path.resolve(ROOT, spec.background?.asset ?? "assets/background.png");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const svg = buildSvg(spec);
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  // eslint-disable-next-line no-console
  console.log(`placeholder background written: ${outPath}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
