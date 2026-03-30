import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { nowLocal, generateId } from "@/lib/utils";
import { executeApprovedActions } from "@/lib/engine";

export const dynamic = "force-dynamic";

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

    // 거절 시: placeholder task를 cancelled로 변경 + taskLink 생성 (재스캔 시 중복 방지)
    if (body.status === "rejected") {
      const action = await db.query.actions.findFirst({
        where: eq(schema.actions.id, id),
        columns: { actionType: true, taskId: true, payload: true },
      });
      if (action?.actionType === "todo_create") {
        // placeholder task → cancelled
        await db.update(schema.tasks).set({ status: "cancelled", updatedAt: now })
          .where(eq(schema.tasks.id, action.taskId));

        // payload에서 threadTs/channelId 추출 → taskLink 생성 (재스캔 시 existingLink 체크에 걸리도록)
        try {
          const payload = JSON.parse(action.payload || "{}");
          if (payload.threadTs) {
            await db.insert(schema.taskLinks).values({
              id: generateId(),
              taskId: action.taskId,
              linkType: "slack_thread",
              slackThreadTs: payload.threadTs,
              slackChannelName: payload.channelId || null,
              slackThreadUrl: payload.threadUrl || null,
            }).onConflictDoNothing();
          }
          if (payload.jiraIssueKey) {
            await db.insert(schema.taskLinks).values({
              id: generateId(),
              taskId: action.taskId,
              linkType: "jira",
              jiraIssueKey: payload.jiraIssueKey,
              jiraIssueUrl: `https://catchtable.atlassian.net/browse/${payload.jiraIssueKey}`,
            }).onConflictDoNothing();
          }
        } catch { /* payload 파싱 실패 무시 */ }
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
