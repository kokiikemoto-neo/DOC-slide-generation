// 設定/環境変数の読み込み。dotenv に依存せず .env を素朴にパースする。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** リポジトリルート（src/ の1つ上）。 */
export const ROOT = path.resolve(__dirname, "..");

/** `.env` を読み、process.env に未設定のキーだけ流し込む（既存環境を優先）。 */
export function loadEnv(envPath = path.join(ROOT, ".env")): void {
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // 両端のクォートを剥がす
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

export interface AppConfig {
  oauthClientId: string;
  oauthClientSecret: string;
  oauthRedirectUri: string;
  tokenPath: string;
  pythonBin: string;
}

/** 描画段で必要になる設定を環境変数から組み立てる。未設定でも例外は投げず空文字で返す
 *  （実際に Google API を叩く auth.ts 側で、欠けていれば分かりやすく案内する）。 */
export function getConfig(): AppConfig {
  loadEnv();
  return {
    oauthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    oauthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
    oauthRedirectUri:
      process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "http://localhost:3000/oauth2callback",
    tokenPath: path.resolve(ROOT, process.env.GOOGLE_TOKEN_PATH ?? "token.json"),
    pythonBin: process.env.PYTHON_BIN ?? "python",
  };
}
