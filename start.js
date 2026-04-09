// Work Autopilot — NAS 엔트리포인트
// Next.js 서버 시작 (스케줄러는 src/lib/scheduler.ts에서 관리)

const { spawn } = require("child_process");

// ===== Next.js 서버 시작 =====
const server = spawn("node", ["server.js"], {
  stdio: "inherit",
  env: { ...process.env },
});

server.on("exit", (code) => {
  console.log(`[Start] Next.js server exited with code ${code}`);
  process.exit(code || 0);
});

// 종료 시그널 핸들링
process.on("SIGTERM", () => {
  console.log("[Start] SIGTERM received, shutting down...");
  server.kill("SIGTERM");
});
process.on("SIGINT", () => {
  console.log("[Start] SIGINT received, shutting down...");
  server.kill("SIGINT");
});
