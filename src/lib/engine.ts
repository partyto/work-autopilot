// Work Autopilot 핵심 엔진 — Jira/Slack 스캔 + 리포트 + 액션 실행
import { db, schema } from "@/db";
import { eq, and } from "drizzle-orm";
import { generateId, nowLocal, todayDate } from "@/lib/utils";
import * as jira from "@/lib/integrations/jira";
import * as slack from "@/lib/integrations/slack";

// ===== 일일 스캔 =====
export async function runDailyScan() {
  const report: string[] = [];
  const warnings: string[] = [];
  let openIssues: jira.JiraIssue[] = [];
  let doneIssues: jira.JiraIssue[] = [];

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
      report.push(`*📋 Work Autopilot — 일일 업무 리포트*`);
      report.push(`\`${todayDate()}\`\n`);

      report.push(`*🔄 진행 중 (${inProgress.length}건)*`);
      if (inProgress.length > 0) {
        inProgress.forEach((i) => {
          const due = i.fields.duedate ? ` (기한: ${i.fields.duedate})` : "";
          report.push(`• \`${i.key}\` ${i.fields.summary}${due}`);
        });
      } else {
        report.push("• 없음");
      }

      report.push(`\n*📦 백로그 (${backlog.length}건)*`);
      if (backlog.length > 0) {
        report.push(`• ${backlog.slice(0, 3).map((i) => `\`${i.key}\` ${i.fields.summary}`).join("\n• ")}`);
        if (backlog.length > 3) report.push(`• ...외 ${backlog.length - 3}건`);
      }

      // 주의 항목
      if (overdue.length > 0 || dueSoon.length > 0) {
        report.push(`\n*⚠️ 주의 필요*`);
        overdue.forEach((i) => {
          warnings.push(`❗ \`${i.key}\` ${i.fields.summary} — 기한 초과 (${i.fields.duedate})`);
        });
        dueSoon.forEach((i) => {
          warnings.push(`⏰ \`${i.key}\` ${i.fields.summary} — 기한 임박 (${i.fields.duedate})`);
        });
        report.push(warnings.join("\n"));
      }

      report.push(`\n*✅ 최근 7일 완료 (${doneIssues.length}건)*`);
      if (doneIssues.length > 0) {
        doneIssues.slice(0, 5).forEach((i) => {
          report.push(`• \`${i.key}\` ${i.fields.summary}`);
        });
        if (doneIssues.length > 5) report.push(`• ...외 ${doneIssues.length - 5}건`);
      }

      // Jira ↔ TO-DO 동기화
      await syncJiraStatuses(openIssues.concat(doneIssues));

    } catch (error) {
      report.push(`\n⚠️ Jira 스캔 실패: ${error}`);
      console.error("[Engine] Jira scan error:", error);
    }
  } else {
    report.push("⚠️ Jira API 미설정 — JIRA_USER_EMAIL, JIRA_API_TOKEN 필요");
  }

  // --- Step 2: 승인 대기 액션 수 ---
  const pendingActions = await db.query.actions.findMany({
    where: eq(schema.actions.status, "proposed" as any),
  });
  if (pendingActions.length > 0) {
    report.push(`\n*🔔 승인 대기 액션: ${pendingActions.length}건*`);
    report.push("대시보드에서 확인해주세요.");
  }

  // --- Step 3: 추천 액션 ---
  report.push(`\n*🎯 추천 액션*`);
  if (warnings.length > 0) {
    report.push("1. 기한 임박/초과 이슈 우선 처리");
  }
  if (pendingActions.length > 0) {
    report.push(`${warnings.length > 0 ? "2" : "1"}. 대시보드에서 대기 중인 액션 승인/거절`);
  }

  report.push(`\n_🤖 Work Autopilot 자동 리포트_`);

  // --- Step 4: Slack DM 발송 ---
  const message = report.join("\n");

  if (slack.isSlackConfigured()) {
    try {
      const { ts } = await slack.sendDM(message);
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
  } else {
    console.log("[Engine] Slack not configured, report logged to console:");
    console.log(message);
  }

  return message;
}

// ===== Jira 상태 동기화 =====
async function syncJiraStatuses(issues: jira.JiraIssue[]) {
  const now = nowLocal();

  for (const issue of issues) {
    const link = await db.query.taskLinks.findFirst({
      where: and(
        eq(schema.taskLinks.linkType, "jira"),
        eq(schema.taskLinks.jiraIssueKey, issue.key)
      ),
    });

    if (!link) continue;

    const newStatus = issue.fields.status.name;
    const previousStatus = link.jiraStatus;

    // 상태 변경 감지
    if (previousStatus !== newStatus) {
      await db.update(schema.taskLinks)
        .set({ jiraStatus: newStatus, lastSyncedAt: now })
        .where(eq(schema.taskLinks.id, link.id));

      const task = await db.query.tasks.findFirst({
        where: eq(schema.tasks.id, link.taskId),
      });

      if (task) {
        // Jira DONE → TO-DO 미완료 → 완료 제안
        if (newStatus.toUpperCase() === "DONE" && task.status !== "done") {
          await db.insert(schema.actions).values({
            id: generateId(),
            taskId: task.id,
            actionType: "todo_complete",
            description: `Jira ${issue.key}가 DONE → TO-DO 완료 처리 제안`,
            payload: JSON.stringify({ jiraIssueKey: issue.key, jiraStatus: newStatus }),
            status: "proposed",
            proposedAt: now,
          });
        }
        // TO-DO 완료 → Jira 미완료 → Jira 전환 제안
        else if (task.status === "done" && newStatus.toUpperCase() !== "DONE") {
          await db.insert(schema.actions).values({
            id: generateId(),
            taskId: task.id,
            actionType: "jira_transition",
            description: `TO-DO 완료인데 Jira ${issue.key}는 ${newStatus} → DONE 전환 제안`,
            payload: JSON.stringify({ jiraIssueKey: issue.key, targetStatus: "DONE" }),
            status: "proposed",
            proposedAt: now,
          });
        }
      }
    } else {
      // 상태 동일해도 lastSyncedAt 갱신
      await db.update(schema.taskLinks)
        .set({ lastSyncedAt: now })
        .where(eq(schema.taskLinks.id, link.id));
    }
  }
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
          if (!target) throw new Error(`전환 '${targetStatus}'을 찾을 수 없음`);
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

        case "slack_reply": {
          if (!slack.isSlackConfigured()) throw new Error("Slack API 미설정");
          const { channelId, threadTs, message } = payload;
          await slack.replyToThread(channelId, threadTs, message);

          await db.update(schema.actions).set({
            status: "executed",
            executedAt: now,
          }).where(eq(schema.actions.id, action.id));

          results.push(`✅ Slack 답글 발송 완료`);
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

        case "todo_create": {
          const { summary, channelId, threadTs, threadUrl } = payload;
          const newTaskId = generateId();
          await db.insert(schema.tasks).values({
            id: newTaskId,
            title: summary || "Slack에서 감지된 할일",
            sourceType: "slack_detected",
            status: "pending",
            priority: "medium",
            createdAt: now,
            updatedAt: now,
          });

          if (channelId && threadTs) {
            await db.insert(schema.taskLinks).values({
              id: generateId(),
              taskId: newTaskId,
              linkType: "slack_thread",
              slackChannelId: channelId,
              slackThreadTs: threadTs,
              slackThreadUrl: threadUrl || null,
              createdAt: now,
            });
          }

          await db.update(schema.actions).set({
            status: "executed",
            executedAt: now,
          }).where(eq(schema.actions.id, action.id));

          results.push(`✅ 새 TO-DO 생성: ${summary}`);
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
