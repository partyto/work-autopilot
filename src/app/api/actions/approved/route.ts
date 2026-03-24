import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import type { Action } from "@/db/schema";

// GET /api/actions/approved - 승인됐지만 아직 실행되지 않은 액션 조회
export async function GET() {
  try {
    const approvedActions = await db.query.actions.findMany({
      where: eq(schema.actions.status, "approved" as any),
    });

    const actionsWithContext = await Promise.all(
      approvedActions.map(async (action: Action) => {
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
