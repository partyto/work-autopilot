import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, inArray } from "drizzle-orm";
import type { Action, Task, TaskLink } from "@/db/schema";
import type { ActionStatus } from "@/db/types";

export const dynamic = "force-dynamic";

// GET /api/actions/approved - 승인됐지만 아직 실행되지 않은 액션 조회
export async function GET() {
  try {
    const approvedActions = await db.query.actions.findMany({
      where: eq(schema.actions.status, "approved" as ActionStatus),
    });

    if (approvedActions.length === 0) {
      return NextResponse.json([]);
    }

    // N+1 방지: 한 번에 전체 조회
    const taskIds = [...new Set(approvedActions.map((a: Action) => a.taskId))];
    const [taskList, linkList] = await Promise.all([
      db.query.tasks.findMany({ where: inArray(schema.tasks.id, taskIds) }),
      db.query.taskLinks.findMany({ where: inArray(schema.taskLinks.taskId, taskIds) }),
    ]);
    const taskMap = new Map(taskList.map((t: Task) => [t.id, t]));
    const linksByTask = new Map<string, TaskLink[]>();
    for (const link of linkList) {
      const arr = linksByTask.get(link.taskId) || [];
      arr.push(link);
      linksByTask.set(link.taskId, arr);
    }

    const actionsWithContext = approvedActions.map((action: Action) => {
      const task = taskMap.get(action.taskId);
      return {
        ...action,
        payload: action.payload ? JSON.parse(action.payload) : null,
        task: task ? { id: task.id, title: task.title, status: task.status } : null,
        links: linksByTask.get(action.taskId) || [],
      };
    });

    return NextResponse.json(actionsWithContext);
  } catch (error) {
    console.error("Failed to fetch approved actions:", error);
    return NextResponse.json({ error: "승인된 액션 조회 실패" }, { status: 500 });
  }
}
