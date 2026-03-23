import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { nowLocal } from "@/lib/utils";

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
