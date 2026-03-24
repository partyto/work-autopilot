import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

// PATCH /api/tasks/reorder
// Body: { ids: string[] } — 표시 순서대로 정렬된 task ID 목록
export async function PATCH(request: NextRequest) {
  try {
    const { ids } = await request.json();

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids 배열이 필요합니다" }, { status: 400 });
    }

    // 각 task의 sort_order를 인덱스 순서로 업데이트
    await Promise.all(
      ids.map((id: string, index: number) =>
        db
          .update(schema.tasks)
          .set({ sortOrder: index })
          .where(eq(schema.tasks.id, id))
      )
    );

    return NextResponse.json({ success: true, updated: ids.length });
  } catch (error) {
    console.error("[Reorder API] 실패:", error);
    return NextResponse.json({ error: "순서 저장 실패" }, { status: 500 });
  }
}
