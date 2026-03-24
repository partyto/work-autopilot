import { NextRequest, NextResponse } from "next/server";
import * as jira from "@/lib/integrations/jira";

export async function GET(req: NextRequest) {
  if (!jira.isJiraConfigured()) {
    return NextResponse.json({ error: "Jira not configured" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");

  try {
    if (action === "projects") {
      const projects = await jira.getProjects();
      return NextResponse.json(projects);
    }

    if (action === "issuetypes") {
      const projectKey = searchParams.get("project");
      if (!projectKey) {
        return NextResponse.json({ error: "project param required" }, { status: 400 });
      }
      const types = await jira.getIssueTypes(projectKey);
      return NextResponse.json(types);
    }

    if (action === "fields") {
      const projectKey = searchParams.get("project");
      const issueTypeId = searchParams.get("issueTypeId");
      if (!projectKey || !issueTypeId) {
        return NextResponse.json({ error: "project and issueTypeId params required" }, { status: 400 });
      }
      const fields = await jira.getCreateMetaFields(projectKey, issueTypeId);
      return NextResponse.json(fields);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
