// Jira REST API 직접 연동 — Cowork MCP 의존성 제거
// 필요 환경변수: JIRA_SITE_URL, JIRA_USER_EMAIL, JIRA_API_TOKEN, JIRA_USER_ACCOUNT_ID

const JIRA_SITE = process.env.JIRA_SITE_URL || "https://catchtable.atlassian.net";
const JIRA_EMAIL = process.env.JIRA_USER_EMAIL || "";
const JIRA_TOKEN = process.env.JIRA_API_TOKEN || "";
const JIRA_ACCOUNT_ID = process.env.JIRA_USER_ACCOUNT_ID || "63d8cbafc2b1cb6b346f8ab4";

function authHeader(): string {
  return "Basic " + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString("base64");
}

async function jiraFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${JIRA_SITE}/rest/api/3${path}`, {
    ...options,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira API error ${res.status}: ${text}`);
  }

  return res.json();
}

// JQL로 이슈 검색 (Jira Cloud 신규 API: /rest/api/3/search/jql)
export async function searchIssues(jql: string, maxResults = 50) {
  const data = await jiraFetch(
    `/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=summary,status,priority,duedate,updated,assignee`
  );
  return data.issues as JiraIssue[];
}

// 단일 이슈 조회
export async function getIssue(issueKey: string) {
  return jiraFetch(`/issue/${issueKey}?fields=summary,status,priority,duedate,updated`);
}

// 이슈 전환 가능 목록 조회
export async function getTransitions(issueKey: string) {
  const data = await jiraFetch(`/issue/${issueKey}/transitions`);
  return data.transitions as JiraTransition[];
}

// 이슈 상태 전환 실행
export async function transitionIssue(issueKey: string, transitionId: string) {
  await jiraFetch(`/issue/${issueKey}/transitions`, {
    method: "POST",
    body: JSON.stringify({ transition: { id: transitionId } }),
  });
}

// 내 담당 미완료 이슈 조회
export async function getMyOpenIssues(projectKey = "BIZWAIT") {
  return searchIssues(
    `assignee = "${JIRA_ACCOUNT_ID}" AND project = "${projectKey}" AND status != "Done" ORDER BY updated DESC`
  );
}

// 최근 완료 이슈 조회
export async function getMyRecentDoneIssues(projectKey = "BIZWAIT", days = 7) {
  return searchIssues(
    `assignee = "${JIRA_ACCOUNT_ID}" AND project = "${projectKey}" AND status = "Done" AND updated >= -${days}d ORDER BY updated DESC`
  );
}

// 특정 이슈의 현재 상태만 가져오기
export async function getIssueStatus(issueKey: string): Promise<string | null> {
  try {
    const issue = await getIssue(issueKey);
    return issue.fields.status.name;
  } catch {
    return null;
  }
}

// Jira 설정 유효성 체크
export function isJiraConfigured(): boolean {
  return !!(JIRA_EMAIL && JIRA_TOKEN);
}

// Types
export interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    priority: { name: string };
    duedate: string | null;
    updated: string;
  };
}

export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string };
}
