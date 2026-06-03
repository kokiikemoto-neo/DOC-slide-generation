# SlideGen — テンプレート準拠スライド自動生成ツール 設計書

> タイトル・画像・本文を入力すると、ユーザーが用意した「テンプレート画像（最終アウトプット見本）」を分解し、その色・フォント・レイアウトに合わせて Google Slides を直接生成する AI ツール。

この文書は **設計と構成** を固めるためのもの。実装は VS Code 上の Claude Code が本書を起点に進める。

---

## 1. 全体像

```
[テンプレート画像]            [入力データ(タイトル/画像/本文)]
       │                              │
       ▼                              │
┌──────────────┐                      │
│ 1. 画像分解    │                      │
│  Vision解析   │                      │
└──────┬───────┘                      │
       ▼                              │
[StyleSpec(JSON)]  ←── デザイントークン抽出                
       │                              │
       └──────────┬───────────────────┘
                  ▼
        ┌──────────────────┐
        │ 2. レイアウト合成  │  StyleSpec + 入力 → SlidePlan
        └────────┬─────────┘
                 ▼
          [SlidePlan(JSON)]
                 ▼
        ┌──────────────────┐
        │ 3. Slides生成     │  Google Slides API (batchUpdate)
        └────────┬─────────┘
                 ▼
          [Google Slides URL]
```

3 つの中間表現（`StyleSpec` / `SlidePlan`）を JSON で固定するのが要。これにより各段を独立して差し替え・テスト・GitHub 管理できる。**どんな画像・文章が来ても**、合成段が StyleSpec の枠に流し込むだけなので破綻しない。

---

## 2. リポジトリ構成

```
slidegen/
├── README.md
├── DESIGN.md                  # 本書
├── .env.example               # APIキー等のテンプレ(実値はコミットしない)
├── .gitignore
├── package.json
├── docs/
│   ├── architecture.md
│   ├── stylespec-schema.md
│   └── api-setup.md           # Google Cloud / OAuth 手順
├── schemas/
│   ├── stylespec.schema.json  # StyleSpec の JSON Schema
│   └── slideplan.schema.json  # SlidePlan の JSON Schema
├── src/
│   ├── index.ts               # CLI/エントリポイント
│   ├── analyze/
│   │   ├── decompose.ts        # 画像→StyleSpec (Vision呼び出し)
│   │   └── prompts.ts          # 分解用プロンプト
│   ├── compose/
│   │   ├── layout.ts           # StyleSpec + 入力 → SlidePlan
│   │   └── fit.ts              # テキスト量・画像比率の自動調整
│   ├── render/
│   │   ├── googleSlides.ts     # SlidePlan → Slides API batchUpdate
│   │   ├── auth.ts             # OAuth2 / サービスアカウント
│   │   └── requests.ts         # batchUpdate リクエスト組み立て
│   ├── types.ts               # StyleSpec / SlidePlan の型
│   └── config.ts
├── samples/
│   ├── template-01.png        # テンプレート画像見本
│   └── stylespec-01.json      # 分解結果の例(回帰テスト用)
└── tests/
    ├── decompose.test.ts
    ├── compose.test.ts
    └── fixtures/
```

---

## 3. 中間表現スキーマ

### 3.1 StyleSpec（テンプレート画像の分解結果）

画像から抽出するデザイントークン。色・フォント・レイアウト領域を含む。

