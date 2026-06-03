// compose 段: 固定 StyleSpec + 7スロット入力 → SlidePlan。
// このテンプレはレイアウト固定なのでスライド分割はしない（溢れたらフォント縮小のみ）。
import path from "node:path";
import type {
  StyleSpec,
  ComingSoonContent,
  SlidePlan,
  PlanElement,
  Region,
  OverflowState,
  FontStyle,
} from "../types.js";

/** typography が見つからない場合の最終フォールバック。 */
const FALLBACK_FONT: FontStyle = {
  family: "Noto Sans JP",
  weightHint: "regular",
  sizePt: 14,
  color: "#1E1D56",
  align: "left",
};
import { fitText } from "./fit.js";
import { validateSlidePlan } from "../load.js";

export interface ComposeResult {
  plan: SlidePlan;
  /** overflow=trimmed などの注意喚起メッセージ。CLI が表示する。 */
  warnings: string[];
}

/** content のキー名は region.id と1:1対応する。 */
type SlotKey = keyof ComingSoonContent;

function regionById(spec: StyleSpec, id: string): Region | undefined {
  return spec.regions.find((r) => r.id === id);
}

/** region に紐づく typography を解決（region.style 優先、無ければ role 名）。 */
function fontStyleFor(spec: StyleSpec, region: Region): FontStyle {
  const key = region.style ?? region.role;
  return spec.typography[key] ?? spec.typography["body"] ?? FALLBACK_FONT;
}

/**
 * StyleSpec(coming-soon-v1) と入力を SlidePlan(1枚) に合成する。
 * - text(tagline/body1/body2): rect に収まるようフォント段階縮小。限界超は overflow=trimmed。
 * - image(logo/qr): fit=contain。
 * - image(frame1/frame2): fit=perspective。value は元画像参照のまま
 *   （透視変換した実PNGの生成は render 段の責務。SlidePlan は IO 非依存に保つ）。
 */
export function composeComingSoon(
  spec: StyleSpec,
  content: ComingSoonContent,
  styleRefName?: string
): ComposeResult {
  const warnings: string[] = [];
  const elements: PlanElement[] = [];
  const overflow: Record<string, OverflowState> = {};

  const slots = spec.editableSlots ?? Object.keys(content);

  for (const slot of slots) {
    const region = regionById(spec, slot);
    if (!region) {
      warnings.push(`StyleSpec に region "${slot}" が無いためスキップしました。`);
      continue;
    }
    const value = content[slot as SlotKey];

    if (region.role === "image") {
      elements.push({
        region: slot,
        type: "image",
        value,
        fit: region.fit ?? "contain",
      });
      continue;
    }

    // text スロット (tagline/body1/body2)
    const font = fontStyleFor(spec, region);
    const result = fitText(value ?? "", region.rect, font.sizePt);
    elements.push({
      region: slot,
      type: "text",
      value,
      fontSizePt: result.sizePt,
    });
    if (result.overflow !== "fit") {
      overflow[slot] = result.overflow;
      warnings.push(
        `テキスト "${slot}" が rect(${region.rect.w}x${region.rect.h}pt) に収まりません。` +
          `最小フォント ${result.sizePt}pt まで縮小しましたが見切れる可能性があります (overflow=trimmed)。`
      );
    } else if (result.sizePt < font.sizePt) {
      warnings.push(
        `テキスト "${slot}" を ${font.sizePt}pt → ${result.sizePt}pt に縮小して収めました。`
      );
    }
  }

  const styleRef =
    styleRefName ?? spec.meta.sourceImage ?? `${spec.meta.templateId ?? "stylespec"}.json`;

  const plan: SlidePlan = {
    styleRef,
    slides: [
      {
        elements,
        ...(Object.keys(overflow).length > 0 ? { overflow } : {}),
      },
    ],
  };

  // 自己検証（compose 出力の段間契約をランタイム担保）
  validateSlidePlan(plan, "compose:composeComingSoon");

  return { plan, warnings };
}

/** styleRef 用にファイル名(拡張子付き)を取り出すヘルパ。 */
export function basenameOf(filePath: string): string {
  return path.basename(filePath);
}
