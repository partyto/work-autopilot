import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq, desc } from "drizzle-orm";
import { generateId, nowLocal, todayDate } from "@/lib/utils";

// GET /api/reports - 일일 리포트 목록 조회
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const limit = parseInt(searchParams.get("limit") || "7");

  try {
    if (date) {
      const report = await db.query.dailyReports.findFirst({
        where: eq(schema.dailyReports.date, date),
      });
      return NextResponse.json(report || null);
    }

    const reports = await db.query.dailyReports.findMany({
      orderBy: [desc(schema.dailyReports.date)],
      limit,
    });

    return NextResponse.json(reports);
  } catch (error) {
    console.error("Failed to fetch reports:", error);
    return NextResponse.json({ error: "리포트 조회 실패" }, { status: 500 });
  }
}

// POST /api/reports - 일일 리포트 생성/갱신 (Scheduled Task에서 호출)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date = todayDate(), summary, pendingActions, slackMessageTs } = body;

    // 같은 날짜 리포트가 있으면 업데이트
    const existing = await db.query.dailyReports.findFirst({
      where: eq(schema.dailyReports.date, date),
    });

    if (existing) {
      await db
        .update(schema.dailyReports)
        .set({
          summary: summary ? JSON.stringify(summary) : existing.summary,
          pendingActions: pendingActions ? JSON.stringify(pendingActions) : existing.pendingActions,
          slackMessageTs: slackMessageTs || existing.slackMessageTs,
        })
        .where(eq(schema.dailyReports.id, existing.id));

      const updated = await db.query.dailyReports.findFirst({
        where: eq(schema.dailyReports.id, existing.id),
      });
      return NextResponse.json(updated);
    }

    // 새 리포트 생성
    const reportId = generateId();
    const now = nowLocal();

    await db.insert(schema.dailyReports).values({
      id: reportId,
      date,
      summary: summary ? JSON.stringify(summary) : null,
      pendingActions: pendingActions ? JSON.stringify(pendingActions) : null,
      slackMessageTs: slackMessageTs || null,
      createdAt: now,
    });

    const created = await db.query.dailyReports.findFirst({
      where: eq(schema.dailyReports.id, reportId),
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("Failed to create report:", error);
    return NextResponse.json({ error: "리포트 생성 실패" }, { status: 500 });
  }
}
