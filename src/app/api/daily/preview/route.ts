import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, and } from "drizzle-orm";
import { toKSTDateStr, prevWorkingDay } from "@/lib/holidays";

export const dynamic = "force-dynamic";

// GET /api/daily/preview?type=sod|eod
// Slack 발송 없이 모달에 보여줄 데이터만 반환
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") as "sod" | "eod" | null;
  if (type !== "sod" && type !== "eod") {
    return NextResponse.json({ error: "type은 'sod' 또는 'eod'여야 합니다" }, { status: 400 });
  }

  try {
    const today = new Date();
    const todayStr = toKSTDateStr(today);
    const tasks = await db.select().from(schema.tasks);

    if (type === "sod") {
      // 어제 EOD에서 이관된 항목 조회
      const yesterday = prevWorkingDay(today);
      const yesterdayStr = toKSTDateStr(yesterday);

      const yesterdayEod = await db.query.workflowLogs.findFirst({
        where: (w) => and(eq(w.date, yesterdayStr), eq(w.type, "eod")),
      });

      let carriedOver: typeof tasks = [];
      if (yesterdayEod?.summary) {
        try {
          const eodData = JSON.parse(yesterdayEod.summary) as { carriedOverIds: string[] };
          const taskMap = new Map(tasks.map((t) => [t.id, t]));
          carriedOver = eodData.carriedOverIds
            .map((id) => taskMap.get(id))
            .filter((t): t is (typeof tasks)[number] => !!t && t.status !== "done" && t.status !== "cancelled");
        } catch {
          // 파싱 실패 시 현재 미완료 항목으로 fallback
        }
      }

      // EOD 로그 없으면 현재 미완료 전체
      if (carriedOver.length === 0) {
        carriedOver = tasks.filter(
          (t) => t.status === "pending" || t.status === "in_progress" || t.status === "in_qa"
        );
      }

      const dueToday = tasks.filter(
        (t) =>
          t.dueDate &&
          t.dueDate.slice(0, 10) === todayStr &&
          t.status !== "done" &&
          t.status !== "cancelled"
      );

      const overdueNow = tasks.filter(
        (t) =>
          t.dueDate &&
          t.dueDate.slice(0, 10) < todayStr &&
          t.status !== "done" &&
          t.status !== "cancelled"
      );

      const inProgressCount = tasks.filter(
        (t) => t.status === "in_progress" || t.status === "in_qa"
      ).length;
      const pendingCount = tasks.filter((t) => t.status === "pending").length;

      return NextResponse.json({
        carriedOver: carriedOver.map((t) => ({
          id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate,
        })),
        dueToday: dueToday.map((t) => ({
          id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate,
        })),
        overdueNow: overdueNow.map((t) => ({
          id: t.id, title: t.title, priority: t.priority, dueDate: t.dueDate,
        })),
        inProgressCount,
        pendingCount,
        todayStr,
      });
    }

    // EOD preview
    const completedToday = tasks.filter(
      (t) => t.status === "done" && t.completedAt && t.completedAt.slice(0, 10) === todayStr
    );

    const incomplete = tasks.filter(
      (t) => t.status === "pending" || t.status === "in_progress" || t.status === "in_qa"
    );

    const overdue = tasks.filter(
      (t) =>
        t.dueDate &&
        t.dueDate.slice(0, 10) < todayStr &&
        t.status !== "done" &&
        t.status !== "cancelled"
    );

    return NextResponse.json({
      completedToday: completedToday.map((t) => ({
        id: t.id, title: t.title, completedAt: t.completedAt,
      })),
      incomplete: incomplete.map((t) => ({
        id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate,
      })),
      overdue: overdue.map((t) => ({
        id: t.id, title: t.title, priority: t.priority, dueDate: t.dueDate,
      })),
      todayStr,
    });
  } catch (err) {
    console.error("[API/daily/preview] error:", err);
    return NextResponse.json({ error: "조회 실패" }, { status: 500 });
  }
}
