import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, and } from "drizzle-orm";
import { nowLocal } from "@/lib/utils";
import * as jira from "@/lib/integrations/jira";
import * as slack from "@/lib/integrations/slack";
import { TODO_TO_JIRA } from "@/lib/status-mapping";
import { isValidTaskStatus, isValidPriority } from "@/db/types";

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
    let _warnings: string[] | undefined;

    if (body.title !== undefined) updateData.title = body.title.trim();
    if (body.description !== undefined) updateData.description = body.description?.trim() || null;
    if (body.status !== undefined) {
      if (!isValidTaskStatus(body.status)) {
        return NextResponse.json({ error: `유효하지 않은 상태: ${body.status}` }, { status: 400 });
      }
      updateData.status = body.status;
      if (body.status === "done") {
        updateData.completedAt = now;
      } else {
        updateData.completedAt = null;
      }
    }
    if (body.priority !== undefined) {
      if (!isValidPriority(body.priority)) {
        return NextResponse.json({ error: `유효하지 않은 우선순위: ${body.priority}` }, { status: 400 });
      }
      updateData.priority = body.priority;
    }
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
        const targetJiraStatus = TODO_TO_JIRA[body.status];
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
            console.error(`[Task PATCH] Jira sync failed for ${jiraLink.jiraIssueKey}:`, e);
            _warnings = _warnings || [];
            _warnings.push(`Jira ${jiraLink.jiraIssueKey} 상태 동기화 실패: ${e}`);
          }
        }
      }
    }

    // 상태 변경 시 Slack 리액션 추가
    if (body.status !== undefined && slack.isSlackConfigured()) {
      const slackLink = links.find((l) => l.linkType === "slack_thread");
      if (slackLink?.slackChannelId && slackLink?.slackThreadTs) {
        const emoji =
          body.status === "done" ? "완료_"
          : body.status === "in_progress" || body.status === "in_qa" ? "확인중2"
          : null;
        if (emoji) {
          slack.addReaction(slackLink.slackChannelId, slackLink.slackThreadTs, emoji).catch((e) => {
            if (!String(e).includes("already_reacted")) {
              console.warn("[Task PATCH] Slack reaction failed:", e);
            }
          });
        }
      }
    }

    // 기한 변경 시 Jira 기한 동기화
    if (body.dueDate !== undefined && jira.isJiraConfigured()) {
      const jiraLink = links.find((l) => l.linkType === "jira");
      if (jiraLink?.jiraIssueKey) {
        try {
          await jira.updateIssue(jiraLink.jiraIssueKey, {
            duedate: body.dueDate || null,
          });
          console.log(`[Task PATCH] Jira ${jiraLink.jiraIssueKey} 기한 → ${body.dueDate || "없음"}`);
        } catch (e) {
          console.error(`[Task PATCH] Jira due date sync failed for ${jiraLink.jiraIssueKey}:`, e);
          _warnings = _warnings || [];
          _warnings.push(`Jira ${jiraLink.jiraIssueKey} 기한 동기화 실패: ${e}`);
        }
      }
    }

    const response: Record<string, any> = { ...updated, links };
    if (_warnings?.length) response._warnings = _warnings;
    return NextResponse.json(response);
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
