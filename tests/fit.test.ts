import { describe, it, expect } from "vitest";
import { fitText, fitsAt, estimateLineCount } from "../src/compose/fit.js";
import type { Rect } from "../src/types.js";

const rect: Rect = { x: 0, y: 0, w: 400, h: 100 }; // body 相当

describe("estimateLineCount", () => {
  it("明示改行は最低でもその行数になる", () => {
    expect(estimateLineCount("a\nb\nc", 400, 14)).toBeGreaterThanOrEqual(3);
  });

  it("幅を超える長い行は折り返して複数行になる", () => {
    const long = "あ".repeat(200); // 200全角 ≈ 200em
    // rect幅400pt / 14pt ≈ 28.5em/行 → 約8行
    expect(estimateLineCount(long, 400, 14)).toBeGreaterThan(5);
  });

  it("フォントを小さくすると行数は減る(または同等)", () => {
    const text = "あ".repeat(100);
    const big = estimateLineCount(text, 400, 18);
    const small = estimateLineCount(text, 400, 10);
    expect(small).toBeLessThanOrEqual(big);
  });
});

describe("fitText", () => {
  it("短文: 縮小なしで収まる (fit)", () => {
    const r = fitText("短い本文", rect, 14);
    expect(r.fits).toBe(true);
    expect(r.overflow).toBe("fit");
    expect(r.sizePt).toBe(14);
  });

  it("長文: 段階縮小して収める (sizePt < base, fit)", () => {
    const text = "あ".repeat(220);
    const r = fitText(text, rect, 14);
    expect(r.overflow).toBe("fit");
    expect(r.sizePt).toBeLessThan(14);
    expect(r.sizePt).toBeGreaterThanOrEqual(9);
  });

  it("超長文: 最小サイズでも溢れる (trimmed)", () => {
    const text = "あ".repeat(2000);
    const r = fitText(text, rect, 14);
    expect(r.overflow).toBe("trimmed");
    expect(r.sizePt).toBe(9); // 下限を採用
    expect(r.fits).toBe(false);
  });

  it("空文字は常に収まる", () => {
    const r = fitText("", rect, 14);
    expect(r.fits).toBe(true);
    expect(r.lines).toBe(0);
  });

  it("min/step オプションが効く", () => {
    const text = "あ".repeat(2000);
    const r = fitText(text, rect, 20, { minSizePt: 6, stepPt: 2 });
    expect(r.sizePt).toBe(6);
  });
});

describe("fitsAt", () => {
  it("小さいフォントなら収まり、大きいフォントなら溢れる境界がある", () => {
    const text = "あ".repeat(80);
    expect(fitsAt(text, rect, 24)).toBe(false);
    expect(fitsAt(text, rect, 9)).toBe(true);
  });
});
