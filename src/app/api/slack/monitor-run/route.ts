import { NextRequest, NextResponse } from "next/server";
import { runExtractionMonitor } from "@/lib/extraction-monitor";
import { getDutyState, saveDutyState } from "@/lib/duty-rotation";

export const dynamic = "force-dynamic";

// POST /api/slack/monitor-run — 수동 추출 모니터 실행 (테스트용)
// body: { channel?: string, duty_slack_id?: string }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const channel = body.channel || undefined;

    // 당번 임시 override (테스트용)
    if (body.duty_slack_id) {
      const state = getDutyState();
      const member = state.members.find((m) => m.slack_id === body.duty_slack_id);
      if (member) {
        const week = new Date().toISOString().slice(0, 10);
        state.vacation_overrides[week] = member.index;
        state.current_duty_index = member.index;
        state.current_duty_name = member.name;
        saveDutyState(state);
      }
    }

    await runExtractionMonitor(channel);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[monitor-run] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
