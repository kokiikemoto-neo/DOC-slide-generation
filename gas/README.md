# SlideGen GAS フロント（事例生成 × 事例検索）

2タブ構成の Apps Script Web アプリです。設計の正本は
[`../docs/integration-gas-node.md`](../docs/integration-gas-node.md)。

- **事例生成タブ**: 各項目をフォーム入力（**画像はファイルアップロード可**＝Driveへ保存して公開URL化、
  直接URL貼付も可）→「実行」→ ①**事例生成シート**へ保存(管理No.でupsert)
  → ②Node `/render` でスライド生成 → ③**事例検索シート**の同じ管理No.(=ID)行の
  「営業資料URL」列へ生成URLを書き戻し → ④同ページに「完成制作物」（リンク＋プレビュー）表示。
- **事例検索タブ**: 事例検索シートを業種/地域/採用課題/採用人数等でフィルタ表示（営業資料URL等のリンク付き）。

```
[事例生成タブ] form → saveAndGenerate → 生成シートupsert → Node /render → 検索シートへURL書戻し → 完成制作物
[事例検索タブ] filters → searchCompanies → 事例検索シートをAND絞り込み → 結果テーブル
```

> スライド生成本体（透視変換・Slides API）は Node 側のまま。GAS は入力/検索/中継のみ。

## ファイル

| ファイル | 役割 |
|---|---|
| `appsscript.json` | マニフェスト（Web アプリ設定・スコープ） |
| `.clasp.json`     | clasp 設定（`scriptId` は各自のものに置換） |
| `Config.gs`       | 2シートの列名マップ(`GEN_COLUMN_MAP`/`SEARCH_COLUMN_MAP`)・フォーム項目・Script Properties（**実シートに合わせて編集**） |
| `Search.gs`       | range / in / contains フィルタ実装（事例検索シート対象） |
| `Code.gs`         | `doGet`/`doPost`、`saveAndGenerate`（保存→生成→書き戻し）、Node 中継 |
| `index.html`      | 2タブUI（事例生成フォーム ＋ 事例検索） |

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

| プロパティ | 内容 | 既定/例 |
|---|---|---|
| `NODE_RENDER_URL` | Node `/render` の公開URL（Cloud Run の `<SERVICE_URL>/render`） | `https://.../render` |
| `RENDER_API_KEY`  | Node と共有するシークレット（`.env` の `RENDER_API_KEY` と同値） | （ランダム文字列） |
| `SPREADSHEET_ID`  | 対象スプレッドシートのID（URL可・自動でID抽出）。コンテナバインドなら省略可 | （省略可） |
| `GEN_SHEET_NAME`  | 事例生成シートのタブ名 | 既定 `事例生成シート` |
| `SEARCH_SHEET_NAME` | 事例検索シートのタブ名 | 既定 `事例検索シート` |
| `WRITEBACK_HEADER` | 生成URLを書き戻す検索シートの列ヘッダー名 | 既定 `営業資料URL` |
| `UPLOAD_FOLDER_ID` | 画像アップロードの保存先 Drive フォルダID（省略時はマイドライブ直下） | （省略可） |

> `NODE_RENDER_URL` / `RENDER_API_KEY` は**コードにも git にも書きません**。必ず Script Properties に。
> シート名/書き戻し列は既定のままなら設定不要。タブ名を変えたときだけ上書きします。

## 実シートの列名合わせ

列名（ヘッダー）は `Config.gs` の `GEN_COLUMN_MAP`（事例生成シート）と
`SEARCH_COLUMN_MAP`（事例検索シート）で対応付けています。**実シートのヘッダーに合わせて編集**してください。
突合は「生成シートの管理No. ＝ 検索シートの ID」。書き戻し列は名前で引くので列が移動しても追従します。

全タブの列構成を確認するには、エディタで `inspectRows()` を実行し、ログ（表示 → ログ）を見ます。

## 動作確認

1. `clasp deploy` で得た Web アプリ URL を開く。
2. **事例生成タブ**で各項目を入力 →「実行」→「完成制作物」にスライドが出れば成功
   （検索シートの同じ管理No.行「営業資料URL」にURLが入る）。
3. **事例検索タブ**で業種/地域/採用課題等で絞り込み → 営業資料URLリンクが見えることを確認。

うまくいかない時は `docs/integration-gas-node.md §8` と
`docs/deploy-cloud-run.md` のトラブルシュートを参照。
