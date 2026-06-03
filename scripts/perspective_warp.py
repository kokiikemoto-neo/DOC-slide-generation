#!/usr/bin/env python3
"""frame1/frame2 用 透視変換ヘルパ (Google Slides は透視変換不可のため画像側で焼き込む)。

入力画像の矩形4隅を、StyleSpec の quad(四隅, pt) へ写す透視変換を行い、
ページ全面サイズ(960x540 * scale)の透明背景PNGとして書き出す。
出力は Slides 上で (0,0,pageW,pageH) に回転0で重ねるだけで quad にぴったり収まる。

依存: opencv-python, numpy
  pip install opencv-python numpy

使い方:
  python perspective_warp.py \
    --input shot1.png --output out/frame1.png \
    --page-w 960 --page-h 540 --scale 2 \
    --quad "48,129 354,129 354,323 48,323"   # tl tr br bl
"""
import argparse
import sys


def parse_quad(s: str):
    pts = []
    for token in s.replace(",", " ").split():
        pts.append(float(token))
    if len(pts) != 8:
        raise ValueError(f"quad は 8 数値 (tl tr br bl の x,y) が必要: 受領={len(pts)}個")
    return [(pts[0], pts[1]), (pts[2], pts[3]), (pts[4], pts[5]), (pts[6], pts[7])]


def main() -> int:
    ap = argparse.ArgumentParser(description="perspective warp into a quad on a full-page transparent canvas")
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--page-w", type=float, required=True, help="page width in pt")
    ap.add_argument("--page-h", type=float, required=True, help="page height in pt")
    ap.add_argument("--quad", required=True, help='"tlx,tly trx,try brx,bry blx,bly" in pt')
    ap.add_argument("--scale", type=float, default=2.0, help="output px per pt")
    args = ap.parse_args()

    try:
        import numpy as np
        import cv2
    except ImportError as e:
        sys.stderr.write(
            "ERROR: opencv-python / numpy が見つかりません。\n"
            "  pip install opencv-python numpy\n"
            f"  (詳細: {e})\n"
        )
        return 3

    img = cv2.imread(args.input, cv2.IMREAD_UNCHANGED)
    if img is None:
        sys.stderr.write(f"ERROR: 入力画像を読めません: {args.input}\n")
        return 4

    # BGRA に正規化（アルファ無し→付与、グレースケール→3ch経由でBGRA）
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGRA)
    elif img.shape[2] == 3:
        img = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
    elif img.shape[2] == 4:
        pass
    else:
        sys.stderr.write(f"ERROR: 想定外のチャンネル数: {img.shape}\n")
        return 5

    h, w = img.shape[:2]
    quad = parse_quad(args.quad)
    scale = args.scale

    # 元画像の4隅 (tl, tr, br, bl)
    src = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32)
    # 写像先 quad を px へ
    dst = np.array([[x * scale, y * scale] for (x, y) in quad], dtype=np.float32)

    out_w = int(round(args.page_w * scale))
    out_h = int(round(args.page_h * scale))

    matrix = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(
        img,
        matrix,
        (out_w, out_h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),  # 透明
    )

    # 出力ディレクトリは TS 側で用意済みの想定だが念のため
    import os
    os.makedirs(os.path.dirname(os.path.abspath(args.output)) or ".", exist_ok=True)

    ok = cv2.imwrite(args.output, warped)
    if not ok:
        sys.stderr.write(f"ERROR: 出力の書き込みに失敗: {args.output}\n")
        return 6

    sys.stdout.write(f"OK {args.output} ({out_w}x{out_h})\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
