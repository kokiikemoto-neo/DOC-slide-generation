# Claude Code への指示文：Phase 2 — GAS検索フロント × Node連携

Phase 1（CLAUDE_CODE_PROMPT.md：固定テンプレートのスライド生成キット）が動いた後に着手する追加フェーズ。
着手前に `docs/integration-gas-node.md` と `schemas/search-filter.schema.json` を必ず読むこと。

## ゴール
Google Sheets（1行=1社）を列フィルタで検索する GAS Web アプリを作り、検索結果から選んだ企業を
既存 Node 生成キットに渡して Google Slides を生成する。GAS と Node は HTTPS+JSON で連携。

## 重要な前提（守る）
1. **透視変換や Slides 生成は Node 側のまま**。GAS には移植しない（GASでは動かない）。
2. **Node はHTTP API化する**が、既存の compose/perspective/render ロジックは流用。生成本体の変更は最小に。
3. **公開デプロイ・認証情報・共有シークレットの実値はユーザーが手作業で設定**。
   コードや git に URL・鍵・シークレットを書かない。`.gitignore` と Script Properties / 環境変数で管理。

## 実装ステップ（各ステップごとにコミット）

### Step 7: Node を HTTP API 化（src/server.ts）
- `POST /render` を実装。body は `docs/integration-gas-node.md §4` の契約どおり
  （`templateId` + `content` 7スロット）。
- リクエストを `content.schema.json` で検証 → 既存 compose→perspective→render を呼ぶ → `presentationUrl` を返す。
- `X-Api-Key` ヘッダを環境変数の共有シークレットと照合（不一致は401）。値は `.env`（gitignore済み）。
- ローカル起動 + サンプルbodyでの動作確認手順を README に追記。
- → commit: "feat: expose slide generation as POST /render HTTP API with shared-secret auth"

### Step 8: GAS プロジェクト雛形（gas/、clasp管理）
- `gas/` に clasp プロジェクトを作成（`.clasp.json` / `appsscript.json`）。git に含める。
- `appsscript.json` に Web アプリ実行設定と必要スコープ（Spreadsheet読み取り・外部URL fetch）を記述。
- `gas/README.md` に clasp push 手順、Script Properties（`NODE_RENDER_URL`,`RENDER_API_KEY`）の
  設定方法を書く（**実値は書かない**、プレースホルダのみ）。
- → commit: "chore: scaffold GAS project (clasp) with manifest and setup docs"

### Step 9: 検索ロジック（gas/Code.gs, Search.gs）
- `doPost` で検索条件JSON（`search-filter.schema.json` 準拠）を受ける。
- Sheets `companies` を読み、`range`/`in`/`contains` の3フィルタをAND適用（`docs/integration-gas-node.md §3`）。
- `soldNeeds` 等の複数値セルは区切り文字でsplitして `in` 判定。
- 結果（count + rows）をJSONで返す。
- → commit: "feat: GAS Sheets search with range/in/contains filters"

### Step 10: 検索UI（gas/index.html）
- `doGet` で HtmlService によるUIを返す。採用人数の範囲入力、売れたニーズ/業種の複数選択、企業名の部分一致。
- 検索→結果テーブル表示。各行に「スライド生成」ボタン。
- → commit: "feat: GAS search UI with filter form and result table"

### Step 11: GAS→Node 中継（gas/Code.gs）
- 「スライド生成」押下で、選択行を `content` にマッピング（`docs/integration-gas-node.md §4`）。
- `UrlFetchApp.fetch(NODE_RENDER_URL, { headers:{'X-Api-Key':RENDER_API_KEY}, ... })` で POST。
- 返ってきた `presentationUrl` をUIに表示。任意で Sheets の「生成URL」列に書き戻す。
- → commit: "feat: relay selected company from GAS to Node /render and show result URL"

## 完了の定義
- GAS Web アプリで条件検索 → ヒット行から「スライド生成」 → Node が生成した Slides URL が表示される。
- 検索フィルタ（範囲/複数選択/部分一致）が仕様どおり動く。
- 鍵・URL・シークレットの実値がコード/gitに一切含まれない。

不明点（Sheetsの実際の列名、ニーズの区切り文字、Nodeのデプロイ先）は、勝手に仮定せず私に確認すること。
