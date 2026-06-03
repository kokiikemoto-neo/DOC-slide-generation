# SlideGen — テンプレート準拠スライド自動生成ツール（coming-soon-v1 固定版）

タイトル・画像・本文（7スロット）を入力すると、固定テンプレート **coming-soon-v1** に沿って
**Google Slides を直接1枚生成**するツールです。傾いたカード（frame1/frame2）には、
Slides では不可能な透視変換を**画像側に焼き込んで**から配置します。

3段構成（`DESIGN.md`）のうち、本実装は **compose 段** と **render 段** のみ。
画像→StyleSpec の自動分解（analyze 段）は行わず、実測済みの
`samples/stylespec-coming-soon-v1.json` を固定 StyleSpec として使います。

```
入力(7スロット content.json) ──▶ compose ──▶ SlidePlan(JSON) ──▶ render ──▶ Google Slides URL
                                  (layout/fit)                   (透視変換+batchUpdate)
```

## できること

- 固定 StyleSpec + 入力 → `SlidePlan`（ajv でスキーマ検証）
- テキスト（tagline/body1/body2）は rect に収まらなければ**フォント段階縮小**、
  限界超で `overflow=trimmed` 警告（このテンプレはスライド分割しない）
- 画像（logo/qr）は **contain** 配置
- 画像（frame1/frame2）は **OpenCV で透視変換**してフレームの傾きに焼き込み、Slides には回転0で配置
- ローカル画像は **Drive へ一時アップロード→公開URL化→生成後に削除**
- 認証は OAuth2（個人利用）。トークンは `token.json` に保存（コミットしない）

## 必要環境

- Node.js 20+ / npm
- Python 3 ＋ `opencv-python`, `numpy`（透視変換に使用）
- Google アカウント（Slides/Drive API を有効化したプロジェクト）

## セットアップ

```bash
npm install
python -m pip install opencv-python numpy      # 透視変換の依存

cp .env.example .env                            # 値は docs/api-setup.md の手順で取得し記入
```

Google 側の準備（プロジェクト作成・API 有効化・OAuth クライアント発行）は
**[docs/api-setup.md](docs/api-setup.md)** に手順だけまとめています（鍵の値は載せません）。

> 認証情報・鍵・トークンの発行と登録は利用者ご自身で行ってください。
> `.env` / `token.json` / `*-key.json` は `.gitignore` 済みでコミットされません。

## 使い方

### スライドを生成（render）

```bash
npm run slidegen -- render --input samples/content.example.json
# = npx tsx src/index.ts render --input samples/content.example.json
```

初回はターミナルに認証 URL が出ます（[docs/api-setup.md](docs/api-setup.md) の手順7）。
成功すると生成された Google Slides の URL が表示されます。

主なオプション:

| オプション | 説明 |
|------------|------|
| `--input <path>`   | 7スロット content.json（必須） |
| `--style <path>`   | 固定 StyleSpec（既定 `samples/stylespec-coming-soon-v1.json`） |
| `--title <text>`   | プレゼンのタイトル |
| `--keep-uploads`   | Drive の一時画像を削除せず残す（デバッグ用） |
| `--plan-out <path>`| 生成した SlidePlan も保存 |

### SlidePlan だけ作る（compose・認証不要）

```bash
npm run slidegen -- compose --input samples/content.example.json --out out/plan.json
```

### オフライン・プレビュー（認証不要・レイアウト確認）

Google Slides を作らずに、render と同じ配置ロジックで `out/preview.png` を合成します。
透視変換・contain・テキスト配置の見た目を素早く確認できます。

```bash
npm run make:samples        # サンプル用ダミー画像を生成（初回のみ）
npm run preview             # out/preview.png を生成
```

## 入力フォーマット（content.json）

