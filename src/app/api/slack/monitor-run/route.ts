import { NextRequest, NextResponse } from "next/server";
import { runExtractionMonitor } from "@/lib/extraction-monitor";

export const dynamic = "force-dynamic";

// POST /api/slack/monitor-run — 수동 추출 모니터 실행 (테스트용)
// body: { channel?: string }  — 기본값: #help-정보보안 (C07DAP4TL5T)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const channel = body.channel || undefined;
    await runExtractionMonitor(channel);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[monitor-run] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
