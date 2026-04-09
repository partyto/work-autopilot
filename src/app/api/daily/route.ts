import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, desc } from "drizzle-orm";
import { runEndOfDay, runStartOfDay } from "@/lib/workflow";
import { isWorkingDay, nextWorkingDay, toBusinessDateStr } from "@/lib/holidays";

export const dynamic = "force-dynamic";

/** 다음 워크플로 액션 및 예정 시각 계산 */
function computeWorkflowStatus(
  lastEodDate: string | null,
  lastSodDate: string | null,
  lastEodCreatedAt: string | null,
  lastSodCreatedAt: string | null,
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
  // 날짜가 같으면 createdAt 타임스탬프로 비교 (같은 날 SOD→EOD 순서 판단)
  let nextAction: "eod" | "sod";
  if (!lastEodDate && !lastSodDate) {
    nextAction = "eod";
  } else if (!lastEodDate) {
    nextAction = "eod";
  } else if (!lastSodDate) {
    nextAction = "sod";
  } else if (lastEodDate !== lastSodDate) {
    nextAction = lastEodDate > lastSodDate ? "sod" : "eod";
  } else {
    // 같은 날짜: createdAt으로 최신 판단
    const eodTs = lastEodCreatedAt ?? "";
    const sodTs = lastSodCreatedAt ?? "";
    nextAction = eodTs >= sodTs ? "sod" : "eod";
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

    const parseSummary = (raw: string | null) => {
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    };

    const status = computeWorkflowStatus(
      lastEod?.date ?? null,
      lastSod?.date ?? null,
      lastEod?.createdAt ?? null,
      lastSod?.createdAt ?? null,
    );

    return NextResponse.json({
      lastEod: lastEod
        ? { date: lastEod.date, createdAt: lastEod.createdAt, summary: parseSummary(lastEod.summary) }
        : null,
      lastSod: lastSod
        ? { date: lastSod.date, createdAt: lastSod.createdAt, summary: parseSummary(lastSod.summary) }
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

    const result = type === "eod" ? await runEndOfDay() : await runStartOfDay();
    return NextResponse.json({ success: true, message: result.message });
  } catch (err) {
    console.error("[API/daily] POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
