// Work Autopilot 핵심 엔진 — Jira/Slack 스캔 + 리포트 + 액션 실행
import { db, schema } from "@/db";
import { eq, and } from "drizzle-orm";
import { generateId, nowLocal, todayDate } from "@/lib/utils";
import * as jira from "@/lib/integrations/jira";
import * as slack from "@/lib/integrations/slack";
import * as gcal from "@/lib/integrations/gcal";

// ===== 상태 매핑 =====
// TO-DO → Jira 상태 매핑
const TODO_TO_JIRA: Record<string, string> = {
  done: "DONE",
  in_progress: "IN PROGRESS",
  in_qa: "IN QA",
  pending: "BACKLOG",
};

// 상태 우선순위 (높을수록 더 앞선 상태)
const TODO_STATUS_LEVEL: Record<string, number> = {
  pending: 0,
  in_progress: 1,
  in_qa: 2,
  done: 3,
  cancelled: -1,
};

function jiraStatusLevel(jiraStatus: string): number {
  const upper = jiraStatus.toUpperCase();
  if (upper === "DONE" || upper.includes("DONE") || upper.includes("CLOSED")) return 3;
  if (upper.includes("QA") || upper.includes("REVIEW") || upper.includes("TEST")) return 2;
  if (upper.includes("PROGRESS")) return 1;
  if (upper === "BACKLOG" || upper === "TO DO" || upper === "OPEN" || upper === "TODO") return 0;
  return 0;
}

function jiraStatusToTodo(jiraStatus: string): string | null {
  const upper = jiraStatus.toUpperCase();
  if (upper === "DONE" || upper.includes("DONE") || upper.includes("CLOSED")) return "done";
  if (upper.includes("QA") || upper.includes("REVIEW") || upper.includes("TEST")) return "in_qa";
  if (upper.includes("PROGRESS")) return "in_progress";
  if (upper === "BACKLOG" || upper === "TO DO" || upper === "OPEN" || upper === "TODO") return "pending";
  return null; // 매핑 불가
}

function todoStatusToJira(todoStatus: string): string | null {
  return TODO_TO_JIRA[todoStatus] || null;
}

const TODO_STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  in_progress: "진행 중",
  in_qa: "IN-QA",
  done: "완료",
};

// ===== 일일 스캔 =====
// sendReport=true → Slack DM 발송 (17:30 일일 리포트용)
// sendReport=false → 스캔 + 액션 제안만, DM 없음 (30분 자동 스캔용)
export type ScanResultItem =
  | { type: "jira"; key: string; summary: string; status: string; url: string }
  | { type: "slack"; channel: string; preview: string; url: string };

