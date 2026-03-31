import { NextRequest, NextResponse } from "next/server";
import { sendBlockDM } from "@/lib/integrations/slack";
import { getDutyState, getCurrentDuty } from "@/lib/duty-rotation";

export const dynamic = "force-dynamic";

// POST /api/slack/extract-select — 추출 유형 선택 메시지 (Block Kit 버튼)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { ticket_key, requester, reason, shop_seq, destroy_date } = body;

    if (!ticket_key || !shop_seq) {
      return NextResponse.json(
        { error: "ticket_key and shop_seq are required" },
        { status: 400 },
      );
    }

    const state = getDutyState();
    const duty = getCurrentDuty(state);

    const metadata = JSON.stringify({
      ticket_key,
      requester: requester || "",
      reason: reason || "",
      shop_seq: String(shop_seq),
      destroy_date: destroy_date || "",
    });

    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:clipboard: *${ticket_key} 추출 요청 분석 완료*\n\n:bust_in_silhouette: 요청자: ${requester || "미확인"}\n:speech_balloon: 사유: ${reason || "미확인"}\n:department_store: shop_seq: \`${shop_seq}\`\n:calendar: 파기일자: ${destroy_date || "미확인"}`,
        },
      },
      {
        type: "actions",
        block_id: "extract_actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "1️⃣ 마케팅 수신용", emoji: true },
            style: "primary",
            action_id: "extract_marketing",
            value: metadata,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "2️⃣ 공지성 수신용", emoji: true },
            action_id: "extract_notice",
            value: metadata,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "3️⃣ 그 외", emoji: true },
            style: "danger",
            action_id: "extract_other",
            value: metadata,
          },
        ],
      },
    ];

    const result = await sendBlockDM(
      duty.slack_id,
      blocks,
      `${ticket_key} 추출 요청 — 유형을 선택해주세요`,
    );

    return NextResponse.json({
      ok: true,
      duty: duty.name,
      channel: result.channelId,
      ts: result.ts,
    });
  } catch (err) {
    console.error("[extract-select] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
