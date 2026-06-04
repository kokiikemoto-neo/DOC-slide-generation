// 暫定の固定下地 assets/background.png を新 StyleSpec(coming-soon) の座標で生成する。
// 正式版は Figma 書き出し（薄藤色）に差し替えること（BACKGROUND_FILE_ID or 直接置換）。
// 発光フレーム枠・グラデ帯・丸数字①②・本文枠を近似描画して位置確認できるようにする。
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { ROOT } from "../src/config.js";
import { loadStyleSpec } from "../src/load.js";
import type { Quad, Rect, StyleSpec } from "../src/types.js";

const SCALE = 2;

function quadPoints(q: Quad): string {
  return [q.tl, q.tr, q.br, q.bl].map((p) => `${p.x},${p.y}`).join(" ");
}
function roundedRect(r: Rect, fill: string, o: { stroke?: string; sw?: number; rx?: number; dash?: string } = {}): string {
  const { stroke = "none", sw = 0, rx = 10, dash = "" } = o;
  return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${rx}" ry="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
}

function buildSvg(spec: StyleSpec): string {
  const { w: W, h: H } = spec.pageSize;
  const p = spec.palette;
  const R = spec.regions;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${H * SCALE}" viewBox="0 0 ${W} ${H}">`);
  out.push(`<defs>
    <linearGradient id="band" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${p.frameGlowB ?? "#8AA0FF"}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${p.frameGlowP ?? "#C9A9F5"}" stop-opacity="0.55"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="${p.frameGlowB ?? "#8AA0FF"}" flood-opacity="0.8"/>
    </filter>
  </defs>`);
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${p.pageBg ?? "#EAE7FB"}"/>`);

  const rectOf = (key: string): Rect | null => {
    const r = R[key];
    return r && r.type === "rect" ? r.rect : null;
  };

  // ロゴ白カード
  const logo = rectOf("logo");
  if (logo) out.push(roundedRect(logo, "#FFFFFF", { rx: 8, stroke: "#FFFFFF", sw: 1 }));

  // タグライン帯（グラデ）
  const tagline = rectOf("tagline");
  if (tagline) out.push(roundedRect(tagline, "url(#band)", { rx: 12 }));

  // QR 破線ボックス
  const qr = rectOf("qr");
  if (qr) out.push(roundedRect(qr, "#FFFFFF", { rx: 8, stroke: p.numberFill ?? "#B7A6F0", sw: 1.5, dash: "5 4" }));

  // 本文枠（薄い発光ボックス）
  for (const key of ["body1", "body2"]) {
    const r = rectOf(key);
    if (r) out.push(roundedRect(r, "#FFFFFF22", { rx: 10, stroke: p.frameGlowB ?? "#8AA0FF", sw: 1.5 }));
  }

  // 見出し帯＋丸数字①②
  const headings: Array<{ key: string; label: string }> = [
    { key: "heading1", label: "①" },
    { key: "heading2", label: "②" },
  ];
  for (const { key, label } of headings) {
    const r = rectOf(key);
    if (!r) continue;
    out.push(roundedRect(r, "url(#band)", { rx: r.h / 2 }));
    const cy = r.y + r.h / 2;
    const cx = r.x; // 左端に丸数字
    const rad = r.h / 2 + 3;
    out.push(
      `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${p.numberFill ?? "#B7A6F0"}"/>`,
      `<text x="${cx}" y="${cy}" font-family="Noto Sans JP, sans-serif" font-size="${rad}" fill="#FFFFFF" text-anchor="middle" dominant-baseline="central">${label}</text>`
    );
  }

  // 発光フレーム（傾き：quad ポリゴン）
  for (const key of ["frame1", "frame2"]) {
    const reg = R[key];
    if (reg && reg.type === "quad") {
      out.push(
        `<polygon points="${quadPoints(reg.quad)}" fill="#FFFFFF" stroke="${p.frameGlowB ?? "#8AA0FF"}" stroke-width="2.5" filter="url(#glow)"/>`
      );
    }
  }

  out.push(`</svg>`);
  return out.join("\n");
}

async function main(): Promise<void> {
  const styleArg = process.argv[2] ?? path.join(ROOT, "samples", "stylespec-coming-soon.json");
  const spec = loadStyleSpec(styleArg);
  const outPath = path.resolve(ROOT, spec.background ?? "assets/background.png");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await sharp(Buffer.from(buildSvg(spec))).png().toFile(outPath);
  // eslint-disable-next-line no-console
  console.log(`placeholder background written: ${outPath}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