export async function runDailyScan(sendReport: boolean = true): Promise<{
  message: string;
  scanItems: ScanResultItem[];
}> {
  const report: string[] = [];
  const warnings: string[] = [];
  const newlyProposedActions: string[] = [];
  let openIssues: jira.JiraIssue[] = [];
  let doneIssues: jira.JiraIssue[] = [];
  const scanItems: ScanResultItem[] = [];

  // --- Step 1: Jira 스캔 ---
  if (jira.isJiraConfigured()) {
    try {
      openIssues = await jira.getMyOpenIssues();
      doneIssues = await jira.getMyRecentDoneIssues();

      const inProgress = openIssues.filter((i) => i.fields.status.name === "In Progress" || i.fields.status.name === "IN PROGRESS");
      const backlog = openIssues.filter((i) => i.fields.status.name === "Backlog" || i.fields.status.name === "BACKLOG");

      const today = new Date();
      const threeDaysLater = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);

      const dueSoon = openIssues.filter((i) => {
        if (!i.fields.duedate) return false;
        const due = new Date(i.fields.duedate);
        return due <= threeDaysLater && due >= today;
      });

      const overdue = openIssues.filter((i) => {
        if (!i.fields.duedate) return false;
        return new Date(i.fields.duedate) < today;
      });

      // 리포트 구성
      report.push(`*📋 Work Pavlotrasche — 일일 업무 리포트*`);
      report.push(`\`${todayDate()}\`\n`);

      const jiraBase = process.env.JIRA_SITE_URL || "https://catchtable.atlassian.net";
      const jiraLink = (key: string) => `<${jiraBase}/browse/${key}|${key}>`;

      report.push(`*🔄 진행 중 (${inProgress.length}건)*`);
      if (inProgress.length > 0) {
        inProgress.forEach((i) => {
          const due = i.fields.duedate ? ` (기한: ${i.fields.duedate})` : "";
          report.push(`• ${jiraLink(i.key)} ${i.fields.summary}${due}`);
        });
      } else {
        report.push("• 없음");
      }

      report.push(`\n*📦 백로그 (${backlog.length}건)*`);
      if (backlog.length > 0) {
        report.push(`• ${backlog.slice(0, 3).map((i) => `${jiraLink(i.key)} ${i.fields.summary}`).join("\n• ")}`);
        if (backlog.length > 3) report.push(`• ...외 ${backlog.length - 3}건`);
      }

      // 주의 항목
      if (overdue.length > 0 || dueSoon.length > 0) {
        report.push(`\n*⚠️ 주의 필요*`);
        overdue.forEach((i) => {
          warnings.push(`❗ ${jiraLink(i.key)} ${i.fields.summary} — 기한 초과 (${i.fields.duedate})`);
        });
        dueSoon.forEach((i) => {
          warnings.push(`⏰ ${jiraLink(i.key)} ${i.fields.summary} — 기한 임박 (${i.fields.duedate})`);
        });
        report.push(warnings.join("\n"));
      }

      report.push(`\n*✅ 최근 7일 완료 (${doneIssues.length}건)*`);
      if (doneIssues.length > 0) {
        doneIssues.slice(0, 5).forEach((i) => {
          report.push(`• ${jiraLink(i.key)} ${i.fields.summary}`);
        });
        if (doneIssues.length > 5) report.push(`• ...외 ${doneIssues.length - 5}건`);
      }

      // 스캔 아이템 수집 (대시보드 표시용)
      openIssues.forEach((i) => scanItems.push({
        type: "jira",
        key: i.key,
        summary: i.fields.summary,
        status: i.fields.status.name,
        url: `${process.env.JIRA_SITE_URL || "https://catchtable.atlassian.net"}/browse/${i.key}`,
      }));

      // Jira ↔ TO-DO 동기화
      const jiraNewActions = await syncJiraStatuses(openIssues.concat(doneIssues));
      jiraNewActions.forEach((d) => newlyProposedActions.push(d));

    } catch (error) {
      report.push(`\n⚠️ Jira 스캔 실패: ${error}`);
      console.error("[Engine] Jira scan error:", error);
    }
  } else {
    report.push("⚠️ Jira API 미설정 — JIRA_USER_EMAIL, JIRA_API_TOKEN 필요");
  }

  // --- Step 1.5: Google Calendar 스캔 ---
  if (gcal.isGcalConfigured()) {
    try {
      const gcalResults = await scanGoogleCalendar();
      if (gcalResults.todayEvents.length > 0 || gcalResults.tomorrowEvents.length > 0) {
        if (gcalResults.todayEvents.length > 0) {
          report.push(`\n*📅 오늘 일정 (${gcalResults.todayEvents.length}건)*`);
          gcalResults.todayEvents.forEach((e) => {
            const time = gcal.formatEventTime(e);
            const attendees = (e.attendees?.length ?? 0) > 1 ? ` 👥${e.attendees!.length}명` : "";
            report.push(`• ${time} ${e.summary}${attendees}`);
          });
        }
        if (gcalResults.tomorrowEvents.length > 0) {
          report.push(`\n*📅 내일 일정 (${gcalResults.tomorrowEvents.length}건)*`);
          gcalResults.tomorrowEvents.forEach((e) => {
            const time = gcal.formatEventTime(e);
            report.push(`• ${time} ${e.summary}`);
          });
        }
        if (gcalResults.newActions > 0) {
          report.push(`→ ${gcalResults.newActions}건 회의 준비 TO-DO 제안됨`);
          gcalResults.actionDescriptions.forEach((d) => newlyProposedActions.push(d));
        }
      }
    } catch (error) {
      console.warn("[Engine] GCal scan skipped:", error);
    }
  }

  // --- Step 2: Slack 멘션 스캔 ---
  if (slack.isSlackConfigured()) {
    try {
      const slackResults = await scanSlackMentions();
      if (slackResults.mentions > 0) {
        report.push(`\n*💬 Slack 멘션 (${slackResults.mentions}건)*`);
        slackResults.items.forEach((item) => {
          const threadLink = item.permalink ? `<${item.permalink}|#${item.channel}>` : `#${item.channel}`;
          report.push(`• ${threadLink} — ${item.preview}`);
          scanItems.push({
            type: "slack",
            channel: item.channel,
            preview: item.preview.replace(/\n/g, " ").substring(0, 80),
            url: item.permalink,
          });
        });
        if (slackResults.newActions > 0) {
          report.push(`→ ${slackResults.newActions}건 액션 제안됨`);
          slackResults.actionDescriptions?.forEach((d) => newlyProposedActions.push(d));
        }
      }
    } catch (error) {
      console.warn("[Engine] Slack scan skipped:", error);
    }
  }

  // --- Step 3.5: 승인 대기 액션 수 ---
  const pendingActions = await db.query.actions.findMany({
    where: eq(schema.actions.status, "proposed" as any),
  });
  if (pendingActions.length > 0) {
    report.push(`\n*🔔 승인 대기 액션: ${pendingActions.length}건*`);
    pendingActions.slice(0, 5).forEach((a) => {
      report.push(`• ${a.description}`);
    });
    if (pendingActions.length > 5) report.push(`• ...외 ${pendingActions.length - 5}건`);
    report.push("👉 대시보드에서 승인/거절해주세요.");
  }

  // --- Step 3: 추천 액션 ---
  report.push(`\n*🎯 추천 액션*`);
  if (warnings.length > 0) {
    report.push("1. 기한 임박/초과 이슈 우선 처리");
  }
  if (pendingActions.length > 0) {
    report.push(`${warnings.length > 0 ? "2" : "1"}. 대시보드에서 대기 중인 액션 승인/거절`);
  }

  report.push(`\n_🤖 Work Pavlotrasche 자동 리포트_`);

  // --- Step 4: Slack DM 발송 (sendReport=true인 경우만) ---
  const message = report.join("\n");

  if (slack.isSlackConfigured() && sendReport) {
    try {
      const { ts } = await slack.sendDM(message);

      // 새 액션 제안 시 즉시 알림 DM (리포트와 별도)
      if (newlyProposedActions.length > 0) {
        const alertLines = [
          `⚡ *새 액션 ${newlyProposedActions.length}건 제안됨 — 승인이 필요합니다*`,
          ...newlyProposedActions.map((d) => `• ${d}`),
          `\n👉 대시보드에서 확인하세요.`,
        ];
        await slack.sendDM(alertLines.join("\n")).catch(() => {});
      }
      // 리포트 DB 저장
      await db.insert(schema.dailyReports).values({
        id: generateId(),
        date: todayDate(),
        summary: JSON.stringify({
          openIssues: openIssues.length,
          inProgress: openIssues.filter((i) => i.fields.status.name.toUpperCase().includes("PROGRESS")).length,
          backlog: openIssues.filter((i) => i.fields.status.name.toUpperCase().includes("BACKLOG")).length,
          done7d: doneIssues.length,
          pendingActions: pendingActions.length,
        }),
        pendingActions: JSON.stringify(pendingActions.map((a) => a.id)),
        slackMessageTs: ts,
        createdAt: nowLocal(),
      }).onConflictDoNothing();

      console.log("[Engine] Daily report sent via Slack DM");
    } catch (error) {
      console.error("[Engine] Slack DM failed:", error);
    }
  } else if (!sendReport) {
    // 스캔 전용 모드 — 새 액션 제안 시 알림 DM만 발송
    if (slack.isSlackConfigured() && newlyProposedActions.length > 0) {
      const alertLines = [
        `⚡ *새 액션 ${newlyProposedActions.length}건 제안됨 — 승인이 필요합니다*`,
        ...newlyProposedActions.map((d) => `• ${d}`),
        `\n👉 대시보드에서 확인하세요.`,
      ];
      await slack.sendDM(alertLines.join("\n")).catch(() => {});
    }
    console.log("[Engine] Scan-only mode: report suppressed");
  } else {
    console.log("[Engine] Slack not configured, report logged to console:");
    console.log(message);
  }

  return { message, scanItems };
}

