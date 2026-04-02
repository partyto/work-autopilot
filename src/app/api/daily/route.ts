import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, desc } from "drizzle-orm";
import { runEndOfDay, recordStartOfDay } from "@/lib/workflow";
import { isWorkingDay, nextWorkingDay, toBusinessDateStr } from "@/lib/holidays";

export const dynamic = "force-dynamic";

/** 다음 워크플로 액션 및 예정 시각 계산 */
function computeWorkflowStatus(
  lastEodDate: string | null,
  lastSodDate: string | null,
) {
  const now = new Date();
  const todayStr = toBusinessDateStr(now); // 5시 이전은 전날로 취급
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kstHour = new Date(kstMs).getUTCHours() + new Date(kstMs).getUTCMinutes() / 60;

  // 다음 EOD: 오늘이 워킹 데이고 EOD 미실행 + 아직 19시 안됐으면 오늘, 아니면 다음 워킹 데이
  const eodDoneToday = lastEodDate === todayStr;
  const nextEodDate = (() => {
    if (!eodDoneToday && isWorkingDay(now)) {
      return todayStr;
    }
    return toBusinessDateStr(nextWorkingDay(now));
  })();
  const nextEodTime = `${nextEodDate}T19:00:00+09:00`;

  // 다음 SOD: 오늘이 워킹 데이고 SOD 미실행 + 아직 10시 안됐으면 오늘, 아니면 다음 워킹 데이
  const sodDoneToday = lastSodDate === todayStr;
  const nextSodDate = (() => {
    if (!sodDoneToday && isWorkingDay(now) && kstHour >= 5) {
      return todayStr;
    }
    return toBusinessDateStr(nextWorkingDay(now));
  })();
  const nextSodTime = `${nextSodDate}T10:00:00+09:00`;

  // nextAction: 마지막으로 실행된 것 기준으로 다음 것을 제시
  // EOD가 더 최신이면 → SOD가 다음, SOD가 더 최신이면 → EOD가 다음
  let nextAction: "eod" | "sod";
  if (!lastEodDate && !lastSodDate) {
    nextAction = "eod";
  } else if (!lastEodDate) {
    nextAction = "eod";
  } else if (!lastSodDate) {
    nextAction = "sod";
  } else if (lastEodDate >= lastSodDate) {
    nextAction = "sod";
  } else {
    nextAction = "eod";
  }

  return { nextEodDate, nextEodTime, nextSodDate, nextSodTime, nextAction };
}

// GET /api/daily — 워크플로 상태 조회
export async function GET() {
  try {
    const [lastEod, lastSod] = await Promise.all([
      db.query.workflowLogs.findFirst({
        where: (w) => eq(w.type, "eod"),
        orderBy: (w) => [desc(w.date)],
      }),
      db.query.workflowLogs.findFirst({
        where: (w) => eq(w.type, "sod"),
        orderBy: (w) => [desc(w.date)],
      }),
    ]);

    const status = computeWorkflowStatus(
      lastEod?.date ?? null,
      lastSod?.date ?? null,
    );

    return NextResponse.json({
      lastEod: lastEod
        ? { date: lastEod.date, createdAt: lastEod.createdAt, summary: lastEod.summary ? JSON.parse(lastEod.summary) : null }
        : null,
      lastSod: lastSod
        ? { date: lastSod.date, createdAt: lastSod.createdAt, summary: lastSod.summary ? JSON.parse(lastSod.summary) : null }
        : null,
      ...status,
    });
  } catch (err) {
    console.error("[API/daily] GET error:", err);
    return NextResponse.json({ error: "조회 실패" }, { status: 500 });
  }
}

// POST /api/daily — 수동 트리거
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const type = body.type as "eod" | "sod";

    if (type !== "eod" && type !== "sod") {
      return NextResponse.json({ error: "type은 'eod' 또는 'sod'여야 합니다" }, { status: 400 });
    }

    if (type === "eod") {
      const result = await runEndOfDay();
      return NextResponse.json({ success: true, message: result.message });
    } else {
      // SOD: Slack 없이 DB 기록만 (10시 넛지 스킵 목적)
      await recordStartOfDay();
      return NextResponse.json({ success: true, message: "하루 시작이 기록되었습니다." });
    }
  } catch (err) {
    console.error("[API/daily] POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
