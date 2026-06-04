# Node 生成API を Cloud Run にデプロイする手順

> GAS Web アプリから到達するには、Node の `/render` API を**公開URL**で動かす必要があります。
> ここでは Google Cloud Run へのデプロイ手順をまとめます。
> **鍵・トークン・シークレットの実値は記載しません。**発行・設定はあなたが手作業で行ってください。
> （`.env` / `token.json` / サービスアカウント鍵は git にも Docker イメージにも含めません。）

## 前提

- Phase 1 のローカル疎通が済んでいる（`npm run slidegen -- render ...` で生成できる）。
- `gcloud` CLI 導入済み・ログイン済み（`gcloud auth login` / `gcloud config set project <PROJECT_ID>`）。
- Google Slides API / Drive API は有効化済み（`docs/api-setup.md` 手順2）。

## 1. Google 認証を「ヘッドレスで使える形」にする

Cloud Run 上ではブラウザ同意フローを実行できません。次のいずれかを用意します。

- **方式A（推奨・既存コードのまま）: リフレッシュトークン入りの `token.json` を使う**
  1. ローカルで `.env` を用意（`docs/api-setup.md` の手順で OAuth デスクトップクライアントの
     ID/secret を取得して記入）。
  2. `npm run login` を実行。ブラウザで同意すると `token.json` が生成されます
     （`access_type:"offline"` のため `refresh_token` を含み、以後は自動更新）。
     - ※ OAuth 同意画面が「テスト」状態だと refresh_token は約7日で失効します。
       常用するなら同意画面を「本番（In production）」に切り替えるか、失効したら `npm run login` で再取得。
  3. この `token.json` と OAuth クライアントの ID/secret を **Secret Manager** に登録（後述）。
- 方式B: サービスアカウント方式に切り替える場合は別途 `auth.ts` の拡張が必要（本フェーズ範囲外）。

## 2. シークレットを Secret Manager に登録

```bash
# 共有シークレット（GAS と一致させる値。自分でランダム生成）
printf '%s' "<RENDER_API_KEY>"        | gcloud secrets create render-api-key --data-file=-
# OAuth クライアント
printf '%s' "<GOOGLE_OAUTH_CLIENT_ID>"     | gcloud secrets create google-oauth-client-id --data-file=-
printf '%s' "<GOOGLE_OAUTH_CLIENT_SECRET>" | gcloud secrets create google-oauth-client-secret --data-file=-
# token.json（方式A）
gcloud secrets create google-token --data-file=token.json
```

> `<...>` は実値に置き換えて**手元で**実行する値です。このファイルには書きません。

## 3. デプロイ（ソースから直接ビルド）

リポジトリ直下（`Dockerfile` のある場所）で:

```bash
gcloud run deploy slidegen-render \
  --source . \
  --region <REGION> \
  --no-allow-unauthenticated \
  --set-secrets=RENDER_API_KEY=render-api-key:latest \
  --set-secrets=GOOGLE_OAUTH_CLIENT_ID=google-oauth-client-id:latest \
  --set-secrets=GOOGLE_OAUTH_CLIENT_SECRET=google-oauth-client-secret:latest \
  --set-secrets=/secrets/token.json=google-token:latest \
  --set-env-vars=GOOGLE_TOKEN_PATH=/secrets/token.json,PYTHON_BIN=python3
```

ポイント:
- `PORT` は Cloud Run が自動注入します（`server.ts` は `process.env.PORT` を見ます）。
- `GOOGLE_TOKEN_PATH` をマウント先 `/secrets/token.json` に向けます（`config.ts` がこれを参照）。
- 透視変換の Python/OpenCV は `Dockerfile` 内でインストール済みです。

### 認証（GAS からの到達）について
- `--no-allow-unauthenticated` のままだと Cloud Run の IAM 認証が必要で、GAS の単純な
  `UrlFetchApp` では到達できません。本ツールは**アプリ層の `X-Api-Key`** で保護するため、
  運用としては次のどちらか:
  - (簡便) `--allow-unauthenticated` で公開し、`X-Api-Key` で守る（推奨・GAS と相性良）。
  - (厳格) IAM 認証を維持し、GAS 側で Google OAuth トークンを付与して呼ぶ（追加実装が必要）。
- 簡便側にする場合は `--allow-unauthenticated` に変更してデプロイし直してください。

## 4. 疎通確認

```bash
SERVICE_URL=$(gcloud run services describe slidegen-render --region <REGION> --format='value(status.url)')
curl "$SERVICE_URL/health"          # {"ok":true,...}

curl -X POST "$SERVICE_URL/render" \
  -H "X-Api-Key: <RENDER_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"templateId":"coming-soon-v1","content":{"logo":"<公開URL>","tagline":"...","qr":"<公開URL>","frame1":"<公開URL>","body1":"...","frame2":"<公開URL>","body2":"..."}}'
```

> 注: コンテナ内にはローカル画像が無いため、`content` の画像4スロットは**公開到達可能なURL**にします
> （`samples/render-request.example.json` はローカル疎通用にローカルパスを使っているのでそのままでは Cloud Run で失敗します）。
> 実運用では GAS が Sheets の画像URL列を渡します。

返ってきた `presentationUrl` が開ければ成功です。

## 5. GAS 側に値を設定

GAS の Script Properties に以下を登録します（`gas/README.md` 参照）:

| プロパティ | 値 |
|---|---|
| `NODE_RENDER_URL` | `<SERVICE_URL>/render` |
| `RENDER_API_KEY`  | 手順2と同じ共有シークレット |

## トラブルシュート

- **401 が返る**: `X-Api-Key` と Secret `render-api-key` の値が一致しているか。
- **500 「サーバが未設定」**: `RENDER_API_KEY` がコンテナに渡っていない（`--set-secrets` を確認）。
- **認証エラー（Slides）**: `token.json` が `/secrets/token.json` にマウントされ、`GOOGLE_TOKEN_PATH`
  がそこを指しているか。refresh_token を含むか（含まない場合はローカルで再取得）。
- **透視変換エラー**: コンテナの `PYTHON_BIN=python3` と OpenCV インストールを確認。
- **画像取得失敗**: content の画像URLが公開到達可能か。ローカルパスはコンテナ内に存在しないため不可
  （GAS からは公開URLを渡す運用）。
