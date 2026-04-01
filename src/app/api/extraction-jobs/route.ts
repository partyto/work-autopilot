// GET /api/extraction-jobs — Worker가 폴링하는 pending job 목록
import { NextResponse } from "next/server";
import { getPendingJobs, markProcessing } from "@/lib/extraction-jobs";

export const dynamic = "force-dynamic";

export async function GET() {
  const pending = getPendingJobs();

  // 첫 번째 pending job을 processing으로 전환 후 반환
  if (pending.length > 0) {
    const job = pending[0];
    markProcessing(job.id);
    return NextResponse.json({ job });
  }

  return NextResponse.json({ job: null });
}
