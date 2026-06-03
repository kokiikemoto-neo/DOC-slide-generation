// 描画段の換算ユーティリティ: pt→EMU, #RRGGBB→RGB(0-1), contain フィット計算。
import type { Rect } from "../types.js";

export const EMU_PER_PT = 12700;

/** pt → EMU (整数)。 */
export function ptToEmu(pt: number): number {
  return Math.round(pt * EMU_PER_PT);
}

export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

/** "#RRGGBB" → { red, green, blue } 各 0..1。不正値は黒にフォールバック。 */
export function hexToRgb(hex: string): RgbColor {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex?.trim() ?? "");
  if (!m) return { red: 0, green: 0, blue: 0 };
  const n = parseInt(m[1]!, 16);
  return {
    red: ((n >> 16) & 0xff) / 255,
    green: ((n >> 8) & 0xff) / 255,
    blue: (n & 0xff) / 255,
  };
}

/**
 * contain フィット: アスペクト比を保ったまま container(pt) 内に収め、中央寄せした矩形(pt)を返す。
 * imgW/imgH は元画像のピクセル寸法(比率だけ使う)。
 */
export function containRect(container: Rect, imgW: number, imgH: number): Rect {
  if (imgW <= 0 || imgH <= 0) return { ...container };
  const imgRatio = imgW / imgH;
  const boxRatio = container.w / container.h;
  let w: number;
  let h: number;
  if (imgRatio > boxRatio) {
    // 画像のほうが横長 → 幅を合わせる
    w = container.w;
    h = container.w / imgRatio;
  } else {
    h = container.h;
    w = container.h * imgRatio;
  }
  return {
    x: container.x + (container.w - w) / 2,
    y: container.y + (container.h - h) / 2,
    w,
    h,
  };
}

/** weightHint("bold"/"medium"/"regular") を太字フラグへ。 */
export function isBold(weightHint?: string): boolean {
  return weightHint === "bold";
}
