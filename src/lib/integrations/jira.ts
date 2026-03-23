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

  // 204 No Content 등 빈 응답 처리 (예: transition POST)
  const text = await res.text();
  if (!text) return {};
  return JSON.parse(text);
}

// ===== 검색 =====

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

// ===== 전환 =====

export async function getTransitions(issueKey: string) {
  const data = await jiraFetch(`/issue/${issueKey}/transitions`);
  return data.transitions as JiraTransition[];
}

export async function transitionIssue(issueKey: string, transitionId: string) {
  await jiraFetch(`/issue/${issueKey}/transitions`, {
    method: "POST",
    body: JSON.stringify({ transition: { id: transitionId } }),
  });
}

// ===== 메타데이터 조회 =====

// 접근 가능한 프로젝트 목록
export async function getProjects(): Promise<JiraProject[]> {
  const data = await jiraFetch("/project/search?maxResults=50&orderBy=name");
  return (data.values || []).map((p: any) => ({
    key: p.key,
    name: p.name,
    id: p.id,
  }));
}

// 프로젝트별 이슈 타입 목록
export async function getIssueTypesForProject(projectKey: string): Promise<JiraIssueType[]> {
  const data = await jiraFetch(`/issue/createmeta/${projectKey}/issuetypes`);
  return (data.issueTypes || data.values || []).map((it: any) => ({
    id: it.id,
    name: it.name,
    subtask: it.subtask || false,
  }));
}

// 프로젝트 + 이슈타입별 생성 가능 필드 및 허용값 조회
export async function getCreateFields(
  projectKey: string,
  issueTypeId: string
): Promise<JiraCreateField[]> {
  const data = await jiraFetch(
    `/issue/createmeta/${projectKey}/issuetypes/${issueTypeId}`
  );
  const rawFields = data.fields || data.values || [];

  // 시스템이 자동 처리하는 필드는 제외 (프론트에서 입력 불필요)
  const SKIP_FIELDS = new Set([
    "project",
    "issuetype",
    "reporter",
    "attachment",
    "issuelinks",
    "timetracking",
    "worklog",
    "comment",
    "thumbnail",
    "watches",
    "votes",
    "subtasks",
    "created",
    "updated",
    "statuscategorychangedate",
    "lastViewed",
    "security",
    "creator",
    "aggregatetimeestimate",
    "aggregatetimeoriginalestimate",
    "aggregatetimespent",
    "environment",
    "timespent",
    "timeoriginalestimate",
    "timeestimate",
    "aggregateprogress",
    "progress",
    "workratio",
    "resolution",
    "resolutiondate",
    "status",
    "parent",
  ]);

  return rawFields
    .filter((f: any) => !SKIP_FIELDS.has(f.fieldId))
    .map((f: any) => {
      const field: JiraCreateField = {
        fieldId: f.fieldId,
        name: f.name,
        required: f.required || false,
        schema: {
          type: f.schema?.type || "string",
          items: f.schema?.items || undefined,
          custom: f.schema?.custom || undefined,
        },
        allowedValues: undefined,
        autoCompleteUrl: f.autoCompleteUrl || undefined,
      };

      // 허용값이 있는 경우 정리
      if (f.allowedValues && Array.isArray(f.allowedValues)) {
        field.allowedValues = f.allowedValues.map((v: any) => ({
          id: v.id,
          name: v.name || v.value || v.label || v.displayName || v.key || String(v.id),
          value: v.value || v.name || undefined,
        }));
      }

      return field;
    });
}

// 우선순위 목록
export async function getPriorities(): Promise<JiraPriority[]> {
  const data = await jiraFetch("/priority/search?maxResults=50");
  return (data.values || []).map((p: any) => ({
    id: p.id,
    name: p.name,
  }));
}

// ===== 이슈 생성 =====

// 동적 필드 기반 이슈 생성
export async function createIssue(options: {
  projectKey: string;
  issueTypeName: string;
  fields: Record<string, any>; // 동적 필드 값
}): Promise<{ key: string; id: string; self: string }> {
  const apiFields: Record<string, any> = {
    project: { key: options.projectKey },
    issuetype: { name: options.issueTypeName },
  };

  // 동적 필드 매핑
  for (const [fieldId, value] of Object.entries(options.fields)) {
    if (value === undefined || value === null || value === "") continue;

    switch (fieldId) {
      case "summary":
        apiFields.summary = value;
        break;
      case "description":
        // Atlassian Document Format
        apiFields.description = {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: String(value) }],
            },
          ],
        };
        break;
      case "priority":
        apiFields.priority = { name: value };
        break;
      case "assignee":
        apiFields.assignee = { accountId: value };
        break;
      case "duedate":
        apiFields.duedate = value;
        break;
      case "labels":
        apiFields.labels = Array.isArray(value) ? value : [value];
        break;
      case "components":
        apiFields.components = Array.isArray(value)
          ? value.map((v: any) => (typeof v === "string" ? { name: v } : v))
          : [{ name: value }];
        break;
      default:
        // select 타입 (option, priority 등): { id: "xxx" } 또는 { name: "xxx" }
        // 배열 타입: [{ id: "xxx" }]
        apiFields[fieldId] = value;
        break;
    }
  }

  return jiraFetch("/issue", {
    method: "POST",
    body: JSON.stringify({ fields: apiFields }),
  });
}

// 현재 사용자 Account ID 반환
export function getMyAccountId(): string {
  return JIRA_ACCOUNT_ID;
}

// Jira 설정 유효성 체크
export function isJiraConfigured(): boolean {
  return !!(JIRA_EMAIL && JIRA_TOKEN);
}

// ===== Types =====

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

export interface JiraProject {
  key: string;
  name: string;
  id: string;
}

export interface JiraIssueType {
  id: string;
  name: string;
  subtask: boolean;
}

export interface JiraPriority {
  id: string;
  name: string;
}

export interface JiraCreateField {
  fieldId: string;
  name: string;
  required: boolean;
  schema: {
    type: string;
    items?: string;
    custom?: string;
  };
  allowedValues?: { id: string; name: string; value?: string }[];
  autoCompleteUrl?: string;
}
