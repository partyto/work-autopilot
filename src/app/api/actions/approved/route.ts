import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

// GET /api/actions/approved - 승인됐지만 아직 실행되지 않은 액션 조회
// Scheduled Task(실행 엔진)가 이 엔드포인트를 호출해서 실행할 액션 목록을 가져감
export async function GET() {
  try {
    const approvedActions = await db.query.actions.findMany({
      where: eq(schema.actions.status, "approved" as any),
    });

    // 각 액션에 연결된 task + link 정보 함께 반환
    const actionsWithContext = await Promise.all(
      approvedActions.map(async (action) => {
        const task = await db.query.tasks.findFirst({
          where: eq(schema.tasks.id, action.taskId),
        });
        const links = task
          ? await db.query.taskLinks.findMany({
              where: eq(schema.taskLinks.taskId, task.id),
            })
          : [];

        return {
          ...action,
          payload: action.payload ? JSON.parse(action.payload) : null,
          task: task ? { id: task.id, title: task.title, status: task.status } : null,
          links,
        };
      })
    );

    return NextResponse.json(actionsWithContext);
  } catch (error) {
    console.error("Failed to fetch approved actions:", error);
    return NextResponse.json({ error: "승인된 액션 조회 실패" }, { status: 500 });
  }
}
