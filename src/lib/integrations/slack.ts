// Slack Web API 직접 연동 — Cowork MCP 의존성 제거
// 필요 환경변수: SLACK_BOT_TOKEN, SLACK_USER_ID

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN || "";
const SLACK_USER_ID = process.env.SLACK_USER_ID || "U042YQ0RUAY";

async function slackApi(method: string, body: Record<string, any> = {}) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }
  return data;
}

// DM 메시지 발송
export async function sendDM(text: string, userId = SLACK_USER_ID) {
  // DM 채널 열기
  const openRes = await slackApi("conversations.open", { users: userId });
  const channelId = openRes.channel.id;

  // 메시지 발송
  const msgRes = await slackApi("chat.postMessage", {
    channel: channelId,
    text,
    mrkdwn: true,
  });

  return { channelId, ts: msgRes.ts };
}

// 스레드에 답글 달기
export async function replyToThread(channelId: string, threadTs: string, text: string) {
  return slackApi("chat.postMessage", {
    channel: channelId,
    thread_ts: threadTs,
    text,
    mrkdwn: true,
  });
}

// 최근 멘션 검색
export async function searchMentions(query: string, count = 20) {
  // search.messages는 user token이 필요 (bot token으로는 제한적)
  const res = await fetch(
    `https://slack.com/api/search.messages?query=${encodeURIComponent(query)}&count=${count}&sort=timestamp&sort_dir=desc`,
    {
      headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
    }
  );
  const data = await res.json();
  if (!data.ok) {
    // search API가 bot token으로 안 되면 빈 배열 반환
    console.warn("Slack search failed (bot token may not support search):", data.error);
    return [];
  }
  return data.messages?.matches || [];
}

// 채널 메시지 히스토리 (스레드 확인용)
export async function getThreadReplies(channelId: string, threadTs: string) {
  const data = await slackApi("conversations.replies", {
    channel: channelId,
    ts: threadTs,
    limit: 100,
  });
  return data.messages || [];
}

// Slack 설정 유효성 체크
export function isSlackConfigured(): boolean {
  return !!SLACK_TOKEN;
}

export { SLACK_USER_ID };
