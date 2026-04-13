// 추출 Job Queue — data/extraction-jobs.json 기반 단순 큐
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const JOBS_PATH = path.join(process.cwd(), "data", "extraction-jobs.json");

export interface ExtractionJob {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  ticket_key: string;
  shop_seq: string; // 빈 문자열이면 all_shops 모드
  all_shops?: boolean; // true면 query_all_shops 사용 (shop_seq IN 조건 제거)
  extract_type: "marketing" | "notice";
  thread_ts: string;
  channel: string;
  requester_id: string;
  pm_user_id: string;
  thread_starter_id?: string;
  notify_ids?: string[]; // DM 수신 대상: 스레드 원작성자 + @비즈-예약PM 멘션한 사람들
  sql: string;
  created_at: string;
  error?: string;
  notified_stale?: boolean; // 헬스체크에서 지연 알림 이미 발송됨
}

function readJobs(): ExtractionJob[] {
  try {
    if (!fs.existsSync(JOBS_PATH)) return [];
    return JSON.parse(fs.readFileSync(JOBS_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function writeJobs(jobs: ExtractionJob[]) {
  fs.mkdirSync(path.dirname(JOBS_PATH), { recursive: true });
  // atomic write: 임시 파일에 쓴 후 rename (동시 쓰기 시 데이터 유실 방지)
  const tmpPath = JOBS_PATH + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(jobs, null, 2), "utf-8");
  fs.renameSync(tmpPath, JOBS_PATH);
}

export function createJob(
  params: Omit<ExtractionJob, "id" | "status" | "created_at">,
): ExtractionJob {
  const jobs = readJobs();
  const job: ExtractionJob = {
    ...params,
    id: randomUUID(),
    status: "pending",
    created_at: new Date().toISOString(),
  };
  jobs.push(job);
  writeJobs(jobs);
  return job;
}

export function getPendingJobs(): ExtractionJob[] {
  return readJobs().filter((j) => j.status === "pending");
}

export function markProcessing(jobId: string): void {
  const jobs = readJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (job) {
    job.status = "processing";
    writeJobs(jobs);
  }
}

export function markCompleted(jobId: string): void {
  const jobs = readJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (job) {
    job.status = "completed";
    writeJobs(jobs);
  }
}

export function markFailed(jobId: string, error: string): void {
  const jobs = readJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (job) {
    job.status = "failed";
    job.error = error;
    writeJobs(jobs);
  }
}

export function getJob(jobId: string): ExtractionJob | undefined {
  return readJobs().find((j) => j.id === jobId);
}

export function cleanOldJobs(): void {
  const jobs = readJobs();
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7일
  const filtered = jobs.filter(
    (j) => new Date(j.created_at).getTime() > cutoff || j.status === "pending",
  );
  writeJobs(filtered);
}
