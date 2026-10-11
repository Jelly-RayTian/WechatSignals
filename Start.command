#!/bin/zsh
set -e
cd "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v npm >/dev/null 2>&1; then
  source "$HOME/.nvm/nvm.sh" 2>/dev/null || true
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "请安装 Node.js 22+，然后重新打开。"
  exit 1
fi
if [[ ! -d node_modules ]]; then npm ci; fi
if [[ ! -x native/keychain-helper ]]; then npm run build:keychain; fi
npm start
