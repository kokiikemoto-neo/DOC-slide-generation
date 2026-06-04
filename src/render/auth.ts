// OAuth2 認証（個人利用 / installed-app loopback フロー）。
// トークンは token.json に保存（.gitignore 済み）。鍵・トークンはコミットしない。
import fs from "node:fs";
import http from "node:http";
import { URL } from "node:url";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { getConfig, type AppConfig } from "../config.js";

/** Slides 作成 + 生成物を共有フォルダへ移動するための Drive アクセス。
 *  共有フォルダはこのアプリ外で作成されるため drive.file では不足 → full drive を使う。 */
export const SCOPES = [
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/drive",
];

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

function assertConfig(cfg: AppConfig): void {
  const missing: string[] = [];
  if (!cfg.oauthClientId) missing.push("GOOGLE_OAUTH_CLIENT_ID");
  if (!cfg.oauthClientSecret) missing.push("GOOGLE_OAUTH_CLIENT_SECRET");
  if (missing.length > 0) {
    throw new AuthError(
      `OAuth 設定が未完了です（${missing.join(", ")}）。` +
        ` .env を作成し docs/api-setup.md の手順で値を設定してください。`
    );
  }
}

function buildClient(cfg: AppConfig): OAuth2Client {
  return new google.auth.OAuth2(cfg.oauthClientId, cfg.oauthClientSecret, cfg.oauthRedirectUri);
}

function loadSavedToken(cfg: AppConfig): unknown | null {
  if (!fs.existsSync(cfg.tokenPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(cfg.tokenPath, "utf8"));
  } catch {
    return null;
  }
}

/** loopback サーバで consent 後の ?code を受け取り、トークンへ交換し token.json に保存する。 */
async function runConsentFlow(client: OAuth2Client, cfg: AppConfig): Promise<void> {
  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });

  const redirect = new URL(cfg.oauthRedirectUri);
  const port = Number(redirect.port || 80);
  const callbackPath = redirect.pathname || "/";

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url ?? "/", `http://${redirect.host}`);
        if (reqUrl.pathname !== callbackPath) {
          res.writeHead(404).end("Not found");
          return;
        }
        const err = reqUrl.searchParams.get("error");
        const got = reqUrl.searchParams.get("code");
        if (err) {
          res.writeHead(400).end(`認証エラー: ${err}`);
          server.close();
          reject(new AuthError(`認証が拒否されました: ${err}`));
          return;
        }
        if (!got) {
          res.writeHead(400).end("code がありません");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>認証が完了しました。</h1><p>このタブを閉じてターミナルに戻ってください。</p>");
        server.close();
        resolve(got);
      } catch (e) {
        reject(e as Error);
      }
    });
    server.on("error", (e) => reject(new AuthError(`ローカルサーバ起動に失敗: ${e.message}`)));
    server.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(
        "\nブラウザで以下のURLを開き、Googleアカウントで許可してください:\n\n" +
          authUrl +
          `\n\n(リダイレクト待機中: ${cfg.oauthRedirectUri})\n`
      );
    });
  });

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  fs.writeFileSync(cfg.tokenPath, JSON.stringify(tokens, null, 2), "utf8");
  // eslint-disable-next-line no-console
  console.log(`トークンを保存しました: ${cfg.tokenPath}`);
}

/**
 * 認証済み OAuth2Client を返す。token.json があれば再利用、無ければ consent フロー。
 * インタラクティブなブラウザ操作が必要。
 */
export async function authorize(): Promise<OAuth2Client> {
  const cfg = getConfig();
  assertConfig(cfg);
  const client = buildClient(cfg);

  const saved = loadSavedToken(cfg);
  if (saved) {
    client.setCredentials(saved as Record<string, unknown>);
    return client;
  }
  await runConsentFlow(client, cfg);
  return client;
}
