// 画像の解決(ローカル/URL→バイト+寸法)と Drive アップロード(公開URL化)。
// Slides API は「公開到達可能なURL」を要求するため、ローカル画像は Drive 経由で URL 化する。
import fs from "node:fs";
import { Readable } from "node:stream";
import { google, type drive_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import sharp from "sharp";

export class ImageResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageResolveError";
  }
}

export interface ResolvedImage {
  buffer: Buffer;
  mime: string;
  width: number;
  height: number;
  ext: string;
}

const EXT_BY_FORMAT: Record<string, { ext: string; mime: string }> = {
  png: { ext: "png", mime: "image/png" },
  jpeg: { ext: "jpg", mime: "image/jpeg" },
  jpg: { ext: "jpg", mime: "image/jpeg" },
  gif: { ext: "gif", mime: "image/gif" },
  webp: { ext: "webp", mime: "image/webp" },
};

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

/** data URL か判定。 */
function isDataUrl(s: string): boolean {
  return /^data:[^;]+;base64,/.test(s);
}

/** ローカルパス / http(s) URL / data URL から画像バイトと寸法を取得する。 */
export async function resolveImageBytes(src: string): Promise<ResolvedImage> {
  let buffer: Buffer;
  if (isDataUrl(src)) {
    const comma = src.indexOf(",");
    buffer = Buffer.from(src.slice(comma + 1), "base64");
  } else if (isHttpUrl(src)) {
    let res: Response;
    try {
      res = await fetch(src);
    } catch (e) {
      throw new ImageResolveError(`画像URLの取得に失敗しました (${src}): ${(e as Error).message}`);
    }
    if (!res.ok) {
      throw new ImageResolveError(`画像URLが ${res.status} を返しました: ${src}`);
    }
    buffer = Buffer.from(await res.arrayBuffer());
  } else {
    if (!fs.existsSync(src)) {
      throw new ImageResolveError(`画像ファイルが見つかりません: ${src}`);
    }
    buffer = fs.readFileSync(src);
  }

  let meta: sharp.Metadata;
  try {
    meta = await sharp(buffer).metadata();
  } catch (e) {
    throw new ImageResolveError(`画像の解析に失敗しました (${src}): ${(e as Error).message}`);
  }
  const fmt = (meta.format ?? "png").toLowerCase();
  const info = EXT_BY_FORMAT[fmt] ?? EXT_BY_FORMAT["png"]!;
  return {
    buffer,
    mime: info.mime,
    ext: info.ext,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  };
}

/**
 * バイト列を Drive にアップロードし、anyone(reader) 公開にして Slides が取得可能な URL を返す。
 * createImage が取得するための公開URLとして uc?export=view 形式を用いる。
 * 返り値の fileId は後始末(削除)に使える。
 */
export async function uploadPublicImage(
  auth: OAuth2Client,
  img: ResolvedImage,
  name: string
): Promise<{ url: string; fileId: string }> {
  const drive = google.drive({ version: "v3", auth });

  const media = {
    mimeType: img.mime,
    body: Readable.from(img.buffer),
  };
  let fileId: string | null | undefined;
  try {
    const created = await drive.files.create({
      requestBody: { name, mimeType: img.mime },
      media,
      fields: "id",
    });
    fileId = created.data.id;
  } catch (e) {
    throw new ImageResolveError(`Drive へのアップロード(files.create)に失敗: ${name}\n  → ${googleErr(e)}`);
  }
  if (!fileId) {
    throw new ImageResolveError(`Drive へのアップロードに失敗しました (id 取得不可): ${name}`);
  }

  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" },
    });
  } catch (e) {
    throw new ImageResolveError(
      `Drive の公開設定(permissions.create type=anyone)に失敗: ${name}\n  → ${googleErr(e)}\n` +
        `  ※ 組織(Workspace)のポリシーで「リンクを知っている全員」への共有が禁止されている可能性があります。`
    );
  }

  return { url: `https://drive.google.com/uc?export=view&id=${fileId}`, fileId };
}

/** googleapis のエラーから、コード・理由・メッセージを読みやすく取り出す。 */
function googleErr(e: unknown): string {
  const anyE = e as {
    code?: number | string;
    message?: string;
    response?: { data?: { error?: { code?: number; message?: string; errors?: Array<{ reason?: string; message?: string }> } } };
  };
  const err = anyE?.response?.data?.error;
  if (err) {
    const reason = err.errors?.[0]?.reason;
    return `${err.code ?? anyE.code ?? ""} ${err.message ?? ""}${reason ? ` [${reason}]` : ""}`.trim();
  }
  return anyE?.message ?? String(e);
}

/** アップロードしたファイルを削除する（任意の後始末用）。 */
export async function deleteFiles(auth: OAuth2Client, fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return;
  const drive: drive_v3.Drive = google.drive({ version: "v3", auth });
  await Promise.allSettled(fileIds.map((id) => drive.files.delete({ fileId: id })));
}
