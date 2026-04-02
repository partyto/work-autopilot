// 하루 시작(SOD) / 하루 마무리(EOD) 워크플로
import { db, schema } from "@/db";
import { eq, and, lt, gte } from "drizzle-orm";
import { generateId, nowLocal, todayDate } from "@/lib/utils";
import * as slack from "@/lib/integrations/slack";
import { runDailyScan } from "@/lib/engine";
import { formatWorkingDate, prevWorkingDay, toKSTDateStr, toBusinessDateStr } from "@/lib/holidays";

const PRIORITY_LABEL: Record<string, string> = { high: "높음", medium: "보통", low: "낮음" };
const STATUS_LABEL: Record<string, string> = {
  pending: "대기", in_progress: "진행 중", in_qa: "IN-QA",
  done: "완료", cancelled: "취소",
};

// ===== EOD (하루 마무리) =====
export async function runEndOfDay(): Promise<{ message: string }> {
  const today = new Date();
  const todayStr = toBusinessDateStr(today); // 5시 이전은 전날로 취급

  const allTasks = await db.query.tasks.findMany({
    where: (t) => and(
      eq(t.status, "done") === eq(t.status, "done") ? undefined : undefined,
      undefined
    ),
  });
  // 전체 tasks 조회 (조건 없이)
  const tasks = await db.select().from(schema.tasks);

  // 오늘 완료된 항목
  const completedToday = tasks.filter(
    (t) => t.status === "done" && t.completedAt && t.completedAt.slice(0, 10) === todayStr
  );

  // 이관 항목 (진행 중/대기 상태 — 내일로 넘어가는 것들)
  const carriedOver = tasks.filter(
    (t) => t.status === "pending" || t.status === "in_progress" || t.status === "in_qa"
  );

  // 기한 초과
  const overdue = tasks.filter(
    (t) =>
      t.dueDate &&
      t.dueDate.slice(0, 10) < todayStr &&
      t.status !== "done" &&
      t.status !== "cancelled"
  );

  // Slack 메시지 구성
  const lines: string[] = [];
  lines.push(`*📊 하루 마무리 — ${formatWorkingDate(today)}*\n`);

  lines.push(`*✅ 오늘 완료 (${completedToday.length}건)*`);
  if (completedToday.length > 0) {
    completedToday.slice(0, 5).forEach((t) => lines.push(`• ${t.title}`));
    if (completedToday.length > 5) lines.push(`• ...외 ${completedToday.length - 5}건`);
  } else {
    lines.push("• 없음");
  }

  lines.push(`\n*🔄 이관 (${carriedOver.length}건) — 내일로 넘어가는 할일*`);
  if (carriedOver.length > 0) {
    // 우선순위 높은 순 정렬
    const sorted = [...carriedOver].sort((a, b) => {
      const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
      return (order[a.priority] ?? 2) - (order[b.priority] ?? 2);
    });
    sorted.slice(0, 7).forEach((t) => {
      const p = PRIORITY_LABEL[t.priority] ? `[${PRIORITY_LABEL[t.priority]}] ` : "";
      const s = STATUS_LABEL[t.status] || t.status;
      lines.push(`• ${p}${t.title} — ${s}`);
    });
    if (sorted.length > 7) lines.push(`• ...외 ${sorted.length - 7}건`);
  } else {
    lines.push("• 없음");
  }

  if (overdue.length > 0) {
    lines.push(`\n*⚠️ 기한 초과 (${overdue.length}건)*`);
    overdue.slice(0, 5).forEach((t) => lines.push(`• ${t.title} (기한: ${t.dueDate})`));
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
      const { ts } = await slack.sendDM(message);
      slackTs = ts;
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

  // 어제(직전 워킹 데이) EOD 데이터 조회
  const yesterday = prevWorkingDay(today);
  const yesterdayStr = toKSTDateStr(yesterday);

  const yesterdayEod = await db.query.workflowLogs.findFirst({
    where: (w) => and(eq(w.date, yesterdayStr), eq(w.type, "eod")),
  });

  const tasks = await db.select().from(schema.tasks);

  // 어제 이관 항목 조회 + 현재 상태 비교
  let carriedOverItems: Array<{ title: string; oldStatus?: string; currentStatus: string; priority: string }> = [];
  if (yesterdayEod?.summary) {
    try {
      const eodData = JSON.parse(yesterdayEod.summary) as {
        carriedOverIds: string[];
      };
      const taskMap = new Map(tasks.map((t) => [t.id, t]));
      carriedOverItems = eodData.carriedOverIds
        .map((id) => taskMap.get(id))
        .filter(Boolean)
        .map((t) => ({
          title: t!.title,
          currentStatus: t!.status,
          priority: t!.priority,
        }));
    } catch {
      // 파싱 실패 무시
    }
  }

  // 오늘 새로 생긴 할일 (created_at = today)
  const newToday = tasks.filter(
    (t) =>
      t.createdAt.slice(0, 10) === todayStr &&
      t.status !== "done" &&
      t.status !== "cancelled"
  );

  // 오늘 마감인 할일
  const dueToday = tasks.filter(
    (t) =>
      t.dueDate &&
      t.dueDate.slice(0, 10) === todayStr &&
      t.status !== "done" &&
      t.status !== "cancelled"
  );

  // 기한 초과 (현재도)
  const overdueNow = tasks.filter(
    (t) =>
      t.dueDate &&
      t.dueDate.slice(0, 10) < todayStr &&
      t.status !== "done" &&
      t.status !== "cancelled"
  );

  // Slack 메시지 구성
  const lines: string[] = [];
  lines.push(`*🌅 하루 시작 — ${formatWorkingDate(today)}*\n`);

  if (carriedOverItems.length > 0) {
    lines.push(`*📥 어제에서 이관 (${carriedOverItems.length}건)*`);
    carriedOverItems.slice(0, 7).forEach((item) => {
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
    newToday.slice(0, 5).forEach((t) => lines.push(`• ${t.title}`));
    if (newToday.length > 5) lines.push(`• ...외 ${newToday.length - 5}건`);
  }

  if (dueToday.length > 0) {
    lines.push(`\n*📅 오늘 마감 (${dueToday.length}건)*`);
    dueToday.forEach((t) => {
      const p = PRIORITY_LABEL[t.priority] ? `[${PRIORITY_LABEL[t.priority]}] ` : "";
      lines.push(`• ${p}${t.title} (D-0)`);
    });
  }

  if (overdueNow.length > 0) {
    lines.push(`\n*⚠️ 기한 초과 (${overdueNow.length}건)*`);
    overdueNow.slice(0, 3).forEach((t) => lines.push(`• ${t.title} (${t.dueDate})`));
    if (overdueNow.length > 3) lines.push(`• ...외 ${overdueNow.length - 3}건`);
  }

  // 전체 현황
  const inProgressCount = tasks.filter((t) => t.status === "in_progress" || t.status === "in_qa").length;
  const pendingCount = tasks.filter((t) => t.status === "pending").length;
  lines.push(`\n*📊 현재 현황*`);
  lines.push(`• 진행 중: ${inProgressCount}건 · 대기: ${pendingCount}건`);

  lines.push(`\n_🤖 Work Pavlotrasche — 하루 시작 자동 리포트_`);

  const message = lines.join("\n");
  let slackTs: string | null = null;

  if (slack.isSlackConfigured()) {
    try {
      const { ts } = await slack.sendDM(message);
      slackTs = ts;
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

// ===== SOD 버튼 — Slack 발송 없이 DB에만 기록 (넛지 스킵 목적) =====
export async function recordStartOfDay(): Promise<void> {
  const todayStr = toBusinessDateStr(new Date());
  await db.insert(schema.workflowLogs).values({
    id: generateId(),
    type: "sod",
    date: todayStr,
    summary: JSON.stringify({ manual: true }),
    createdAt: nowLocal(),
  }).onConflictDoUpdate({
    target: [schema.workflowLogs.date, schema.workflowLogs.type],
    set: { summary: JSON.stringify({ manual: true }), createdAt: nowLocal() },
  });
  console.log(`[Workflow] SOD recorded (no Slack) for ${todayStr}`);
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
