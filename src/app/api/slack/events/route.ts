import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { BOT_MENTION, BOT_USER_ID, processMentionMessage } from "@/lib/extraction-monitor";

export const dynamic = "force-dynamic";

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || "";

function verifySlackSignature(
  signature: string | null,
  timestamp: string | null,
  rawBody: string,
): boolean {
  if (!SIGNING_SECRET) {
    console.warn("[slack/events] SLACK_SIGNING_SECRET 미설정 — 서명 검증 스킵");
    return true;
  }
  if (!signature || !timestamp) return false;
  const fiveMinAgo = Math.floor(Date.now() / 1000) - 300;
  if (parseInt(timestamp) < fiveMinAgo) return false;
  const baseString = `v0:${timestamp}:${rawBody}`;
  const hash =
    "v0=" + crypto.createHmac("sha256", SIGNING_SECRET).update(baseString).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch {
    return false;
  }
}

// POST /api/slack/events — Slack Events API 수신 엔드포인트
// - url_verification: challenge 에코
// - event_callback (app_mention): 즉시 처리 → @파트라슈 멘션되면 바로 DM 발송
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-slack-signature");
    const timestamp = req.headers.get("x-slack-request-timestamp");

    if (!verifySlackSignature(signature, timestamp, rawBody)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);

    // 1) Slack URL 검증 (최초 1회)
    if (payload.type === "url_verification") {
      return NextResponse.json({ challenge: payload.challenge });
    }

    // 2) Slack 재시도 무시 (3초 타임아웃 → 중복 처리 방지)
    const retryNum = req.headers.get("x-slack-retry-num");
    if (retryNum) {
      console.log(`[slack/events] retry #${retryNum} 무시`);
      return NextResponse.json({ ok: true });
    }

    // 3) event_callback 처리
    if (payload.type === "event_callback") {
      const event = payload.event;
      if (!event) return NextResponse.json({ ok: true });

      // app_mention: 봇이 직접 멘션된 경우
      // message: 스레드 내 답글 등에서도 멘션 포함된 경우 (app_mention이 안 올 수 있음)
      const isAppMention = event.type === "app_mention";
      const isMessage = event.type === "message" && !event.bot_id && !event.subtype;

      if (!isAppMention && !isMessage) {
        return NextResponse.json({ ok: true });
      }

      // 봇 본인 메시지 무시
      if (event.user === BOT_USER_ID) {
        return NextResponse.json({ ok: true });
      }

      // 멘션 포함 여부 확인 (message 이벤트 중 멘션 없는 건 스킵)
      if (!event.text?.includes(BOT_MENTION)) {
        return NextResponse.json({ ok: true });
      }

      const channelId = event.channel;
      const threadTs = event.thread_ts || event.ts;

      // Slack은 3초 내 응답을 요구하므로 즉시 200 반환 + 백그라운드 처리
      void processMentionMessage({
        channelId,
        msg: { user: event.user, text: event.text, ts: event.ts },
        threadTs,
        initialThreadStarterId: event.user,
        persistState: true,
      }).catch((err) => console.error("[slack/events] processMentionMessage error:", err));

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[slack/events] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