```jsonc
{
  "meta": {
    "sourceImage": "template-01.png",
    "aspectRatio": "16:9",        // 16:9 | 4:3
    "pageSize": { "w": 960, "h": 540 } // pt(EMU換算は描画段で)
  },
  "palette": {
    "background": "#0E1726",
    "primary":    "#3DA9FC",
    "accent":     "#FFB703",
    "textMain":   "#FFFFFF",
    "textSub":    "#B6C2D1"
  },
  "typography": {
    "title":   { "family": "Montserrat", "weightHint": "bold",    "sizePt": 36, "color": "#FFFFFF", "align": "left" },
    "body":    { "family": "Noto Sans JP","weightHint": "regular", "sizePt": 16, "color": "#B6C2D1", "align": "left" },
    "caption": { "family": "Noto Sans JP","weightHint": "regular", "sizePt": 11, "color": "#7A8AA0", "align": "left" }
  },
  "regions": [
    { "id": "title",   "role": "title", "rect": { "x": 60,  "y": 48,  "w": 560, "h": 90 } },
    { "id": "image",   "role": "image", "rect": { "x": 640, "y": 48,  "w": 260, "h": 444 }, "fit": "cover" },
    { "id": "body",    "role": "body",  "rect": { "x": 60,  "y": 160, "w": 560, "h": 320 } },
    { "id": "accentBar","role": "decoration", "rect": { "x": 0, "y": 0, "w": 12, "h": 540 }, "fill": "#3DA9FC" }
  ],
  "confidence": { "palette": 0.92, "typography": 0.7, "regions": 0.85 }
}
```

- `weightHint` は「画像から推定したウェイト」。Google Slides 側のフォントに存在しない場合があるため *Hint* とし、描画段で最も近いものへフォールバック。
- `confidence` を持たせ、低い項目はログ警告 → 手動上書き(`--override`)できるようにする。
- **フォント名はあくまで推定**。Vision で正確な書体特定は困難なので、`fontCandidates` を複数返しユーザー確認 or 既定フォントへフォールバックする設計が安全。

### 3.2 SlidePlan（合成結果・描画の直前形）

入力データを StyleSpec の各 region に割り当てた、API 非依存の中間形。

```jsonc
{
  "styleRef": "stylespec-01.json",
  "slides": [
    {
      "elements": [
        { "region": "title", "type": "text",  "value": "四半期レビュー" },
        { "region": "body",  "type": "text",  "value": "・売上は前年比12%増\n・新規顧客が..." },
        { "region": "image", "type": "image", "value": "https://.../chart.png", "fit": "cover" },
        { "region": "accentBar", "type": "shape" }
      ],
      "overflow": { "body": "trimmed" }   // fit.ts が縮小/分割したか記録
    }
  ]
}
```

JSON Schema は `schemas/` に置き、各段の出力をスキーマ検証してから次段へ渡す（CI でも検証）。

---

## 4. 各モジュールの責務

### 4.1 analyze/decompose.ts — 画像分解
- 入力: テンプレート画像（PNG/JPG）。
- 処理: Vision モデルに画像 + `prompts.ts` の分解指示を渡し、StyleSpec(JSON) を生成。
  - 色はピクセル解析でも裏取り（画像から代表色クラスタリング → Vision 推定とマージ）。色は機械抽出のほうが正確なので **palette はピクセル由来を優先**、typography/regions は Vision 由来。
- 出力: `StyleSpec` JSON（スキーマ検証必須）。
- 注意: フォント特定は不確実 → 候補＋confidence を返し、確定はユーザー or フォールバックに委ねる。

### 4.2 compose/layout.ts — レイアウト合成
- 入力: `StyleSpec` + 入力データ(title/body/image)。
- 処理: role ベースで input を region にマッピング。`fit.ts` を呼び、
  - 本文が region に収まらなければ：フォント段階縮小 → それでも溢れれば自動でスライド分割。
  - 画像は region の `fit`(cover/contain) に従いトリミング比率を計算。
- 出力: `SlidePlan` JSON。
- これが「どんな画像・文章でも合わせる」中核。レイアウトは画像から得た rect に **流し込むだけ** なので入力に依存しない。

