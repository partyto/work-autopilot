import cron from "node-cron";
import { runDailyScan, executeApprovedActions } from "./engine";
import { runEndOfDay, runStartOfDay } from "./workflow";
import { isWorkingDay } from "./holidays";
import { runExtractionMonitor } from "./extraction-monitor";

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

  // 매일 10:00 KST — 하루 시작 리포트 (공휴일 제외)
  cron.schedule("0 10 * * 1-5", async () => {
    if (!isWorkingDay(new Date())) return; // 공휴일 스킵
    console.log(`[Scheduler] SOD started at ${new Date().toISOString()}`);
    try {
      await runStartOfDay();
      console.log(`[Scheduler] SOD completed`);
    } catch (error) {
      console.error("[Scheduler] SOD failed:", error);
    }
  }, {
    timezone: "Asia/Seoul",
  });

  // EOD(하루 마무리)는 대시보드 '마무리' 버튼으로만 수동 실행
  // → 자동 스케줄 제거

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

  console.log("[Scheduler] Initialized — Auto scan: every 30min (Mon-Fri), SOD: 10:00 KST, EOD: manual only, ExtractionMonitor: every 15min 09-19 KST");
}
