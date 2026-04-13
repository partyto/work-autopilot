// 추출 Job 헬스체크 — pending/processing 상태가 오래 지속되는 경우 알림
// 승인자/스레드 참여자에게 DM으로 상태 통보
import fs from "fs";
import path from "path";
import { sendDM } from "./integrations/slack";
import type { ExtractionJob } from "./extraction-jobs";

const JOBS_PATH = path.join(process.cwd(), "data", "extraction-jobs.json");

// 지연 임계치
const STALE_PENDING_MS = 30 * 60 * 1000;      // 30분 — Worker가 안 집어감
const STALE_PROCESSING_MS = 60 * 60 * 1000;   // 60분 — 처리 중 hang

function readJobs(): ExtractionJob[] {
  try {
    if (!fs.existsSync(JOBS_PATH)) return [];
    return JSON.parse(fs.readFileSync(JOBS_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function writeJobs(jobs: ExtractionJob[]) {
  const tmp = JOBS_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(jobs, null, 2), "utf-8");
  fs.renameSync(tmp, JOBS_PATH);
}

export async function runExtractionHealthCheck() {
  const jobs = readJobs();
  if (!jobs.length) return;

  const now = Date.now();
  let dirty = false;

  for (const job of jobs) {
    if (job.notified_stale) continue;
    if (job.status !== "pending" && job.status !== "processing") continue;

    const age = now - new Date(job.created_at).getTime();
    const threshold = job.status === "pending" ? STALE_PENDING_MS : STALE_PROCESSING_MS;
    if (age < threshold) continue;

    const minutes = Math.floor(age / 60000);
    const recipients = new Set<string>();
    if (job.requester_id) recipients.add(job.requester_id);
    for (const id of job.notify_ids || []) recipients.add(id);

    const statusLabel = job.status === "pending" ? "Worker 미점유" : "처리 중 지연";
    const text =
      `:warning: *추출 지연 알림*\n` +
      `티켓: *${job.ticket_key}* — ${job.extract_type === "marketing" ? "마케팅" : "공지성"}\n` +
      `상태: \`${job.status}\` (${statusLabel})\n` +
      `경과: ${minutes}분\n` +
      `job: \`${job.id.slice(0, 8)}\`\n\n` +
      `파트라슈 worker 또는 쿼리 실행 상태를 확인해주세요.`;

    for (const userId of recipients) {
      try {
        await sendDM(text, userId);
      } catch (err) {
        console.error(`[ExtractionHealth] DM 실패 (${userId}):`, err);
      }
    }

    job.notified_stale = true;
    dirty = true;
    console.warn(`[ExtractionHealth] Stale job notified: ${job.id} ${job.ticket_key} age=${minutes}m`);
  }

  if (dirty) writeJobs(jobs);
}
