// 中間表現の型定義。analyze / compose / render の段間契約。
// coming-soon-v1 固定テンプレ用の拡張フィールド(quad/editable/style/background)も含む。

export type AspectRatio = "16:9" | "4:3";
export type Role = "title" | "body" | "image" | "caption" | "decoration" | "text";
export type WeightHint = "regular" | "medium" | "bold";
export type Fit = "cover" | "contain" | "perspective";
export type Align = "left" | "center" | "right";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 四隅座標 [x, y]（pt, 960x540 基準）。透視変換の写像先。 */
export interface Quad {
  tl: [number, number];
  tr: [number, number];
  br: [number, number];
  bl: [number, number];
}

export interface FontStyle {
  family: string;
  fontCandidates?: string[]; // 推定候補。Slides 側に無ければフォールバック
  weightHint?: WeightHint;
  sizePt: number;
  color: string; // #RRGGBB
  align?: Align;
}

export interface Region {
  id: string;
  role: Role;
  rect: Rect;
  fit?: Fit; // role === "image" のとき有効
  fill?: string; // role === "decoration" のとき有効
  editable?: boolean; // 差し替え可能スロットか
  quad?: Quad; // fit === "perspective" のとき有効
  style?: string; // typography のキー参照（text のとき）
  note?: string;
}

export interface StyleSpec {
  meta: {
    templateId?: string;
    sourceImage?: string;
    aspectRatio: AspectRatio;
    pageSize: { w: number; h: number }; // pt
    note?: string;
  };
  background?: {
    type: "image";
    asset: string; // 最背面に敷く固定下地画像のパス
    note?: string;
  };
  palette: Record<string, string>;
  typography: Record<string, FontStyle>;
  regions: Region[];
  editableSlots?: string[];
  confidence?: Record<string, number>;
}

// ---- 入力データ（汎用：DESIGN.md §3 のスライド配列形式） ----
export interface ContentSlide {
  title?: string;
  body?: string;
  image?: string; // 公開URL or ローカルパス(描画前にDriveへ)
}
export interface ContentInput {
  slides: ContentSlide[];
}

// ---- 入力データ（coming-soon-v1 固定テンプレ：7スロット） ----
export interface ComingSoonContent {
  logo: string; // 画像 URL or ローカルパス
  tagline: string; // テキスト
  qr: string; // 画像 URL or ローカルパス
  frame1: string; // 画像 URL or ローカルパス（透視変換対象）
  head1?: string; // ①見出しタイトル（任意）
  body1: string; // テキスト
  frame2: string; // 画像 URL or ローカルパス（透視変換対象）
  head2?: string; // ②見出しタイトル（任意）
  body2: string; // テキスト
}

// ---- 合成結果 ----
export type ElementType = "text" | "image" | "shape";
export type OverflowState = "fit" | "trimmed" | "split";

export interface PlanElement {
  region: string; // StyleSpec.regions[].id を参照
  type: ElementType;
  value?: string;
  fit?: Fit;
  /** text のとき: fit.ts が決めた最終フォントサイズ(pt)。 */
  fontSizePt?: number;
}

export interface PlanSlide {
  elements: PlanElement[];
  overflow?: Record<string, OverflowState>;
}

export interface SlidePlan {
  styleRef: string;
  slides: PlanSlide[];
}
