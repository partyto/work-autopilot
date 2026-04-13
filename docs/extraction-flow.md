# 데이터 추출 자동화 플로우

`#help-정보보안` 채널의 매장 연락처 추출 요청을 자동 감지 → 파싱 → 승인 → Patrasche worker가 쿼리 실행까지 처리하는 엔드-투-엔드 워크플로우.

> 2026-04-13 기준. 스케줄러는 KST, 평일(Mon-Fri) + 공휴일 스킵.

---

## 전체 흐름

```
[Slack #help-정보보안]
  │ 스레드에 @비즈-예약PM 멘션 + JIRA 키 + 매장 정보
  │
  ▼
[ExtractionMonitor] (15분 간격, 09-19 KST)
  │ - JIRA 키 (SCR-xxxx) 추출
  │ - 전체 매장 키워드 감지 → all_shops=true
  │ - 아니면 shop_seq 파싱 (다단계 우선순위)
  │ - 승인자에게 DM + 버튼
  │
  ▼
[승인자 버튼 클릭] → src/app/api/slack/interact/route.ts
  │ ┌─ "추출 시작 (마케팅)" / "추출 시작 (공지성)"  → 정상 Job
  │ ├─ "전체 매장 추출 진행"  → all_shops=true Job
  │ └─ "취소"  → Job 미생성, 메시지 "취소됨"
  │
  ▼
[Job Queue] data/extraction-jobs.json (pending)
  │
  ▼
[Patrasche Worker] (worker/extractor.ts)
  │ - pending Job 점유 → processing
  │ - Playwright로 QueryPie 로그인 + SQL 실행
  │ - 결과 Excel 업로드 + JIRA 완료 코멘트
  │ - completed / failed 기록
  │
  ▼
[Health Check] (10분 간격, 09-19 KST)
  │ - pending 30분 초과 → worker 미점유
  │ - processing 60분 초과 → hang
  │ - notify_ids에게 1회 DM, notified_stale=true 기록
```

---

## 본문 파싱 규칙

### JIRA 키
`/SCR-[0-9]+/` 정규식. 첫 번째 매치 사용.

### 전체 매장 감지 (`detectAllShopsIntent`)
다음 중 하나라도 포함되면 `all_shops=true`로 전환하고 shop_seq 파싱을 스킵:
- `전체 매장` / `전체매장`
- `모든 매장` / `모든매장`
- `전 매장` / `전매장`
- `all shops` / `all shop` (대소문자 무관)

멘션(`<@...>`)과 URL은 사전에 제거 후 판정.

### shop_seq 파싱 (`parseShopSeq`)
일반 숫자를 오인 식별하지 않도록 4단계 우선순위:

1. **명시적 키워드 + 숫자** (가장 안전)
   - `shop_seq: 12345,67890`
   - `매장번호 12345`
   - `매장ID = 12345`
   - `shopSeq : 12345`
2. **URL 쿼리 파라미터**
   - `https://.../?shop_seq=12345`
   - `?shopSeq=12345`
3. **URL 경로**
   - `/shop/12345`
   - `/shops/12345`
4. **Fallback** (명시적 힌트 있을 때만)
   - `대상 매장`, `매장 리스트`, `매장 목록`, `대상 shop` 중 하나가 있으면 4~8자리 숫자 추출
   - 없으면 빈 문자열 반환

모든 단계에서 Set으로 중복 제거, 쉼표 구분 문자열로 반환.

### 파싱 실패 처리
- shop_seq 빈 문자열 + `all_shops=false` → 승인자 DM에 `전체 매장 추출 진행` / `취소` 버튼 표시 (`promptAllShopsFallback`)

---

## SQL 생성 (`generateSQL`)

```ts
generateSQL(type: "marketing" | "notice", shopSeqList: string, opts?: { allShops?: boolean }): string
```

### 일반 모드
`sql_templates.{marketing,notice}`의 `{shop_seq_list}`를 치환.

### 전체 매장 모드 (`allShops: true`)
`WHERE tsm.shop_seq IN ({shop_seq_list})` 조건 줄만 제거.
마지막 조건이 `AND`로 끝나지 않도록 트림:
- `\s+AND\s*\n\s*;` → `\n;`
- `\s+AND\s*$` (라인 끝) → 제거

---

## Job 상태 머신

| 상태 | 의미 | 전이 |
|---|---|---|
| `pending` | Queue 등록, worker 미점유 | worker가 집어가면 → `processing` |
| `processing` | worker가 Playwright 실행 중 | 성공 → `completed`, 실패 → `failed` |
| `completed` | 결과 파일 업로드 + JIRA 완료 코멘트 | 종결 |
| `failed` | 에러 (`error` 필드에 기록) | 수동 재처리 필요 |

