import { NextRequest, NextResponse } from "next/server";
import {
  postBlockMessage,
  sendBlockDM,
} from "@/lib/integrations/slack";
import {
  getDutyState,
  getCurrentDuty,
  getWeekRange,
  getISOWeek,
  saveDutyState,
} from "@/lib/duty-rotation";

export const dynamic = "force-dynamic";

// POST /api/slack/duty-announce — 당번 공지 메시지 (Block Kit 버튼 포함)
export async function POST(req: NextRequest) {
  try {
    const state = getDutyState();
    const duty = getCurrentDuty(state);
    const week = getWeekRange();
    const isoWeek = getISOWeek(new Date());

    // state 업데이트
    state.current_week = isoWeek;
    state.current_duty_index = duty.index;
    state.current_duty_name = duty.name;
    saveDutyState(state);

    // 다른 멤버 목록 (변경 시 선택지)
    const otherMembers = state.members
      .filter((m) => m.index !== duty.index)
      .map((m) => `${m.name}`)
      .join(", ");

    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:rotating_light: *이번 주 데이터 추출 당번 안내*\n\n:bust_in_silhouette: 당번: <@${duty.slack_id}>\n:calendar: 기간: ${week.start}(월) ~ ${week.end}(금)\n\n#help-정보보안 채널에 추출 요청이 오면 알려드릴게요!`,
        },
      },
      {
        type: "actions",
        block_id: "duty_actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: ":arrows_counterclockwise: 변경하기", emoji: true },
            style: "danger",
            action_id: "duty_change",
            value: JSON.stringify({
              duty_index: duty.index,
              duty_name: duty.name,
              duty_slack_id: duty.slack_id,
              week: isoWeek,
            }),
          },
          {
            type: "button",
            text: { type: "plain_text", text: ":white_check_mark: 확정하기", emoji: true },
            style: "primary",
            action_id: "duty_confirm",
            value: JSON.stringify({
              duty_index: duty.index,
              duty_name: duty.name,
              duty_slack_id: duty.slack_id,
              week: isoWeek,
            }),
          },
        ],
      },
    ];

    const fallbackText = `이번 주 데이터 추출 당번: ${duty.name} (${week.start}~${week.end})`;

    // 채널에 공지
    const result = await postBlockMessage(
      state.announcement_channel,
      blocks,
      fallbackText,
    );

    // 당번에게 DM
    await sendBlockDM(
      duty.slack_id,
      [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:wave: 이번 주 데이터 추출 당번입니다!\n기간: ${week.start}(월) ~ ${week.end}(금)\n#help-정보보안 채널에 요청이 오면 별도로 알려드리겠습니다.`,
          },
        },
      ],
      `이번 주 데이터 추출 당번입니다! (${week.start}~${week.end})`,
    );

    return NextResponse.json({
      ok: true,
      duty: duty.name,
      week: isoWeek,
      channel_ts: result.ts,
    });
  } catch (err) {
    console.error("[duty-announce] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
