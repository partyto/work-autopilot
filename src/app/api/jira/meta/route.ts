import { NextRequest, NextResponse } from "next/server";
import * as jira from "@/lib/integrations/jira";

// 즐겨찾기 프로젝트 (최상단 고정)
const PINNED_PROJECT_NAMES = ["서비스관리 - 웨이팅", "서비스관리 - 예약"];

// GET /api/jira/meta
// ?action=projects               → 프로젝트 목록 (즐겨찾기 상단 고정)
// ?action=issuetypes&project=KEY  → 해당 프로젝트의 이슈타입 목록
// ?action=fields&project=KEY&issueTypeId=ID → 해당 프로젝트+이슈타입의 생성 필드 + 허용값
export async function GET(request: NextRequest) {
  if (!jira.isJiraConfigured()) {
    return NextResponse.json(
      { error: "Jira API 미설정", configured: false },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "projects";
  const projectKey = searchParams.get("project");
  const issueTypeId = searchParams.get("issueTypeId");

  try {
    switch (action) {
      case "projects": {
        const projects = await jira.getProjects();
        // 즐겨찾기 프로젝트 상단 고정
        const pinned: typeof projects = [];
        const rest: typeof projects = [];
        for (const p of projects) {
          if (PINNED_PROJECT_NAMES.some((name) => p.name.includes(name.replace("서비스관리 - ", "")))) {
            pinned.push(p);
          } else {
            rest.push(p);
          }
        }
        return NextResponse.json({
          configured: true,
          projects: [...pinned, ...rest],
          pinnedKeys: pinned.map((p) => p.key),
        });
      }

      case "issuetypes": {
        if (!projectKey) {
          return NextResponse.json({ error: "project 파라미터 필요" }, { status: 400 });
        }
        const issueTypes = await jira.getIssueTypesForProject(projectKey);
        // 서브태스크 제외
        const filtered = issueTypes.filter((it) => !it.subtask);
        return NextResponse.json({ configured: true, issueTypes: filtered });
      }

      case "fields": {
        if (!projectKey || !issueTypeId) {
          return NextResponse.json(
            { error: "project, issueTypeId 파라미터 필요" },
            { status: 400 }
          );
        }
        const fields = await jira.getCreateFields(projectKey, issueTypeId);
        return NextResponse.json({
          configured: true,
          fields,
          myAccountId: jira.getMyAccountId(),
        });
      }

      default:
        return NextResponse.json({ error: `알 수 없는 action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error("[Jira Meta] Failed:", error);
    return NextResponse.json(
      { error: `Jira 메타데이터 조회 실패: ${error}`, configured: true },
      { status: 500 }
    );
  }
}
