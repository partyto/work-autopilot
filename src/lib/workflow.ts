// 하루 시작(SOD) / 하루 마무리(EOD) 워크플로
import { db, schema } from "@/db";
import { eq, and, or, lt, notInArray, inArray, isNotNull, like } from "drizzle-orm";
import { generateId, nowLocal } from "@/lib/utils";
import * as slack from "@/lib/integrations/slack";
import * as gcal from "@/lib/integrations/gcal";
import { runDailyScan } from "@/lib/engine";
import { formatWorkingDate, prevWorkingDay, toKSTDateStr, toBusinessDateStr } from "@/lib/holidays";

const PRIORITY_LABEL: Record<string, string> = { urgent: "긴급", high: "높음", medium: "보통", low: "낮음" };
const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const STATUS_LABEL: Record<string, string> = {
  pending: "대기", in_progress: "진행 중", in_qa: "IN-QA",
  done: "완료", cancelled: "취소",
};

/** 우선순위 > 기한(없으면 맨 뒤) > 제목 가나다 정렬 */
function sortTasks<T extends { priority: string; dueDate?: string | null; title: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const pd = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
    if (pd !== 0) return pd;
    const da = a.dueDate ?? "9999-99-99";
    const db2 = b.dueDate ?? "9999-99-99";
    if (da !== db2) return da < db2 ? -1 : 1;
    return a.title.localeCompare(b.title, "ko");
  });
}

/** "YYYY-MM-DD" → "MM-DD" */
function fmtDue(dueDate?: string | null): string {
  if (!dueDate) return "";
  return dueDate.slice(5); // "MM-DD"
}


// ===== 공통: 어제 EOD carryover → 현재 상태 조회 =====
export async function getCarriedOverTasks(todayStr: string): Promise<
  Array<{ id: string; title: string; currentStatus: string; priority: string }>
> {
  const yesterday = prevWorkingDay(new Date());
  const yesterdayStr = toKSTDateStr(yesterday);

  const yesterdayEod = await db.query.workflowLogs.findFirst({
    where: (w) => and(eq(w.date, yesterdayStr), eq(w.type, "eod")),
  });

  if (!yesterdayEod?.summary) {
    // EOD 로그 없으면 현재 미완료 전체로 fallback
    return db.select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      currentStatus: schema.tasks.status,
      priority: schema.tasks.priority,
    }).from(schema.tasks).where(
      or(
        eq(schema.tasks.status, "pending"),
        eq(schema.tasks.status, "in_progress"),
        eq(schema.tasks.status, "in_qa"),
      )
    );
  }

  try {
    const { carriedOverIds } = JSON.parse(yesterdayEod.summary) as { carriedOverIds: string[] };
    if (!carriedOverIds?.length) return [];
    return db.select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      currentStatus: schema.tasks.status,
      priority: schema.tasks.priority,
    }).from(schema.tasks).where(
      and(
        inArray(schema.tasks.id, carriedOverIds),
        notInArray(schema.tasks.status, ["done", "cancelled"]),
      )
    );
  } catch {
    console.warn("[Workflow] carriedOver 파싱 실패 — fallback to 전체 미완료");
    return db.select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      currentStatus: schema.tasks.status,
      priority: schema.tasks.priority,
    }).from(schema.tasks).where(
      or(
        eq(schema.tasks.status, "pending"),
        eq(schema.tasks.status, "in_progress"),
        eq(schema.tasks.status, "in_qa"),
      )
    );
  }
}

