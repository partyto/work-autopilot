import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, and, notInArray, isNotNull, lt, or, like } from "drizzle-orm";
import { toBusinessDateStr } from "@/lib/holidays";
import { getCarriedOverTasks } from "@/lib/workflow";

export const dynamic = "force-dynamic";

// GET /api/daily/preview?type=sod|eod
// Slack 발송 없이 모달에 보여줄 데이터만 반환
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") as "sod" | "eod" | null;
  if (type !== "sod" && type !== "eod") {
    return NextResponse.json({ error: "type은 'sod' 또는 'eod'여야 합니다" }, { status: 400 });
  }

  try {
    const todayStr = toBusinessDateStr(new Date()); // 05:00 이전은 전날로 취급

    if (type === "sod") {
      const [carriedOver, dueToday, overdueNow, activeStatuses] = await Promise.all([
        getCarriedOverTasks(todayStr),
        db.select({ id: schema.tasks.id, title: schema.tasks.title, status: schema.tasks.status, priority: schema.tasks.priority, dueDate: schema.tasks.dueDate })
          .from(schema.tasks).where(
            and(eq(schema.tasks.dueDate, todayStr), notInArray(schema.tasks.status, ["done", "cancelled"]))
          ),
        db.select({ id: schema.tasks.id, title: schema.tasks.title, priority: schema.tasks.priority, dueDate: schema.tasks.dueDate })
          .from(schema.tasks).where(
            and(isNotNull(schema.tasks.dueDate), lt(schema.tasks.dueDate, todayStr), notInArray(schema.tasks.status, ["done", "cancelled"]))
          ),
        db.select({ status: schema.tasks.status }).from(schema.tasks).where(
          or(eq(schema.tasks.status, "in_progress"), eq(schema.tasks.status, "in_qa"), eq(schema.tasks.status, "pending"))
        ),
      ]);

      const inProgressCount = activeStatuses.filter((t) => t.status === "in_progress" || t.status === "in_qa").length;
      const pendingCount = activeStatuses.filter((t) => t.status === "pending").length;

      return NextResponse.json({
        carriedOver: carriedOver.map((t) => ({ id: t.id, title: t.title, status: t.currentStatus, priority: t.priority })),
        dueToday,
        overdueNow,
        inProgressCount,
        pendingCount,
        todayStr,
      });
    }

    // EOD preview
    const [completedToday, incomplete, overdue] = await Promise.all([
      db.select({ id: schema.tasks.id, title: schema.tasks.title, completedAt: schema.tasks.completedAt })
        .from(schema.tasks).where(
          and(eq(schema.tasks.status, "done"), like(schema.tasks.completedAt, `${todayStr}%`))
        ),
      db.select({ id: schema.tasks.id, title: schema.tasks.title, status: schema.tasks.status, priority: schema.tasks.priority, dueDate: schema.tasks.dueDate })
        .from(schema.tasks).where(
          or(eq(schema.tasks.status, "pending"), eq(schema.tasks.status, "in_progress"), eq(schema.tasks.status, "in_qa"))
        ),
      db.select({ id: schema.tasks.id, title: schema.tasks.title, priority: schema.tasks.priority, dueDate: schema.tasks.dueDate })
        .from(schema.tasks).where(
          and(isNotNull(schema.tasks.dueDate), lt(schema.tasks.dueDate, todayStr), notInArray(schema.tasks.status, ["done", "cancelled"]))
        ),
    ]);

    return NextResponse.json({ completedToday, incomplete, overdue, todayStr });
  } catch (err) {
    console.error("[API/daily/preview] error:", err);
    return NextResponse.json({ error: "조회 실패" }, { status: 500 });
  }
}
