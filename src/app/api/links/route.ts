import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { generateId, nowLocal } from "@/lib/utils";

export const dynamic = "force-dynamic";

// POST /api/links - TO-DO에 Jira/Slack 링크 추가
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, linkType, jiraIssueKey, slackThreadUrl, slackChannelId, slackThreadTs } = body;

    if (!taskId || !linkType) {
      return NextResponse.json({ error: "taskId와 linkType은 필수" }, { status: 400 });
    }

    const now = nowLocal();
    const linkId = generateId();

    if (linkType === "jira" && jiraIssueKey) {
      await db.insert(schema.taskLinks).values({
        id: linkId,
        taskId,
        linkType: "jira",
        jiraIssueKey: jiraIssueKey.trim().toUpperCase(),
        jiraIssueUrl: `https://catchtable.atlassian.net/browse/${jiraIssueKey.trim().toUpperCase()}`,
        jiraProjectKey: jiraIssueKey.split("-")[0],
        createdAt: now,
      });
    } else if (linkType === "slack_thread") {
      await db.insert(schema.taskLinks).values({
        id: linkId,
        taskId,
        linkType: "slack_thread",
        slackChannelId: slackChannelId || null,
        slackThreadTs: slackThreadTs || null,
        slackThreadUrl: slackThreadUrl || null,
        createdAt: now,
      });
    }

    const created = await db.query.taskLinks.findFirst({
      where: eq(schema.taskLinks.id, linkId),
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("Failed to create link:", error);
    return NextResponse.json({ error: "링크 생성 실패" }, { status: 500 });
  }
}

// DELETE /api/links?id=xxx - 링크 삭제
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id 필수" }, { status: 400 });
  }

  try {
    await db.delete(schema.taskLinks).where(eq(schema.taskLinks.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete link:", error);
    return NextResponse.json({ error: "링크 삭제 실패" }, { status: 500 });
  }
}