// ===== Slack 멘션 스캔 =====
// 할일/요청 키워드가 포함된 멘션을 감지하여 TO-DO 생성 또는 답글 액션 제안
const ACTION_KEYWORDS = [
  "해줘", "해주세요", "부탁", "할일", "TODO", "todo",
  "확인해", "확인 부탁", "처리해", "검토해", "리뷰해",
  "공유해", "전달해", "수정해", "반영해", "업데이트해",
  "일정", "마감", "기한", "데드라인", "deadline",
];

async function scanSlackMentions(): Promise<{
  mentions: number;
  items: { channel: string; preview: string; permalink: string }[];
  newActions: number;
  actionDescriptions: string[];
}> {
  const userId = slack.SLACK_USER_ID;
  const mentions = await slack.searchMentions(`<@${userId}>`, 30);

  if (mentions.length === 0) {
    return { mentions: 0, items: [], newActions: 0, actionDescriptions: [] };
  }

  const now = nowLocal();
  const today = new Date();
  const oneDayAgo = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  let newActions = 0;
  const actionDescriptions: string[] = [];
  const items: { channel: string; preview: string; permalink: string }[] = [];

  // 최근 24시간 멘션만 처리
  const recentMentions = mentions.filter((m: any) => {
    const ts = parseFloat(m.ts);
    return new Date(ts * 1000) >= oneDayAgo;
  });

  // 기존 todo_create 액션 payload 목록 미리 로드 (중복 감지용)
  const existingTodoActions = await db.query.actions.findMany({
    where: eq(schema.actions.actionType, "todo_create" as any),
  });
  const processedThreadTs = new Set<string>(
    existingTodoActions
      .map((a) => {
        try { return (JSON.parse(a.payload || "{}") as { threadTs?: string }).threadTs ?? ""; }
        catch { return ""; }
      })
      .filter(Boolean)
  );

  for (const mention of recentMentions.slice(0, 10)) {
    const text = mention.text || "";
    const channelName = mention.channel?.name || "DM";
    const permalink = mention.permalink || "";
    const threadTs = mention.ts;
    const channelId = mention.channel?.id;

    // 요약 미리보기
    const preview = text
      .replace(/<@[A-Z0-9]+>/g, "@user")
      .replace(/<[^>]+>/g, "")
      .replace(/\n+/g, " ")
      .trim()
      .substring(0, 80);
    items.push({ channel: channelName, preview, permalink });

    // ① 이미 처리된 스레드인지 확인 — task_links 기준 (액션 승인+실행 후)
    const existingLink = await db.query.taskLinks.findFirst({
      where: and(
        eq(schema.taskLinks.linkType, "slack_thread"),
        eq(schema.taskLinks.slackThreadTs, threadTs)
      ),
    });
    if (existingLink) continue;

    // ② 이미 액션이 제안/실행된 threadTs인지 확인 (proposed·approved·executed 포함)
    if (processedThreadTs.has(threadTs)) continue;

    // 할일 키워드 감지
    const hasActionKeyword = ACTION_KEYWORDS.some((kw) =>
      text.toLowerCase().includes(kw.toLowerCase())
    );

    if (hasActionKeyword) {
      // 키워드 매칭 → TO-DO 생성 제안
      // 임시 태스크를 placeholder로 생성 (제안용)
      const placeholderTaskId = generateId();
      await db.insert(schema.tasks).values({
        id: placeholderTaskId,
        title: `[Slack] ${preview}`,
        description: `Slack #${channelName}에서 감지된 요청`,
        sourceType: "slack_detected",
        status: "pending",
        priority: "medium",
        createdAt: now,
        updatedAt: now,
      });

      const actionDesc = `Slack #${channelName}에서 할일 감지: "${preview}"`;
      await db.insert(schema.actions).values({
        id: generateId(),
        taskId: placeholderTaskId,
        actionType: "todo_create",
        description: actionDesc,
        payload: JSON.stringify({
          summary: preview,
          channelId,
          threadTs,
          threadUrl: permalink,
        }),
        status: "proposed",
        proposedAt: now,
      });
      newActions++;
      actionDescriptions.push(actionDesc);
      processedThreadTs.add(threadTs); // 같은 스캔 내 중복 방지
    }
  }

  return { mentions: recentMentions.length, items: items.slice(0, 5), newActions, actionDescriptions };
}

