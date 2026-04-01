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

  // 204 No Content (예: transition POST) — 빈 바디이므로 json 파싱 생략
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return null;
  }

  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

// JQL로 이슈 검색
export async function searchIssues(jql: string, maxResults = 50) {
  const data = await jiraFetch(
    `/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=summary,status,priority,duedate,updated,created,assignee`
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

// 현재 사용자 Account ID 반환
export function getMyAccountId(): string {
  return JIRA_ACCOUNT_ID;
}

// 전체 프로젝트 목록 조회
export async function getProjects(): Promise<JiraProject[]> {
  const data = await jiraFetch("/project/search?maxResults=100&orderBy=name");
  return (data.values || []) as JiraProject[];
}

// 프로젝트의 이슈 타입 목록 조회
export async function getIssueTypes(projectKey: string): Promise<JiraIssueType[]> {
  const data = await jiraFetch(`/issue/createmeta?projectKeys=${projectKey}&expand=projects.issuetypes`);
  const project = (data.projects || [])[0];
  return (project?.issuetypes || []) as JiraIssueType[];
}

// 이슈 생성 메타 (필드 목록) 조회
export async function getCreateMetaFields(projectKey: string, issueTypeId: string): Promise<JiraCreateField[]> {
  const data = await jiraFetch(
    `/issue/createmeta/${projectKey}/issuetypes/${issueTypeId}?maxResults=50`
  );
  return (data.fields || []) as JiraCreateField[];
}

// 이슈 필드 업데이트 (기한 등)
export async function updateIssue(issueKey: string, fields: Record<string, any>) {
  await jiraFetch(`/issue/${issueKey}`, {
    method: "PUT",
    body: JSON.stringify({ fields }),
  });
}

// 이슈 생성
export async function createIssue(fields: Record<string, any>): Promise<{ key: string; id: string; self: string }> {
  return jiraFetch("/issue", {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
}

// Jira 설정 유효성 체크
export function isJiraConfigured(): boolean {
  return !!(JIRA_EMAIL && JIRA_TOKEN);
}

// JIRA 이슈에 파일 첨부
export async function attachFileToIssue(
  issueKey: string,
  filename: string,
  buffer: Buffer,
): Promise<void> {
  const blob = new Blob([new Uint8Array(buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const formData = new FormData();
  formData.append("file", blob, filename);

  const res = await fetch(
    `${JIRA_SITE}/rest/api/3/issue/${issueKey}/attachments`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "X-Atlassian-Token": "no-check",
      },
      body: formData,
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`JIRA attachment failed (${res.status}): ${text}`);
  }
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
    created?: string;
  };
}

export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string };
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
}

export interface JiraIssueType {
  id: string;
  name: string;
  subtask: boolean;
}

export interface JiraCreateField {
  fieldId: string;
  name: string;
  required: boolean;
  schema: { type: string; items?: string; custom?: string };
  allowedValues?: { id: string; name: string; value?: string }[];
}
