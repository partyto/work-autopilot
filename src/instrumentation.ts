// Next.js instrumentation — 서버 시작 시 스케줄러 초기화
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initScheduler } = await import("@/lib/scheduler");
    initScheduler();
  }
}
