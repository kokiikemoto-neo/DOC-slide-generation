import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadStyleSpec,
  loadComingSoonContent,
  validateAgainst,
  SchemaValidationError,
} from "../src/load.js";
import type { ComingSoonContent } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXED_STYLESPEC = path.join(ROOT, "samples", "stylespec-coming-soon.json");

describe("loadStyleSpec", () => {
  it("Figma 実測 StyleSpec(新構造) がスキーマ検証を通る", () => {
    const spec = loadStyleSpec(FIXED_STYLESPEC);
    expect(spec.version).toBe("coming-soon-v1");
    expect(spec.pageSize).toEqual({ w: 960, h: 540 });
    expect(spec.background).toBe("assets/background.png");
    expect(spec.editableSlots).toHaveLength(9);
  });

  it("frame1/frame2 は quad 型（点は {x,y}）", () => {
    const spec = loadStyleSpec(FIXED_STYLESPEC);
    for (const key of ["frame1", "frame2"]) {
      const r = spec.regions[key]!;
      expect(r.type).toBe("quad");
      if (r.type === "quad") {
        expect(typeof r.quad.tl.x).toBe("number");
        expect(typeof r.quad.tl.y).toBe("number");
      }
    }
  });

  it("不正な StyleSpec は SchemaValidationError を投げる", () => {
    expect(() =>
      validateAgainst({ version: "x" }, "stylespec.schema.json", "StyleSpec", "(test)")
    ).toThrow(SchemaValidationError);
  });
});

describe("loadComingSoonContent", () => {
  const valid: ComingSoonContent = {
    logo: "https://example.com/logo.png",
    tagline: "現場の暗黙知を、誰でも引き出せる形に。",
    qr: "https://example.com/qr.png",
    frame1: "https://example.com/shot1.png",
    body1: "・ベテランの判断基準を構造化",
    frame2: "https://example.com/shot2.png",
    body2: "・導入3ヶ月で対応時間が40%減",
  };

  it("7スロット揃った入力は検証を通る", () => {
    expect(() =>
      validateAgainst<ComingSoonContent>(
        valid,
        "content-coming-soon.schema.json",
        "ContentInput",
        "(test)"
      )
    ).not.toThrow();
  });

  it("スロット欠落は SchemaValidationError を投げる", () => {
    const { frame2: _omit, ...broken } = valid;
    void _omit;
    expect(() =>
      validateAgainst(broken, "content-coming-soon.schema.json", "ContentInput", "(test)")
    ).toThrow(SchemaValidationError);
  });

  it("未知のスロットは拒否する (additionalProperties:false)", () => {
    expect(() =>
      validateAgainst(
        { ...valid, extra: "x" },
        "content-coming-soon.schema.json",
        "ContentInput",
        "(test)"
      )
    ).toThrow(SchemaValidationError);
  });
});
