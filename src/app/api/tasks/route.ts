import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, desc, and, asc } from "drizzle-orm";
import { generateId, nowLocal } from "@/lib/utils";
import type { Task } from "@/db/schema";
import * as jira from "@/lib/integrations/jira";
import * as gcal from "@/lib/integrations/gcal";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const includeLinks = searchParams.get("includeLinks") !== "false";

  try {
    let conditions = [];
    if (status && status !== "all") {
      conditions.push(eq(schema.tasks.status, status as any));
    }

    const taskList = await db.query.tasks.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [asc(schema.tasks.sortOrder), desc(schema.tasks.createdAt)],
    });

    if (includeLinks) {
      const tasksWithLinks = await Promise.all(
        taskList.map(async (task: Task) => {
          const links = await db.query.taskLinks.findMany({
            where: eq(schema.taskLinks.taskId, task.id),
          });
          return { ...task, links };
        })
      );
      return NextResponse.json(tasksWithLinks);
    }

    return NextResponse.json(taskList);
  } catch (error) {
    console.error("Failed to fetch tasks:", error);
    return NextResponse.json({ error: "할일 목록 조회 실패" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      title,
      description,
      priority = "medium",
      dueDate,
      sourceType = "manual",
      jiraIssueKey,
      slackThreadUrl,
      createJiraIssue = false,
      jiraProjectKey = "BIZWAIT",
      jiraIssueTypeName = "Task",
      jiraFields,
    } = body;

    if (!title || title.trim() === "") {
      return NextResponse.json({ error: "제목은 필수입니다" }, { status: 400 });
    }

    const taskId = generateId();
    const now = nowLocal();

    await db.insert(schema.tasks).values({
      id: taskId,
      title: title.trim(),
      description: description?.trim() || null,
      status: "pending",
      priority,
      sourceType,
      dueDate: dueDate || null,
      createdAt: now,
      updatedAt: now,
    });

    let finalJiraKey = jiraIssueKey?.trim().toUpperCase() || null;

    if (!finalJiraKey && createJiraIssue && jira.isJiraConfigured()) {
      try {
        const created = await jira.createIssue({
          projectKey: jiraProjectKey,
          issueTypeName: jiraIssueTypeName,
          fields: jiraFields || {
            summary: title.trim(),
            description: description?.trim() || undefined,
            duedate: dueDate || undefined,
            assignee: jira.getMyAccountId(),
          },
        });
        finalJiraKey = created.key;
      } catch (err) {
        console.error("[Tasks API] Jira 이슈 생성 실패:", err);
      }
    }

    if (finalJiraKey) {
      await db.insert(schema.taskLinks).values({
        id: generateId(),
        taskId,
        linkType: "jira",
        jiraIssueKey: finalJiraKey,
        jiraIssueUrl: `https://catchtable.atlassian.net/browse/${finalJiraKey}`,
        jiraProjectKey: finalJiraKey.split("-")[0],
        createdAt: now,
      });
    }

    if (dueDate && gcal.isGcalConfigured()) {
      try {
        const { id: gcalEventId } = await gcal.createEvent(
          title.trim(),
          dueDate,
          description?.trim(),
        );
        await db.insert(schema.taskLinks).values({
          id: generateId(),
          taskId,
          linkType: "gcal" as any,
          gcalEventId,
          gcalCalendarId: gcal.GCAL_CALENDAR_ID,
          createdAt: now,
        });
      } catch (err) {
        console.error("[Tasks API] 캘린더 이벤트 생성 실패:", err);
      }
    }

    if (slackThreadUrl) {
      const parsed = parseSlackUrl(slackThreadUrl);
      await db.insert(schema.taskLinks).values({
        id: generateId(),
        taskId,
        linkType: "slack_thread",
        slackChannelId: parsed?.channelId || null,
        slackThreadTs: parsed?.threadTs || null,
        slackThreadUrl: slackThreadUrl.trim(),
        createdAt: now,
      });
    }

    const created = await db.query.tasks.findFirst({
      where: eq(schema.tasks.id, taskId),
    });
    const links = await db.query.taskLinks.findMany({
      where: eq(schema.taskLinks.taskId, taskId),
    });

    return NextResponse.json({ ...created, links }, { status: 201 });
  } catch (error) {
    console.error("Failed to create task:", error);
    return NextResponse.json({ error: "할일 생성 실패" }, { status: 500 });
  }
}

function parseSlackUrl(url: string): { channelId: string; threadTs: string } | null {
  try {
    const match = url.match(/archives\/([A-Z0-9]+)\/p(\d+)/);
    if (match) {
      const channelId = match[1];
      const rawTs = match[2];
      const threadTs = rawTs.slice(0, 10) + "." + rawTs.slice(10);
      return { channelId, threadTs };
    }
    return null;
  } catch {
    return null;
  }
}
