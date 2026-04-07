import cron from "node-cron";
import { runDailyScan, executeApprovedActions } from "./engine";
import { hasTodaySOD, sendSODNudge } from "./workflow";
import { isWorkingDay } from "./holidays";
import { runExtractionMonitor } from "./extraction-monitor";
import { getDutyState, getCurrentDuty, getWeekRange, getISOWeek, saveDutyState } from "./duty-rotation";
import { postBlockMessage, sendBlockDM } from "./integrations/slack";

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

  // 매주 월요일 09:03 KST — 데이터 추출 당번 공지 (#team-예약파트-실무 + 당번 DM)
  cron.schedule("3 9 * * 1", async () => {
    if (!isWorkingDay(new Date())) return; // 공휴일(월요일) 스킵
    console.log(`[Scheduler] Weekly duty announce at ${new Date().toISOString()}`);
    try {
      const state = getDutyState();
      const duty = getCurrentDuty(state);
      const week = getWeekRange();
      const isoWeek = getISOWeek(new Date());

      state.current_week = isoWeek;
      state.current_duty_index = duty.index;
      state.current_duty_name = duty.name;
      saveDutyState(state);

      const blocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:rotating_light: *이번 주 데이터 추출 당번 안내*\n\n:bust_in_silhouette: 당번: <@${duty.slack_id}>\n:calendar: 기간: ${week.start}(월) ~ ${week.end}(금)\n\n#help-정보보안 채널에 추출 요청이 오면 알려드릴게요!`,
          },
        },
        {
          type: "actions",
          block_id: "duty_actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: ":arrows_counterclockwise: 변경하기", emoji: true },
              style: "danger",
              action_id: "duty_change",
              value: JSON.stringify({ duty_index: duty.index, duty_name: duty.name, duty_slack_id: duty.slack_id, week: isoWeek }),
            },
            {
              type: "button",
              text: { type: "plain_text", text: ":white_check_mark: 확정하기", emoji: true },
              style: "primary",
              action_id: "duty_confirm",
              value: JSON.stringify({ duty_index: duty.index, duty_name: duty.name, duty_slack_id: duty.slack_id, week: isoWeek }),
            },
          ],
        },
      ];

      await postBlockMessage(state.announcement_channel, blocks, `이번 주 데이터 추출 당번: ${duty.name} (${week.start}~${week.end})`);
      await sendBlockDM(
        duty.slack_id,
        [{ type: "section", text: { type: "mrkdwn", text: `:wave: 이번 주 데이터 추출 당번입니다!\n기간: ${week.start}(월) ~ ${week.end}(금)\n#help-정보보안 채널에 요청이 오면 별도로 알려드리겠습니다.` } }],
        `이번 주 데이터 추출 당번입니다! (${week.start}~${week.end})`,
      );
      console.log(`[Scheduler] Duty announce sent — ${duty.name} (${isoWeek})`);
    } catch (error) {
      console.error("[Scheduler] Duty announce failed:", error);
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

  console.log("[Scheduler] Initialized — Auto scan: every 30min (Mon-Fri), SOD: 10:00 KST, EOD: manual only, ExtractionMonitor: every 15min 09-19 KST, DutyAnnounce: Mon 09:03 KST");
}
