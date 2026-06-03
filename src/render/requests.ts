// SlidePlan を Google Slides の batchUpdate リクエスト列へ変換する。
// 画像URLや最終配置rectは googleSlides.ts が解決済みで「描画オペレーション」として渡す。
import type { slides_v1 } from "googleapis";
import type { FontStyle, Rect } from "../types.js";
import { ptToEmu, hexToRgb, isBold } from "./util.js";

type Request = slides_v1.Schema$Request;

export type DrawOp =
  | {
      kind: "image";
      objectId: string;
      url: string;
      rect: Rect; // pt。回転は常に0（傾きは画像に焼き込み済み）
    }
  | {
      kind: "text";
      objectId: string;
      rect: Rect; // pt
      text: string;
      font: FontStyle;
      sizePt: number; // fit.ts が決めた最終サイズ
      valign?: "TOP" | "MIDDLE" | "BOTTOM";
    };

/** pt rect → Slides の elementProperties(size + transform, 単位 EMU)。 */
function elementProps(pageId: string, rect: Rect): slides_v1.Schema$PageElementProperties {
  return {
    pageObjectId: pageId,
    size: {
      width: { magnitude: ptToEmu(rect.w), unit: "EMU" },
      height: { magnitude: ptToEmu(rect.h), unit: "EMU" },
    },
    transform: {
      scaleX: 1,
      scaleY: 1,
      translateX: ptToEmu(rect.x),
      translateY: ptToEmu(rect.y),
      unit: "EMU",
    },
  };
}

function imageRequests(op: Extract<DrawOp, { kind: "image" }>, pageId: string): Request[] {
  return [
    {
      createImage: {
        objectId: op.objectId,
        url: op.url,
        elementProperties: elementProps(pageId, op.rect),
      },
    },
  ];
}

function textRequests(op: Extract<DrawOp, { kind: "text" }>, pageId: string): Request[] {
  const { objectId, rect, text, font, sizePt, valign = "TOP" } = op;
  const requests: Request[] = [
    {
      createShape: {
        objectId,
        shapeType: "TEXT_BOX",
        elementProperties: elementProps(pageId, rect),
      },
    },
    // 縦位置・はみ出し挙動
    {
      updateShapeProperties: {
        objectId,
        fields: "contentAlignment,autofit.autofitType",
        shapeProperties: {
          contentAlignment: valign,
          autofit: { autofitType: "NONE" },
        },
      },
    },
  ];

  if (text.length > 0) {
    requests.push({ insertText: { objectId, text, insertionIndex: 0 } });
    requests.push({
      updateTextStyle: {
        objectId,
        textRange: { type: "ALL" },
        style: {
          fontFamily: font.family,
          fontSize: { magnitude: sizePt, unit: "PT" },
          foregroundColor: { opaqueColor: { rgbColor: hexToRgb(font.color) } },
          bold: isBold(font.weightHint),
        },
        fields: "fontFamily,fontSize,foregroundColor,bold",
      },
    });
    requests.push({
      updateParagraphStyle: {
        objectId,
        textRange: { type: "ALL" },
        style: { alignment: (font.align ?? "left").toUpperCase() },
        fields: "alignment",
      },
    });
  }
  return requests;
}

/** 描画オペレーション列 → batchUpdate requests。順序はそのまま重なり順(先頭が最背面)。 */
export function buildRequests(pageId: string, ops: DrawOp[]): Request[] {
  const requests: Request[] = [];
  for (const op of ops) {
    if (op.kind === "image") requests.push(...imageRequests(op, pageId));
    else requests.push(...textRequests(op, pageId));
  }
  return requests;
}
