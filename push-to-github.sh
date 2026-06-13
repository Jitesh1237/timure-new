#!/bin/bash
set -e

echo "🚌 Timure Yatayat - Push to GitHub"
echo "=================================="

# Navigate to project directory
cd "$(dirname "$0")"

# Read token from token.txt
if [ ! -f "token.txt" ]; then
  echo "❌ Error: token.txt not found!"
  echo "   Create token.txt with your GitHub Personal Access Token."
  echo "   Token must have 'Contents: Read and Write' permission."
  exit 1
fi

TOKEN=$(cat token.txt | tr -d '[:space:]')

if [ -z "$TOKEN" ]; then
  echo "❌ Error: token.txt is empty!"
  exit 1
fi

echo "✅ Token loaded from token.txt"

# Stage all changes
echo ""
echo "📦 Staging files..."
git add -A

# Commit if there are changes
if ! git diff --cached --quiet; then
  echo "📝 Committing changes..."
  git commit -m "Update via push-to-github.sh"
else
  echo "ℹ️  No changes to commit"
fi

# Push to GitHub
echo ""
echo "🚀 Pushing to GitHub..."
if git push https://${TOKEN}@github.com/Jitesh1237/timure-new.git master --force; then
  echo ""
  echo "✅ Successfully pushed to GitHub!"
  echo ""
  echo "🌐 Next steps:"
  echo "   1. Deploy frontend on Vercel: https://vercel.com"
  echo "      - Import jitesh1237/timure-new"
  echo "      - Root Directory: client"
  echo "      - Env: VITE_API_URL = https://timure-yatayat-api.onrender.com"
  echo ""
  echo "   2. Deploy backend on Render: https://render.com"
  echo "      - New Web Service from jitesh1237/timure-new"
  echo "      - Root Directory: server"
  echo "      - Start: node index.js"
  echo "      - Env: JWT_SECRET=<random>, DATA_DIR=/data"
  echo "      - Add Disk: mount /data, 1GB"
else
  echo ""
  echo "❌ Push failed! Your token may not have write permission."
  echo ""
  echo "🔧 Fix: Go to https://github.com/settings/tokens?type=beta"
  echo "   Edit your token → Repository permissions → Contents → Read and Write"
  exit 1
fi
