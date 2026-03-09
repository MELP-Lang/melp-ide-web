#!/bin/bash
# MELP IDE — Yerel sunucu başlat ve tarayıcıda aç
# Kullanım: melp-ide.sh [dosya.mlp]

PORT=8080
DIST_DIR="/home/pardus/projeler/MLP/editors/web/dist"
FILE_ARG="$1"

# Sunucu çalışmıyorsa başlat
if ! lsof -i:"$PORT" > /dev/null 2>&1; then
    cd "$DIST_DIR" || exit 1
    python3 -m http.server "$PORT" --bind 127.0.0.1 > /tmp/melp-ide-server.log 2>&1 &
    sleep 0.8
fi

# Açılacak dosya varsa dist/ altına kopyala, URL'ye ekle
URL="http://localhost:$PORT"
if [ -n "$FILE_ARG" ] && [ -f "$FILE_ARG" ]; then
    FILENAME=$(basename "$FILE_ARG")
    cp "$FILE_ARG" "$DIST_DIR/tmp_open.mlp"
    # URL-encode filename (boşluk vb. için)
    ENC_NAME=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$FILENAME")
    URL="${URL}/?open=${ENC_NAME}"
fi

xdg-open "$URL" &
echo "MELP IDE: $URL"
