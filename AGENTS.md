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
- 30분 간격 (Mon-Fri): `runDailyScan(false)` — 스캔만, 리포트 없음
- 10:00 KST (Mon-Fri): SOD 완료 여부 체크 → 미완료 시 넛지 DM 발송
- 15분 간격 (09-19 KST, Mon-Fri): `runExtractionMonitor()` — `#help-정보보안` 채널 스레드 감지
- 10분 간격 (09-19 KST, Mon-Fri): `runExtractionHealthCheck()` — 지연 추출 Job 1회 알림
- EOD: 수동(마무리 버튼)만, 자동 없음
- 모든 크론: `isWorkingDay()` 로 공휴일 스킵

## 데이터 추출 자동화 플로우

### 목적
`#help-정보보안` 채널에 올라오는 매장 연락처 추출 요청을 자동 감지 → 본문 파싱 → 승인자 DM → 버튼 클릭 1회로 Patrasche worker가 쿼리 실행까지 처리.

### 구성 파일
- `src/lib/extraction-monitor.ts` — Slack 채널 모니터 + 본문 파서 (`parseShopSeq`, `detectAllShopsIntent`, `parseJiraKey`)
- `src/lib/extraction-jobs.ts` — JSON 기반 Job Queue (`data/extraction-jobs.json`)
- `src/lib/extraction-health.ts` — Job 지연 헬스체크 (pending 30분 / processing 60분 임계)
- `src/lib/duty-rotation.ts` — SQL 템플릿 + `generateSQL(type, shopSeq, {allShops})`
- `src/app/api/slack/interact/route.ts` — 승인자 버튼 핸들러

### 본문 파싱 규칙 (parseShopSeq)
숫자를 shop_seq로 오인하지 않도록 우선순위를 둠:
1. 명시적 키워드 + 숫자: `shop_seq`, `매장번호`, `매장ID`, `shopSeq`
2. URL 쿼리 파라미터: `?shop_seq=12345`
3. URL 경로: `/shop/12345`, `/shops/12345`
4. fallback: `대상 매장`, `매장 리스트`, `매장 목록` 힌트가 있을 때만 4~8자리 숫자 추출
5. `detectAllShopsIntent`가 true면 **파싱 스킵** → `all_shops` 모드

### 전체 매장 모드 (`all_shops`)
본문에 `전체 매장`, `모든 매장`, `전 매장`, `all shops` 키워드 → `query_all_shops: true`.
`generateSQL(type, "", {allShops: true})` 호출 시 SQL 템플릿에서 `WHERE tsm.shop_seq IN ({shop_seq_list})` 조건 줄만 제거됨 (끝 `AND` 자동 trim).

### 승인자 DM 버튼
- **정상 파싱**: `추출 시작 (마케팅)` / `추출 시작 (공지성)`
- **shop_seq 파싱 실패**: `전체 매장 추출 진행` / `취소` (inline 버튼, `promptAllShopsFallback()`)
- **취소**: 메시지를 "취소됨"으로 교체, Job 미생성

### Job 상태 머신
`pending` → `processing` → `completed` / `failed`
- `pending`: 큐에 등록, Patrasche worker 미점유
- `processing`: worker가 집어서 Playwright로 쿼리 실행 중
- `completed`: 결과 파일 업로드 + JIRA 완료 코멘트
- `failed`: 에러 기록 (`error` 필드), 수동 확인 필요

### 헬스체크 동작 (extraction-health.ts)
매 10분마다 `data/extraction-jobs.json`을 스캔:
- `pending` 30분 초과 → worker 미점유, 배포 여부 확인 필요
- `processing` 60분 초과 → hang, Playwright 실행 상태 확인 필요
- `notified_stale: true`가 설정된 Job은 스킵 → **중복 알림 방지**
- 알림 수신자: `requester_id` + `notify_ids` (스레드 원작성자 + @비즈-예약PM 멘션한 사람들)

### 권한 주의사항
`data/extraction-jobs.json`은 컨테이너 UID 1001이 atomic write 하므로 파일 권한 666 필요.
NAS에서 `your4leaf`로 파일을 교체한 경우 `chmod 666` 후 `ls -la`로 확인.

### 장애 복구 (좀비 Job 정리)
processing 상태로 오래 방치된 Job은 다음 방법 중 하나로 처리:
1. 백업 후 6시간 초과 `processing` → `failed` 전환 (일반)
2. `notified_stale: true` 설정으로 알림만 억제 (원인 파악 전)
3. 원본 백업: `extraction-jobs.json.bak.YYYYMMDD-HHMMSS`

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
