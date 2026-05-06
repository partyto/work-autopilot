// Slack OAuth 시작 — 설치 URL로 리다이렉트
// GET /api/slack/oauth/install
// Query: bot=1 (default) | user=1 — 어떤 토큰을 발급받을지 선택

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// 기본 bot scope — 코드 사용처 기반
const DEFAULT_BOT_SCOPES = [
  "chat:write",
  "chat:write.public",
  "im:write",
  "im:read",
  "channels:history",
  "groups:history",
  "reactions:write",
  "users:read",
  "channels:read",
  "groups:read",
];

// User token scope — search:read 등
const DEFAULT_USER_SCOPES = ["search:read", "reactions:write"];

export async function GET(request: NextRequest) {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "SLACK_CLIENT_ID 미설정" }, { status: 500 });
  }

  const appUrl = process.env.APP_URL || "http://localhost:3102";
  const redirectUri = `${appUrl}/api/slack/oauth/callback`;

  const url = new URL(request.url);
  const wantsUser = url.searchParams.get("user") === "1";
  const state = wantsUser ? "user" : "bot";

  const installUrl = new URL("https://slack.com/oauth/v2/authorize");
  installUrl.searchParams.set("client_id", clientId);
  installUrl.searchParams.set("scope", DEFAULT_BOT_SCOPES.join(","));
  installUrl.searchParams.set("user_scope", DEFAULT_USER_SCOPES.join(","));
  installUrl.searchParams.set("redirect_uri", redirectUri);
  installUrl.searchParams.set("state", state);

  return NextResponse.redirect(installUrl.toString());
}
