# SlideGen GAS フロント（事例生成 × 事例検索）

2タブ構成の Apps Script Web アプリ。**サーバ/GCP 不要で GAS だけで完結**します
（スライド生成も GAS の SlidesApp で実行）。設計の背景は
[`../docs/integration-gas-node.md`](../docs/integration-gas-node.md)。

- **事例生成タブ**: 管理No.を**プルダウン選択**（検索シートのID一覧）→ 企業名を自動記入。
  画像（ロゴ/画像①②）は**ファイルアップロード**（ブラウザで縮小し base64 で送信、Drive非経由）。
  QRは選択した管理No.の **DOC_URL から自動生成**。「実行」→ ①**事例生成シート**へ保存(管理No.でupsert)
  → ②**GAS でスライドを新規生成**（毎回新規）→ ③**事例検索シート**の同じ管理No.(=ID)行の
  「営業資料URL」列へ生成URLを**上書き**（旧スライドはゴミ箱へ）→ ④同ページに「完成制作物」表示。
- **事例検索タブ**: 事例検索シートを業種/地域/採用課題/採用人数/従業員規模でフィルタ表示。

```
[事例生成タブ] form → saveAndGenerate → 生成シートupsert → renderSlide(SlidesApp) → 検索シートへURL上書き → 完成制作物
[事例検索タブ] filters → searchCompanies → 事例検索シートをAND絞り込み → 結果テーブル
```

> 注意:
> - **透視変換（傾き）は未対応**。frame1/frame2 はフレーム内にまっすぐ(contain)配置（傾きは後日追加可）。
> - **QR は既定で外部QRサービス**（DOC_URL を送信）。社内完結したい場合は `QR_API_TEMPLATE` を内製エンドポイントに差し替え。

## ファイル

| ファイル | 役割 |
|---|---|
| `appsscript.json` | マニフェスト（Web アプリ設定・スコープ） |
| `.clasp.json`     | clasp 設定（`scriptId` は各自のものに置換） |
| `Config.gs`       | 2シートの列名マップ(`GEN_COLUMN_MAP`/`SEARCH_COLUMN_MAP`)・フォーム項目・Script Properties（**実シートに合わせて編集**） |
| `Search.gs`       | range / in / contains フィルタ実装（事例検索シート対象。範囲列の区間重なり判定含む） |
| `Render.gs`       | **GAS 単体のスライド生成**（SlidesApp）。固定レイアウト・contain・フォント縮小・QR取得 |
| `Background.gs`   | 固定背景(暫定)を base64 で同梱（`BACKGROUND_FILE_ID` で差し替え可） |
| `Code.gs`         | `doGet`/`doPost`、`saveAndGenerate`（保存→`renderSlide`→URL上書き） |
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

**サーバ不要のため、必須のプロパティはありません**（すべて既定で動作）。必要に応じて上書き：

| プロパティ | 内容 | 既定/例 |
|---|---|---|
| `SPREADSHEET_ID`  | 対象スプレッドシートのID（URL可・自動でID抽出）。コンテナバインドなら省略可 | （省略可） |
| `GEN_SHEET_NAME`  | 事例生成シートのタブ名 | 既定 `事例生成シート` |
| `SEARCH_SHEET_NAME` | 事例検索シートのタブ名 | 既定 `事例検索シート` |
| `WRITEBACK_HEADER` | 生成URLを書き戻す検索シートの列ヘッダー名 | 既定 `営業資料URL` |
| `QR_API_TEMPLATE` | QR生成エンドポイント（`{data}` を URL エンコードで置換）。内製に差し替え可 | 既定 qrserver |
| `BACKGROUND_FILE_ID` | 背景画像の Drive ファイルID（正式背景に差し替えたい時）。省略時は同梱の暫定背景 | （省略可） |
| `SHARE_FOLDER_ID` | **生成スライドの保存先フォルダ（推奨）**。チームに編集者で共有したフォルダ/共有ドライブのID。ここに入れると中のスライドもそのメンバーが編集可。設定時はリンク/ドメイン共有はスキップ | （省略可） |
| `SHARE_MODE` | フォルダ未設定時の共有: `domain_edit`(社内リンク編集可・既定) / `anyone_edit`(全員編集※社外公開許可組織のみ) / `none`(作成者のみ) | 既定 `domain_edit` |
| `SHARE_EDITORS` | 追加で編集権限を付ける宛先（メール/Googleグループ、カンマ区切り）。例: `team@neo-career.co.jp` | （省略可） |

> シート名/書き戻し列は既定のままなら設定不要。タブ名を変えたときだけ上書きします。
> Node/Cloud Run は不要になりました（`NODE_RENDER_URL`/`RENDER_API_KEY` は使いません）。

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