// ===== EOD (하루 마무리) =====
export async function runEndOfDay(): Promise<{ message: string }> {
  const today = new Date();
  const todayStr = toBusinessDateStr(today); // 5시 이전은 전날로 취급

  const [completedToday, carriedOver, overdue] = await Promise.all([
    // 오늘 완료된 항목
    db.select().from(schema.tasks).where(
      and(eq(schema.tasks.status, "done"), like(schema.tasks.completedAt, `${todayStr}%`))
    ),
    // 이관 항목 (진행 중/대기 상태 — 내일로 넘어가는 것들)
    db.select().from(schema.tasks).where(
      or(
        eq(schema.tasks.status, "pending"),
        eq(schema.tasks.status, "in_progress"),
        eq(schema.tasks.status, "in_qa"),
      )
    ),
    // 기한 초과
    db.select().from(schema.tasks).where(
      and(
        isNotNull(schema.tasks.dueDate),
        lt(schema.tasks.dueDate, todayStr),
        notInArray(schema.tasks.status, ["done", "cancelled"]),
      )
    ),
  ]);

  // Slack 메시지 구성
  const lines: string[] = [];
  lines.push(`*📊 하루 마무리 — ${formatWorkingDate(today)}*\n`);

  lines.push(`*✅ 오늘 완료 (${completedToday.length}건)*`);
  if (completedToday.length > 0) {
    completedToday.slice(0, 5).forEach((t) => {
      const p = PRIORITY_LABEL[t.priority] ? `[${PRIORITY_LABEL[t.priority]}] ` : "";
      lines.push(`• ${p}${t.title}`);
    });
    if (completedToday.length > 5) lines.push(`• ...외 ${completedToday.length - 5}건`);
  } else {
    lines.push("• 없음");
  }

  lines.push(`\n*🔄 이관 (${carriedOver.length}건) — 내일로 넘어가는 할일*`);
  if (carriedOver.length > 0) {
    const sorted = sortTasks(carriedOver);
    sorted.slice(0, 7).forEach((t) => {
      const p = PRIORITY_LABEL[t.priority] ? `[${PRIORITY_LABEL[t.priority]}] ` : "";
      const s = STATUS_LABEL[t.status] || t.status;
      const due = fmtDue(t.dueDate) ? ` (${fmtDue(t.dueDate)})` : "";
      lines.push(`• ${p}${t.title}${due} — ${s}`);
    });
    if (sorted.length > 7) lines.push(`• ...외 ${sorted.length - 7}건`);
  } else {
    lines.push("• 없음");
  }

  if (overdue.length > 0) {
    lines.push(`\n*⚠️ 기한 초과 (${overdue.length}건)*`);
    const sortedOverdue = sortTasks(overdue);
    sortedOverdue.slice(0, 5).forEach((t) => {
      const p = PRIORITY_LABEL[t.priority] ? `[${PRIORITY_LABEL[t.priority]}] ` : "";
      lines.push(`• ${p}${t.title} (기한: ${fmtDue(t.dueDate)})`);
    });
    if (sortedOverdue.length > 5) lines.push(`• ...외 ${sortedOverdue.length - 5}건`);
  }

  // Jira/Slack/GCal 스캔 포함 (기존 runDailyScan 통합)
  try {
    const scanResult = await runDailyScan(false); // 스캔 결과만, DM은 아래서 통합 발송
    if (scanResult.scanItems.length > 0) {
      lines.push(`\n*🔍 스캔 결과 (${scanResult.scanItems.length}건)*`);
      scanResult.scanItems.slice(0, 5).forEach((item) => {
        if (item.type === "jira") lines.push(`• [Jira] ${item.key} ${item.summary}`);
        else lines.push(`• [Slack] #${item.channel} — ${item.preview}`);
      });
    }
  } catch (err) {
    console.warn("[Workflow] Scan during EOD failed:", err);
  }

  lines.push(`\n_🤖 Work Pavlotrasche — 하루 마무리 자동 리포트_`);

  const message = lines.join("\n");
  let slackTs: string | null = null;

  if (slack.isSlackConfigured()) {
    try {
      const result = await slack.sendDM(message);
      slackTs = result.ts;
    } catch (err) {
      console.error("[Workflow] EOD Slack DM failed:", err);
    }
  }

  // DB 저장
  const summaryData = {
    completedIds: completedToday.map((t) => t.id),
    carriedOverIds: carriedOver.map((t) => t.id),
    overdueIds: overdue.map((t) => t.id),
    counts: {
      completed: completedToday.length,
      carriedOver: carriedOver.length,
      overdue: overdue.length,
    },
  };

  await db.insert(schema.workflowLogs).values({
    id: generateId(),
    type: "eod",
    date: todayStr,
    summary: JSON.stringify(summaryData),
    slackMessageTs: slackTs ?? undefined,
    createdAt: nowLocal(),
  }).onConflictDoUpdate({
    target: [schema.workflowLogs.date, schema.workflowLogs.type],
    set: {
      summary: JSON.stringify(summaryData),
      slackMessageTs: slackTs ?? undefined,
      createdAt: nowLocal(),
    },
  });

  console.log(`[Workflow] EOD completed for ${todayStr}`);
  return { message };
}

