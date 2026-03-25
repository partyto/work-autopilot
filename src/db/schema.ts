import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ===== TO-DO 목록 (Single Source of Truth) =====
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status", {
    enum: ["pending", "in_progress", "in_qa", "done", "cancelled", "overdue"],
  })
    .notNull()
    .default("pending"),
  priority: text("priority", {
    enum: ["high", "medium", "low"],
  })
    .notNull()
    .default("medium"),
  sourceType: text("source_type", {
    enum: ["manual", "jira_sync", "slack_detected"],
  })
    .notNull()
    .default("manual"),
  dueDate: text("due_date"), // ISO date string (YYYY-MM-DD)
  sortOrder: integer("sort_order").default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now', 'localtime'))`),
  completedAt: text("completed_at"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now', 'localtime'))`),
});

// ===== TO-DO ↔ Jira/Slack 매핑 =====
export const taskLinks = sqliteTable("task_links", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  linkType: text("link_type", {
    enum: ["jira", "slack_thread", "gcal"],
  }).notNull(),
  // Jira 매핑
  jiraIssueKey: text("jira_issue_key"),
  jiraIssueUrl: text("jira_issue_url"),
  jiraStatus: text("jira_status"),
  jiraProjectKey: text("jira_project_key"),
  // Slack 매핑
  slackChannelId: text("slack_channel_id"),
  slackChannelName: text("slack_channel_name"),
  slackThreadTs: text("slack_thread_ts"),
  slackThreadUrl: text("slack_thread_url"),
  // Google Calendar 매핑
  gcalEventId: text("gcal_event_id"),
  gcalCalendarId: text("gcal_calendar_id"),
  // 동기화
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now', 'localtime'))`),
});

// ===== 자동 액션 (제안/실행) =====
export const actions = sqliteTable("actions", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  actionType: text("action_type", {
    enum: [
      "jira_transition",
      "slack_reply",
      "jira_create",
      "todo_create",
      "todo_complete",
      "todo_status_change",
    ],
  }).notNull(),
  description: text("description").notNull(),
  payload: text("payload"), // JSON string
  status: text("status", {
    enum: ["proposed", "approved", "executed", "rejected", "cancelled"],
  })
    .notNull()
    .default("proposed"),
  resultLink: text("result_link"),
  proposedAt: text("proposed_at")
    .notNull()
    .default(sql`(datetime('now', 'localtime'))`),
  executedAt: text("executed_at"),
});

// ===== 일일 리포트 =====
export const dailyReports = sqliteTable("daily_reports", {
  id: text("id").primaryKey(),
  date: text("date").notNull().unique(), // YYYY-MM-DD
  summary: text("summary"), // JSON string
  pendingActions: text("pending_actions"), // JSON string
  slackMessageTs: text("slack_message_ts"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now', 'localtime'))`),
});

// ===== Type exports =====
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskLink = typeof taskLinks.$inferSelect;
export type NewTaskLink = typeof taskLinks.$inferInsert;
export type Action = typeof actions.$inferSelect;
export type DailyReport = typeof dailyReports.$inferSelect;
