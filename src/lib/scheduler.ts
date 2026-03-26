import cron from "node-cron";
import { runDailyScan, executeApprovedActions } from "./engine";
import { runEndOfDay, runStartOfDay } from "./workflow";
import { isWorkingDay } from "./holidays";

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

  // 매일 19:00 KST — 하루 마무리 리포트 (기존 17:30 대체, 공휴일 제외)
  // Jira/Slack/GCal 스캔 + TO-DO 이관 요약 통합
  cron.schedule("0 19 * * 1-5", async () => {
    if (!isWorkingDay(new Date())) return; // 공휴일 스킵
    console.log(`[Scheduler] EOD started at ${new Date().toISOString()}`);
    try {
      await runEndOfDay();
      await executeApprovedActions();
      console.log(`[Scheduler] EOD completed`);
    } catch (error) {
      console.error("[Scheduler] EOD failed:", error);
    }
  }, {
    timezone: "Asia/Seoul",
  });

  console.log("[Scheduler] Initialized — Auto scan: every 30min (Mon-Fri), SOD: 10:00 KST, EOD: 19:00 KST");
}
