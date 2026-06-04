// 中間表現の型定義。StyleSpec は Figma 実測の新構造（object-keyed regions / quad点{x,y}）。

export type WeightHint = "regular" | "medium" | "bold";
export type RectFit = "contain" | "cover";
export type Align = "left" | "center" | "right";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 四隅座標 {x,y}（pt, 960x540 基準）。透視変換の写像先。 */
export interface QuadPoint {
  x: number;
  y: number;
}
export interface Quad {
  tl: QuadPoint;
  tr: QuadPoint;
  br: QuadPoint;
  bl: QuadPoint;
}

export interface FontStyle {
  family: string;
  fontCandidates?: string[];
  weightHint?: WeightHint;
  sizePt: number;
  color: string; // #RRGGBB
  align?: Align;
}

/** rect 型リージョン（画像 contain/cover、またはテキスト）。 */
export interface RectRegion {
  type: "rect";
  role: "image" | "text";
  rect: Rect;
  fit?: RectFit; // role==="image"
  style?: string; // role==="text" → typography のキー
  note?: string;
}

/** quad 型リージョン（透視変換で傾けて貼る画像）。 */
export interface QuadRegion {
  type: "quad";
  role: "image";
  fit: "perspective";
  quad: Quad;
  note?: string;
}

export type Region = RectRegion | QuadRegion;

export interface StyleSpec {
  version: string;
  pageSize: { w: number; h: number }; // pt
  background?: string; // 最背面に敷く固定下地画像のパス
  palette: Record<string, string>;
  typography: Record<string, FontStyle>;
  editableSlots: string[];
  regions: Record<string, Region>; // キー = スロット名
  notes?: Record<string, string>;
}

// ---- 入力データ（coming-soon 固定テンプレ：9スロット） ----
export interface ComingSoonContent {
  logo: string; // 画像
  tagline: string; // テキスト
  qr: string; // 画像
  heading1?: string; // ①見出し（可変）
  body1: string; // ①本文
  frame1: string; // 画像（透視変換）
  heading2?: string; // ②見出し（可変）
  body2: string; // ②本文
  frame2: string; // 画像（透視変換）
  // 旧名のエイリアス（GAS が head1/head2 で送ってくる場合の後方互換）
  head1?: string;
  head2?: string;
}

// ---- 合成結果 ----
export type ElementType = "text" | "image";
export type OverflowState = "fit" | "trimmed";

export interface PlanElement {
  region: string; // StyleSpec.regions のキー
  type: ElementType;
  value?: string;
  fit?: RectFit | "perspective";
  fontSizePt?: number; // text のとき: fit.ts が決めた最終サイズ
}

export interface PlanSlide {
  elements: PlanElement[];
  overflow?: Record<string, OverflowState>;
}

export interface SlidePlan {
  styleRef: string;
  slides: PlanSlide[];
}
