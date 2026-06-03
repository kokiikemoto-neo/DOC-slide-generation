// 透視変換ラッパ。Google Slides API は透視変換不可なので、frame1/frame2 は
// Python(OpenCV) 補助スクリプトで「傾き済みPNG」を事前生成し、Slides では回転0で重ねる。
//
// なぜ OpenCV か: sharp/libvips は4点透視変換(homography)をネイティブ提供しないため。
// cv2.getPerspectiveTransform + warpPerspective で正確・高速に焼き込める。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "../config.js";
import type { Quad } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(__dirname, "..", "..", "scripts", "perspective_warp.py");

export class PerspectiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PerspectiveError";
  }
}

export interface WarpOptions {
  inputPath: string; // ローカルの元画像
  outputPath: string; // 出力PNG(透明背景, ページ全面サイズ)
  quad: Quad; // 写像先(pt)
  pageW: number;
  pageH: number;
  scale?: number; // 出力 px/pt（既定2）
  pythonBin?: string; // 既定 "python"
}

function quadToArg(q: Quad): string {
  // tl tr br bl の順で "x,y x,y x,y x,y"
  return [q.tl, q.tr, q.br, q.bl].map(([x, y]) => `${x},${y}`).join(" ");
}

/**
 * 入力画像を quad に合わせて透視変換し、ページ全面の透明PNGを outputPath に書き出す。
 * 返り値は outputPath。Python/OpenCV が無い場合は分かりやすい PerspectiveError。
 */
export function warpToQuad(opts: WarpOptions): Promise<string> {
  const {
    inputPath,
    outputPath,
    quad,
    pageW,
    pageH,
    scale = 2,
    pythonBin = process.env.PYTHON_BIN ?? "python",
  } = opts;

  if (!fs.existsSync(inputPath)) {
    return Promise.reject(new PerspectiveError(`透視変換の入力画像がありません: ${inputPath}`));
  }
  if (!fs.existsSync(SCRIPT_PATH)) {
    return Promise.reject(new PerspectiveError(`ヘルパスクリプトがありません: ${SCRIPT_PATH}`));
  }
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });

  const args = [
    SCRIPT_PATH,
    "--input",
    inputPath,
    "--output",
    outputPath,
    "--page-w",
    String(pageW),
    "--page-h",
    String(pageH),
    "--scale",
    String(scale),
    "--quad",
    quadToArg(quad),
  ];

  return new Promise<string>((resolve, reject) => {
    let child;
    try {
      child = spawn(pythonBin, args, { cwd: ROOT });
    } catch (err) {
      reject(spawnHint(pythonBin, err as Error));
      return;
    }

    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => reject(spawnHint(pythonBin, err)));
    child.on("close", (code) => {
      if (code === 0) {
        resolve(outputPath);
      } else if (code === 3) {
        reject(
          new PerspectiveError(
            "OpenCV/numpy が未インストールです。`pip install opencv-python numpy` を実行してください。\n" +
              stderr.trim()
          )
        );
      } else {
        reject(
          new PerspectiveError(
            `透視変換に失敗しました (exit=${code}, python=${pythonBin}).\n` +
              (stderr.trim() || stdout.trim() || "(出力なし)")
          )
        );
      }
    });
  });
}

function spawnHint(pythonBin: string, err: Error): PerspectiveError {
  if ((err as NodeJS.ErrnoException).code === "ENOENT") {
    return new PerspectiveError(
      `Python 実行ファイル "${pythonBin}" が見つかりません。` +
        ` .env の PYTHON_BIN を設定するか Python をインストールしてください (例: Windows は "py")。`
    );
  }
  return new PerspectiveError(`Python の起動に失敗しました: ${err.message}`);
}
