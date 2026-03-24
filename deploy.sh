#!/bin/bash
# Work Autopilot 원커맨드 배포 스크립트
# 사용법: ./deploy.sh "커밋 메시지"

set -e

WORKSPACE="/Users/catchtable/Library/CloudStorage/SynologyDrive-your4leaf/claude/업무 자동화/work-autopilot"
GIT_REPO="/Users/catchtable/work-autopilot"
NAS_USER="your4leaf"
NAS_HOST="115.21.223.89"
NAS_PORT="224"
NAS_PATH="/volume1/docker/work-autopilot"
COMMIT_MSG="${1:-"chore: auto deploy $(date '+%Y-%m-%d %H:%M')"}"

echo "🔄 [1/4] Workspace → Git 동기화 중..."
rsync -av --exclude='.git' --exclude='node_modules' --exclude='.next' --exclude='data' \
  "$WORKSPACE/src/" "$GIT_REPO/src/"

echo ""
echo "📝 [2/4] Git 커밋 & Push 중..."
cd "$GIT_REPO"
git add src/
git diff --cached --stat

if git diff --cached --quiet; then
  echo "⚠️  변경사항 없음. Git Push 스킵."
else
  git commit -m "$COMMIT_MSG

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
  git push
  echo "✅ Push 완료. GitHub Actions 빌드 대기 중... (약 2분)"
  sleep 120
fi

echo ""
echo "🐳 [3/4] NAS Docker 이미지 Pull 중..."
ssh -p "$NAS_PORT" "$NAS_USER@$NAS_HOST" \
  "cd $NAS_PATH && /usr/local/bin/docker compose pull"

echo ""
echo "🚀 [4/4] NAS 컨테이너 재시작 중..."
ssh -p "$NAS_PORT" "$NAS_USER@$NAS_HOST" \
  "cd $NAS_PATH && /usr/local/bin/docker compose up -d"

echo ""
echo "✅ 배포 완료!"
