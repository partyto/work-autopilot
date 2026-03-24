import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status", { enum: ["pending", "in_progress", "done", "cancelled", "overdue"] }).notNull().default("pending"),
  priority: text("priority", { enum: ["high", "medium", "low"] }).notNull().default("medium"),
  sourceType: text("source_type", { enum: ["manual", "jira_sync", "slack_detected"] }).notNull().default("manual"),
  dueDate: text("due_date"),
  sortOrder: integer("sort_order").default(0),
  createdAt: text("created_at").notNull().default(sql`(datetime('now', 'localtime'))`),
  completedAt: text("completed_at"),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now', 'localtime'))`),
});

export const taskLinks = sqliteTable("task_links", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  linkType: text("link_type", { enum: ["jira", "slack_thread", "gcal"] }).notNull(),
  jiraIssueKey: text("jira_issue_key"),
  jiraIssueUrl: text("jira_issue_url"),
  jiraStatus: text("jira_status"),
  jiraProjectKey: text("jira_project_key"),
  slackChannelId: text("slack_channel_id"),
  slackChannelName: text("slack_channel_name"),
  slackThreadTs: text("slack_thread_ts"),
  slackThreadUrl: text("slack_thread_url"),
  gcalEventId: text("gcal_event_id"),
  gcalCalendarId: text("gcal_calendar_id"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now', 'localtime'))`),
});

export const actions = sqliteTable("actions", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  actionType: text("action_type", {
    enum: ["jira_transition", "slack_reply", "jira_create", "todo_create", "todo_complete", "todo_status_change"],
  }).notNull(),
  description: text("description").notNull(),
  payload: text("payload"),
  status: text("status", { enum: ["proposed", "approved", "executed", "rejected", "cancelled"] }).notNull().default("proposed"),
  resultLink: text("result_link"),
  proposedAt: text("proposed_at").notNull().default(sql`(datetime('now', 'localtime'))`),
  executedAt: text("executed_at"),
});

export const dailyReports = sqliteTable("daily_reports", {
  id: text("id").primaryKey(),
  date: text("date").notNull().unique(),
  summary: text("summary"),
  pendingActions: text("pending_actions"),
  slackMessageTs: text("slack_message_ts"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now', 'localtime'))`),
});

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskLink = typeof taskLinks.$inferSelect;
export type NewTaskLink = typeof taskLinks.$inferInsert;
export type Action = typeof actions.$inferSelect;
export type DailyReport = typeof dailyReports.$inferSelect;