### 파일 구조 (`data/extraction-jobs.json`)
```json
[
  {
    "id": "uuid-v4",
    "status": "pending",
    "ticket_key": "SCR-1234",
    "shop_seq": "12345,67890",     // all_shops=true면 ""
    "all_shops": false,
    "extract_type": "marketing",
    "thread_ts": "1712345678.123456",
    "channel": "C01234567",
    "requester_id": "U01234567",   // 승인자
    "pm_user_id": "U01234567",
    "thread_starter_id": "U09876543",
    "notify_ids": ["U09876543", ...], // 지연 알림 수신자
    "sql": "SELECT ... WHERE ...",
    "created_at": "2026-04-13T10:00:00.000Z",
    "error": "...",                // 실패 시
    "notified_stale": false        // 헬스체크 1회 알림 여부
  }
]
```

---

## 헬스체크 (`extraction-health.ts`)

### 임계치
- `pending`: **30분** — worker가 Job을 집어가지 않음 (배포 문제 의심)
- `processing`: **60분** — Playwright hang 또는 쿼리 지연

### DM 내용
```
:warning: 추출 지연 알림
티켓: *SCR-xxxx* — 마케팅 / 공지성
상태: `processing` (처리 중 지연)
경과: NN분
job: `abc12345`

파트라슈 worker 또는 쿼리 실행 상태를 확인해주세요.
```

### 중복 알림 방지
`notified_stale: true`가 설정된 Job은 다음 헬스체크 실행에서 스킵. 재알림 받으려면 수동으로 플래그 false로 되돌려야 함.

### 수신자
`requester_id` + `notify_ids` 의 Set (중복 제거)

---

## 운영 노트

### 배포
```bash
./deploy.sh "메시지"
# → git push → GHCR 빌드 (약 2분) → Watchtower pull → 컨테이너 재기동
```

### 파일 권한 (중요)
`data/extraction-jobs.json`은 컨테이너 UID 1001이 atomic rename으로 업데이트함.
- NAS에서 your4leaf로 파일을 교체한 경우 **반드시** `chmod 666` 실행
- 디렉터리가 777이라 rename은 되지만 파일 자체 권한이 644면 컨테이너 쓰기 실패

### 좀비 Job 정리 (6시간+ processing)
```bash
ssh nas "cat /volume1/docker/work-autopilot/data/extraction-jobs.json" > /tmp/jobs.json
# 백업
cp /tmp/jobs.json /tmp/jobs.json.bak
# 6시간 초과 processing/pending → failed 전환
/usr/bin/jq '
  def age_sec: (.created_at | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) as $t | (now - $t);
  map(
    if (.status == "processing" or .status == "pending") and (age_sec > 6*3600)
    then . + {
      status: "failed",
      error: ((.error // "") + " [auto-cleanup: stale >6h]"),
      notified_stale: true
    }
    else .
    end
  )
' /tmp/jobs.json > /tmp/jobs.cleaned.json
# 업로드 (scp 대신 cat 파이프 — Synology SSH subsystem 미활성)
cat /tmp/jobs.cleaned.json | ssh nas "cat > /tmp/jobs.cleaned.json"
# NAS에서 백업 + 교체 + 권한 조정
ssh nas "
TARGET=/volume1/docker/work-autopilot/data/extraction-jobs.json
cp \$TARGET \$TARGET.bak.\$(date +%Y%m%d-%H%M%S)
rm \$TARGET
mv /tmp/jobs.cleaned.json \$TARGET
chmod 666 \$TARGET
"
```

### NAS SSH 차단
연속 SSH 호출이 많으면 Synology Auto-Block이 IP를 차단함.
해제: DSM (`https://115.21.223.89:5001`) → 제어판 → 보안 → 자동 차단 → IP 제거.

---

## 관련 파일

| 파일 | 역할 |
|---|---|
| `src/lib/extraction-monitor.ts` | 채널 모니터 + 본문 파서 + 승인자 DM |
| `src/lib/extraction-jobs.ts` | Job Queue (JSON) + 상태 전이 |
| `src/lib/extraction-health.ts` | 지연 Job 헬스체크 + 알림 |
| `src/lib/duty-rotation.ts` | SQL 템플릿 + `generateSQL` |
| `src/lib/scheduler.ts` | 크론 등록 |
| `src/app/api/slack/interact/route.ts` | 버튼 핸들러 |
| `worker/extractor.ts` | Patrasche Playwright worker |
| `data/extraction-jobs.json` | Job 영속 저장소 |
