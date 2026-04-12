// ===== DB 열거형 타입 정의 =====
// schema.ts의 enum과 정확히 일치해야 함

export const TASK_STATUSES = ["pending", "in_progress", "in_qa", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const SOURCE_TYPES = ["manual", "jira_sync", "slack_detected"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const LINK_TYPES = ["jira", "slack_thread", "gcal"] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export const ACTION_TYPES = [
  "jira_transition", "slack_reply", "jira_create",
  "todo_create", "todo_complete", "todo_status_change",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const ACTION_STATUSES = ["proposed", "approved", "executed", "rejected", "cancelled"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

// 검증 헬퍼
export function isValidTaskStatus(s: string): s is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(s);
}
export function isValidPriority(s: string): s is Priority {
  return (PRIORITIES as readonly string[]).includes(s);
}
export function isValidActionType(s: string): s is ActionType {
  return (ACTION_TYPES as readonly string[]).includes(s);
}