// ===== SOD (하루 시작) =====
export async function runStartOfDay(): Promise<{ message: string }> {
  const today = new Date();
  const todayStr = toBusinessDateStr(today); // 5시 이전은 전날로 취급
  const yesterdayStr = toKSTDateStr(prevWorkingDay(today));

  const [carriedOverItems, newToday, dueToday, overdueNow, activeStatuses] = await Promise.all([
    // 어제 EOD에서 이관된 항목 (공통 헬퍼)
    getCarriedOverTasks(todayStr),
    // 오늘 새로 생긴 할일
    db.select().from(schema.tasks).where(
      and(
        like(schema.tasks.createdAt, `${todayStr}%`),
        notInArray(schema.tasks.status, ["done", "cancelled"]),
      )
    ),
    // 오늘 마감인 할일
    db.select().from(schema.tasks).where(
      and(
        eq(schema.tasks.dueDate, todayStr),
        notInArray(schema.tasks.status, ["done", "cancelled"]),
      )
    ),
    // 기한 초과
    db.select().from(schema.tasks).where(
      and(
        isNotNull(schema.tasks.dueDate),
        lt(schema.tasks.dueDate, todayStr),
        notInArray(schema.tasks.status, ["done", "cancelled"]),
      )
    ),
    // 현황 카운트용
    db.select({ status: schema.tasks.status }).from(schema.tasks).where(
      or(
        eq(schema.tasks.status, "in_progress"),
        eq(schema.tasks.status, "in_qa"),
        eq(schema.tasks.status, "pending"),
      )
    ),
  ]);

  // Slack 메시지 구성
  const lines: string[] = [];
  lines.push(`*🌅 하루 시작 — ${formatWorkingDate(today)}*\n`);

  if (carriedOverItems.length > 0) {
    lines.push(`*📥 어제에서 이관 (${carriedOverItems.length}건)*`);
    const sortedCarried = sortTasks(carriedOverItems.map((item) => ({ ...item, dueDate: null })));
    sortedCarried.slice(0, 7).forEach((item) => {
      const p = PRIORITY_LABEL[item.priority] ? `[${PRIORITY_LABEL[item.priority]}] ` : "";
      const s = STATUS_LABEL[item.currentStatus] || item.currentStatus;
      const done = item.currentStatus === "done" ? " ✅ 완료됨" : ` — ${s}`;
      lines.push(`• ${p}${item.title}${done}`);
    });
    if (carriedOverItems.length > 7) lines.push(`• ...외 ${carriedOverItems.length - 7}건`);
  } else {
    lines.push("*📥 어제에서 이관*\n• 없음");
  }

  if (newToday.length > 0) {
    lines.push(`\n*🆕 오늘 새로 생긴 할일 (${newToday.length}건)*`);
    const sortedNew = sortTasks(newToday);
    sortedNew.slice(0, 5).forEach((t) => {
      const p = PRIORITY_LABEL[t.priority] ? `[${PRIORITY_LABEL[t.priority]}] ` : "";
      const due = fmtDue(t.dueDate) ? ` (${fmtDue(t.dueDate)})` : "";
      lines.push(`• ${p}${t.title}${due}`);
    });
    if (newToday.length > 5) lines.push(`• ...외 ${newToday.length - 5}건`);
  }

  if (dueToday.length > 0) {
    lines.push(`\n*📅 오늘 마감 (${dueToday.length}건)*`);
    sortTasks(dueToday).forEach((t) => {
      const p = PRIORITY_LABEL[t.priority] ? `[${PRIORITY_LABEL[t.priority]}] ` : "";
      lines.push(`• ${p}${t.title} (D-0)`);
    });
  }

  if (overdueNow.length > 0) {
    lines.push(`\n*⚠️ 기한 초과 (${overdueNow.length}건)*`);
    sortTasks(overdueNow).slice(0, 3).forEach((t) => {
      const p = PRIORITY_LABEL[t.priority] ? `[${PRIORITY_LABEL[t.priority]}] ` : "";
      lines.push(`• ${p}${t.title} (기한: ${fmtDue(t.dueDate)})`);
    });
    if (overdueNow.length > 3) lines.push(`• ...외 ${overdueNow.length - 3}건`);
  }

  // 전체 현황
  const inProgressCount = activeStatuses.filter((t) => t.status === "in_progress" || t.status === "in_qa").length;
  const pendingCount = activeStatuses.filter((t) => t.status === "pending").length;
  lines.push(`\n*📊 현재 현황*`);
  lines.push(`• 진행 중: ${inProgressCount}건 · 대기: ${pendingCount}건`);

  // 구글 캘린더 오늘 일정 (공개 미팅만)
  if (gcal.isGcalConfigured()) {
    try {
      const { timeMin, timeMax } = gcal.getTodayRange();
      const events = await gcal.listEvents(timeMin, timeMax);
      // visibility가 "public"이거나 "default"(공개)인 미팅만, 종일 이벤트 제외
      const meetings = events.filter((e) => {
        const vis = (e as unknown as Record<string, string>).visibility;
        return e.start.dateTime && vis !== "private";
      });
      if (meetings.length > 0) {
        lines.push(`\n*📅 오늘 미팅 (${meetings.length}건)*`);
        meetings.forEach((e) => {
          const time = gcal.formatEventTime(e);
          lines.push(`• ${time} ${e.summary}`);
        });
      }
    } catch (err) {
      console.warn("[Workflow] SOD GCal fetch failed:", err);
    }
  }

  lines.push(`\n_🤖 Work Pavlotrasche — 하루 시작 자동 리포트_`);

  const message = lines.join("\n");
  let slackTs: string | null = null;

  if (slack.isSlackConfigured()) {
    try {
      const result = await slack.sendDM(message);
      slackTs = result.ts;
    } catch (err) {
      console.error("[Workflow] SOD Slack DM failed:", err);
    }
  }

  // DB 저장
  const summaryData = {
    carriedOverCount: carriedOverItems.length,
    newTodayCount: newToday.length,
    dueTodayCount: dueToday.length,
    overdueCount: overdueNow.length,
    prevEodDate: yesterdayStr,
  };

  await db.insert(schema.workflowLogs).values({
    id: generateId(),
    type: "sod",
    date: todayStr,
    summary: JSON.stringify(summaryData),
    slackMessageTs: slackTs ?? undefined,
    createdAt: nowLocal(),
  }).onConflictDoUpdate({
    target: [schema.workflowLogs.date, schema.workflowLogs.type],
    set: {
      summary: JSON.stringify(summaryData),
      slackMessageTs: slackTs ?? undefined,
      createdAt: nowLocal(),
    },
  });

  console.log(`[Workflow] SOD completed for ${todayStr}`);
  return { message };
}

