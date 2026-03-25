import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, and } from "drizzle-orm";
import { nowLocal } from "@/lib/utils";
import * as jira from "@/lib/integrations/jira";

// TO-DO 상태 → Jira 전환 이름 매핑
const TODO_TO_JIRA_STATUS: Record<string, string> = {
  done: "Done",
  in_progress: "In Progress",
  pending: "Backlog",
  in_qa: "In QA",
};

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

    // 상태 변경 시 Jira 즉시 동기화
    if (body.status !== undefined && jira.isJiraConfigured()) {
      const jiraLink = links.find((l) => l.linkType === "jira");
      if (jiraLink?.jiraIssueKey) {
        const targetJiraStatus = TODO_TO_JIRA_STATUS[body.status];
        if (targetJiraStatus) {
          try {
            const transitions = await jira.getTransitions(jiraLink.jiraIssueKey);
            const target = transitions.find(
              (t) => t.name.toUpperCase() === targetJiraStatus.toUpperCase() ||
                     t.to?.name?.toUpperCase() === targetJiraStatus.toUpperCase()
            );
            if (target) {
              await jira.transitionIssue(jiraLink.jiraIssueKey, target.id);
              // Jira 상태 캐시 업데이트
              await db.update(schema.taskLinks)
                .set({ jiraStatus: targetJiraStatus, lastSyncedAt: nowLocal() })
                .where(and(eq(schema.taskLinks.taskId, id), eq(schema.taskLinks.linkType, "jira")));
              console.log(`[Task PATCH] Jira ${jiraLink.jiraIssueKey} → ${targetJiraStatus}`);
            } else {
              console.warn(`[Task PATCH] Jira transition '${targetJiraStatus}' not found for ${jiraLink.jiraIssueKey}`);
            }
          } catch (e) {
            // Jira 동기화 실패해도 TO-DO 변경은 유지
            console.error(`[Task PATCH] Jira sync failed for ${jiraLink.jiraIssueKey}:`, e);
          }
        }
      }
    }

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
