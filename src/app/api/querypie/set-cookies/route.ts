// POST /api/querypie/set-cookies — QueryPie 세션 쿠키 저장
// 브라우저 DevTools에서 복사한 쿠키 배열을 data/querypie-session.json에 저장
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const SESSION_PATH = path.join(process.cwd(), "data", "querypie-session.json");

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { cookies } = body;

    if (!Array.isArray(cookies) || cookies.length === 0) {
      return NextResponse.json(
        { error: "cookies 배열이 필요합니다 (Playwright Cookie 형식)" },
        { status: 400 },
      );
    }

    fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
    fs.writeFileSync(SESSION_PATH, JSON.stringify(cookies, null, 2), "utf-8");

    return NextResponse.json({ ok: true, count: cookies.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  try {
    if (!fs.existsSync(SESSION_PATH)) {
      return NextResponse.json({ configured: false });
    }
    const cookies = JSON.parse(fs.readFileSync(SESSION_PATH, "utf-8"));
    return NextResponse.json({ configured: true, count: cookies.length });
  } catch {
    return NextResponse.json({ configured: false });
  }
}
