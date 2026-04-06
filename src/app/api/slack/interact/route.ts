import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
  updateMessage,
  postBlockMessage,
  sendDM,
  sendBlockDM,
} from "@/lib/integrations/slack";
import {
  getDutyState,
  swapDuty,
  confirmDuty,
  getWeekRange,
  generateSQL,
} from "@/lib/duty-rotation";
import { createJob } from "@/lib/extraction-jobs";
import {
  extractShopSeqFromJira,
  fetchShopSeqFromSheet,
  isGoogleSheetsConfigured,
} from "@/lib/google-sheets";

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

// ─── shop_seq → Job 생성 공통 함수 ───
async function createExtractionJob(params: {
  extractType: string;
  extractLabel: string;
  shopSeq: string;
  shopSeqSource: string;
  meta: Record<string, string>;
  userId: string;
  channelId: string;
  messageTs: string;
}) {
  const { extractType, extractLabel, shopSeq, shopSeqSource, meta, userId, channelId, messageTs } = params;
  const sql = generateSQL(extractType, shopSeq);
  const shopSeqCount = shopSeq.split(",").length;

  const job = createJob({
    ticket_key: meta.ticket_key,
    shop_seq: shopSeq,
    extract_type: extractType,
    thread_ts: meta.thread_ts || "",
    channel: meta.channel || "",
    requester_id: meta.requester_id || userId,
    pm_user_id: userId,
    sql,
  });

  // 버튼 제거 + 대기 상태 표시
  await updateMessage(channelId, messageTs, [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:clipboard: *${meta.ticket_key} 추출 요청*\n\n:hourglass_flowing_sand: *${extractLabel}* 선택됨 — Worker 대기 중...\nshop_seq: ${shopSeqCount}개 (${shopSeqSource})\njob: \`${job.id.slice(0, 8)}\``,
      },
    },
  ], `${meta.ticket_key} — ${extractLabel} Worker 대기 중`);

  await sendDM(
    `⏳ *${meta.ticket_key}* 추출 요청이 등록되었습니다.\nshop_seq: ${shopSeqCount}개 (${shopSeqSource}에서 추출)\nWorker가 처리할 예정입니다.`,
    userId,
  );
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

      await updateMessage(channelId, messageTs, [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:rotating_light: *이번 주 데이터 추출 당번 안내*\n\n:bust_in_silhouette: 당번: <@${duty.slack_id}>\n:calendar: 기간: ${week.start}(월) ~ ${week.end}(금)\n\n:white_check_mark: *확정됨*`,
          },
        },
      ], `이번 주 당번: ${duty.name} (확정)`);

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
      const replacementName = value.replacement_name;
      const replacementSlackId = value.replacement_slack_id;

      swapDuty(value.original_index, value.replacement_index);
      const week = getWeekRange();

      await updateMessage(channelId, messageTs, [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:rotating_light: *이번 주 데이터 추출 당번 안내*\n\n:bust_in_silhouette: 당번: <@${replacementSlackId}>\n:calendar: 기간: ${week.start}(월) ~ ${week.end}(금)\n\n:arrows_counterclockwise: *${value.original_name} → ${replacementName}으로 변경됨*`,
          },
        },
      ], `당번 변경: ${value.original_name} → ${replacementName}`);

      await postBlockMessage(channelId, [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:tada: 이번 주 당번은 <@${replacementSlackId}>님으로 변경 확정되었습니다. 잘 부탁드립니다!`,
          },
        },
      ], `이번 주 당번 변경 확정: ${replacementName}`);

      await sendDM(
        `:wave: 이번 주 데이터 추출 당번이 되었습니다!\n기간: ${week.start}(월) ~ ${week.end}(금)\n#help-정보보안 채널에 요청이 오면 별도로 알려드리겠습니다.`,
        replacementSlackId,
      );

      return NextResponse.json({ ok: true });
    }

    // ─── 추출 유형: 마케팅 / 공지성 → Google Sheet → Job Queue ───
    if (actionId === "extract_marketing" || actionId === "extract_notice") {
      const extractType = actionId === "extract_marketing" ? "marketing" : "notice";
      const extractLabel = actionId === "extract_marketing" ? "마케팅 수신용" : "공지성 수신용";
      const meta = value;

      // shop_seq 결정: JIRA 구글시트 → Slack 메시지 파싱 순서
      let shopSeq = "";
      let shopSeqSource = "slack";

      if (meta.ticket_key && isGoogleSheetsConfigured()) {
        try {
          const result = await extractShopSeqFromJira(meta.ticket_key);

          if (result?.type === "select_tab") {
            // 다중 탭 → 탭 선택 DM
            const tabButtons = result.tabs.map((tab, idx) => ({
              type: "button" as const,
              text: { type: "plain_text" as const, text: tab.title, emoji: true },
              action_id: `extract_tab_select_${idx}`,
              value: JSON.stringify({
                ...meta,
                extract_type: extractType,
                spreadsheet_id: result.spreadsheetId,
                tab_gid: String(tab.sheetId),
                tab_name: tab.title,
              }),
            }));

            await updateMessage(channelId, messageTs, [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `:clipboard: *${meta.ticket_key}* — *${extractLabel}* 선택됨\n\n:page_facing_up: 시트에 여러 탭이 있습니다. 추출할 탭을 선택해주세요:`,
                },
              },
              {
                type: "actions",
                block_id: "tab_select_actions",
                elements: tabButtons,
              },
            ], `${meta.ticket_key} — 탭 선택`);

            return NextResponse.json({ ok: true });
          }

          if (result?.type === "success") {
            shopSeq = result.shopSeq;
            shopSeqSource = `google-sheet (${result.tabName})`;
          }
        } catch (err) {
          console.error("[interact] Google Sheets shop_seq 추출 실패:", err);
        }
      }

      // Google Sheet에서 못 찾으면 Slack 파싱 값 사용
      if (!shopSeq) shopSeq = meta.shop_seq || "";
      if (!shopSeq) shopSeqSource = "slack";

      if (!shopSeq) {
        await sendDM(
          `⚠️ *${meta.ticket_key}* shop_seq를 찾을 수 없습니다.\nJIRA 이슈에 Google Sheets 링크가 있는지, 시트에 shop_seq 컬럼이 있는지 확인해주세요.`,
          user.id,
        );
        return NextResponse.json({ ok: true });
      }

      await createExtractionJob({
        extractType,
        extractLabel,
        shopSeq,
        shopSeqSource,
        meta,
        userId: user.id,
        channelId,
        messageTs,
      });

      return NextResponse.json({ ok: true });
    }

    // ─── 탭 선택 후 추출 진행 ───
    if (actionId.startsWith("extract_tab_select_")) {
      const meta = value;
      const extractType = meta.extract_type;
      const extractLabel = extractType === "marketing" ? "마케팅 수신용" : "공지성 수신용";

      try {
        const shopSeq = await fetchShopSeqFromSheet(meta.spreadsheet_id, meta.tab_gid);

        if (!shopSeq) {
          await sendDM(
            `⚠️ *${meta.ticket_key}* 선택한 탭 "${meta.tab_name}"에서 shop_seq를 찾을 수 없습니다.`,
            user.id,
          );
          return NextResponse.json({ ok: true });
        }

        await createExtractionJob({
          extractType,
          extractLabel,
          shopSeq,
          shopSeqSource: `google-sheet (${meta.tab_name})`,
          meta,
          userId: user.id,
          channelId,
          messageTs,
        });
      } catch (err) {
        console.error("[interact] 탭 선택 후 추출 실패:", err);
        await sendDM(`❌ *${meta.ticket_key}* 추출 중 오류: ${String(err).slice(0, 200)}`, user.id);
      }

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
