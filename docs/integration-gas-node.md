# SlideGen 統合設計：GAS 検索フロント × Node スライド生成

これまで設計した Node 製スライド生成キット（DESIGN.md / 固定テンプレート coming-soon-v1）に、
**GAS 上の検索アプリ**を前段として足し、Google Sheets の企業データを列フィルタで検索 →
ヒットした企業を選んでスライド生成、までを1つのワークフローにする統合設計。

---

## 1. 全体構成と役割分担

```
┌─────────────────────────── GAS (Google Apps Script) ───────────────────────────┐
│  Web App (doGet/doPost)                                                          │
│   ├─ 検索UI (HtmlService)         : 列フィルタ入力フォーム + 結果テーブル         │
│   ├─ 検索ロジック (Code.gs)        : Google Sheets を読み列でフィルタ             │
│   └─ 生成リクエスト中継            : 選択行 → Node生成APIへ POST                  │
└───────────────────────────────────┬─────────────────────────────────────────────┘
                                     │ HTTPS (JSON)
                                     ▼
┌─────────────────────── Node スライド生成キット（既存設計）─────────────────────┐
│  HTTP API (/render)                                                              │
│   ├─ compose : 受領データ → SlidePlan（固定StyleSpec coming-soon-v1）            │
│   ├─ perspective : frame1/frame2 を透視変換                                      │
│   └─ render : Google Slides API で生成 → URL返却                                 │
└──────────────────────────────────────────────────────────────────────────────┘
        ▲                                   │
        │ 検索対象データ                     ▼ 生成結果URL
┌───────────────┐                   GAS UI に表示 / Sheets に書き戻し
│ Google Sheets │  1行=1社（採用人数・売れたニーズ等の属性列）
└───────────────┘
```

**境界の理由**：透視変換（sharp/OpenCV）や Slides API バッチ処理は GAS では動かない/不得手。
GAS は Sheets 検索と UI に専念し、生成は Node に委譲する。両者は JSON で疎結合。

---

## 2. Google Sheets スキーマ（1行=1社）

シート名 `companies`。1行目はヘッダー固定。列は例（実データに合わせて調整可）：

| 列名(ヘッダー) | キー | 型 | フィルタUI | 用途 |
|---|---|---|---|---|
| 企業ID         | companyId   | string | – | 一意キー |
| 企業名         | name        | string | テキスト部分一致 | tagline等に利用 |
| 採用人数       | hireCount   | number | 数値範囲(min-max) | 検索条件 |
| 売れたニーズ   | soldNeeds   | string(複数可) | 複数選択(タグ) | 検索条件 |
| 業種           | industry    | string | 単一/複数選択 | 検索条件 |
| ロゴURL        | logoUrl     | string | – | slide: logo |
| QR URL         | qrUrl       | string | – | slide: qr |
| 画像1 URL      | image1Url   | string | – | slide: frame1 |
| 画像2 URL      | image2Url   | string | – | slide: frame2 |
| 本文1          | body1       | string | – | slide: body1 |
| 本文2          | body2       | string | – | slide: body2 |
| ひとこと       | tagline     | string | – | slide: tagline |

> 「売れたニーズ」が1セルに複数入る場合は区切り文字（例: `,`）で格納し、GAS側で split してタグ化。

---

## 3. 検索フィルタ仕様（GAS）

`doPost` に検索条件JSONを受け、Sheets 全行を読み、条件AND結合でフィルタして返す。

### 検索条件の形
```json
{
  "filters": {
    "hireCount":  { "type": "range", "min": 10, "max": 100 },
    "soldNeeds":  { "type": "in", "values": ["業務効率化", "属人化解消"] },
    "industry":   { "type": "in", "values": ["製造"] },
    "name":       { "type": "contains", "value": "テック" }
  }
}
```

### フィルタ型
- `range` … min/max（どちらか省略可）で数値範囲。例: 採用人数。
- `in`    … 指定値のいずれかを含む（複数選択・タグ）。soldNeeds は複数値セルなので「いずれか一致」。
- `contains` … 部分一致（テキスト）。
- 複数 filter は **AND**。値未指定の filter は無視。

### 返却
```json
{
  "count": 3,
  "rows": [
    { "companyId": "C001", "name": "...", "hireCount": 30, "soldNeeds": ["業務効率化"], ... }
  ]
}
```

