import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

// PATCH /api/tasks/reorder
// Body: { ids: string[] } — 표시 순서대로 정렬된 task ID 목록
export async function PATCH(request: NextRequest) {
  try {
    const { ids } = await request.json();

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids 배열이 필요합니다" }, { status: 400 });
    }

    // 각 task의 sort_order를 트랜잭션으로 원자적 업데이트
    await db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) {
        await tx.update(schema.tasks).set({ sortOrder: i }).where(eq(schema.tasks.id, ids[i]));
      }
    });

    return NextResponse.json({ success: true, updated: ids.length });
  } catch (error) {
    console.error("[Reorder API] 실패:", error);
    return NextResponse.json({ error: "순서 저장 실패" }, { status: 500 });
  }
}
