import { NextRequest, NextResponse } from "next/server";
import * as jira from "@/lib/integrations/jira";

// GET /api/jira/meta — Jira 프로젝트, 이슈타입, 우선순위 메타데이터 조회
// ?projectKey=BIZWAIT → 해당 프로젝트의 이슈타입도 함께 반환
export async function GET(request: NextRequest) {
  if (!jira.isJiraConfigured()) {
    return NextResponse.json(
      { error: "Jira API 미설정", configured: false },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);
  const projectKey = searchParams.get("projectKey");

  try {
    // 병렬 조회: 프로젝트 + 우선순위 (+ 이슈타입)
    const [projects, priorities, issueTypes] = await Promise.all([
      jira.getProjects(),
      jira.getPriorities(),
      projectKey
        ? jira.getIssueTypesForProject(projectKey)
        : Promise.resolve([]),
    ]);

    return NextResponse.json({
      configured: true,
      projects,
      priorities,
      issueTypes,
    });
  } catch (error) {
    console.error("[Jira Meta] Failed:", error);
    return NextResponse.json(
      { error: `Jira 메타데이터 조회 실패: ${error}`, configured: true },
      { status: 500 }
    );
  }
}
