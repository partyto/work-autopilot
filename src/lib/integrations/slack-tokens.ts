// Slack Token Manager — token rotation 지원
// 12시간마다 만료되는 access token을 refresh token으로 자동 갱신
// DB의 slack_tokens 테이블에 bot/user 두 종류를 저장

import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { nowLocal } from "@/lib/utils";

const REFRESH_MARGIN_MS = 5 * 60 * 1000; // 만료 5분 전 갱신

// 동시 refresh 방지용 in-flight 캐시
const refreshing: Record<string, Promise<string> | undefined> = {};

export type SlackTokenType = "bot" | "user";

export interface SlackTokenRow {
  id: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string | null;
  teamId: string | null;
  enterpriseId: string | null;
  authedUserId: string | null;
}

async function loadToken(type: SlackTokenType): Promise<SlackTokenRow | null> {
  const row = await db.query.slackTokens.findFirst({
    where: eq(schema.slackTokens.id, type),
  });
  return (row as SlackTokenRow) || null;
}

export async function saveToken(
  type: SlackTokenType,
  data: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number; // seconds
    scope?: string;
    teamId?: string;
    enterpriseId?: string;
    authedUserId?: string;
  },
) {
  const expiresAt = Date.now() + data.expiresIn * 1000;
  const existing = await loadToken(type);
  if (existing) {
    await db
      .update(schema.slackTokens)
      .set({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt,
        scope: data.scope || null,
        teamId: data.teamId || null,
        enterpriseId: data.enterpriseId || null,
        authedUserId: data.authedUserId || null,
        updatedAt: nowLocal(),
      })
      .where(eq(schema.slackTokens.id, type));
  } else {
    await db.insert(schema.slackTokens).values({
      id: type,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt,
      scope: data.scope || null,
      teamId: data.teamId || null,
      enterpriseId: data.enterpriseId || null,
      authedUserId: data.authedUserId || null,
      updatedAt: nowLocal(),
    });
  }
}

async function refreshAccessToken(type: SlackTokenType): Promise<string> {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("SLACK_CLIENT_ID / SLACK_CLIENT_SECRET 미설정");
  }

  const row = await loadToken(type);
  if (!row) throw new Error(`Slack ${type} 토큰이 DB에 없음 — OAuth 설치 필요`);

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: row.refreshToken,
  });

  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slack token refresh 실패: ${data.error}`);
  }

  // bot vs user 응답 구조가 다름
  // bot: data.access_token, data.refresh_token, data.expires_in (top-level)
  // user: data.authed_user.access_token / refresh_token / expires_in
  const isUser = type === "user";
  const accessToken = isUser ? data.authed_user?.access_token : data.access_token;
  const refreshToken = isUser ? data.authed_user?.refresh_token : data.refresh_token;
  const expiresIn = isUser ? data.authed_user?.expires_in : data.expires_in;

  if (!accessToken || !refreshToken || !expiresIn) {
    throw new Error(`Slack ${type} refresh 응답 형식 이상: ${JSON.stringify(data).slice(0, 200)}`);
  }

  await saveToken(type, {
    accessToken,
    refreshToken,
    expiresIn,
    scope: isUser ? data.authed_user?.scope : data.scope,
    teamId: data.team?.id,
    enterpriseId: data.enterprise?.id,
    authedUserId: data.authed_user?.id,
  });

  console.log(`[SlackToken] ${type} 토큰 갱신 완료 (expires_in=${expiresIn}s)`);
  return accessToken;
}

/**
 * 현재 유효한 access token 반환. 만료 임박 시 자동 갱신.
 * 동시 refresh 방지를 위해 in-flight Promise 공유.
 */
export async function getAccessToken(type: SlackTokenType): Promise<string> {
  // 환경변수 fallback (구버전 정적 토큰 호환)
  const envFallback = type === "bot" ? process.env.SLACK_BOT_TOKEN : process.env.SLACK_USER_TOKEN;

  let row: SlackTokenRow | null = null;
  try {
    row = await loadToken(type);
  } catch (e) {
    console.warn(`[SlackToken] ${type} DB 조회 실패:`, e);
  }

  // DB에 토큰이 없으면 정적 환경변수 사용 (마이그레이션 기간)
  if (!row) {
    if (envFallback) return envFallback;
    throw new Error(`Slack ${type} 토큰 미설정 — DB OAuth 설치 또는 환경변수 필요`);
  }

  // 만료 임박 시 갱신
  if (row.expiresAt - Date.now() < REFRESH_MARGIN_MS) {
    if (!refreshing[type]) {
      refreshing[type] = refreshAccessToken(type).finally(() => {
        delete refreshing[type];
      });
    }
    return refreshing[type]!;
  }

  return row.accessToken;
}

export async function hasToken(type: SlackTokenType): Promise<boolean> {
  try {
    const row = await loadToken(type);
    if (row) return true;
  } catch {
    // ignore
  }
  const envFallback = type === "bot" ? process.env.SLACK_BOT_TOKEN : process.env.SLACK_USER_TOKEN;
  return !!envFallback;
}
