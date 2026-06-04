#!/usr/bin/env node
// Phase 2: 既存の生成ロジック(compose→perspective→render)を薄くHTTP化した API。
// POST /render  : { templateId, content{7slots} } を検証して Slides を生成し URL を返す。
// GET  /health  : 死活監視用。
// 認証: X-Api-Key ヘッダを環境変数 RENDER_API_KEY と照合（不一致/欠如は 401）。
import http from "node:http";
import path from "node:path";
import { ROOT, loadEnv } from "./config.js";
import {
  loadStyleSpec,
  validateAgainst,
  SchemaValidationError,
} from "./load.js";
import { composeComingSoon } from "./compose/layout.js";
import { renderToSlides } from "./render/googleSlides.js";
import { AuthError } from "./render/auth.js";
import { PerspectiveError } from "./render/perspective.js";
import { ImageResolveError } from "./render/drive.js";
import { renderQrToFile } from "./render/qr.js";
import { putImage, getImage } from "./render/imageStore.js";
import type { ComingSoonContent, StyleSpec } from "./types.js";

loadEnv();

const PORT = Number(process.env.PORT ?? 8080);
const SUPPORTED_TEMPLATE = "coming-soon-v1";
const STYLE_PATH = path.join(ROOT, "samples", "stylespec-coming-soon-v1.json");
const MAX_BODY_BYTES = 25_000_000; // 25MB（アップロード画像を base64(data URL) で受けるため）

// 固定 StyleSpec は起動時に1回ロードして検証（不正なら起動時に落とす）。
let fixedSpec: StyleSpec;
try {
  fixedSpec = loadStyleSpec(STYLE_PATH);
} catch (err) {
  console.error(`固定 StyleSpec のロードに失敗しました: ${(err as Error).message}`);
  process.exit(1);
}

interface RenderRequestBody {
  templateId?: string;
  content?: unknown;
  /** 指定時: この文字列(DOC_URL等)から QR を生成し content.qr に差し込む。 */
  qrText?: string;
}

class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "リクエストボディが大きすぎます。"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", (e) => reject(e));
  });
}

/** X-Api-Key を環境変数と照合。サーバ未設定(キー無し)は 500、不一致/欠如は 401。 */
function checkApiKey(req: http.IncomingMessage): void {
  const configured = process.env.RENDER_API_KEY;
  if (!configured) {
    throw new HttpError(500, "サーバが未設定です（RENDER_API_KEY が環境変数にありません）。");
  }
  const provided = req.headers["x-api-key"];
  const got = Array.isArray(provided) ? provided[0] : provided;
  if (!got || got !== configured) {
    throw new HttpError(401, "認証に失敗しました（X-Api-Key が不正です）。");
  }
}

async function handleRender(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  checkApiKey(req);

  const raw = await readBody(req);
  let parsed: RenderRequestBody;
  try {
    parsed = JSON.parse(raw) as RenderRequestBody;
  } catch {
    throw new HttpError(400, "リクエストボディが JSON ではありません。");
  }

  const templateId = parsed.templateId ?? SUPPORTED_TEMPLATE;
  if (templateId !== SUPPORTED_TEMPLATE) {
    throw new HttpError(400, `未対応の templateId: ${templateId}（対応: ${SUPPORTED_TEMPLATE}）`);
  }
  if (parsed.content === undefined || parsed.content === null || typeof parsed.content !== "object") {
    throw new HttpError(400, "content がありません。");
  }

  // qrText が指定されていれば、その文字列(DOC_URL等)から QR を生成して content.qr に差し込む。
  if (typeof parsed.qrText === "string" && parsed.qrText.trim() !== "") {
    const qrPath = await renderQrToFile(parsed.qrText.trim());
    (parsed.content as Record<string, unknown>).qr = qrPath;
  }

  // 既存の content スキーマで検証（throw: SchemaValidationError）
  const content = validateAgainst<ComingSoonContent>(
    parsed.content,
    "content-coming-soon.schema.json",
    "ContentInput",
    "POST /render"
  );

  // ここから先は CLI と同一のロジックを流用（生成本体は変更なし）
  const { plan, warnings } = composeComingSoon(fixedSpec, content, "stylespec-coming-soon-v1.json");
  warnings.forEach((w) => console.warn(`⚠ ${w}`));

  // Slides が画像を取得するための公開URLは「このサーバ自身」を使う（Drive 公開不要）。
  // リバースプロキシ(Cloud Run)越しでも正しい外部URLになるよう X-Forwarded-* を見る。
  const proto = headerStr(req.headers["x-forwarded-proto"]) || "http";
  const host = headerStr(req.headers["x-forwarded-host"]) || headerStr(req.headers.host) || `localhost:${PORT}`;
  const baseUrl = `${proto}://${host}`;

  const result = await renderToSlides(fixedSpec, plan, {
    title: `SlideGen ${SUPPORTED_TEMPLATE}`,
    log: (m) => console.log(`[render] ${m}`),
    publishImage: async (buffer, mime) => `${baseUrl}/img/${putImage(buffer, mime)}`,
  });

  sendJson(res, 200, {
    ok: true,
    presentationUrl: result.presentationUrl,
    shareNote: result.shareNote ?? "",
    warnings,
  });
}

function headerStr(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

function mapError(err: unknown): { status: number; message: string } {
  if (err instanceof HttpError) return { status: err.status, message: err.message };
  if (err instanceof SchemaValidationError) return { status: 400, message: err.message };
  if (err instanceof AuthError) return { status: 500, message: `認証エラー: ${err.message}` };
  if (err instanceof PerspectiveError) return { status: 502, message: `透視変換エラー: ${err.message}` };
  if (err instanceof ImageResolveError) return { status: 400, message: `画像エラー: ${err.message}` };
  return { status: 500, message: (err as Error).message ?? "内部エラー" };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, template: SUPPORTED_TEMPLATE });
    return;
  }

  // 画像配信（Slides が匿名で取得するため X-Api-Key 不要・公開）。
  if (req.method === "GET" && url.pathname.startsWith("/img/")) {
    const token = decodeURIComponent(url.pathname.slice("/img/".length));
    const img = getImage(token);
    if (!img) {
      sendJson(res, 404, { ok: false, error: "image not found or expired" });
      return;
    }
    res.writeHead(200, { "Content-Type": img.mime, "Cache-Control": "public, max-age=600" });
    res.end(img.buffer);
    return;
  }

  if (req.method === "POST" && url.pathname === "/render") {
    handleRender(req, res).catch((err) => {
      const { status, message } = mapError(err);
      if (status >= 500) console.error(`[/render] ${status}: ${message}`);
      sendJson(res, status, { ok: false, error: message });
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`SlideGen render API listening on :${PORT}`);
  console.log(`  GET  /health`);
  console.log(`  POST /render  (X-Api-Key required)`);
  if (!process.env.RENDER_API_KEY) {
    console.warn("⚠ RENDER_API_KEY が未設定です。/render は 500 を返します。.env に設定してください。");
  }
});
