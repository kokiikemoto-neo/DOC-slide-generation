// 生成した画像を一時的にメモリ保持し、HTTP で配信するためのストア。
// Drive 公開が組織ポリシーで禁止されている環境向け: Slides API には
// 「このサーバ自身の公開URL(/img/:token)」を渡し、Slides がそこから取得する。
// 注意: メモリ保持のため Cloud Run は単一インスタンス(--max-instances=1)で運用すること。
import crypto from "node:crypto";

interface Entry {
  buffer: Buffer;
  mime: string;
  expires: number;
}

const store = new Map<string, Entry>();
const TTL_MS = 15 * 60 * 1000; // 15分（Slides が取得し終わるまで保てば十分）

function sweep(): void {
  const now = Date.now();
  for (const [k, v] of store) {
    if (now > v.expires) store.delete(k);
  }
}

/** 画像を登録してトークンを返す。 */
export function putImage(buffer: Buffer, mime: string): string {
  sweep();
  const token = crypto.randomBytes(16).toString("hex");
  store.set(token, { buffer, mime, expires: Date.now() + TTL_MS });
  return token;
}

/** トークンから画像を取り出す（期限切れ/未登録は null）。 */
export function getImage(token: string): { buffer: Buffer; mime: string } | null {
  const e = store.get(token);
  if (!e) return null;
  if (Date.now() > e.expires) {
    store.delete(token);
    return null;
  }
  return { buffer: e.buffer, mime: e.mime };
}
