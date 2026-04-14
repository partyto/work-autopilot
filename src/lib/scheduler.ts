import cron from "node-cron";
import { runDailyScan, executeApprovedActions } from "./engine";
import { hasTodaySOD, sendSODNudge } from "./workflow";
import { isWorkingDay } from "./holidays";

let initialized = false;

export function initScheduler() {
  if (initialized) return;
  initialized = true;

  // 30분 간격 — Jira+Slack 스캔 + 액션 제안 (DM 없음, 새 액션 제안 시에만 알림)
  cron.schedule("*/30 * * * 1-5", async () => {
    if (!isWorkingDay(new Date())) return;
    console.log(`[Scheduler] Auto scan started at ${new Date().toISOString()}`);
    try {
      await runDailyScan(false);
      await executeApprovedActions();
      console.log(`[Scheduler] Auto scan completed`);
    } catch (error) {
      console.error("[Scheduler] Auto scan failed:", error);
    }
  }, {
    timezone: "Asia/Seoul",
  });

  // 매일 10:00 KST — SOD 완료 여부 체크 후 분기
  cron.schedule("0 10 * * 1-5", async () => {
    if (!isWorkingDay(new Date())) return;
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

  console.log("[Scheduler] Initialized — Auto scan: every 30min (Mon-Fri), SOD nudge: 10:00 KST, EOD: manual only");
}