```json
{
  "logo":    "samples/assets/logo.png",
  "tagline": "現場の暗黙知を、誰でも引き出せる形に。",
  "qr":      "samples/assets/qr.png",
  "frame1":  "samples/assets/shot1.png",
  "body1":   "・ベテランの判断基準を構造化\n・新人の立ち上がりを短縮",
  "frame2":  "samples/assets/shot2.png",
  "body2":   "・導入3ヶ月で問い合わせ対応時間が40%減"
}
```

- 画像スロット（logo/qr/frame1/frame2）は **公開URL** または **ローカルパス**。
  ローカルパスはコマンド実行ディレクトリ基準で解決します。
- テキストスロット（tagline/body1/body2）の改行は `\n`。

## ディレクトリ構成

```
src/
  index.ts                 CLI
  config.ts                ROOT / .env ローダ / 設定
  load.ts                  ajv ローダ・検証 (StyleSpec/Content/SlidePlan)
  types.ts                 中間表現の型
  compose/
    layout.ts              7スロット → SlidePlan
    fit.ts                 テキスト収まり判定（フォント段階縮小）
  render/
    auth.ts                OAuth2（loopback / token.json）
    drive.ts               画像解決＋Drive 公開アップロード
    perspective.ts         透視変換ラッパ（Python 子プロセス）
    requests.ts            batchUpdate リクエスト組み立て
    googleSlides.ts        render オーケストレータ
    util.ts                pt→EMU / hex→RGB / contain
scripts/
  perspective_warp.py      OpenCV 透視変換本体
  make-placeholder-bg.ts   暫定背景 assets/background.png 生成
  make-sample-assets.ts    サンプル用ダミー画像生成
  preview.ts               オフライン合成プレビュー
schemas/                   JSON Schema (stylespec/slideplan/content)
samples/                   固定StyleSpec・content例・ダミー画像
assets/background.png      固定下地（※暫定。下記 TODO 参照）
docs/api-setup.md          Google API セットアップ手順
```

## 技術選定メモ

- **透視変換に Python+OpenCV を採用**: `sharp`/libvips は4点透視変換（homography）を
  ネイティブ提供しないため。`cv2.getPerspectiveTransform` + `warpPerspective` で
  元画像の矩形4隅を quad の4隅へ正確・高速に写し、透明背景PNGに焼き込みます。
  TS 側 `src/render/perspective.ts` が子プロセスとして呼び出します。
- **テキスト収まりは近似**: レンダリングエンジンを持たないため、CJK=1em / ASCII=0.5em の
  幅見積りで行数→高さを推定します（安全側＝やや小さめに倒す）。
- **座標**: StyleSpec は 960×540pt で記述。新規プレゼンの実ページサイズ（既定 720×405pt）を
  生成時に読み取り、全座標を等比スケールしてから EMU（×12700）へ換算します。

## ⚠ 既知の TODO（要・手作業での精緻化）

このテンプレートは「傾き」が仕上がりの肝です。現状は暫定実装のため、本番品質には以下が必要です。

1. **正式な固定背景 `assets/background.png` を用意する**
   現在の背景は StyleSpec のパレットから**プログラム生成した暫定プレースホルダ**です
   （`npm run make:bg` で再生成）。本来は元テンプレ画像から
   「ロゴ【画像添付欄】」「【記入欄】」「Coming soon」「QR【画像添付欄】」等の
   プレースホルダ文字を消し、フレーム発光・グラデ帯・丸数字①②・区切り線を残した版を
   `assets/background.png` に置き換えてください。

2. **frame1 / frame2 の quad（四隅座標）を再計測して精緻化する**
   `samples/stylespec-coming-soon-v1.json` の `quad` は**近似値**です
   （現状 frame1 は軸並行のため傾きが出ません）。背景画像上でフレーム内側の白い四隅の
   実ピクセルを測り、960×540pt に換算して各 `quad` を更新してください。
   ここの精度が傾きの仕上がりを左右します。

## ライセンス / セキュリティ

鍵・トークン・サービスアカウント鍵はコミットしないでください（`.gitignore` 済み）。
詳細は `DESIGN.md §7` と `docs/api-setup.md` を参照。