// ===== Jira ↔ TO-DO 양방향 상태 동기화 =====
async function syncJiraStatuses(issues: jira.JiraIssue[]): Promise<string[]> {
  const now = nowLocal();
  const newActionDescs: string[] = [];

  // 이미 액션이 제안된 Jira 이슈 키 목록 (중복 방지)
  const existingJiraActions = await db.query.actions.findMany({
    where: eq(schema.actions.actionType, "todo_create" as any),
  });
  const processedJiraKeys = new Set<string>(
    existingJiraActions.map((a) => {
      try { return (JSON.parse(a.payload || "{}") as { jiraIssueKey?: string }).jiraIssueKey ?? ""; }
      catch { return ""; }
    }).filter(Boolean)
  );

  for (const issue of issues) {
    const link = await db.query.taskLinks.findFirst({
      where: and(
        eq(schema.taskLinks.linkType, "jira"),
        eq(schema.taskLinks.jiraIssueKey, issue.key)
      ),
    });

    if (!link) {
      // 새로 할당된 Jira 이슈 → TO-DO 생성 제안
      if (processedJiraKeys.has(issue.key)) continue; // 이미 제안됨

      const jiraBase = process.env.JIRA_SITE_URL || "https://catchtable.atlassian.net";
      const issueUrl = `${jiraBase}/browse/${issue.key}`;
      const placeholderTaskId = generateId();

      await db.insert(schema.tasks).values({
        id: placeholderTaskId,
        title: `${issue.fields.summary}`,
        description: `Jira ${issue.key} — ${issue.fields.status.name}`,
        sourceType: "jira_sync",
        status: "pending",
        priority: "medium",
        dueDate: issue.fields.duedate || null,
        createdAt: now,
        updatedAt: now,
      });

      // Jira 링크 미리 생성 (다음 스캔 시 중복 방지)
      await db.insert(schema.taskLinks).values({
        id: generateId(),
        taskId: placeholderTaskId,
        linkType: "jira",
        jiraIssueKey: issue.key,
        jiraIssueUrl: issueUrl,
        jiraStatus: issue.fields.status.name,
        createdAt: now,
      });

      const desc = `Jira 새 이슈 할당: ${issue.key} — "${issue.fields.summary}"`;
      await db.insert(schema.actions).values({
        id: generateId(),
        taskId: placeholderTaskId,
        actionType: "todo_create",
        description: desc,
        payload: JSON.stringify({
          jiraIssueKey: issue.key,
          jiraIssueUrl: issueUrl,
          summary: issue.fields.summary,
          jiraStatus: issue.fields.status.name,
        }),
        status: "proposed",
        proposedAt: now,
      });
      newActionDescs.push(desc);
      processedJiraKeys.add(issue.key);
      console.log(`[Engine] 새 Jira 이슈 감지: ${issue.key} → TO-DO 제안`);
      continue;
    }

    const jiraStatus = issue.fields.status.name;
    const prevJiraStatus = link.jiraStatus;
    const jiraChanged = prevJiraStatus !== null && prevJiraStatus !== jiraStatus;

    // Jira 상태 업데이트
    await db.update(schema.taskLinks)
      .set({
        jiraStatus: jiraStatus,
        lastSyncedAt: now,
      })
      .where(eq(schema.taskLinks.id, link.id));

    const task = await db.query.tasks.findFirst({
      where: eq(schema.tasks.id, link.taskId),
    });
    if (!task) continue;

    // 양방향 매핑으로 불일치 감지
    const expectedTodo = jiraStatusToTodo(jiraStatus);
    const jiraLevelCheck = jiraStatusLevel(jiraStatus);
    const todoLevelCheck = TODO_STATUS_LEVEL[task.status] ?? 0;
    // 레벨이 같으면 aligned (예: Jira IN QA=lv2, TODO in_qa=lv2)
    const isAligned = expectedTodo === task.status || jiraLevelCheck === todoLevelCheck;

    // 기존 proposed 액션 조회
    const existingAction = await db.query.actions.findFirst({
      where: and(
        eq(schema.actions.taskId, task.id),
        eq(schema.actions.status, "proposed" as any),
      ),
    });

    if (isAligned) {
      // 상태 일치 → 기존 proposed 액션 자동 취소
      if (existingAction) {
        await db.update(schema.actions)
          .set({ status: "cancelled" as any })
          .where(eq(schema.actions.id, existingAction.id));
        console.log(`[Engine] 상태 일치 → 액션 자동 취소: ${existingAction.description}`);
      }
      continue;
    }

    // 불일치 존재 — 방향 판단: 나중에 바뀐 쪽이 기준
    if (existingAction) continue; // 이미 proposed 액션이 있으면 중복 방지

    // 우선순위 기반 방향 결정: 더 앞선 상태가 기준
    const jiraLevel = jiraStatusLevel(jiraStatus);
    const todoLevel = TODO_STATUS_LEVEL[task.status] ?? 0;

    if (jiraLevel >= todoLevel) {
      // Jira가 더 앞서거나 동급 → Jira 기준으로 TO-DO 변경 제안
      if (expectedTodo && expectedTodo !== task.status) {
        const todoLabel = TODO_STATUS_LABEL[expectedTodo] || expectedTodo;
        const changeReason = jiraChanged
          ? `Jira ${issue.key}가 ${prevJiraStatus} → ${jiraStatus} 변경됨`
          : `Jira ${issue.key}가 ${jiraStatus} 상태`;
        const desc = `${changeReason} → TO-DO "${todoLabel}" 전환 제안`;
        await db.insert(schema.actions).values({
          id: generateId(),
          taskId: task.id,
          actionType: "todo_status_change",
          description: desc,
          payload: JSON.stringify({
            jiraIssueKey: issue.key,
            jiraStatus,
            targetTodoStatus: expectedTodo,
          }),
          status: "proposed",
          proposedAt: now,
        });
        newActionDescs.push(desc);
        console.log(`[Engine] Jira 우선: ${issue.key} ${jiraStatus}(lv${jiraLevel}) > TODO ${task.status}(lv${todoLevel}) → TO-DO ${todoLabel} 제안`);
      }
    } else {
      // TODO가 더 앞섬 → TODO 기준으로 Jira 변경 제안
      const expectedJira = todoStatusToJira(task.status);
      if (expectedJira) {
        const desc = `TO-DO "${TODO_STATUS_LABEL[task.status] || task.status}"인데 Jira ${issue.key}는 ${jiraStatus} → ${expectedJira} 전환 제안`;
        await db.insert(schema.actions).values({
          id: generateId(),
          taskId: task.id,
          actionType: "jira_transition",
          description: desc,
          payload: JSON.stringify({
            jiraIssueKey: issue.key,
            targetStatus: expectedJira,
          }),
          status: "proposed",
          proposedAt: now,
        });
        newActionDescs.push(desc);
        console.log(`[Engine] TODO 우선: ${task.status}(lv${todoLevel}) > Jira ${jiraStatus}(lv${jiraLevel}) → Jira ${expectedJira} 전환 제안`);
      }
    }
  }
  return newActionDescs;
}

