import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, desc, and, inArray } from "drizzle-orm";
import { generateId, nowLocal } from "@/lib/utils";
import type { Action, Task } from "@/db/schema";
import type { ActionStatus } from "@/db/types";

export const dynamic = "force-dynamic";

// GET /api/actions - 액션 목록 조회
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status"); // proposed, approved, executed, rejected
  const taskId = searchParams.get("taskId");

  try {
    const conditions = [];
    if (status) conditions.push(eq(schema.actions.status, status as ActionStatus));
    if (taskId) conditions.push(eq(schema.actions.taskId, taskId));

    const actionList = await db.query.actions.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [desc(schema.actions.proposedAt)],
    });

    // N+1 방지: 한 번에 전체 task 조회 후 그룹핑
    const taskIds = [...new Set(actionList.map((a: Action) => a.taskId))];
    const taskMap = new Map<string, { id: string; title: string; status: string }>();
    if (taskIds.length > 0) {
      const taskList = await db.query.tasks.findMany({
        where: inArray(schema.tasks.id, taskIds),
        columns: { id: true, title: true, status: true },
      });
      for (const t of taskList) {
        taskMap.set(t.id, t);
      }
    }
    const actionsWithTask = actionList.map((action: Action) => ({
      ...action,
      task: taskMap.get(action.taskId) || null,
    }));

    return NextResponse.json(actionsWithTask);
  } catch (error) {
    console.error("Failed to fetch actions:", error);
    return NextResponse.json({ error: "액션 목록 조회 실패" }, { status: 500 });
  }
}

// POST /api/actions - 새 액션 제안 (Scheduled Task에서 호출)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // 배열로 여러 액션 한번에 생성 가능
    const items = Array.isArray(body) ? body : [body];
    const created = [];

    for (const item of items) {
      const { taskId, actionType, description, payload } = item;

      if (!taskId || !actionType || !description) {
        continue; // 필수 필드 없으면 스킵
      }

      const actionId = generateId();
      const now = nowLocal();

      await db.insert(schema.actions).values({
        id: actionId,
        taskId,
        actionType,
        description,
        payload: payload ? JSON.stringify(payload) : null,
        status: "proposed",
        proposedAt: now,
      });

      const action = await db.query.actions.findFirst({
        where: eq(schema.actions.id, actionId),
      });
      if (action) created.push(action);
    }

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("Failed to create actions:", error);
    return NextResponse.json({ error: "액션 생성 실패" }, { status: 500 });
  }
}
