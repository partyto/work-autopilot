import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
  updateMessage,
  postBlockMessage,
  sendDM,
  sendBlockDM,
  replyToThread,
} from "@/lib/integrations/slack";
import { findLatestExcelInDM, downloadSlackFile } from "@/lib/integrations/slack-files";
import { protectExcel } from "@/lib/excel-protect";
import { attachFileToIssue } from "@/lib/integrations/jira";
import {
  getDutyState,
  swapDuty,
  confirmDuty,
  getWeekRange,
  generateSQL,
} from "@/lib/duty-rotation";

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

    // ─── 추출 유형: 마케팅 ───
    if (actionId === "extract_marketing") {
      const sql = generateSQL("marketing", value.shop_seq);

      await updateMessage(channelId, messageTs, [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:clipboard: *${value.ticket_key} 추출 요청*\n\n:white_check_mark: *마케팅 수신용* 선택됨\nshop_seq: \`${value.shop_seq}\``,
          },
        },
      ], `${value.ticket_key} — 마케팅 수신용 선택`);

      // SQL 쿼리 + 업로드 완료 버튼 DM
      const uploadMeta = JSON.stringify({
        ticket_key: value.ticket_key,
        shop_seq: value.shop_seq,
        thread_ts: value.thread_ts || "",
        channel: value.channel || "",
        permalink: value.permalink || "",
        extract_type: "marketing",
      });

      await sendBlockDM(user.id, [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:mag: *QueryPie에서 아래 쿼리를 실행해주세요:*`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `\`\`\`\n${sql}\n\`\`\``,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `실행 후 결과를 엑셀(XLSX)로 다운로드 받고,\n*이 대화에 파일을 업로드*한 뒤 아래 버튼을 눌러주세요!`,
          },
        },
        {
          type: "actions",
          block_id: "upload_actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "📎 엑셀 업로드 완료", emoji: true },
              style: "primary",
              action_id: "excel_upload_done",
              value: uploadMeta,
            },
          ],
        },
      ], `${value.ticket_key} SQL 쿼리 — 실행 후 엑셀 업로드`);

      return NextResponse.json({ ok: true });
    }

    // ─── 추출 유형: 공지성 ───
    if (actionId === "extract_notice") {
      const sql = generateSQL("notice", value.shop_seq);

      await updateMessage(channelId, messageTs, [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:clipboard: *${value.ticket_key} 추출 요청*\n\n:white_check_mark: *공지성 수신용* 선택됨\nshop_seq: \`${value.shop_seq}\``,
          },
        },
      ], `${value.ticket_key} — 공지성 수신용 선택`);

      // SQL 쿼리 + 업로드 완료 버튼 DM
      const uploadMeta = JSON.stringify({
        ticket_key: value.ticket_key,
        shop_seq: value.shop_seq,
        thread_ts: value.thread_ts || "",
        channel: value.channel || "",
        permalink: value.permalink || "",
        extract_type: "notice",
      });

      await sendBlockDM(user.id, [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:mag: *QueryPie에서 아래 쿼리를 실행해주세요:*`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `\`\`\`\n${sql}\n\`\`\``,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `실행 후 결과를 엑셀(XLSX)로 다운로드 받고,\n*이 대화에 파일을 업로드*한 뒤 아래 버튼을 눌러주세요!`,
          },
        },
        {
          type: "actions",
          block_id: "upload_actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "📎 엑셀 업로드 완료", emoji: true },
              style: "primary",
              action_id: "excel_upload_done",
              value: uploadMeta,
            },
          ],
        },
      ], `${value.ticket_key} SQL 쿼리 — 실행 후 엑셀 업로드`);

      return NextResponse.json({ ok: true });
    }

    // ─── 엑셀 업로드 완료 → 보호 + JIRA 첨부 ───
    if (actionId === "excel_upload_done") {
      const userId = user.id;
      const meta = value;

      // Slack 3초 제한 → 즉시 응답, 비동기 처리
      void (async () => {
        try {
          await updateMessage(channelId, messageTs, [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `:hourglass_flowing_sand: *${meta.ticket_key}* 처리 중...\n엑셀 보호 → JIRA 첨부 진행 중`,
              },
            },
          ], `${meta.ticket_key} 처리 중...`);

          // 1. DM에서 최신 Excel 파일 찾기
          const file = await findLatestExcelInDM(userId);
          if (!file) {
            await updateMessage(channelId, messageTs, [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `:warning: *${meta.ticket_key}* — 엑셀 파일을 찾을 수 없습니다.\n이 대화에 .xlsx 파일을 먼저 업로드해주세요.`,
                },
              },
              {
                type: "actions",
                block_id: "upload_retry",
                elements: [
                  {
                    type: "button",
                    text: { type: "plain_text", text: "📎 엑셀 업로드 완료", emoji: true },
                    style: "primary",
                    action_id: "excel_upload_done",
                    value: JSON.stringify(meta),
                  },
                ],
              },
            ], `${meta.ticket_key} — 파일을 찾을 수 없음`);
            return;
          }

          // 2. 파일 다운로드
          const rawBuffer = await downloadSlackFile(file.url);

          // 3. 비밀번호 보호
          const protectedBuffer = await protectExcel(rawBuffer);
          const protectedFilename = file.name.replace(/\.xlsx$/i, "_protected.xlsx");

          // 4. JIRA 첨부
          await attachFileToIssue(meta.ticket_key, protectedFilename, protectedBuffer);

          // 5. DM 완료 업데이트
          await updateMessage(channelId, messageTs, [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `:white_check_mark: *${meta.ticket_key}* 처리 완료!\n\n:lock: 비밀번호 보호 적용됨\n:ticket: <https://catchtable.atlassian.net/browse/${meta.ticket_key}|JIRA 티켓>에 첨부됨\n:page_facing_up: 파일: \`${protectedFilename}\``,
              },
            },
          ], `${meta.ticket_key} 처리 완료`);

          // 6. #help-정보보안 스레드에 완료 알림 (thread_ts가 있을 때만)
          if (meta.thread_ts && meta.channel) {
            await replyToThread(
              meta.channel,
              meta.thread_ts,
              `:white_check_mark: *${meta.ticket_key}* 데이터 추출이 완료되었습니다.\n비밀번호 보호된 파일이 JIRA 티켓에 첨부되었습니다.`,
            );
          }
        } catch (err) {
          console.error("[excel_upload_done] error:", err);
          try {
            await updateMessage(channelId, messageTs, [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `:x: *${meta.ticket_key}* 처리 실패\n에러: ${String(err).slice(0, 200)}`,
                },
              },
              {
                type: "actions",
                block_id: "upload_retry",
                elements: [
                  {
                    type: "button",
                    text: { type: "plain_text", text: "🔄 재시도", emoji: true },
                    action_id: "excel_upload_done",
                    value: JSON.stringify(meta),
                  },
                ],
              },
            ], `${meta.ticket_key} 처리 실패`);
          } catch { /* ignore */ }
        }
      })();

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
