// compose 段: 固定 StyleSpec(新構造・object-keyed) + 9スロット入力 → SlidePlan。
// レイアウト固定なのでスライド分割はしない（溢れたらフォント縮小のみ）。
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
import { fitText } from "./fit.js";
import { validateSlidePlan } from "../load.js";

/** typography が見つからない場合の最終フォールバック。 */
const FALLBACK_FONT: FontStyle = {
  family: "Noto Sans JP",
  weightHint: "regular",
  sizePt: 13,
  color: "#3A3A5C",
  align: "left",
};

export interface ComposeResult {
  plan: SlidePlan;
  warnings: string[];
}

/** スロット名 → 入力値（heading1/2 は head1/2 の旧名も許容）。 */
function valueForSlot(content: ComingSoonContent, slot: string): string {
  if (slot === "heading1") return content.heading1 ?? content.head1 ?? "";
  if (slot === "heading2") return content.heading2 ?? content.head2 ?? "";
  const v = (content as unknown as Record<string, unknown>)[slot];
  return typeof v === "string" ? v : "";
}

/** region に紐づく typography を解決（region.style 優先）。 */
function fontStyleFor(spec: StyleSpec, region: Region): FontStyle {
  const key = region.type === "rect" ? region.style : undefined;
  return (key && spec.typography[key]) || spec.typography["body"] || FALLBACK_FONT;
}

/**
 * StyleSpec(新構造) と入力を SlidePlan(1枚) に合成する。
 * - text(tagline/heading1/body1/heading2/body2): rect に収めるためフォント段階縮小。
 * - image rect(logo/qr): fit=contain/cover。
 * - image quad(frame1/frame2): fit=perspective。value は元画像参照のまま（透視変換は render 段）。
 */
export function composeComingSoon(
  spec: StyleSpec,
  content: ComingSoonContent,
  styleRefName?: string
): ComposeResult {
  const warnings: string[] = [];
  const elements: PlanElement[] = [];
  const overflow: Record<string, OverflowState> = {};

  const slots = spec.editableSlots ?? Object.keys(spec.regions);

  for (const slot of slots) {
    const region = spec.regions[slot];
    if (!region) {
      warnings.push(`StyleSpec に region "${slot}" が無いためスキップしました。`);
      continue;
    }
    const value = valueForSlot(content, slot);

    if (region.role === "image") {
      elements.push({
        region: slot,
        type: "image",
        value,
        fit: region.type === "quad" ? "perspective" : region.fit ?? "contain",
      });
      continue;
    }

    // text リージョン
    const font = fontStyleFor(spec, region);
    const rect = region.type === "rect" ? region.rect : { x: 0, y: 0, w: 0, h: 0 };
    const result = fitText(value, rect, font.sizePt);
    elements.push({ region: slot, type: "text", value, fontSizePt: result.sizePt });

    if (result.overflow !== "fit") {
      overflow[slot] = result.overflow;
      warnings.push(
        `テキスト "${slot}" が rect(${rect.w}x${rect.h}pt) に収まりません。` +
          `最小 ${result.sizePt}pt まで縮小しましたが見切れる可能性があります (trimmed)。`
      );
    } else if (result.sizePt < font.sizePt) {
      warnings.push(`テキスト "${slot}" を ${font.sizePt}pt → ${result.sizePt}pt に縮小しました。`);
    }
  }

  const plan: SlidePlan = {
    styleRef: styleRefName ?? `${spec.version}.json`,
    slides: [{ elements, ...(Object.keys(overflow).length > 0 ? { overflow } : {}) }],
  };

  validateSlidePlan(plan, "compose:composeComingSoon");
  return { plan, warnings };
}

/** styleRef 用にファイル名を取り出すヘルパ。 */
export function basenameOf(filePath: string): string {
  return path.basename(filePath);
}
