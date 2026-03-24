import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export async function PATCH(request: NextRequest) {
  try {
    const { ids } = await request.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids 배열이 필요합니다" }, { status: 400 });
    }
    await Promise.all(
      ids.map((id: string, index: number) =>
        db.update(schema.tasks).set({ sortOrder: index }).where(eq(schema.tasks.id, id))
      )
    );
    return NextResponse.json({ success: true, updated: ids.length });
  } catch (error) {
    console.error("[Reorder API] 실패:", error);
    return NextResponse.json({ error: "순서 저장 실패" }, { status: 500 });
  }
}
