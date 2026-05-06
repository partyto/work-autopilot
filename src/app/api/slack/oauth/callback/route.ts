// Slack OAuth 콜백 — 설치 후 redirect 받아 access/refresh token DB 저장
// GET /api/slack/oauth/callback?code=...&state=bot|user

import { NextRequest, NextResponse } from "next/server";
import { saveToken } from "@/lib/integrations/slack-tokens";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.json({ error: `Slack OAuth 거부: ${error}` }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ error: "code 누락" }, { status: 400 });
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "SLACK_CLIENT_ID / SLACK_CLIENT_SECRET 미설정" }, { status: 500 });
  }

  const appUrl = process.env.APP_URL || "http://localhost:3102";
  const redirectUri = `${appUrl}/api/slack/oauth/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  try {
    const res = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error("[Slack OAuth] 토큰 교환 실패:", data);
      return NextResponse.json({ error: `OAuth 실패: ${data.error}` }, { status: 400 });
    }

    const saved: string[] = [];

    // Bot token (rotation 활성화 시 expires_in/refresh_token 동봉)
    if (data.access_token && data.refresh_token && data.expires_in) {
      await saveToken("bot", {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        scope: data.scope,
        teamId: data.team?.id,
        enterpriseId: data.enterprise?.id,
        authedUserId: data.authed_user?.id,
      });
      saved.push("bot");
    } else if (data.access_token) {
      console.warn("[Slack OAuth] bot 토큰에 refresh_token 없음 — token rotation 활성화 확인 필요");
    }

    // User token
    const u = data.authed_user;
    if (u?.access_token && u?.refresh_token && u?.expires_in) {
      await saveToken("user", {
        accessToken: u.access_token,
        refreshToken: u.refresh_token,
        expiresIn: u.expires_in,
        scope: u.scope,
        teamId: data.team?.id,
        enterpriseId: data.enterprise?.id,
        authedUserId: u.id,
      });
      saved.push("user");
    }

    if (saved.length === 0) {
      return NextResponse.json({
        error: "저장된 토큰 없음 — token rotation 비활성화 상태인지 확인",
        raw: data,
      }, { status: 400 });
    }

    return new NextResponse(
      `<!doctype html><html><body style="font-family:system-ui;padding:40px;max-width:600px">
      <h2>✅ Slack 토큰 저장 완료</h2>
      <p>저장된 토큰: <strong>${saved.join(", ")}</strong></p>
      <p>팀: ${data.team?.name || "-"} (${data.team?.id || "-"})</p>
      <p>이제 자동으로 갱신됩니다. 창을 닫아도 됩니다.</p>
      <p><a href="${appUrl}">대시보드로 이동</a></p>
      </body></html>`,
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  } catch (e) {
    console.error("[Slack OAuth] 예외:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
