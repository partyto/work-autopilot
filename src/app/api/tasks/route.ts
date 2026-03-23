import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, desc, and, ne } from "drizzle-orm";
import { generateId, nowLocal } from "@/lib/utils";
import * as jira from "@/lib/integrations/jira";

// GET /api/tasks - 할일 목록 조회
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
      orderBy: [desc(schema.tasks.updatedAt)],
    });

    // 매핑 정보도 함께 조회
    if (includeLinks) {
      const tasksWithLinks = await Promise.all(
        taskList.map(async (task) => {
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
    return NextResponse.json(
      { error: "할일 목록 조회 실패" },
      { status: 500 }
    );
  }
}

// POST /api/tasks - 새 할일 생성
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      title,
      description,
      priority = "medium",
      dueDate,
      sourceType = "manual",
      // 매핑 정보 (옵션)
      jiraIssueKey,
      slackThreadUrl,
      // Jira 이슈 신규 생성 옵션
      createJiraIssue = false,
      jiraProjectKey = "BIZWAIT",
    } = body;

    if (!title || title.trim() === "") {
      return NextResponse.json(
        { error: "제목은 필수입니다" },
        { status: 400 }
      );
    }

    const taskId = generateId();
    const now = nowLocal();

    // 할일 생성
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

    // Jira 매핑 생성
    let finalJiraKey = jiraIssueKey?.trim().toUpperCase() || null;

    if (!finalJiraKey && createJiraIssue && jira.isJiraConfigured()) {
      // Jira 이슈 신규 생성
      try {
        const priorityMap: Record<string, string> = {
          high: "High",
          medium: "Medium",
          low: "Low",
        };
        const created = await jira.createIssue({
          projectKey: jiraProjectKey,
          summary: title.trim(),
          description: description?.trim() || undefined,
          priority: priorityMap[priority] || "Medium",
          assignToMe: true,
          dueDate: dueDate || undefined,
        });
        finalJiraKey = created.key;
        console.log(`[Tasks API] Jira 이슈 생성: ${created.key}`);
      } catch (err) {
        console.error("[Tasks API] Jira 이슈 생성 실패:", err);
        // Jira 생성 실패해도 TO-DO는 정상 생성
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

    // Slack 매핑 생성
    if (slackThreadUrl) {
      // Slack URL에서 channel_id와 thread_ts 추출 시도
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

    // 생성된 할일 + 매핑 반환
    const created = await db.query.tasks.findFirst({
      where: eq(schema.tasks.id, taskId),
    });
    const links = await db.query.taskLinks.findMany({
      where: eq(schema.taskLinks.taskId, taskId),
    });

    return NextResponse.json({ ...created, links }, { status: 201 });
  } catch (error) {
    console.error("Failed to create task:", error);
    return NextResponse.json(
      { error: "할일 생성 실패" },
      { status: 500 }
    );
  }
}

// Slack URL 파싱 헬퍼
function parseSlackUrl(url: string): { channelId: string; threadTs: string } | null {
  try {
    // https://wad-hq.slack.com/archives/C0992T55813/p1711234567890123
    const match = url.match(/archives\/([A-Z0-9]+)\/p(\d+)/);
    if (match) {
      const channelId = match[1];
      const rawTs = match[2];
      // Slack ts format: 1711234567.890123
      const threadTs = rawTs.slice(0, 10) + "." + rawTs.slice(10);
      return { channelId, threadTs };
    }
    return null;
  } catch {
    return null;
  }
}