// ===== 승인된 액션 실행 =====
export async function executeApprovedActions() {
  const approved = await db.query.actions.findMany({
    where: eq(schema.actions.status, "approved" as any),
  });

  if (approved.length === 0) return;

  let executed = 0;
  let failed = 0;
  const results: string[] = [];

  for (const action of approved) {
    const payload = action.payload ? JSON.parse(action.payload) : {};
    const now = nowLocal();

    try {
      switch (action.actionType) {
        case "jira_transition": {
          if (!jira.isJiraConfigured()) throw new Error("Jira API 미설정");
          const { jiraIssueKey, targetStatus } = payload;
          const transitions = await jira.getTransitions(jiraIssueKey);
          const target = transitions.find(
            (t) => t.name.toUpperCase() === targetStatus.toUpperCase() || t.to.name.toUpperCase() === targetStatus.toUpperCase()
          );
          if (!target) throw new Error(`전환 '${targetStatus}'을 찾을 수 없음 (가능: ${transitions.map((t) => t.name).join(", ")})`);
          await jira.transitionIssue(jiraIssueKey, target.id);

          await db.update(schema.actions).set({
            status: "executed",
            executedAt: now,
            resultLink: `https://catchtable.atlassian.net/browse/${jiraIssueKey}`,
          }).where(eq(schema.actions.id, action.id));

          results.push(`✅ Jira ${jiraIssueKey} → ${targetStatus}`);
          executed++;
          break;
        }

        case "todo_status_change": {
          const { targetTodoStatus, jiraIssueKey } = payload;
          const updates: Record<string, any> = {
            status: targetTodoStatus,
            updatedAt: now,
          };
          if (targetTodoStatus === "done") {
            updates.completedAt = now;
          } else {
            updates.completedAt = null;
          }
          await db.update(schema.tasks).set(updates)
            .where(eq(schema.tasks.id, action.taskId));

          await db.update(schema.actions).set({
            status: "executed",
            executedAt: now,
          }).where(eq(schema.actions.id, action.id));

          const label = TODO_STATUS_LABEL[targetTodoStatus] || targetTodoStatus;
          results.push(`✅ TO-DO → ${label} (Jira ${jiraIssueKey} 기준)`);
          executed++;
          break;
        }

        case "todo_complete": {
          await db.update(schema.tasks).set({
            status: "done",
            completedAt: now,
            updatedAt: now,
          }).where(eq(schema.tasks.id, action.taskId));

          await db.update(schema.actions).set({
            status: "executed",
            executedAt: now,
          }).where(eq(schema.actions.id, action.id));

          results.push(`✅ TO-DO 완료 처리`);
          executed++;
          break;
        }

        case "slack_reply": {
          if (!slack.isSlackConfigured()) throw new Error("Slack API 미설정");
          const { channelId, threadTs, message } = payload;
          await slack.replyToThread(channelId, threadTs, message);
          // 원본 메시지에 이모지 반응 추가 (실패해도 액션은 성공 처리)
          try {
            await slack.addReaction(channelId, threadTs, "white_check_mark");
          } catch {
            // reactions:write scope 없을 수 있음 — 무시
          }

          await db.update(schema.actions).set({
            status: "executed",
            executedAt: now,
          }).where(eq(schema.actions.id, action.id));

          results.push(`✅ Slack 답글 발송 완료`);
          executed++;
          break;
        }

        case "todo_create": {
          const { summary, channelId, threadTs, threadUrl } = payload;
          // placeholder task(action.taskId)를 실제 TO-DO로 활성화 (새 task 생성 안 함)
          await db.update(schema.tasks).set({
            title: summary || "Slack에서 감지된 할일",
            updatedAt: now,
          }).where(eq(schema.tasks.id, action.taskId));

          // Slack link가 없으면 추가
          if (channelId && threadTs) {
            const existingLink = await db.query.taskLinks.findFirst({
              where: and(
                eq(schema.taskLinks.taskId, action.taskId),
                eq(schema.taskLinks.linkType, "slack_thread")
              ),
            });
            if (!existingLink) {
              await db.insert(schema.taskLinks).values({
                id: generateId(),
                taskId: action.taskId,
                linkType: "slack_thread",
                slackChannelId: channelId,
                slackThreadTs: threadTs,
                slackThreadUrl: threadUrl || null,
                createdAt: now,
              });
            }
          }

          await db.update(schema.actions).set({
            status: "executed",
            executedAt: now,
          }).where(eq(schema.actions.id, action.id));

          results.push(`✅ TO-DO 생성: ${summary}`);
          executed++;
          break;
        }

        default:
          results.push(`⏭ 미지원 액션 타입: ${action.actionType}`);
      }
    } catch (error) {
      failed++;
      results.push(`❌ 실패 (${action.actionType}): ${error}`);
      console.error(`[Engine] Action ${action.id} failed:`, error);
    }
  }

  // 결과 Slack DM 발송
  if (slack.isSlackConfigured() && (executed > 0 || failed > 0)) {
    const summary = [
      `*🤖 액션 실행 결과*`,
      `실행: ${executed}건 | 실패: ${failed}건`,
      ...results,
    ].join("\n");

    try {
      await slack.sendDM(summary);
    } catch (e) {
      console.error("[Engine] Result DM failed:", e);
    }
  }

  console.log(`[Engine] Actions executed: ${executed}, failed: ${failed}`);
}

