#!/bin/bash
# 맥: 더블클릭하면 터미널에서 NYX 뷰어 서버가 켜진다
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Node.js(22 이상)가 없습니다 — https://nodejs.org 에서 LTS 설치 후 다시 실행하세요"; read -r; exit 1; }
node start.mjs
