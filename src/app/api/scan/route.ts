import { NextRequest, NextResponse } from "next/server";
import { runDailyScan, executeApprovedActions } from "@/lib/engine";

// POST /api/scan - 수동 트리거 (대시보드 "지금 스캔" 버튼용)
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "scan";

  try {
    if (type === "execute") {
      await executeApprovedActions();
      return NextResponse.json({ success: true, type: "execute" });
    }

    const report = await runDailyScan();
    return NextResponse.json({ success: true, type: "scan", report });
  } catch (error) {
    console.error("Manual scan failed:", error);
    return NextResponse.json({ error: "스캔 실패: " + String(error) }, { status: 500 });
  }
}

// GET /api/scan - 설정 상태 확인
export async function GET() {
  const { isJiraConfigured } = await import("@/lib/integrations/jira");
  const { isSlackConfigured } = await import("@/lib/integrations/slack");

  return NextResponse.json({
    jira: isJiraConfigured(),
    slack: isSlackConfigured(),
    scheduler: true,
  });
}
