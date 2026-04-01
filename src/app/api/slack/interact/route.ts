import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
  updateMessage,
  postBlockMessage,
  sendDM,
} from "@/lib/integrations/slack";
import {
  getDutyState,
  swapDuty,
  confirmDuty,
  getWeekRange,
  generateSQL,
} from "@/lib/duty-rotation";
import { createJob } from "@/lib/extraction-jobs";

export const dynamic = "force-dynamic";

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || "";

function verifySlackSignature(
  signature: string | null,
  timestamp: string | null,
  rawBody: string,
): boolean {
  if (!SIGNING_SECRET || !signature || !timestamp) return !SIGNING_SECRET; // skip if no secret configured
  const fiveMinAgo = Math.floor(Date.now() / 1000) - 300;
  if (parseInt(timestamp) < fiveMinAgo) return false;
  const baseString = `v0:${timestamp}:${rawBody}`;
  const hash = "v0=" + crypto.createHmac("sha256", SIGNING_SECRET).update(baseString).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
}

// POST /api/slack/interact — Slack 버튼 클릭 콜백 핸들러
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-slack-signature");
    const timestamp = req.headers.get("x-slack-request-timestamp");

    if (!verifySlackSignature(signature, timestamp, rawBody)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }

    const params = new URLSearchParams(rawBody);
    const payload = JSON.parse(params.get("payload") || "{}");
    const { type, actions, channel, message, user } = payload;
    if (type !== "block_actions" || !actions?.length) {
      return NextResponse.json({ ok: true });
    }

    const action = actions[0];
    const actionId = action.action_id;
    const value = action.value ? JSON.parse(action.value) : {};
    const channelId = channel?.id;
    const messageTs = message?.ts;

    // ─── 당번 확정 ───
    if (actionId === "duty_confirm") {
      const state = confirmDuty();
      const duty = state.members[state.current_duty_index];
      const week = getWeekRange();

      // 원본 메시지 업데이트: 버튼 제거
      await updateMessage(channelId, messageTs, [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:rotating_light: *이번 주 데이터 추출 당번 안내*\n\n:bust_in_silhouette: 당번: <@${duty.slack_id}>\n:calendar: 기간: ${week.start}(월) ~ ${week.end}(금)\n\n:white_check_mark: *확정됨*`,
          },
        },
      ], `이번 주 당번: ${duty.name} (확정)`);

      // 확정 메시지
      await postBlockMessage(channelId, [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:tada: 이번 주 당번은 <@${duty.slack_id}>님으로 확정되었습니다. 잘 부탁드립니다!`,
          },
        },
      ], `이번 주 당번 확정: ${duty.name}`);

      return NextResponse.json({ ok: true });
    }

    // ─── 당번 변경 요청 ───
    if (actionId === "duty_change") {
      const state = getDutyState();
      const currentIndex = value.duty_index;

      // 나머지 멤버 버튼 생성
      const otherMembers = state.members.filter((m) => m.index !== currentIndex);
      const buttons = otherMembers.map((m) => ({
        type: "button" as const,
        text: { type: "plain_text" as const, text: m.name, emoji: true },
        action_id: `duty_select_${m.index}`,
        value: JSON.stringify({
          original_index: currentIndex,
          original_name: value.duty_name,
          replacement_index: m.index,
          replacement_name: m.name,
          replacement_slack_id: m.slack_id,
        }),
      }));

      await updateMessage(channelId, messageTs, [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:arrows_counterclockwise: *당번 변경*\n\n현재 당번: ${value.duty_name}\n대체할 당번을 선택해주세요:`,
          },
        },
        {
          type: "actions",
          block_id: "duty_select_actions",
          elements: buttons,
        },
      ], "당번 변경 — 대체자를 선택해주세요");

      return NextResponse.json({ ok: true });
    }

    // ─── 대체자 선택 ───
    if (actionId.startsWith("duty_select_")) {
      const originalIndex = value.original_index;
      const replacementIndex = value.replacement_index;
      const replacementName = value.replacement_name;
      const replacementSlackId = value.replacement_slack_id;

      const state = swapDuty(originalIndex, replacementIndex);
      const week = getWeekRange();

      // 원본 메시지 업데이트
      await updateMessage(channelId, messageTs, [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:rotating_light: *이번 주 데이터 추출 당번 안내*\n\n:bust_in_silhouette: 당번: <@${replacementSlackId}>\n:calendar: 기간: ${week.start}(월) ~ ${week.end}(금)\n\n:arrows_counterclockwise: *${value.original_name} → ${replacementName}으로 변경됨*`,
          },
        },
      ], `당번 변경: ${value.original_name} → ${replacementName}`);

      // 변경 확정 메시지
      await postBlockMessage(channelId, [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:tada: 이번 주 당번은 <@${replacementSlackId}>님으로 변경 확정되었습니다. 잘 부탁드립니다!`,
          },
        },
      ], `이번 주 당번 변경 확정: ${replacementName}`);

      // 대체자에게 DM
      await sendDM(
        `:wave: 이번 주 데이터 추출 당번이 되었습니다!\n기간: ${week.start}(월) ~ ${week.end}(금)\n#help-정보보안 채널에 요청이 오면 별도로 알려드리겠습니다.`,
        replacementSlackId,
      );

      return NextResponse.json({ ok: true });
    }

    // ─── 추출 유형: 마케팅 / 공지성 → Job Queue에 등록 (Worker가 처리) ───
    if (actionId === "extract_marketing" || actionId === "extract_notice") {
      const extractType = actionId === "extract_marketing" ? "marketing" : "notice";
      const extractLabel = actionId === "extract_marketing" ? "마케팅 수신용" : "공지성 수신용";
      const meta = value;
      const sql = generateSQL(extractType, meta.shop_seq);

      const job = createJob({
        ticket_key: meta.ticket_key,
        shop_seq: meta.shop_seq || "",
        extract_type: extractType,
        thread_ts: meta.thread_ts || "",
        channel: meta.channel || "",
        requester_id: meta.requester_id || "",
        pm_user_id: user.id,
        sql,
      });

      // 버튼 제거 + 대기 상태 표시
      await updateMessage(channelId, messageTs, [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:clipboard: *${meta.ticket_key} 추출 요청*\n\n:hourglass_flowing_sand: *${extractLabel}* 선택됨 — Worker 대기 중...\nshop_seq: \`${meta.shop_seq || "확인 필요"}\`\njob: \`${job.id.slice(0, 8)}\``,
          },
        },
      ], `${meta.ticket_key} — ${extractLabel} Worker 대기 중`);

      await sendDM(
        `⏳ *${meta.ticket_key}* 추출 요청이 등록되었습니다. Worker가 처리할 예정입니다.`,
        user.id,
      );

      return NextResponse.json({ ok: true });
    }

    // ─── 추출 유형: 그 외 ───
    if (actionId === "extract_other") {
      await updateMessage(channelId, messageTs, [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:clipboard: *${value.ticket_key} 추출 요청*\n\n:warning: *그 외* 선택됨 — 수동 처리가 필요합니다.\nshop_seq: \`${value.shop_seq}\``,
          },
        },
      ], `${value.ticket_key} — 수동 처리`);

      await sendDM(
        `:warning: *${value.ticket_key}* 건은 표준 쿼리로 처리할 수 없습니다.\nJIRA 티켓을 확인하여 수동으로 처리해주세요.\n<https://catchtable.atlassian.net/browse/${value.ticket_key}|JIRA 티켓 보기>`,
        user.id,
      );

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[slack/interact] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
