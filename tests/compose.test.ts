import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { composeComingSoon } from "../src/compose/layout.js";
import { loadStyleSpec } from "../src/load.js";
import type { ComingSoonContent } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const spec = loadStyleSpec(path.join(ROOT, "samples", "stylespec-coming-soon-v1.json"));

const baseContent: ComingSoonContent = {
  logo: "https://example.com/logo.png",
  tagline: "現場の暗黙知を、誰でも引き出せる形に。",
  qr: "https://example.com/qr.png",
  frame1: "https://example.com/shot1.png",
  body1: "・ベテランの判断基準を構造化\n・新人の立ち上がりを短縮",
  frame2: "https://example.com/shot2.png",
  body2: "・導入3ヶ月で問い合わせ対応時間が40%減",
};

describe("composeComingSoon", () => {
  it("7スロット全てが要素になり SlidePlan 検証を通る", () => {
    const { plan } = composeComingSoon(spec, baseContent, "stylespec-coming-soon-v1.json");
    expect(plan.slides).toHaveLength(1);
    const ids = plan.slides[0]!.elements.map((e) => e.region).sort();
    expect(ids).toEqual(["body1", "body2", "frame1", "frame2", "logo", "qr", "tagline"]);
  });

  it("frame1/frame2 は fit=perspective で元画像参照を保持(IO非依存)", () => {
    const { plan } = composeComingSoon(spec, baseContent);
    const f1 = plan.slides[0]!.elements.find((e) => e.region === "frame1")!;
    expect(f1.type).toBe("image");
    expect(f1.fit).toBe("perspective");
    expect(f1.value).toBe("https://example.com/shot1.png");
  });

  it("logo/qr は fit=contain", () => {
    const { plan } = composeComingSoon(spec, baseContent);
    const logo = plan.slides[0]!.elements.find((e) => e.region === "logo")!;
    expect(logo.fit).toBe("contain");
  });

  it("短い本文は縮小されず base サイズ(14pt)", () => {
    const { plan, warnings } = composeComingSoon(spec, baseContent);
    const body1 = plan.slides[0]!.elements.find((e) => e.region === "body1")!;
    expect(body1.fontSizePt).toBe(14);
    expect(warnings).toHaveLength(0);
  });

  it("超長文 body は trimmed 警告と overflow 記録が出る", () => {
    const longContent: ComingSoonContent = {
      ...baseContent,
      body1: "あ".repeat(2000),
    };
    const { plan, warnings } = composeComingSoon(spec, longContent);
    expect(plan.slides[0]!.overflow).toMatchObject({ body1: "trimmed" });
    expect(warnings.some((w) => w.includes("body1"))).toBe(true);
  });

  it("適度に長い本文は縮小されて収まり、縮小警告が出る", () => {
    const midContent: ComingSoonContent = {
      ...baseContent,
      body2: "あ".repeat(250),
    };
    const { plan, warnings } = composeComingSoon(spec, midContent);
    const body2 = plan.slides[0]!.elements.find((e) => e.region === "body2")!;
    expect(body2.fontSizePt).toBeLessThan(14);
    expect(plan.slides[0]!.overflow?.body2).toBeUndefined();
    expect(warnings.some((w) => w.includes("body2") && w.includes("縮小"))).toBe(true);
  });
});
