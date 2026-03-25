import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, and } from "drizzle-orm";
import { nowLocal, todayDate, generateId } from "@/lib/utils";

// POST /api/sync - 동기화 상태 업데이트 (Scheduled Task에서 호출)
// Jira/Slack 스캔 결과를 받아서 DB에 반영
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type } = body;

    if (type === "jira_status_update") {
      // Jira 이슈 상태가 변경된 경우 task_links 업데이트 + 액션 제안
      return handleJiraStatusUpdate(body);
    }

    if (type === "slack_commitment_detected") {
      // Slack에서 미처리 커밋먼트 감지 → 새 TO-DO 제안
      return handleSlackCommitment(body);
    }

    if (type === "bulk_jira_sync") {
      // 모든 Jira 링크의 상태를 일괄 업데이트
      return handleBulkJiraSync(body);
    }

    return NextResponse.json({ error: "알 수 없는 sync 타입" }, { status: 400 });
  } catch (error) {
    console.error("Sync failed:", error);
    return NextResponse.json({ error: "동기화 실패" }, { status: 500 });
  }
}

// Jira 이슈 상태 변경 처리
async function handleJiraStatusUpdate(body: {
  jiraIssueKey: string;
  newJiraStatus: string;
  previousJiraStatus?: string;
}) {
  const { jiraIssueKey, newJiraStatus, previousJiraStatus } = body;
  const now = nowLocal();

  // 해당 Jira 이슈와 연결된 링크 찾기
  const link = await db.query.taskLinks.findFirst({
    where: and(
      eq(schema.taskLinks.linkType, "jira"),
      eq(schema.taskLinks.jiraIssueKey, jiraIssueKey)
    ),
  });

  if (!link) {
    return NextResponse.json({ message: "매핑된 TO-DO 없음", matched: false });
  }

  // 링크 상태 업데이트
  await db
    .update(schema.taskLinks)
    .set({ jiraStatus: newJiraStatus, lastSyncedAt: now })
    .where(eq(schema.taskLinks.id, link.id));

  // Jira가 DONE인데 TO-DO가 done이 아니면 → todo_complete 액션 제안
  const task = await db.query.tasks.findFirst({
    where: eq(schema.tasks.id, link.taskId),
  });

  if (task && newJiraStatus?.toUpperCase() === "DONE" && task.status !== "done") {
    await db.insert(schema.actions).values({
      id: generateId(),
      taskId: task.id,
      actionType: "todo_complete",
      description: `Jira ${jiraIssueKey}가 DONE으로 변경됨 → TO-DO 완료 처리 제안`,
      payload: JSON.stringify({ jiraIssueKey, newJiraStatus }),
      status: "proposed",
      proposedAt: now,
    });
  }

  // TO-DO가 done인데 Jira가 아직 IN PROGRESS면 → jira_transition 액션 제안
  if (task && task.status === "done" && newJiraStatus?.toUpperCase() !== "DONE") {
    await db.insert(schema.actions).values({
      id: generateId(),
      taskId: task.id,
      actionType: "jira_transition",
      description: `TO-DO가 완료인데 Jira ${jiraIssueKey}는 ${newJiraStatus} → Jira DONE 전환 제안`,
      payload: JSON.stringify({ jiraIssueKey, targetStatus: "DONE" }),
      status: "proposed",
      proposedAt: now,
    });
  }

  return NextResponse.json({ matched: true, taskId: link.taskId, actionsProposed: true });
}

