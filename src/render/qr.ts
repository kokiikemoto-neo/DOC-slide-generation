// テキスト(URL等)から QR コード PNG を生成する。第三者QRサービスに依存せず Node 内で完結。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import QRCode from "qrcode";
import { ROOT } from "../config.js";

/**
 * text を QR 化して out/qr-<hash>.png に書き出し、そのローカルパスを返す。
 * 返り値は compose/render が通常のローカル画像として扱える（contain 配置）。
 */
export async function renderQrToFile(text: string): Promise<string> {
  const dir = path.join(ROOT, "out");
  fs.mkdirSync(dir, { recursive: true });
  const hash = crypto.createHash("sha1").update(text).digest("hex").slice(0, 12);
  const file = path.join(dir, `qr-${hash}.png`);
  await QRCode.toFile(file, text, {
    width: 600,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#1E1D56", light: "#FFFFFF" },
  });
  return file;
}
