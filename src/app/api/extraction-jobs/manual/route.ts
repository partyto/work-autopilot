// POST /api/extraction-jobs/manual — 수동으로 추출 job 생성 (어드민용)
// body: { ticket_key, extract_type, requester_id?, thread_ts?, channel?, thread_starter_id? }
import { NextRequest, NextResponse } from "next/server";
import { createJob } from "@/lib/extraction-jobs";
import { extractShopSeqFromJira, fetchShopSeqFromSheet, isGoogleSheetsConfigured } from "@/lib/google-sheets";
import { generateSQL } from "@/lib/duty-rotation";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      ticket_key,
      extract_type,
      requester_id = "",
      thread_ts = "",
      channel = "",
      thread_starter_id,
      tab_gid,
      spreadsheet_id,
    } = body;

    if (!ticket_key || !extract_type) {
      return NextResponse.json({ error: "ticket_key, extract_type 필수" }, { status: 400 });
    }
    if (extract_type !== "marketing" && extract_type !== "notice") {
      return NextResponse.json({ error: "extract_type은 marketing 또는 notice" }, { status: 400 });
    }

    // shop_seq 결정
    let shopSeq = body.shop_seq || "";
    let shopSeqSource = "manual";

    if (!shopSeq && isGoogleSheetsConfigured()) {
      // tab_gid가 직접 지정된 경우
      if (spreadsheet_id && tab_gid) {
        shopSeq = await fetchShopSeqFromSheet(spreadsheet_id, tab_gid);
        shopSeqSource = `google-sheet (tab_gid:${tab_gid})`;
      } else {
        const result = await extractShopSeqFromJira(ticket_key);
        if (result?.type === "success") {
          shopSeq = result.shopSeq;
          shopSeqSource = `google-sheet (${result.tabName})`;
        } else if (result?.type === "select_tab") {
          // 탭 목록 반환 — 클라이언트가 tab_gid 선택 후 재요청
          return NextResponse.json({
            need_tab_select: true,
            spreadsheet_id: result.spreadsheetId,
            tabs: result.tabs,
          });
        }
      }
    }

    if (!shopSeq) {
      return NextResponse.json({ error: "shop_seq를 찾을 수 없습니다. JIRA 이슈에 Google Sheets 링크가 있는지 확인하세요." }, { status: 400 });
    }

    const sql = generateSQL(extract_type as "marketing" | "notice", shopSeq);
    const job = createJob({
      ticket_key,
      shop_seq: shopSeq,
      extract_type: extract_type as "marketing" | "notice",
      thread_ts,
      channel,
      requester_id,
      pm_user_id: requester_id,
      thread_starter_id,
      sql,
    });

    console.log(`[manual] Job 생성: ${job.id} (${ticket_key} / ${extract_type} / shop_seq ${shopSeq.split(",").length}개, ${shopSeqSource})`);

    return NextResponse.json({
      ok: true,
      job_id: job.id,
      ticket_key,
      extract_type,
      shop_seq_count: shopSeq.split(",").length,
      shop_seq_source: shopSeqSource,
    });
  } catch (err) {
    console.error("[extraction-jobs/manual] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
