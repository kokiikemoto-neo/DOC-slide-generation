# Google API セットアップ手順（OAuth・個人利用）

> このツールは **あなた自身の Google アカウント** で Google Slides / Drive を操作します。
> 鍵・トークンの**発行と登録はあなたが行ってください**。本書は手順のみで、値は一切記載しません。
> 発行した値は `.env` と `token.json` に入りますが、いずれも `.gitignore` 済みでコミットされません。

## 0. 前提

- Google アカウント（個人で可）
- Node.js 20 以上 / Python 3（透視変換に使用）

## 1. Google Cloud プロジェクトを作る

1. https://console.cloud.google.com/ を開く。
2. 上部のプロジェクト選択 →「新しいプロジェクト」→ 名前を付けて作成。
3. 作成したプロジェクトを選択した状態にする。

## 2. API を有効化する

「APIとサービス」→「ライブラリ」で以下2つを検索し、それぞれ「有効にする」:

- **Google Slides API**
- **Google Drive API**

## 3. OAuth 同意画面を設定する

1. 「APIとサービス」→「OAuth同意画面」。
2. User Type は **外部 (External)** を選択（個人アカウントならこれで可）。
3. アプリ名・サポートメール・デベロッパー連絡先など必須項目を入力して保存。
4. 「対象ユーザー / テストユーザー」に **自分の Google アカウント** を追加する
   （公開申請をしない限り、テストユーザーだけが利用可能）。
5. スコープは未追加でもよい（実行時にこのアプリが要求する。後述のスコープを参照）。

## 4. OAuth クライアント ID（デスクトップアプリ）を発行する

1. 「APIとサービス」→「認証情報」→「認証情報を作成」→「OAuth クライアント ID」。
2. アプリケーションの種類: **デスクトップアプリ**。
3. 作成すると **クライアント ID** と **クライアントシークレット** が表示される。
   - この2つを後述の `.env` に貼り付ける（コミットしない）。

> 補足: ループバック (`http://localhost:3000/oauth2callback`) を使うため、
> 「承認済みリダイレクト URI」を編集できる種類（ウェブアプリ）を選んだ場合は
> 同じ URI を登録すること。デスクトップアプリ種類なら loopback は既定で許可されます。

## 5. `.env` を用意する

リポジトリ直下の `.env.example` を `.env` にコピーし、発行した値を入れる:

```
cp .env.example .env   # Windows PowerShell: Copy-Item .env.example .env
```

`.env` の項目:

| キー | 内容 |
|------|------|
| `GOOGLE_OAUTH_CLIENT_ID`     | 手順4のクライアント ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | 手順4のクライアントシークレット |
| `GOOGLE_OAUTH_REDIRECT_URI`  | 既定 `http://localhost:3000/oauth2callback` のままで可 |
| `GOOGLE_TOKEN_PATH`          | トークン保存先（既定 `token.json`） |
| `PYTHON_BIN`                 | Python 実行ファイル（Windows は `py` など） |

## 6. 透視変換の Python 依存をインストールする

frame1/frame2 の透視変換に OpenCV を使います:

```
python -m pip install opencv-python numpy
```

（`PYTHON_BIN` を別の実行系にしている場合はそちらで実行）

## 7. 初回認証（トークン発行）

`slidegen render` を初めて実行すると、ターミナルに認証 URL が表示されます。

1. URL をブラウザで開く。
2. 手順3でテストユーザーに登録したアカウントでログインし、要求された権限を許可する。
3. 「このアプリは確認されていません」と出たら「詳細」→「（アプリ名）に移動」で進む
   （自分のテストアプリなので問題なし）。
4. 許可後、`http://localhost:3000/oauth2callback` にリダイレクトされ、
   ツールがコードを受け取って `token.json` を保存します。

以降は `token.json` が再利用され、ブラウザ操作は不要です。

## 要求スコープ

このツールは最小スコープのみ要求します:

- `https://www.googleapis.com/auth/presentations` — スライド作成・編集
- `https://www.googleapis.com/auth/drive.file` — **このツールが作成したファイルのみ** の管理
  （画像を一時アップロードして公開URL化し、生成後に削除するため）

## トラブルシュート

- **`redirect_uri_mismatch`**: `.env` の `GOOGLE_OAUTH_REDIRECT_URI` と
  Cloud Console 側の登録 URI を一致させる（デスクトップアプリ種類なら通常不要）。
- **`access_blocked` / テストユーザー**: 同意画面のテストユーザーに自分を追加したか確認。
- **画像が出ない**: Drive の公開URL取得に失敗している可能性。`--keep-uploads` で
  アップロードを残し、URL に直接アクセスできるか確認する。
- **`No module named 'cv2'`**: 手順6を実行。`PYTHON_BIN` の指す Python に入れる。
- **トークンを作り直したい**: `token.json` を削除して再実行。
