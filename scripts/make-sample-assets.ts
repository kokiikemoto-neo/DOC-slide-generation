// サンプルを自己完結で動かすためのダミー画像生成（logo / qr / shot1 / shot2）。
// samples/assets/ に書き出す。content.example.json から相対パスで参照する。
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { ROOT } from "../src/config.js";

const OUT = path.join(ROOT, "samples", "assets");

async function svgToPng(svg: string, file: string): Promise<void> {
  await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, file));
}

function logoSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="180">
    <rect width="600" height="180" fill="#FFFFFF"/>
    <circle cx="90" cy="90" r="50" fill="#5B6BF5"/>
    <text x="170" y="105" font-family="sans-serif" font-size="56" font-weight="bold" fill="#1E1D56">ACME</text>
  </svg>`;
}

function qrSvg(): string {
  // 擬似QR（本物ではない・配置確認用の市松模様）
  const cells: string[] = [];
  const n = 9;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if ((r * 7 + c * 3) % 5 < 2) cells.push(`<rect x="${10 + c * 20}" y="${10 + r * 20}" width="20" height="20" fill="#1E1D56"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
    <rect width="200" height="200" fill="#FFFFFF"/>${cells.join("")}</svg>`;
}

function shotSvg(label: string, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="520">
    <rect width="800" height="520" fill="${color}"/>
    <rect x="0" y="0" width="800" height="70" fill="#00000022"/>
    <circle cx="40" cy="35" r="12" fill="#fff"/><circle cx="80" cy="35" r="12" fill="#ffffff88"/>
    <text x="400" y="300" font-family="sans-serif" font-size="72" font-weight="bold" fill="#ffffff" text-anchor="middle">${label}</text>
  </svg>`;
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  await svgToPng(logoSvg(), "logo.png");
  await svgToPng(qrSvg(), "qr.png");
  await svgToPng(shotSvg("SHOT 1", "#3B82F6"), "shot1.png");
  await svgToPng(shotSvg("SHOT 2", "#10B981"), "shot2.png");
  console.log(`sample assets written to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
