// テキスト量の自動調整。rect に収まるようフォントを段階縮小する。
// レンダリングエンジンを持たないため、CJK=1em / ASCII=0.5em の素朴な幅見積りで
// 行数→高さを推定する近似。Slides 実描画とは誤差があるため安全側(やや小さめ)に倒す。
import type { Rect, OverflowState } from "../types.js";

export interface FitTextOptions {
  /** 折返し計算の基準幅。CJK 1文字=1em とみなす。 */
  cjkWidthEm?: number;
  /** ASCII/半角 1文字の幅(em)。 */
  asciiWidthEm?: number;
  /** 行送り倍率。 */
  lineHeight?: number;
  /** 縮小の下限(pt)。これ未満には縮めない。 */
  minSizePt?: number;
  /** 1ステップの縮小量(pt)。 */
  stepPt?: number;
}

export interface FitTextResult {
  /** 採用フォントサイズ(pt)。 */
  sizePt: number;
  /** rect に収まったか。 */
  fits: boolean;
  /** 推定行数(採用サイズでの)。 */
  lines: number;
  /** "fit"=収まった / "trimmed"=最小サイズでも溢れた(見切れ警告)。 */
  overflow: OverflowState;
}

const DEFAULTS: Required<FitTextOptions> = {
  cjkWidthEm: 1.0,
  asciiWidthEm: 0.5,
  lineHeight: 1.35,
  minSizePt: 9,
  stepPt: 1,
};

/** 1文字の相対幅(em)。CJK(全角)はほぼ正方、半角はおよそ半分。 */
function charWidthEm(cp: number, o: Required<FitTextOptions>): number {
  // CJK統合漢字 / かな / 全角記号 / ハングル等のざっくり判定
  const isWide =
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK部首補助〜記号
    (cp >= 0x3041 && cp <= 0x33ff) || // かな〜CJK互換
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK拡張A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK統合漢字
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) || // ハングル音節
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK互換漢字
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK互換形
    (cp >= 0xff00 && cp <= 0xff60) || // 全角英数記号
    (cp >= 0xffe0 && cp <= 0xffe6);
  return isWide ? o.cjkWidthEm : o.asciiWidthEm;
}

/** 1段落(改行を含まない)の幅(em)。 */
function paragraphWidthEm(line: string, o: Required<FitTextOptions>): number {
  let w = 0;
  for (const ch of line) w += charWidthEm(ch.codePointAt(0) ?? 0x20, o);
  return w;
}

/** 指定サイズでの推定総行数。明示改行ごとに折返しを足し合わせる。 */
export function estimateLineCount(text: string, rectW: number, sizePt: number, opts: FitTextOptions = {}): number {
  const o = { ...DEFAULTS, ...opts };
  if (rectW <= 0 || sizePt <= 0) return 0;
  const maxEmPerLine = rectW / sizePt; // rect幅を em 換算
  if (maxEmPerLine <= 0) return 0;
  let lines = 0;
  for (const para of text.split("\n")) {
    if (para.length === 0) {
      lines += 1; // 空行も1行
      continue;
    }
    const widthEm = paragraphWidthEm(para, o);
    lines += Math.max(1, Math.ceil(widthEm / maxEmPerLine));
  }
  return lines;
}

/** 指定サイズでテキストが rect 高さに収まるか。 */
export function fitsAt(text: string, rect: Rect, sizePt: number, opts: FitTextOptions = {}): boolean {
  const o = { ...DEFAULTS, ...opts };
  const lines = estimateLineCount(text, rect.w, sizePt, o);
  const neededH = lines * sizePt * o.lineHeight;
  return neededH <= rect.h;
}

/**
 * baseSizePt から開始し、rect に収まるまで stepPt ずつ縮小する。
 * 下限 minSizePt でも収まらなければ minSizePt を採用し overflow="trimmed"。
 */
export function fitText(
  text: string,
  rect: Rect,
  baseSizePt: number,
  opts: FitTextOptions = {}
): FitTextResult {
  const o = { ...DEFAULTS, ...opts };
  const trimmed = text ?? "";
  // 空文字は無条件で収まる
  if (trimmed.trim() === "") {
    return { sizePt: baseSizePt, fits: true, lines: 0, overflow: "fit" };
  }
  let size = baseSizePt;
  while (size > o.minSizePt) {
    if (fitsAt(trimmed, rect, size, o)) {
      return {
        sizePt: size,
        fits: true,
        lines: estimateLineCount(trimmed, rect.w, size, o),
        overflow: "fit",
      };
    }
    size = Math.max(o.minSizePt, +(size - o.stepPt).toFixed(3));
  }
  // 下限サイズで判定
  const fitsAtMin = fitsAt(trimmed, rect, o.minSizePt, o);
  return {
    sizePt: o.minSizePt,
    fits: fitsAtMin,
    lines: estimateLineCount(trimmed, rect.w, o.minSizePt, o),
    overflow: fitsAtMin ? "fit" : "trimmed",
  };
}
