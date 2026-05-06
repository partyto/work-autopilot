// Slack Web API 직접 연동 — Cowork MCP 의존성 제거
// 토큰 로테이션 지원 (slack-tokens.ts) — DB에 저장된 토큰 자동 갱신
// 마이그레이션 호환: DB 토큰 없으면 SLACK_BOT_TOKEN/SLACK_USER_TOKEN 환경변수 fallback

import { getAccessToken, hasToken } from "./slack-tokens";

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
  const token = await getAccessToken("bot");
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
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

// 채널 메시지 발송 (채널 이름 또는 ID)
export async function sendChannelMessage(channel: string, text: string) {
  const msgRes = await slackApi("chat.postMessage", {
    channel,
    text,
    mrkdwn: true,
    unfurl_links: false,
    unfurl_media: false,
  });
  return { channelId: msgRes.channel, ts: msgRes.ts };
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
  // user 토큰 우선 사용, 없으면 bot
  let token: string;
  try {
    token = await getAccessToken("user");
  } catch {
    token = await getAccessToken("bot");
  }

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
  let token: string;
  try {
    token = await getAccessToken("user");
  } catch {
    console.warn("Slack search skipped: no user token available");
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
    console.warn("Slack search failed:", data.error, "(user token 필요)");
    return [];
  }
  return data.messages?.matches || [];
}

// 채널 메시지 히스토리 (스레드 확인용)
export async function getThreadReplies(channelId: string, threadTs: string) {
  // conversations.replies는 JSON body를 지원하지 않으므로 GET query string으로 호출
  await throttle();
  const token = await getAccessToken("bot");
  const params = new URLSearchParams({ channel: channelId, ts: threadTs, limit: "100" });
  const res = await fetch(`https://slack.com/api/conversations.replies?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
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

// Slack 설정 유효성 체크 (sync — 기존 호출처 시그니처 유지를 위해 best-effort)
// 정확한 체크는 hasSlackToken() 사용
export function isSlackConfigured(): boolean {
  // 환경변수가 있거나 (DB 토큰 체크는 async라 불가) 향후 호출 시점에 검증
  return !!process.env.SLACK_BOT_TOKEN || !!process.env.SLACK_CLIENT_ID;
}

// 비동기 정확 체크
export async function hasSlackToken(): Promise<boolean> {
  return hasToken("bot");
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
  const token = await getAccessToken("bot");
  const res = await fetch(
    `https://slack.com/api/chat.getPermalink?channel=${channelId}&message_ts=${messageTs}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return data.permalink || "";
}

export { SLACK_USER_ID, slackApi };
