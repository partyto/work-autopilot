// POST /api/extraction-jobs/complete — Worker가 추출 완료 후 xlsx 전달
// NAS 봇이 Excel 암호화 → JIRA 첨부 → Slack 답글 처리
import { NextRequest, NextResponse } from "next/server";
import { getJob, markCompleted, markFailed } from "@/lib/extraction-jobs";
import { protectExcel } from "@/lib/excel-protect";
import { attachFileToIssue } from "@/lib/integrations/jira";
import { sendDM, replyToThread } from "@/lib/integrations/slack";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { job_id, xlsx, error } = body;

    if (!job_id) {
      return NextResponse.json({ error: "job_id 필요" }, { status: 400 });
    }

    const job = getJob(job_id);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Worker에서 오류 발생 시
    if (error) {
      markFailed(job_id, error);

      // 스레드에 @비즈-예약PM 멘션 답글
      if (job.thread_ts && job.channel) {
        const errMsg = error.includes("SESSION_EXPIRED")
          ? `<!subteam^S07CRFNDZD4> *${job.ticket_key}* 추출에 실패하였습니다. QueryPie 세션이 만료되었으니 직접 추출해주세요.`
          : `<!subteam^S07CRFNDZD4> *${job.ticket_key}* 추출에 실패하였습니다. 직접 추출해주세요.\n오류: ${error.slice(0, 100)}`;
        await replyToThread(job.channel, job.thread_ts, errMsg);
      }
      return NextResponse.json({ ok: true });
    }

    if (!xlsx) {
      return NextResponse.json({ error: "xlsx (base64) 필요" }, { status: 400 });
    }

    // 1. Excel 암호화
    const xlsxBuffer = Buffer.from(xlsx, "base64");
    const protectedBuffer = await protectExcel(xlsxBuffer, "1234abcd");
    const filename = `${job.ticket_key}_${job.extract_type}.xlsx`;

    // 2. JIRA 첨부
    await attachFileToIssue(job.ticket_key, filename, protectedBuffer);

    // 3. #help-정보보안 스레드 완료 답글
    if (job.thread_ts && job.channel) {
      await replyToThread(
        job.channel,
        job.thread_ts,
        `:white_check_mark: *${job.ticket_key}* 데이터 추출이 완료되었습니다.`,
      );
    }

    // 4. 요청자에게 비밀번호 포함 DM
    if (job.requester_id) {
      await sendDM(
        `:page_facing_up: *${job.ticket_key}* 요청하신 데이터가 JIRA에 첨부되었습니다.\n:key: 파일 비밀번호: \`1234abcd\``,
        job.requester_id,
      );
    }

    // 5. 스레드 원작성자가 요청자와 다른 경우 추가 DM
    if (job.thread_starter_id && job.thread_starter_id !== job.requester_id) {
      await sendDM(
        `:page_facing_up: *${job.ticket_key}* 요청하신 데이터가 JIRA에 첨부되었습니다.\n:key: 파일 비밀번호: \`1234abcd\``,
        job.thread_starter_id,
      );
    }

    markCompleted(job_id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[extraction-jobs/complete] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
