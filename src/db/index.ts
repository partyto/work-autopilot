import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

const client = createClient({
  url: process.env.DATABASE_URL || "file:./data/work-autopilot.db",
});

export const db = drizzle(client, { schema });
export { schema };

// DB 테이블 자동 생성 (없으면 CREATE)
const initSQL = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'medium',
  source_type TEXT NOT NULL DEFAULT 'manual',
  due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE TABLE IF NOT EXISTS task_links (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL,
  jira_issue_key TEXT,
  jira_issue_url TEXT,
  jira_status TEXT,
  jira_project_key TEXT,
  slack_channel_id TEXT,
  slack_channel_name TEXT,
  slack_thread_ts TEXT,
  slack_thread_url TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  result_link TEXT,
  proposed_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  executed_at TEXT
);
CREATE TABLE IF NOT EXISTS daily_reports (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  summary TEXT,
  pending_actions TEXT,
  slack_message_ts TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
`;

// 앱 시작 시 테이블 초기화
client.executeMultiple(initSQL).catch((err) => {
  console.error("[DB] Table init failed:", err);
});
