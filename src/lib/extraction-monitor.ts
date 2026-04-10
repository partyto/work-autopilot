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
const BIZPM_GROUP_MENTION = "<!subteam^S07CRFNDZD4>"; // @비즈-예약PM

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

  // 채널 히스토리 조회 — oldest 필터 없이 최근 메시지 스캔
  // 기존 oldest 필터 방식은 부모 메시지가 이미 지나간 후
  // 스레드 답글에 @비즈-예약PM 멘션이 달리면 탐지 못하는 문제가 있음
  // processed_threads로 중복 처리 방지
  const messages = await getChannelHistory(
    targetChannel,
    undefined,
    isTest ? 10 : 50,
  );

  if (!messages.length) return;

  // 가장 최신 ts 기록
  const latestTs = messages[0].ts;
  let newProcessed = [...(state.processed_threads || [])];

  // 채널 메시지 + 스레드 답글까지 포함한 후보 목록 구성
  // conversations.history는 최상위 메시지만 반환하므로
  // reply_count > 0인 메시지는 스레드 답글도 확인
  type Candidate = { msg: any; threadTs: string; threadStarterId: string };
  const candidates: Candidate[] = [];

  for (const msg of messages) {
    const threadTs = msg.thread_ts || msg.ts;

    // 이미 처리한 스레드는 바로 스킵 (불필요한 API 호출 방지)
    if (newProcessed.includes(threadTs)) continue;

    // 최상위 메시지 자체에 멘션이 있으면 바로 후보 추가
    if (msg.text?.includes(BIZPM_GROUP_MENTION)) {
      candidates.push({ msg, threadTs, threadStarterId: msg.user });
      continue;
    }

    // 스레드에 새 답글이 있는 경우만 확인 (latest_reply > last_checked_ts)
    if (msg.reply_count > 0) {
      const hasNewReplies = !state.last_checked_ts ||
        (msg.latest_reply && msg.latest_reply > state.last_checked_ts);
      if (!hasNewReplies) continue;

      try {
        const replies = await getThreadReplies(targetChannel, threadTs);
        for (const reply of replies) {
          if (reply.text?.includes(BIZPM_GROUP_MENTION)) {
            // 스레드 원작성자 = 첫 번째 봇 제외 사람 (replies[0]은 봇 메시지일 수 있음)
            const firstHuman = replies.find((m: any) => m.user && !m.bot_id);
            const threadStarterId = firstHuman?.user || msg.user;
            candidates.push({ msg: reply, threadTs, threadStarterId });
            break; // 스레드당 1번만 처리
          }
        }
      } catch {
        // 스레드 조회 실패 시 스킵
      }
    }
  }

  for (const { msg, threadTs, threadStarterId: initialThreadStarter } of candidates) {
    // 이미 처리한 스레드 스킵
    if (newProcessed.includes(threadTs)) continue;

    try {
      // 스레드 전체 텍스트 합치기 (JIRA 티켓/shop_seq 파싱용)
      let fullText = msg.text || "";
      let threadStarterId = initialThreadStarter;
      const mentionerIds: string[] = [msg.user]; // @비즈-예약PM 멘션한 사람들
      try {
        const thread = await getThreadReplies(targetChannel, threadTs);
        if (thread.length > 0) {
          fullText = thread.map((m: any) => m.text || "").join("\n");
          // 원작성자 = 첫 봇 제외 사람
          const firstHuman = thread.find((m: any) => m.user && !m.bot_id);
          threadStarterId = firstHuman?.user || initialThreadStarter;
          // @비즈-예약PM 멘션한 모든 사람 수집
          for (const m of thread) {
            if (m.user && m.text?.includes(BIZPM_GROUP_MENTION) && !mentionerIds.includes(m.user)) {
              mentionerIds.push(m.user);
            }
          }
        }
      } catch {
        // 폴백: msg.text 사용
      }

      // DM 수신 대상: 원작성자 + 멘션한 사람들 (중복 제거)
      const notifyIds = [...new Set([threadStarterId, ...mentionerIds].filter(Boolean))];

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
        thread_starter_id: threadStarterId,
        notify_ids: notifyIds,
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
