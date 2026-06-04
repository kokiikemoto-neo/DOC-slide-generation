// render 段オーケストレータ: SlidePlan + StyleSpec → Google Slides を1枚生成して URL を返す。
// 背景(最背面) → frame1/frame2(透視変換済PNGをページ全面に重ねる) → logo/qr(contain)
//  → tagline/body1/body2(TEXT_BOX) の順で配置する。
import fs from "node:fs";
import path from "node:path";
import { google, type slides_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { ROOT } from "../config.js";
import type { StyleSpec, SlidePlan, Region, Rect, FontStyle } from "../types.js";
import { authorize } from "./auth.js";
import { resolveImageBytes, uploadPublicImage, deleteFiles, type ResolvedImage } from "./drive.js";
import { warpToQuad } from "./perspective.js";
import { buildRequests, type DrawOp } from "./requests.js";
import { containRect, EMU_PER_PT } from "./util.js";

const MAIN_SLIDE_ID = "slidegen_main";
const FALLBACK_FONT: FontStyle = {
  family: "Noto Sans JP",
  weightHint: "regular",
  sizePt: 14,
  color: "#1E1D56",
  align: "left",
};

export interface RenderOptions {
  /** 生成後に Drive へアップした一時画像を削除しない（既定は削除）。 */
  keepUploads?: boolean;
  /** プレゼンタイトル。 */
  title?: string;
  /** 透視変換の出力解像度(px/pt)。 */
  warpScale?: number;
  /** 進捗ログ出力先（既定 console.log）。 */
  log?: (msg: string) => void;
  /**
   * 画像を「Slides が取得できる公開URL」にする手段。
   * 指定時はこれを使う（サーバ自己配信など）。未指定時は Drive へ公開アップロード（既定）。
   */
  publishImage?: (buffer: Buffer, mime: string, name: string) => Promise<string>;
}

export interface RenderResult {
  presentationId: string;
  presentationUrl: string;
  uploadedFileIds: string[];
}

interface Scale {
  sx: number;
  sy: number;
}

function regionById(spec: StyleSpec, id: string): Region | undefined {
  return spec.regions.find((r) => r.id === id);
}

function fontFor(spec: StyleSpec, region: Region): FontStyle {
  const key = region.style ?? region.role;
  return spec.typography[key] ?? spec.typography["body"] ?? FALLBACK_FONT;
}

function scaleRect(rect: Rect, s: Scale): Rect {
  return { x: rect.x * s.sx, y: rect.y * s.sy, w: rect.w * s.sx, h: rect.h * s.sy };
}

/** create 応答の pageSize(EMU/PT) を pt に正規化。 */
function pageSizePt(pageSize: slides_v1.Schema$Size | undefined): { w: number; h: number } {
  const toPt = (d?: slides_v1.Schema$Dimension): number => {
    if (!d?.magnitude) return 0;
    return d.unit === "PT" ? d.magnitude : d.magnitude / EMU_PER_PT;
  };
  return { w: toPt(pageSize?.width), h: toPt(pageSize?.height) };
}

/** SlidePlan を Google Slides へ描画する。 */
export async function renderToSlides(
  spec: StyleSpec,
  plan: SlidePlan,
  opts: RenderOptions = {}
): Promise<RenderResult> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const warpScale = opts.warpScale ?? 2;
  const auth = await authorize();
  const slides = google.slides({ version: "v1", auth });

  const slide0 = plan.slides[0];
  if (!slide0) throw new Error("SlidePlan にスライドがありません。");

  // 1) 空のプレゼンを作成し、実際のページサイズを取得
  log("プレゼンテーションを作成中…");
  const created = await slides.presentations.create({
    requestBody: { title: opts.title ?? `SlideGen ${spec.meta.templateId ?? ""}`.trim() },
  });
  const presentationId = created.data.presentationId!;
  const firstSlideId = created.data.slides?.[0]?.objectId ?? undefined;
  const actualPage = pageSizePt(created.data.pageSize ?? undefined);
  const specPage = spec.meta.pageSize;
  const s: Scale = {
    sx: actualPage.w > 0 ? actualPage.w / specPage.w : 1,
    sy: actualPage.h > 0 ? actualPage.h / specPage.h : 1,
  };
  log(`ページ ${actualPage.w}x${actualPage.h}pt (StyleSpec ${specPage.w}x${specPage.h}pt, scale ${s.sx.toFixed(3)})`);

  // 2) 画像を準備（背景・frame透視変換・logo/qr）→ 公開URL化
  const workDir = path.join(ROOT, "out");
  fs.mkdirSync(workDir, { recursive: true });
  const uploadedFileIds: string[] = [];
  const ops: DrawOp[] = [];

  // 画像を「Slides が取得できるURL」にする。publishImage 指定時はそれ（サーバ自己配信）、
  // 未指定時は Drive 公開アップロード（既定。組織が公開共有を許可する場合のみ動作）。
  const publishImg = async (img: ResolvedImage, name: string): Promise<string> => {
    if (opts.publishImage) return opts.publishImage(img.buffer, img.mime, name);
    const up = await uploadPublicImage(auth, img, name);
    uploadedFileIds.push(up.fileId);
    return up.url;
  };

  // 2a) 背景（最背面・ページ全面）
  if (spec.background?.asset) {
    const bgPath = path.resolve(ROOT, spec.background.asset);
    log(`背景画像を配信準備中: ${spec.background.asset}`);
    const bg = await resolveImageBytes(bgPath);
    const url = await publishImg(bg, "slidegen-background.png");
    ops.push({ kind: "image", objectId: "bg_img", url, rect: { x: 0, y: 0, w: actualPage.w, h: actualPage.h } });
  } else {
    log("警告: StyleSpec.background が無いため背景なしで描画します。");
  }

  // 要素を種別ごとに仕分け（描画順: frame → image(contain) → text）
  const elements = slide0.elements;
  const get = (id: string) => elements.find((e) => e.region === id);

  // 2b) perspective フレーム
  for (const frameId of ["frame1", "frame2"]) {
    const el = get(frameId);
    const region = regionById(spec, frameId);
    if (!el?.value || !region?.quad) continue;
    log(`${frameId}: 透視変換中…`);
    const src = await resolveImageBytes(el.value);
    const srcPath = path.join(workDir, `${frameId}-src.${src.ext}`);
    fs.writeFileSync(srcPath, src.buffer);
    const warpedPath = path.join(workDir, `${frameId}-warped.png`);
    await warpToQuad({
      inputPath: srcPath,
      outputPath: warpedPath,
      quad: region.quad,
      pageW: specPage.w,
      pageH: specPage.h,
      scale: warpScale,
    });
    const warped = await resolveImageBytes(warpedPath);
    const url = await publishImg(warped, `slidegen-${frameId}.png`);
    // ページ全面に回転0で配置（傾きは画像に焼き込み済み）
    ops.push({ kind: "image", objectId: `${frameId}_img`, url, rect: { x: 0, y: 0, w: actualPage.w, h: actualPage.h } });
  }

  // 2c) contain 画像（logo/qr）
  for (const imgId of ["logo", "qr"]) {
    const el = get(imgId);
    const region = regionById(spec, imgId);
    if (!el?.value || !region) continue;
    log(`${imgId}: 画像を配置中…`);
    const img = await resolveImageBytes(el.value);
    const url = await publishImg(img, `slidegen-${imgId}.${img.ext}`);
    const fitted = containRect(scaleRect(region.rect, s), img.width, img.height);
    ops.push({ kind: "image", objectId: `${imgId}_img`, url, rect: fitted });
  }

  // 2d) テキスト（role==="text" の全 region: tagline/head1/body1/head2/body2 …）
  //     本文(style==="body")は上揃え、それ以外(tagline/見出し)は中央揃え。
  for (const region of spec.regions) {
    if (region.role !== "text") continue;
    const el = get(region.id);
    if (!el) continue;
    const font = fontFor(spec, region);
    ops.push({
      kind: "text",
      objectId: `${region.id}_box`,
      rect: scaleRect(region.rect, s),
      text: el.value ?? "",
      font,
      sizePt: el.fontSizePt ?? font.sizePt,
      valign: region.style === "body" ? "TOP" : "MIDDLE",
    });
  }

  // 3) batchUpdate: 空白スライドを作って既定スライドを置換 → 全要素を配置
  log("batchUpdate を送信中…");
  const requests: slides_v1.Schema$Request[] = [
    { createSlide: { objectId: MAIN_SLIDE_ID, slideLayoutReference: { predefinedLayout: "BLANK" } } },
    ...(firstSlideId ? [{ deleteObject: { objectId: firstSlideId } }] : []),
    ...buildRequests(MAIN_SLIDE_ID, ops),
  ];

  try {
    await slides.presentations.batchUpdate({
      presentationId,
      requestBody: { requests },
    });
  } catch (err) {
    throw new Error(`Slides batchUpdate に失敗しました: ${(err as Error).message}`);
  }

  // 4) 後始末（Drive 公開アップロード方式のときのみ）。
  //    自己配信(publishImage)方式はメモリTTLで自動失効するので削除不要。
  if (!opts.publishImage && !opts.keepUploads && uploadedFileIds.length > 0) {
    log("一時アップロード画像を削除中…");
    await deleteFiles(auth, uploadedFileIds);
  }

  const presentationUrl = `https://docs.google.com/presentation/d/${presentationId}/edit`;
  return { presentationId, presentationUrl, uploadedFileIds };
}
