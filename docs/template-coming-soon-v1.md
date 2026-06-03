# 固定テンプレート「coming-soon-v1」実装ガイド

汎用設計（DESIGN.md）の特殊ケースとして、このテンプレート1種類を固定運用する。
analyze 段（画像→StyleSpec の自動分解）は**スキップ**し、実測済みの
`samples/stylespec-coming-soon-v1.json` を固定 StyleSpec として直接使う。
compose 段と render 段だけ実装すればよい。

## このテンプレートの構造

16:9 / 960×540pt。差し替え可能なのは7スロットのみ、それ以外（背景・発光フレーム・
グラデ帯・丸数字①②・区切り線）は固定背景画像に焼き込む。

| slot | 種類 | 中身 |
|------|------|------|
| logo    | 画像 | 左上ロゴ（白カード内、contain） |
| tagline | テキスト | 中央グラデ帯の「活用背景ひとこと」 |
| qr      | 画像 | 右上QR（contain） |
| frame1  | 画像 | 左上の傾いたカード①（透視変換） |
| body1   | テキスト | ①本文 |
| body2   | テキスト | ②本文 |
| frame2  | 画像 | 右下の傾いたカード②（透視変換） |

## 事前準備（1回だけ・手作業＋スクリプト）

1. **固定背景 `assets/background.png` を作る**
   元テンプレート画像から、プレースホルダ文字（「ロゴ【画像添付欄】」「【記入欄】」
   「Coming soon」「QR【画像添付欄】」「活用背景ひとこと」）を消した版を用意する。
   フレームの発光・グラデ帯・丸数字①②・区切り線は**残す**。これが全スライド共通の下地。
   - 透視変換した画像をフレームの上に重ねるので、Coming soon フレーム自体は背景に残してよい
     （画像がはみ出さないよう quad をフレーム内側に合わせる）。

2. **frame1 / frame2 の quad（四隅座標）を精緻化する**
   StyleSpec の quad は近似値。`assets/background.png` 上でフレーム内側の白い四隅の
   実ピクセルを測り直し、960×540pt に換算して StyleSpec の `quad` を更新する。
   傾きが命のテンプレートなので、ここの精度が仕上がりを左右する。

## compose 段

固定 StyleSpec を読み、入力（7スロット分の値）を割り当てて SlidePlan を作る。
- テキスト（tagline/body1/body2）: rect に収まらなければフォント段階縮小。
  このテンプレートはスライド分割しない（レイアウト固定のため）。溢れたら縮小のみ、
  限界を超えたら overflow=trimmed として警告。
- 画像（logo/qr）: rect 内に contain。
- 画像（frame1/frame2）: 後述の透視変換を施した「傾き済み画像」を生成し、その出力パスを value に入れる。

## render 段：透視変換が肝

**Google Slides API は画像の透視変換（台形歪み）をサポートしない。** 単純な回転しかできない。
したがって frame1/frame2 は **Slides に入れる前に画像側を加工**する。

### 手順
1. ユーザー画像を `sharp`（または Python/Pillow + OpenCV）で quad に合わせて透視変換（perspective warp）。
   - OpenCV: `cv2.getPerspectiveTransform` で元画像の矩形4隅 → quad の4隅への変換行列を作り `cv2.warpPerspective`。
   - 出力は透明背景PNG。フレームの傾きにぴったり収まった画像になる。
2. 変換後PNGを Drive にアップロードして公開URL化（Slides API は到達可能URLを要求）。
3. Slides 上では、その画像を frame の bounding rect 位置に `createImage` で**回転なし**配置。
   （傾きは画像内に焼き込み済みなので Slides 側の rotation は 0）。

### その他の描画
- `assets/background.png` をページ全面（0,0,960,540）に `createImage` で最背面配置。
- logo/qr は rect に contain で配置。
- tagline/body1/body2 は `createShape(TEXT_BOX)` + `insertText` + `updateTextStyle`。
  色・サイズ・フォントは StyleSpec.typography から。色は #RRGGBB → {r,g,b}(0-1) 換算。
- 座標換算: pt → EMU は ×12700。

## 入力フォーマット（content.json）

```json
{
  "logo": "https://.../logo.png",
  "tagline": "現場の暗黙知を、誰でも引き出せる形に。",
  "qr": "https://.../qr.png",
  "frame1": "https://.../shot1.png",
  "body1": "・ベテランの判断基準を構造化\n・新人の立ち上がりを短縮",
  "frame2": "https://.../shot2.png",
  "body2": "・導入3ヶ月で問い合わせ対応時間が40%減"
}
```

ローカルパスも可。その場合 render 前に Drive へアップロードしてURL化する補助関数を通す。

## ファイル構成（このテンプレート分）

```
samples/stylespec-coming-soon-v1.json   # 固定StyleSpec（実測済み）
assets/background.png                    # 要作成: 文字を消した固定下地
src/render/perspective.ts                # 透視変換(sharp/opencv呼び出し)
src/compose/layout.ts                    # 7スロット割り当て（汎用と共用）
src/render/googleSlides.ts               # 背景+画像+テキスト配置（汎用と共用）
```

## 注意（セキュリティ）

Drive へのアップロードや OAuth トークンの発行は、あなた自身の Google アカウントで
行ってください（鍵・トークンはコミットしない、DESIGN.md §7 のとおり）。
私の側で認証情報を作成・登録することはしません。
