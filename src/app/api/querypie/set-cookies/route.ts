// GET /api/querypie/set-cookies — 쿠키 설정 안내
// 실제 쿠키는 사내망 Worker에 직접 설정 (http://localhost:3200/set-cookies)
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    message: "QueryPie 쿠키는 사내망 Worker에 직접 설정해주세요.",
    worker_endpoint: "POST http://localhost:3200/set-cookies",
    body_format: '{ "cookies": [...] }',
  });
}
