import cron from "node-cron";
import { runDailyScan, executeApprovedActions } from "./engine";

let initialized = false;

export function initScheduler() {
  if (initialized) return;
  initialized = true;

  // 매일 평일 17:30 KST — 일일 스캔 + 리포트 발송
  cron.schedule("30 17 * * 1-5", async () => {
    console.log(`[Scheduler] Daily scan started at ${new Date().toISOString()}`);
    try {
      await runDailyScan();
      await executeApprovedActions(); // 스캔 직후 승인된 액션 즉시 실행
      console.log(`[Scheduler] Daily scan completed`);
    } catch (error) {
      console.error("[Scheduler] Daily scan failed:", error);
    }
  }, {
    timezone: "Asia/Seoul",
  });

  // 평일 2시간 간격 — 승인된 액션 실행
  cron.schedule("0 10,12,14,16,18 * * 1-5", async () => {
    console.log(`[Scheduler] Action executor started at ${new Date().toISOString()}`);
    try {
      const { executeApprovedActions } = await import("./engine");
      await executeApprovedActions();
      console.log(`[Scheduler] Action executor completed`);
    } catch (error) {
      console.error("[Scheduler] Action executor failed:", error);
    }
  }, {
    timezone: "Asia/Seoul",
  });

  console.log("[Scheduler] Initialized — Daily scan: 17:30 KST (Mon-Fri), Executor: 10/12/14/16/18h KST (Mon-Fri)");
}
