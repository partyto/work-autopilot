import cron from "node-cron";
import { runDailyScan, executeApprovedActions } from "./engine";
import { hasTodaySOD, sendSODNudge } from "./workflow";
import { isWorkingDay } from "./holidays";
import { runExtractionMonitor } from "./extraction-monitor";
import { runExtractionHealthCheck } from "./extraction-health";

let initialized = false;

export function initScheduler() {
  if (initialized) return;
  initialized = true;

  // 30분 간격 — Jira+Slack 스캔 + 액션 제안 (DM 없음, 새 액션 제안 시에만 알림)
  cron.schedule("*/30 * * * 1-5", async () => {
    if (!isWorkingDay(new Date())) return; // 공휴일 스킵
    console.log(`[Scheduler] Auto scan started at ${new Date().toISOString()}`);
    try {
      await runDailyScan(false); // 스캔만, 일일 리포트 DM 없음
      await executeApprovedActions();
      console.log(`[Scheduler] Auto scan completed`);
    } catch (error) {
      console.error("[Scheduler] Auto scan failed:", error);
    }
  }, {
    timezone: "Asia/Seoul",
  });

  // 매일 10:00 KST — SOD 완료 여부 체크 후 분기
  // - 이미 대시보드에서 하루 시작을 했다면 → 스킵
  // - 아직 안 했다면 → "하루를 시작해 볼까요?" 넛지 메시지 발송
  cron.schedule("0 10 * * 1-5", async () => {
    if (!isWorkingDay(new Date())) return; // 공휴일 스킵
    console.log(`[Scheduler] SOD check at ${new Date().toISOString()}`);
    try {
      const alreadyStarted = await hasTodaySOD();
      if (alreadyStarted) {
        console.log(`[Scheduler] SOD already done today — skipping nudge`);
        return;
      }
      await sendSODNudge();
      console.log(`[Scheduler] SOD nudge sent`);
    } catch (error) {
      console.error("[Scheduler] SOD check/nudge failed:", error);
    }
  }, {
    timezone: "Asia/Seoul",
  });

  // 15분 간격 — #help-정보보안 모니터링 (평일 업무시간 09:00~19:00)
  cron.schedule("*/15 9-19 * * 1-5", async () => {
    if (!isWorkingDay(new Date())) return;
    try {
      await runExtractionMonitor();
    } catch (error) {
      console.error("[Scheduler] ExtractionMonitor failed:", error);
    }
  }, {
    timezone: "Asia/Seoul",
  });

  // 10분 간격 — 추출 Job 헬스체크 (평일 업무시간 09-19 KST)
  // pending 30분 / processing 60분 초과 시 승인자에게 DM 알림 (중복 알림은 notified_stale 플래그로 차단)
  cron.schedule("*/10 9-19 * * 1-5", async () => {
    if (!isWorkingDay(new Date())) return;
    try {
      await runExtractionHealthCheck();
    } catch (error) {
      console.error("[Scheduler] ExtractionHealthCheck failed:", error);
    }
  }, {
    timezone: "Asia/Seoul",
  });

  console.log("[Scheduler] Initialized — Auto scan: every 30min (Mon-Fri), SOD nudge: 10:00 KST, EOD: manual only, ExtractionMonitor: every 15min 09-19 KST, ExtractionHealth: every 10min 09-19 KST");
}