// ===== Google Calendar 스캔 =====
const MEETING_KEYWORDS = [
  "회의", "미팅", "meeting", "review", "리뷰", "sync", "싱크",
  "planning", "플래닝", "interview", "인터뷰", "standup", "스탠드업",
  "1on1", "1:1", "weekly", "monthly", "retro", "스프린트", "sprint",
  "킥오프", "kickoff", "브리핑", "briefing",
];

async function scanGoogleCalendar(): Promise<{
  todayEvents: gcal.GCalEvent[];
  tomorrowEvents: gcal.GCalEvent[];
  newActions: number;
  actionDescriptions: string[];
}> {
  const now = nowLocal();
  const todayRange    = gcal.getTodayRange();
  const tomorrowRange = gcal.getTomorrowRange();

  const [todayEvents, tomorrowEvents] = await Promise.all([
    gcal.listEvents(todayRange.timeMin, todayRange.timeMax),
    gcal.listEvents(tomorrowRange.timeMin, tomorrowRange.timeMax),
  ]);

  let newActions = 0;
  const actionDescriptions: string[] = [];

  // 오늘 + 내일 이벤트 중 회의 감지 → TO-DO 제안
  const allEvents = [...todayEvents, ...tomorrowEvents];
  for (const event of allEvents) {
    const title = event.summary || "";
    const isMeeting =
      MEETING_KEYWORDS.some((kw) => title.toLowerCase().includes(kw.toLowerCase())) ||
      (event.attendees && event.attendees.length > 1);

    if (!isMeeting) continue;

    // 이미 처리된 이벤트인지 확인
    const existing = await db.query.taskLinks.findFirst({
      where: and(
        eq(schema.taskLinks.linkType, "gcal" as any),
        eq(schema.taskLinks.gcalEventId as any, event.id),
      ),
    });
    if (existing) continue;

    // 회의 날짜 추출
    const eventDate = event.start.dateTime
      ? event.start.dateTime.slice(0, 10)
      : event.start.date || todayDate();

    // placeholder 태스크 생성
    const placeholderTaskId = generateId();
    const time = gcal.formatEventTime(event);
    const taskTitle = `[회의 준비] ${title}`;

    await db.insert(schema.tasks).values({
      id:          placeholderTaskId,
      title:       taskTitle,
      description: `${eventDate} ${time} 회의 준비 — Google Calendar에서 감지`,
      sourceType:  "manual",
      status:      "pending",
      priority:    "high",
      dueDate:     eventDate,
      createdAt:   now,
      updatedAt:   now,
    });

    // gcal 링크 생성 (중복 방지용)
    await db.insert(schema.taskLinks).values({
      id:             generateId(),
      taskId:         placeholderTaskId,
      linkType:       "gcal" as any,
      gcalEventId:    event.id,
      gcalCalendarId: gcal.GCAL_CALENDAR_ID,
      createdAt:      now,
    });

    // 액션 제안
    const desc = `회의 준비 TO-DO 제안: "${title}" (${eventDate} ${time})`;
    await db.insert(schema.actions).values({
      id:          generateId(),
      taskId:      placeholderTaskId,
      actionType:  "todo_create",
      description: desc,
      payload:     JSON.stringify({ gcalEventId: event.id, eventTitle: title, eventDate, time }),
      status:      "proposed",
      proposedAt:  now,
    });

    newActions++;
    actionDescriptions.push(desc);
    console.log(`[Engine] 회의 감지: ${title} → TO-DO 제안`);
  }

  return { todayEvents, tomorrowEvents, newActions, actionDescriptions };
}
