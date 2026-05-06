import { NextRequest, NextResponse } from "next/server";
import { sendDM } from "@/lib/integrations/slack";
import { getAccessToken } from "@/lib/integrations/slack-tokens";

export const dynamic = "force-dynamic";

async function postToChannel(channelId: string, text: string, threadTs?: string) {
  const token = await getAccessToken("bot");
  const body: Record<string, any> = { channel: channelId, text, mrkdwn: true };
  if (threadTs) body.thread_ts = threadTs;

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
  return data;
}

// POST /api/slack-send — 파트라슈 봇으로 Slack 메시지 전송
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { channel_id, user_id, message, thread_ts } = body;

    if (!message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    // DM 발송 (user_id 지정 시)
    if (user_id) {
      const result = await sendDM(message, user_id);
      return NextResponse.json({ ok: true, channel: result.channelId, ts: result.ts });
    }

    // 채널 메시지 (channel_id 지정 시)
    if (channel_id) {
      const result = await postToChannel(channel_id, message, thread_ts);
      return NextResponse.json({ ok: true, channel: channel_id, ts: result.ts });
    }

    return NextResponse.json({ error: "channel_id or user_id is required" }, { status: 400 });
  } catch (err) {
    console.error("[API/slack-send] POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