// ===== SOD 완료 여부 확인 =====
export async function hasTodaySOD(): Promise<boolean> {
  const todayStr = toBusinessDateStr(new Date());
  const log = await db.query.workflowLogs.findFirst({
    where: (w) => and(eq(w.date, todayStr), eq(w.type, "sod")),
  });
  return !!log;
}

// ===== 10:00 넛지 — 아직 하루 시작 안 했을 때 =====
export async function sendSODNudge(): Promise<void> {
  const today = new Date();
  const dateLabel = formatWorkingDate(today);
  const dashboardUrl = process.env.APP_URL ?? "http://localhost:3100";

  const message = [
    `*🌅 하루를 시작해 볼까요?*`,
    ``,
    `오늘 *${dateLabel}* 아직 하루 시작을 하지 않으셨네요.`,
    `준비되셨으면 대시보드에서 시작해 주세요 👇`,
    ``,
    `<${dashboardUrl}|📋 대시보드 열기>`,
    ``,
    `_🤖 Work Pavlotrasche — 자동 알림_`,
  ].join("\n");

  if (slack.isSlackConfigured()) {
    try {
      await slack.sendDM(message);
      console.log(`[Workflow] SOD nudge sent for ${toKSTDateStr(today)}`);
    } catch (err) {
      console.error("[Workflow] SOD nudge Slack DM failed:", err);
    }
  }
}
