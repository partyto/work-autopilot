<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Project Context — Work Pavlotrasche

## 개요
Next.js 16 App Router + Tailwind CSS 4 + SQLite(Drizzle ORM) 기반 업무 자동화 대시보드.
Jira/Slack 연동, 칸반 보드, 자동 스캔, 워크플로(SOD/EOD) 관리.

## 배포
- NAS: `your4leaf@115.21.223.89` (SSH port 224), 경로 `/volume1/docker/work-autopilot`
- SSH key: `~/.ssh/nas_key`
- GitHub Actions → ghcr.io/partyto/work-autopilot:latest → Watchtower 자동 배포
- 배포 스크립트: `./deploy.sh "커밋 메시지"`
- NAS 수동 재시작: `ssh -p 224 -i ~/.ssh/nas_key your4leaf@115.21.223.89 "cd /volume1/docker/work-autopilot && /usr/local/bin/docker compose up -d"`

## 빌드 명령
```bash
export PATH="$PATH:/opt/homebrew/bin"
node_modules/.bin/next build
```

## 주요 파일
- `src/components/Dashboard.tsx` — 메인 대시보드 (칸반, SOD/EOD 버튼, 액션 뷰)
- `src/components/TaskCard.tsx` — 카드 UI (상태 드롭다운, 링크, 설명 접기)
- `src/components/SidebarNav.tsx` — LNB (로고 클릭으로 collapse)
- `src/components/SidebarLayout.tsx` — LNB collapse 상태 관리 클라이언트 래퍼
- `src/lib/scheduler.ts` — 크론 스케줄러 (앱 내부, start.js와 분리)
- `src/lib/workflow.ts` — SOD/EOD 워크플로 로직
- `src/lib/engine.ts` — Jira+Slack 스캔 엔진
- `src/app/api/daily/route.ts` — SOD/EOD API
- `src/app/api/tasks/reorder/route.ts` — 드래그 앤 드롭 순서 저장

## 스케줄러 현황 (scheduler.ts)
- 30분 간격: `runDailyScan(false)` — 스캔만, 리포트 없음
- 10:00 KST: SOD 완료 여부 체크 → 미완료 시 넛지 DM 발송
- EOD: 수동(마무리 버튼)만, 자동 없음

## 하루 경계
- KST 05:00 기준 — `toBusinessDateStr()` 사용 (05:00 이전은 전날로 취급)

## 카드 정렬
- `sortOrder` ASC → `createdAt` DESC (최신이 상단)
- 드래그 앤 드롭(@dnd-kit)으로 순서 변경 → `/api/tasks/reorder` PATCH

## linkType enum
`["jira", "slack_thread", "gcal", "url"]` — "url" 타입은 slackThreadUrl 컬럼 재사용

## 환경변수 주요 항목 (.env.local / NAS .env)
- `APP_URL=http://115.21.223.89:3100` — Slack DM 링크용
- `SLACK_BOT_TOKEN`, `SLACK_USER_TOKEN`
- `JIRA_API_TOKEN`, `JIRA_USER_EMAIL`

## 주의사항
- `start.js`에는 크론 없음 — 모든 스케줄은 `scheduler.ts`에서만
- `sendDM()`에 `unfurl_links: false` 적용 — IP 노출 방지
- SOD 버튼: 모달 + Slack 발송(runStartOfDay) + DB 기록 → 10시 넛지 자동 스킵
