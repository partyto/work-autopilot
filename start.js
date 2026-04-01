// Work Autopilot — NAS 엔트리포인트
// Next.js 서버 + node-cron 스케줄러를 함께 실행

const { schedule } = require("node-cron");
const { spawn } = require("child_process");

// ===== 1. Next.js 서버 시작 =====
const server = spawn("node", ["server.js"], {
  stdio: "inherit",
  env: { ...process.env },
});

server.on("exit", (code) => {
  console.log(`[Start] Next.js server exited with code ${code}`);
  process.exit(code || 0);
});

// ===== 2. 스케줄러 초기화 =====
const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

async function triggerScan() {
  try {
    console.log(`[Scheduler] Daily scan triggered at ${new Date().toISOString()}`);
    const res = await fetch(`${BASE_URL}/api/scan`, { method: "POST" });
    const data = await res.json();
    console.log(`[Scheduler] Scan result:`, data.success ? "OK" : data.error);
  } catch (error) {
    console.error("[Scheduler] Scan failed:", error.message);
  }
}

async function triggerExecutor() {
  try {
    console.log(`[Scheduler] Action executor triggered at ${new Date().toISOString()}`);
    const res = await fetch(`${BASE_URL}/api/scan?type=execute`, { method: "POST" });
    const data = await res.json();
    console.log(`[Scheduler] Executor result:`, data.success ? "OK" : data.error);
  } catch (error) {
    console.error("[Scheduler] Executor failed:", error.message);
  }
}

// 서버 시작 대기 후 스케줄 등록
setTimeout(() => {
  // 매일 평일 17:30 KST — 일일 스캔 + 리포트 발송
  schedule("30 17 * * 1-5", triggerScan, { timezone: "Asia/Seoul" });

  // 평일 2시간 간격 — 승인된 액션 실행
  schedule("0 10,12,14,16,18 * * 1-5", triggerExecutor, { timezone: "Asia/Seoul" });

  console.log("[Scheduler] Initialized — Daily scan: 17:30 KST (Mon-Fri), Executor: 10/12/14/16/18h KST (Mon-Fri)");
}, 3000); // 3초 대기 (서버 Ready 후)

// 종료 시그널 핸들링
process.on("SIGTERM", () => {
  console.log("[Start] SIGTERM received, shutting down...");
  server.kill("SIGTERM");
});
process.on("SIGINT", () => {
  console.log("[Start] SIGINT received, shutting down...");
  server.kill("SIGINT");
});
