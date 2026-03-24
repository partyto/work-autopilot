import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { nowLocal } from "@/lib/utils";

// GET /api/tasks/[id] - 단일 할일 조회
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const task = await db.query.tasks.findFirst({
      where: eq(schema.tasks.id, id),
    });

    if (!task) {
      return NextResponse.json({ error: "할일을 찾을 수 없습니다" }, { status: 404 });
    }

    const links = await db.query.taskLinks.findMany({
      where: eq(schema.taskLinks.taskId, id),
    });

    return NextResponse.json({ ...task, links });
  } catch (error) {
    console.error("Failed to fetch task:", error);
    return NextResponse.json({ error: "할일 조회 실패" }, { status: 500 });
  }
}

// PATCH /api/tasks/[id] - 할일 수정
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const now = nowLocal();

    const updateData: Record<string, any> = { updatedAt: now };

    if (body.title !== undefined) updateData.title = body.title.trim();
    if (body.description !== undefined) updateData.description = body.description?.trim() || null;
    if (body.status !== undefined) {
      updateData.status = body.status;
      if (body.status === "done") {
        updateData.completedAt = now;
      } else {
        updateData.completedAt = null;
      }
    }
    if (body.priority !== undefined) updateData.priority = body.priority;
    if (body.dueDate !== undefined) updateData.dueDate = body.dueDate || null;

    await db
      .update(schema.tasks)
      .set(updateData)
      .where(eq(schema.tasks.id, id));

    const updated = await db.query.tasks.findFirst({
      where: eq(schema.tasks.id, id),
    });

    if (!updated) {
      return NextResponse.json({ error: "할일을 찾을 수 없습니다" }, { status: 404 });
    }

    const links = await db.query.taskLinks.findMany({
      where: eq(schema.taskLinks.taskId, id),
    });

    return NextResponse.json({ ...updated, links });
  } catch (error) {
    console.error("Failed to update task:", error);
    return NextResponse.json({ error: "할일 수정 실패" }, { status: 500 });
  }
}

// DELETE /api/tasks/[id] - 할일 삭제
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    await db.delete(schema.tasks).where(eq(schema.tasks.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete task:", error);
    return NextResponse.json({ error: "할일 삭제 실패" }, { status: 500 });
  }
}
