import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

const client = createClient({
  url: process.env.DATABASE_URL || "file:./data/work-autopilot.db",
});

export const db = drizzle(client, { schema });
export { schema };

const initSQL = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
  status TEXT NOT NULL DEFAULT 'pending', priority TEXT NOT NULL DEFAULT 'medium',
  source_type TEXT NOT NULL DEFAULT 'manual', due_date TEXT, sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  completed_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE TABLE IF NOT EXISTS task_links (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL, jira_issue_key TEXT, jira_issue_url TEXT, jira_status TEXT,
  jira_project_key TEXT, slack_channel_id TEXT, slack_channel_name TEXT,
  slack_thread_ts TEXT, slack_thread_url TEXT, last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL, description TEXT NOT NULL, payload TEXT,
  status TEXT NOT NULL DEFAULT 'proposed', result_link TEXT,
  proposed_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')), executed_at TEXT
);
CREATE TABLE IF NOT EXISTS daily_reports (
  id TEXT PRIMARY KEY, date TEXT NOT NULL UNIQUE, summary TEXT,
  pending_actions TEXT, slack_message_ts TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
`;

client.executeMultiple(initSQL).catch((err) => {
  console.error("[DB] Table init failed:", err);
});

const migrationSQL = [
  "ALTER TABLE task_links ADD COLUMN gcal_event_id TEXT",
  "ALTER TABLE task_links ADD COLUMN gcal_calendar_id TEXT",
  "ALTER TABLE tasks ADD COLUMN sort_order INTEGER DEFAULT 0",
];
(async () => {
  for (const sql of migrationSQL) {
    try { await client.execute(sql); } catch { /* 이미 존재하는 컬럼이면 무시 */ }
  }
})();
