# SlideGen render API (Phase 2) — Node + Python(OpenCV) + sharp。
# Slides/Drive 認証は実行時に token.json / 環境変数で注入する（鍵はイメージに焼き込まない）。
FROM node:20-slim

# 透視変換に使う Python + OpenCV(ヘッドレス) と、sharp が要求する周辺ライブラリ。
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip \
    && python3 -m pip install --no-cache-dir --break-system-packages \
      opencv-python-headless numpy \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依存だけ先に入れてレイヤキャッシュを効かせる
COPY package*.json ./
RUN npm ci

# アプリ本体（src/scripts/schemas/samples/assets など）
COPY . .

# Python 実行ファイル名 / 既定ポート（Cloud Run は PORT を注入）
ENV PYTHON_BIN=python3
ENV PORT=8080
EXPOSE 8080

# tsx でそのまま起動（ROOT 相対のアセット解決を素直に保つため dist は使わない）
CMD ["npx", "tsx", "src/server.ts"]
