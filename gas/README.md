# SlideGen GAS フロント（検索UI × Node 生成中継）

Google Sheets の企業データ（1行=1社）を列フィルタで検索し、選んだ企業を Node の
`/render` API に渡して Google Slides を生成する Apps Script Web アプリです。
設計の正本は [`../docs/integration-gas-node.md`](../docs/integration-gas-node.md)。

```
検索UI(index.html) → doPost(検索) → Sheets フィルタ → 結果テーブル
                                                   └→「スライド生成」→ doPost(generate)
                                                        → 行を content にマッピング
                                                        → UrlFetchApp で Node /render へ POST
                                                        → presentationUrl を UI に表示（任意で書き戻し）
```

## ファイル

| ファイル | 役割 |
|---|---|
| `appsscript.json` | マニフェスト（Web アプリ設定・スコープ） |
| `.clasp.json`     | clasp 設定（`scriptId` は各自のものに置換） |
| `Config.gs`       | 列名マップ・区切り文字・Script Properties 読み取り（**ここを実シートに合わせて編集**） |
| `Search.gs`       | range / in / contains フィルタ実装 |
| `Code.gs`         | `doGet`/`doPost`、Sheets 読み取り、Node 中継 |
| `index.html`      | 検索フォーム＋結果テーブル UI |

## セットアップ

### 1. clasp を用意

```bash
npm install -g @google/clasp
clasp login                      # 自分の Google アカウントで認証（~/.clasprc.json に保存・コミット禁止）
```

### 2. Apps Script プロジェクトに紐付け

**A. 新規作成する場合**（このディレクトリで）:

```bash
cd gas
clasp create --type webapp --title "SlideGen Search" --rootDir .
# → .clasp.json の scriptId が自分のものに書き換わる
```

**B. 既存スクリプトに紐付ける場合**: `gas/.clasp.json` の `scriptId` を自分の
スクリプトID（Apps Script エディタ URL の `/d/<ここ>/edit`）に置き換える。

### 3. push & デプロイ

```bash
clasp push                       # ローカルのファイルを Apps Script へ反映
clasp deploy --description "v1"  # Web アプリとしてデプロイ（URL が発行される）
# 初回は clasp open でエディタを開き、Web アプリのアクセス設定・承認を行う
```

## Script Properties（**実値はここに書かない／コミットしない**）

Apps Script エディタ →「プロジェクトの設定」→「スクリプト プロパティ」に登録します。
コード（`Config.gs`）は `PropertiesService.getScriptProperties()` から読むだけです。

| プロパティ | 内容 | 例 |
|---|---|---|
| `NODE_RENDER_URL` | Node `/render` の公開URL（Cloud Run の `<SERVICE_URL>/render`） | `https://.../render` |
| `RENDER_API_KEY`  | Node と共有するシークレット（`.env` の `RENDER_API_KEY` と同値） | （ランダム文字列） |
| `SPREADSHEET_ID`  | 検索対象スプレッドシートのID（URL の `/d/<ここ>/edit`）。コンテナバインドなら省略可 | |
| `SHEET_NAME`      | シート名（省略時 `companies`） | `companies` |
| `URL_WRITEBACK_HEADER` | 生成URLを書き戻す列のヘッダー名（省略時は書き戻さない） | `生成URL` |

> `NODE_RENDER_URL` / `RENDER_API_KEY` は**コードにも git にも書きません**。必ず Script Properties に。

## 実シートの列名合わせ

列名（ヘッダー）は `Config.gs` の `COLUMN_MAP` で対応付けています。既定は
`docs/integration-gas-node.md §2` の例です。**実際のシートのヘッダーに合わせて編集**してください。

ヘッダーを確認するには、エディタで `inspectHeaders()` を実行し、ログ（表示 → ログ）に
出力される1行目の列名を確認できます。

## 動作確認

1. `clasp deploy` で得た Web アプリ URL を開く。
2. 採用人数の範囲・売れたニーズ/業種の選択・企業名の部分一致で検索。
3. 結果行の「スライド生成」を押す → しばらくして Slides の URL が表示されれば成功。

うまくいかない時は `docs/integration-gas-node.md §8` と
`docs/deploy-cloud-run.md` のトラブルシュートを参照。