// Slack 미처리 커밋먼트 감지 처리
async function handleSlackCommitment(body: {
  channelId: string;
  channelName?: string;
  threadTs: string;
  threadUrl: string;
  summary: string; // AI가 추출한 커밋먼트 요약
  confidence: number; // 0-1
}) {
  const { channelId, channelName, threadTs, threadUrl, summary, confidence } = body;
  const now = nowLocal();

  // 이미 이 스레드와 연결된 TO-DO가 있는지 확인
  const existingLink = await db.query.taskLinks.findFirst({
    where: and(
      eq(schema.taskLinks.linkType, "slack_thread"),
      eq(schema.taskLinks.slackChannelId, channelId),
      eq(schema.taskLinks.slackThreadTs, threadTs)
    ),
  });

  if (existingLink) {
    return NextResponse.json({ message: "이미 매핑된 스레드", matched: true, taskId: existingLink.taskId });
  }

  // confidence가 0.6 이상이면 → 새 TO-DO 생성 액션 제안
  if (confidence >= 0.6) {
    // placeholder task 생성 (FK 제약 충족)
    const placeholderTaskId = generateId();
    await db.insert(schema.tasks).values({
      id: placeholderTaskId,
      title: `[Slack] ${summary}`,
      description: `Slack #${channelName || "DM"}에서 감지된 커밋먼트`,
      sourceType: "slack_detected",
      status: "pending",
      priority: "medium",
      createdAt: now,
      updatedAt: now,
    });

    const actionId = generateId();
    await db.insert(schema.actions).values({
      id: actionId,
      taskId: placeholderTaskId,
      actionType: "todo_create",
      description: `Slack에서 미처리 커밋먼트 감지: ${summary}`,
      payload: JSON.stringify({ channelId, channelName, threadTs, threadUrl, summary, confidence }),
      status: "proposed",
      proposedAt: now,
    });

    return NextResponse.json({ matched: false, actionProposed: true, actionId });
  }

  return NextResponse.json({ matched: false, actionProposed: false, reason: "confidence 낮음" });
}

// 전체 Jira 링크 일괄 동기화
async function handleBulkJiraSync(body: {
  updates: Array<{ jiraIssueKey: string; jiraStatus: string }>;
}) {
  const { updates } = body;
  const now = nowLocal();
  let synced = 0;
  let actionsProposed = 0;

  for (const { jiraIssueKey, jiraStatus } of updates) {
    const link = await db.query.taskLinks.findFirst({
      where: and(
        eq(schema.taskLinks.linkType, "jira"),
        eq(schema.taskLinks.jiraIssueKey, jiraIssueKey)
      ),
    });

    if (!link) continue;

    const previousStatus = link.jiraStatus;

    // 상태가 변경된 경우에만 업데이트
    if (previousStatus !== jiraStatus) {
      await db
        .update(schema.taskLinks)
        .set({ jiraStatus, lastSyncedAt: now })
        .where(eq(schema.taskLinks.id, link.id));

      // 불일치 감지 → 액션 제안
      const task = await db.query.tasks.findFirst({
        where: eq(schema.tasks.id, link.taskId),
      });

      if (task) {
        // Jira DONE ↔ TO-DO not done
        if (jiraStatus.toUpperCase() === "DONE" && task.status !== "done") {
          await db.insert(schema.actions).values({
            id: generateId(),
            taskId: task.id,
            actionType: "todo_complete",
            description: `Jira ${jiraIssueKey}가 DONE → TO-DO 완료 처리 제안`,
            payload: JSON.stringify({ jiraIssueKey, jiraStatus }),
            status: "proposed",
            proposedAt: now,
          });
          actionsProposed++;
        }
        // TO-DO done ↔ Jira not DONE
        else if (task.status === "done" && jiraStatus.toUpperCase() !== "DONE") {
          await db.insert(schema.actions).values({
            id: generateId(),
            taskId: task.id,
            actionType: "jira_transition",
            description: `TO-DO 완료인데 Jira ${jiraIssueKey}는 ${jiraStatus} → DONE 전환 제안`,
            payload: JSON.stringify({ jiraIssueKey, targetStatus: "DONE" }),
            status: "proposed",
            proposedAt: now,
          });
          actionsProposed++;
        }
      }

      synced++;
    }
  }

  return NextResponse.json({ synced, actionsProposed, total: updates.length });
}
