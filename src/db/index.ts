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
CREATE TABLE IF NOT EXISTS workflow_logs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  date TEXT NOT NULL,
  summary TEXT,
  slack_message_ts TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(date, type)
);
`;

// 앱 시작 시 테이블 초기화
client.executeMultiple(initSQL).catch((err) => {
  console.error("[DB] Table init failed:", err);
});

// 컬럼 마이그레이션 (기존 DB에 컬럼 없을 경우 추가)
const migrationSQL = [
  "ALTER TABLE task_links ADD COLUMN gcal_event_id TEXT",
  "ALTER TABLE task_links ADD COLUMN gcal_calendar_id TEXT",
  "ALTER TABLE task_links ADD COLUMN jira_created_at TEXT",
  // sortOrder 추가 (드래그&드롭 정렬용)
  "ALTER TABLE tasks ADD COLUMN sort_order INTEGER DEFAULT 0",
  // 인덱스 추가 (쿼리 성능 최적화)
  "CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)",
  "CREATE INDEX IF NOT EXISTS idx_task_links_task_id ON task_links(task_id)",
  "CREATE INDEX IF NOT EXISTS idx_task_links_type_jira ON task_links(link_type, jira_issue_key)",
  "CREATE INDEX IF NOT EXISTS idx_task_links_type_slack ON task_links(link_type, slack_thread_ts)",
  "CREATE INDEX IF NOT EXISTS idx_task_links_type_gcal ON task_links(link_type, gcal_event_id)",
  "CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status)",
  "CREATE INDEX IF NOT EXISTS idx_actions_task_id ON actions(task_id)",
  "CREATE INDEX IF NOT EXISTS idx_actions_action_type ON actions(action_type)",
];
(async () => {
  for (const sql of migrationSQL) {
    try {
      await client.execute(sql);
    } catch {
      // 이미 존재하는 컬럼이면 무시
    }
  }
})();