### 4.3 render/googleSlides.ts — Slides 生成
- 入力: `SlidePlan` + `StyleSpec`。
- 処理: Google Slides API の `presentations.create` → `presentations.batchUpdate` でテキストボックス/画像/図形を配置。座標は pt → EMU 換算。
- 出力: プレゼンテーション URL。
- 認証は `auth.ts`。個人利用は OAuth2、サーバ運用はサービスアカウント＋ドメイン委任を選べる構成（`docs/api-setup.md` 参照）。

---

## 5. データフロー（処理順）

1. `slidegen analyze samples/template-01.png` → `stylespec-01.json` 生成
2. （任意）`slidegen analyze ... --override palette.primary=#FF0000` で低confidence項目を補正
3. `slidegen compose --style stylespec-01.json --input content.json` → `slideplan.json`
4. `slidegen render --plan slideplan.json` → Google Slides URL 返却

`content.json` の入力例:
```json
{ "slides": [ { "title": "...", "body": "...", "image": "https://..." } ] }
```

---

## 6. Google Slides API メモ（実装時の要点）

- 座標系は **EMU**（1 pt = 12700 EMU）。StyleSpec は pt 保持し描画段で換算。
- 要素作成は `createShape`(TEXT_BOX) / `createImage` / `insertText` / `updateTextStyle` / `updateShapeProperties` を 1 回の `batchUpdate` にまとめる。
- フォント色・背景色は RGB(0–1 正規化) で渡す。`#RRGGBB` → {r,g,b} 変換ユーティリティを用意。
- カスタムフォント名は Slides 側に存在すれば適用、無ければデフォルト。`weightHint` は太字フラグへ写像。
- 画像は **公開到達可能な URL** が必要（API が取得しに行く）。ローカル画像は事前に Drive へアップロードして URL 化する補助関数を `render/` に置く。

---

## 7. GitHub 運用

- 初手: `git init` → 本書と schemas/ を最初のコミット。以降は機能単位でブランチ。
- ブランチ: `feat/analyze`, `feat/compose`, `feat/render` の順で段階マージ。
- **コミットしない**: `.env`、OAuth トークン(`token.json`)、サービスアカウント鍵(`*.json` 秘密鍵) → `.gitignore` に登録。鍵は誤コミット防止のため命名規約を決める。
- CI（GitHub Actions 任意）: push 時に `tsc` 型チェック + スキーマ検証 + `samples/` の回帰テスト。
- サンプル画像と期待 StyleSpec を `samples/` に固定し、分解ロジック変更時の差分を検知。

> 注: API キーや鍵ファイルの作成・登録は私（Claude）ではなくあなた自身が行ってください。本書はその前提で手順だけ示します（`docs/api-setup.md`）。

---

## 8. 技術スタック（推奨）

| 項目 | 選定 | 理由 |
|------|------|------|
| 言語 | TypeScript (Node 20+) | Google API クライアントが充実、型で中間表現を担保 |
| Slides | `googleapis` 公式パッケージ | batchUpdate を型付きで扱える |
| Vision分解 | Anthropic Claude (画像入力) | 画像→構造化JSONに強い |
| 色抽出 | `sharp` + 簡易k-means | palette をピクセルから正確に |
| 検証 | `ajv` (JSON Schema) | 段間契約をランタイム検証 |
| テスト | `vitest` | 軽量・TS親和 |

---

## 9. 段階的な実装ステップ（Claude Code 向け）

1. リポジトリ雛形 + `schemas/` + `types.ts`（中間表現を先に確定）
2. `analyze`：画像 → StyleSpec。`samples/` で目視確認。
3. `compose`：StyleSpec + ダミー入力 → SlidePlan。`fit.ts` の溢れ処理を単体テスト。
4. `render`：SlidePlan → Slides。まず固定 StyleSpec で 1 枚描画 → batchUpdate を拡張。
5. CLI 結線 + エラーハンドリング + README。
6. CI とサンプル回帰テスト。

各ステップ完了ごとにコミット。中間表現(JSON)を成果物として残すと、どの段で問題が出たか切り分けやすい。
