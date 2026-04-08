// Slack Web API 직접 연동 — Cowork MCP 의존성 제거
// 필요 환경변수: SLACK_BOT_TOKEN, SLACK_USER_TOKEN, SLACK_USER_ID
// - SLACK_BOT_TOKEN: DM 발송, 스레드 답글 등 (xoxb-)
// - SLACK_USER_TOKEN: 검색 API용 (xoxp-) — search:read scope 필요

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN || "";
const SLACK_USER_TOKEN = process.env.SLACK_USER_TOKEN || "";
const SLACK_USER_ID = process.env.SLACK_USER_ID || "U042YQ0RUAY";

// Slack API 레이트 리밋 (Tier 3: ~50 req/min → 최소 1200ms 간격)
let lastCallTime = 0;
const MIN_INTERVAL_MS = 1200;

async function throttle() {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallTime);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallTime = Date.now();
}

async function slackApi(method: string, body: Record<string, any> = {}) {
  await throttle();
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
    unfurl_links: false,
    unfurl_media: false,
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

// 메시지에 이모지 반응 추가 (User Token 우선 — reactions:write 스코프 필요)
export async function addReaction(channelId: string, messageTs: string, emoji: string) {
  const token = SLACK_USER_TOKEN || SLACK_TOKEN;
  if (!token) throw new Error("Slack token not configured");

  await throttle();
  const res = await fetch("https://slack.com/api/reactions.add", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel: channelId, timestamp: messageTs, name: emoji }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
  return data;
}

// 최근 멘션 검색 (User Token 필요 — search:read scope)
export async function searchMentions(query: string, count = 20) {
  const token = SLACK_USER_TOKEN || SLACK_TOKEN;
  if (!token) {
    console.warn("Slack search skipped: no token available");
    return [];
  }

  const res = await fetch(
    `https://slack.com/api/search.messages?query=${encodeURIComponent(query)}&count=${count}&sort=timestamp&sort_dir=desc`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  const data = await res.json();
  if (!data.ok) {
    console.warn("Slack search failed:", data.error, SLACK_USER_TOKEN ? "(user token)" : "(bot token — user token 필요)");
    return [];
  }
  return data.messages?.matches || [];
}

// 채널 메시지 히스토리 (스레드 확인용)
export async function getThreadReplies(channelId: string, threadTs: string) {
  // conversations.replies는 JSON body를 지원하지 않으므로 GET query string으로 호출
  await throttle();
  const params = new URLSearchParams({ channel: channelId, ts: threadTs, limit: "100" });
  const res = await fetch(`https://slack.com/api/conversations.replies?${params}`, {
    headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
  return (data.messages || []) as any[];
}

// Block Kit 메시지 전송
export async function postBlockMessage(
  channel: string,
  blocks: any[],
  text: string,
  metadata?: Record<string, any>,
) {
  const body: Record<string, any> = { channel, blocks, text, mrkdwn: true };
  if (metadata) body.metadata = { event_type: "duty_bot", event_payload: metadata };
  return slackApi("chat.postMessage", body);
}

// Block Kit DM 전송
export async function sendBlockDM(
  userId: string,
  blocks: any[],
  text: string,
  metadata?: Record<string, any>,
) {
  const openRes = await slackApi("conversations.open", { users: userId });
  const channelId = openRes.channel.id;
  const msgRes = await postBlockMessage(channelId, blocks, text, metadata);
  return { channelId, ts: msgRes.ts };
}

// 기존 메시지 업데이트 (버튼 제거/변경용)
export async function updateMessage(
  channel: string,
  ts: string,
  blocks: any[],
  text: string,
) {
  return slackApi("chat.update", { channel, ts, blocks, text });
}

// Slack 설정 유효성 체크
export function isSlackConfigured(): boolean {
  return !!SLACK_TOKEN;
}

// #help-정보보안 등 채널 히스토리 조회
export async function getChannelHistory(channelId: string, oldest?: string, limit = 50) {
  const params: Record<string, any> = { channel: channelId, limit };
  if (oldest) params.oldest = oldest;
  const data = await slackApi("conversations.history", params);
  return (data.messages || []) as any[];
}

// 메시지 permalink 조회
export async function getPermalink(channelId: string, messageTs: string): Promise<string> {
  await throttle();
  const res = await fetch(
    `https://slack.com/api/chat.getPermalink?channel=${channelId}&message_ts=${messageTs}`,
    { headers: { Authorization: `Bearer ${SLACK_TOKEN}` } }
  );
  const data = await res.json();
  return data.permalink || "";
}

export { SLACK_USER_ID, slackApi };
