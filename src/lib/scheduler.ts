import cron from "node-cron";
import { runDailyScan, executeApprovedActions } from "./engine";

let initialized = false;

export function initScheduler() {
  if (initialized) return;
  initialized = true;

  // 30분 간격 — Jira+Slack 스캔 + 액션 제안 (DM 없음, 새 액션 제안 시에만 알림)
  cron.schedule("*/30 * * * 1-5", async () => {
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

  // 매일 평일 17:30 KST — 일일 요약 리포트 + Slack DM 발송
  cron.schedule("30 17 * * 1-5", async () => {
    console.log(`[Scheduler] Daily report started at ${new Date().toISOString()}`);
    try {
      await runDailyScan(true); // 스캔 + 일일 리포트 DM 발송
      await executeApprovedActions();
      console.log(`[Scheduler] Daily report completed`);
    } catch (error) {
      console.error("[Scheduler] Daily report failed:", error);
    }
  }, {
    timezone: "Asia/Seoul",
  });

  console.log("[Scheduler] Initialized — Auto scan: every 30min (Mon-Fri), Daily report: 17:30 KST (Mon-Fri)");
}
