// ===== 상태 매핑 (Single Source of Truth) =====
// engine.ts와 api/tasks/[id]/route.ts에서 공유

import type { TaskStatus } from "@/db/types";

// TO-DO → Jira 전환 이름 매핑 (Jira가 실제 사용하는 casing)
export const TODO_TO_JIRA: Record<string, string> = {
  done: "Done",
  in_progress: "In Progress",
  in_qa: "In QA",
  pending: "Backlog",
};

// 상태 우선순위 (높을수록 더 앞선 상태)
export const TODO_STATUS_LEVEL: Record<string, number> = {
  pending: 0,
  overdue: 0,   // pending과 동급 — Jira 관점에서 미시작, syncJiraStatuses 비교 대상 포함
  in_progress: 1,
  in_qa: 2,
  done: 3,
  cancelled: -1,
};

export const TODO_STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  in_progress: "진행 중",
  in_qa: "IN-QA",
  done: "완료",
};

export function jiraStatusLevel(jiraStatus: string): number {
  const upper = jiraStatus.toUpperCase();
  if (upper === "DONE" || upper.includes("DONE") || upper.includes("CLOSED")) return 3;
  if (upper.includes("QA") || upper.includes("REVIEW") || upper.includes("TEST")) return 2;
  if (upper.includes("PROGRESS")) return 1;
  if (upper === "BACKLOG" || upper === "TO DO" || upper === "OPEN" || upper === "TODO") return 0;
  return 0;
}

export function jiraStatusToTodo(jiraStatus: string): TaskStatus | null {
  const upper = jiraStatus.toUpperCase();
  if (upper === "DONE" || upper.includes("DONE") || upper.includes("CLOSED")) return "done";
  if (upper.includes("QA") || upper.includes("REVIEW") || upper.includes("TEST")) return "in_qa";
  if (upper.includes("PROGRESS")) return "in_progress";
  if (upper === "BACKLOG" || upper === "TO DO" || upper === "OPEN" || upper === "TODO") return "pending";
  return null;
}

export function todoStatusToJira(todoStatus: string): string | null {
  return TODO_TO_JIRA[todoStatus] || null;
}
