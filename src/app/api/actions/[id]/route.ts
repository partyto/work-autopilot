import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { nowLocal } from "@/lib/utils";
import { executeApprovedActions } from "@/lib/engine";

// PATCH /api/actions/[id] - 액션 상태 변경 (승인/거절/실행완료)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const now = nowLocal();

    const updateData: Record<string, any> = {};

    if (body.status) {
      updateData.status = body.status;
      if (body.status === "executed") {
        updateData.executedAt = now;
      }
    }

    if (body.resultLink) {
      updateData.resultLink = body.resultLink;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "변경할 내용이 없습니다" }, { status: 400 });
    }

    await db
      .update(schema.actions)
      .set(updateData)
      .where(eq(schema.actions.id, id));

    // 승인 시 즉시 실행
    if (body.status === "approved") {
      try {
        await executeApprovedActions();
      } catch (execError) {
        console.error("[Actions API] 승인 후 즉시 실행 실패:", execError);
      }
    }

    // 거절 시: todo_create placeholder task 삭제
    if (body.status === "rejected") {
      const action = await db.query.actions.findFirst({
        where: eq(schema.actions.id, id),
        columns: { actionType: true, taskId: true },
      });
      if (action?.actionType === "todo_create") {
        await db.delete(schema.tasks).where(eq(schema.tasks.id, action.taskId));
      }
    }

    const updated = await db.query.actions.findFirst({
      where: eq(schema.actions.id, id),
    });

    if (!updated) {
      return NextResponse.json({ error: "액션을 찾을 수 없습니다" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update action:", error);
    return NextResponse.json({ error: "액션 업데이트 실패" }, { status: 500 });
  }
}

// DELETE /api/actions/[id] - 액션 삭제
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    await db.delete(schema.actions).where(eq(schema.actions.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete action:", error);
    return NextResponse.json({ error: "액션 삭제 실패" }, { status: 500 });
  }
}
