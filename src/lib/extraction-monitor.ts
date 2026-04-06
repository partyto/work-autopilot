// #help-정보보안 채널 모니터링 — @파트라슈 멘션 감지 → 요청자에게 추출 유형 DM
import { getDutyState, saveDutyState } from "./duty-rotation";
import {
  getChannelHistory,
  getThreadReplies,
  getPermalink,
  sendBlockDM,
} from "./integrations/slack";
import { slackApi } from "./integrations/slack";

const HELP_CHANNEL = "C07DAP4TL5T"; // #help-정보보안
const BOT_USER_ID = "U0AMXD1CKS8"; // @파트라슈
const BOT_MENTION = `<@${BOT_USER_ID}>`;

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
  const targetChannel = overrideChannel || HELP_CHANNEL;
  const isTest = !!overrideChannel;

  // 채널 히스토리 조회 (테스트 채널이면 최근 10개만)
  const messages = await getChannelHistory(
    targetChannel,
    isTest ? undefined : (state.last_checked_ts || undefined),
    isTest ? 10 : 100,
  );

  if (!messages.length) return;

  // 가장 최신 ts 기록
  const latestTs = messages[0].ts;
  let newProcessed = [...(state.processed_threads || [])];

  for (const msg of messages) {
    // @파트라슈 멘션이 포함된 메시지만 처리
    if (!msg.text?.includes(BOT_MENTION)) continue;

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

      // 1) 스레드에 확인 답글
      await slackApi("chat.postMessage", {
        channel: targetChannel,
        thread_ts: threadTs,
        text: `:dog: 확인했습니다! <@${msg.user}>님에게 DM으로 추출 유형 선택을 안내드리겠습니다.`,
        mrkdwn: true,
      });

      // 2) 요청자에게 추출 유형 선택 버튼 DM
      const metadata = JSON.stringify({
        ticket_key: ticketKey,
        shop_seq: shopSeq,
        thread_ts: threadTs,
        channel: targetChannel,
        permalink,
        requester_id: msg.user,
      });

      await sendBlockDM(msg.user, [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:bell: *새 데이터 추출 요청*\n\n:ticket: JIRA: <https://catchtable.atlassian.net/browse/${ticketKey}|${ticketKey}>\n:department_store: shop_seq: \`${shopSeq || "자동 추출 예정"}\`\n:link: <${permalink}|Slack 스레드 보기>`,
          },
        },
        {
          type: "actions",
          block_id: "extract_actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "1\uFE0F\u20E3 마케팅 수신용", emoji: true },
              style: "primary",
              action_id: "extract_marketing",
              value: metadata,
            },
            {
              type: "button",
              text: { type: "plain_text", text: "2\uFE0F\u20E3 공지성 수신용", emoji: true },
              action_id: "extract_notice",
              value: metadata,
            },
            {
              type: "button",
              text: { type: "plain_text", text: "3\uFE0F\u20E3 그 외", emoji: true },
              style: "danger",
              action_id: "extract_other",
              value: metadata,
            },
          ],
        },
      ], `${ticketKey} 추출 요청 — 유형을 선택해주세요`);

      newProcessed.push(threadTs);
      console.log(`[ExtractionMonitor] Processed thread ${threadTs} (${ticketKey}) → DM to ${msg.user}`);
    } catch (err) {
      console.error(`[ExtractionMonitor] Failed to process thread ${threadTs}:`, err);
    }
  }

  // state 업데이트
  state.last_checked_ts = latestTs;
  state.processed_threads = newProcessed.slice(-100);
  saveDutyState(state);
}
