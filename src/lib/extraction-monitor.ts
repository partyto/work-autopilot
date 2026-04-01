// #help-정보보안 채널 모니터링 — 비즈-PM 멘션 감지 → 당번 알림
import { getDutyState, getCurrentDuty, saveDutyState } from "./duty-rotation";
import {
  getChannelHistory,
  getThreadReplies,
  getPermalink,
  postBlockMessage,
  sendBlockDM,
} from "./integrations/slack";
import { slackApi } from "./integrations/slack";

const HELP_CHANNEL = "C07DAP4TL5T"; // #help-정보보안
const BIZ_PM_MENTION = "<!subteam^S07CRFNDZD4>"; // 비즈-PM 그룹

function parseJiraTicket(text: string): string | null {
  const match = text.match(/SCR-\d+/i);
  return match ? match[0].toUpperCase() : null;
}

function parseShopSeq(text: string): string {
  // shop_seq 패턴: 숫자 (콤마 구분 가능)
  const match = text.match(/shop_seq[^\d]*([0-9,\s]+)/i);
  if (match) return match[1].replace(/\s/g, "").trim();
  // 그냥 숫자 목록
  const nums = text.match(/\b\d{4,6}\b/g);
  return nums ? nums.join(",") : "";
}

export async function runExtractionMonitor(overrideChannel?: string) {
  const state = getDutyState();
  const duty = getCurrentDuty(state);
  const targetChannel = overrideChannel || HELP_CHANNEL;
  const isTest = !!overrideChannel;

  // 채널 히스토리 조회 (last_checked_ts 이후, 테스트 채널이면 전체 조회)
  const messages = await getChannelHistory(
    targetChannel,
    isTest ? undefined : (state.last_checked_ts || undefined),
    100,
  );

  if (!messages.length) return;

  // 가장 최신 ts 기록
  const latestTs = messages[0].ts;
  let newProcessed = [...(state.processed_threads || [])];

  for (const msg of messages) {
    // 비즈-PM 멘션이 포함된 메시지만 처리
    if (!msg.text?.includes(BIZ_PM_MENTION)) continue;

    // thread_ts: 스레드 답글이면 thread_ts, 아니면 msg.ts
    const threadTs = msg.thread_ts || msg.ts;

    // 이미 처리한 스레드 스킵
    if (newProcessed.includes(threadTs)) continue;

    try {

      // 스레드 전체 읽기 (실패 시 메시지 원문으로 폴백)
      let fullText = msg.text || "";
      try {
        const thread = await getThreadReplies(targetChannel, threadTs);
        if (thread.length > 0) fullText = thread.map((m: any) => m.text || "").join("\n");
      } catch {
        // 스레드가 없는 단독 메시지면 msg.text 사용
      }

      // JIRA 티켓 파싱
      const ticketKey = parseJiraTicket(fullText) || "SCR-?";
      const shopSeq = parseShopSeq(fullText);

      const permalink = await getPermalink(targetChannel, threadTs);

      // 1) 스레드에 당번 멘션 답글
      await slackApi("chat.postMessage", {
        channel: targetChannel,
        thread_ts: threadTs,
        text: `<@${duty.slack_id}> 확인 부탁드립니다! :eyes:`,
        mrkdwn: true,
      });

      // 2) 당번 PM에게 추출 유형 선택 버튼 DM
      const metadata = JSON.stringify({
        ticket_key: ticketKey,
        shop_seq: shopSeq,
        thread_ts: threadTs,
        channel: targetChannel,
        permalink,
        requester_id: msg.user, // 원본 요청자 — 추출 완료 시 DM으로 비밀번호 안내
      });

      await sendBlockDM(duty.slack_id, [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:bell: *새 데이터 추출 요청*\n\n:ticket: JIRA: <https://catchtable.atlassian.net/browse/${ticketKey}|${ticketKey}>\n:department_store: shop_seq: \`${shopSeq || "확인 필요"}\`\n:link: <${permalink}|Slack 스레드 보기>`,
          },
        },
        {
          type: "actions",
          block_id: "extract_actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "1️⃣ 마케팅 수신용", emoji: true },
              style: "primary",
              action_id: "extract_marketing",
              value: metadata,
            },
            {
              type: "button",
              text: { type: "plain_text", text: "2️⃣ 공지성 수신용", emoji: true },
              action_id: "extract_notice",
              value: metadata,
            },
            {
              type: "button",
              text: { type: "plain_text", text: "3️⃣ 그 외", emoji: true },
              style: "danger",
              action_id: "extract_other",
              value: metadata,
            },
          ],
        },
      ], `${ticketKey} 추출 요청 — 유형을 선택해주세요`);

      newProcessed.push(threadTs);
      console.log(`[ExtractionMonitor] Processed thread ${threadTs} (${ticketKey})`);
    } catch (err) {
      console.error(`[ExtractionMonitor] Failed to process thread ${threadTs}:`, err);
    }
  }

  // state 업데이트
  state.last_checked_ts = latestTs;
  state.processed_threads = newProcessed.slice(-100); // 최대 100개 유지
  saveDutyState(state);
}