UI 側は結果をテーブル表示し、各行に「スライド生成」ボタンを置く。

---

## 4. GAS → Node 連携契約

GAS は選択された1社の行を、Node 生成APIが期待する `content.json` 形式へ**マッピングして** POST する。
（マッピング表 = §2 の「用途」列）

### Node 側エンドポイント `POST /render`
リクエスト：
```json
{
  "templateId": "coming-soon-v1",
  "content": {
    "logo":    "<logoUrl>",
    "tagline": "<tagline or name>",
    "qr":      "<qrUrl>",
    "frame1":  "<image1Url>",
    "body1":   "<body1>",
    "frame2":  "<image2Url>",
    "body2":   "<body2>"
  }
}
```
レスポンス：
```json
{ "ok": true, "presentationUrl": "https://docs.google.com/presentation/d/.../edit" }
```

GAS は受け取った `presentationUrl` を UI に表示し、任意で Sheets の該当行「生成URL」列に書き戻す。

---

## 5. 認証・ホスティングの前提（重要）

1. **Node 生成APIは公開URLが必要。** GAS Webアプリから到達できる場所（Cloud Run / Render / VPS 等）に
   デプロイする。ローカル(`localhost`)のままでは GAS から呼べない。
2. **GAS→Node 間の保護**：誰でも叩けないよう共有シークレット（ヘッダ `X-Api-Key`）で簡易認証。
   キーは GAS の Script Properties と Node の環境変数に置き、**コードにも git にも書かない**。
3. **Google Slides/Drive の認証は Node 側**（既存設計どおり OAuth/サービスアカウント）。
   鍵・トークン・APIキーは一切コミットしない（`.gitignore`）。発行・登録はユーザーが手作業で行う。
4. GAS の Sheets 読み取りは GAS 実行ユーザーの権限で行われる（追加の鍵は不要）。

---

## 6. リポジトリ構成（統合後）

既存 Node リポジトリに `gas/` を追加。GAS は clasp でローカル管理し git に含める。

```
slidegen/
├── DESIGN.md                         # Node側 全体設計（既存）
├── docs/
│   ├── template-coming-soon-v1.md    # 固定テンプレ実装ガイド（既存）
│   ├── integration-gas-node.md       # 本書
│   └── api-setup.md                  # Google Cloud / OAuth 手順（既存）
├── schemas/                          # StyleSpec / SlidePlan / content / search-filter
│   ├── stylespec.schema.json
│   ├── slideplan.schema.json
│   ├── content.schema.json
│   └── search-filter.schema.json     # 追加: 検索条件JSONの検証用
├── samples/
│   └── stylespec-coming-soon-v1.json
├── src/                              # Node（既存：compose/render/perspective）
│   └── server.ts                     # 追加: POST /render の HTTP API
└── gas/                              # 追加: GAS プロジェクト（clasp管理）
    ├── .clasp.json                   # scriptId（公開してよい範囲で）
    ├── appsscript.json               # マニフェスト
    ├── Code.gs                       # doGet/doPost・検索ロジック・Node中継
    ├── Search.gs                     # フィルタ実装（range/in/contains）
    ├── index.html                    # 検索UI
    └── README.md                     # clasp push 手順、Script Properties設定
```

---

## 7. データフロー（通し）

1. ユーザーが GAS Web アプリを開く → 検索フォーム（採用人数の範囲、売れたニーズのタグ等）
2. 条件を入力 → `doPost` が Sheets をフィルタ → 結果テーブル表示
3. 行の「スライド生成」押下 → GAS が行を content にマッピングし Node `/render` へ POST
4. Node が固定テンプレでスライド生成 → URL を返す
5. GAS が URL を表示（＋任意で Sheets に書き戻し）

---

## 8. 実装範囲の切り分け（Claude Code 向け）

- **Node 追加分**：`src/server.ts`（既存 compose/render をHTTP化、`X-Api-Key`検証）、`search-filter.schema.json`
- **GAS 新規**：`gas/` 一式（検索UI・フィルタ・Node中継）。clasp で push。
- 既存の compose/perspective/render ロジックは流用。生成本体は変更最小。

> 注：Node の公開デプロイ、Google 認証情報の発行、共有シークレットの設定は
> いずれもユーザー（あなた）が手作業で実施。Claude Code は手順書とコードのみ用意し、
> 鍵・URL・シークレットの実値は記入しないこと。
