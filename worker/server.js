// QueryPie Playwright Worker — NAS Docker 또는 로컬 Mac에서 실행
// NAS 봇의 Job Queue를 폴링하여 QueryPie 추출 수행 후 결과 반환
const http = require("http");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const unzipper = require("unzipper");
const XLSX = require("xlsx");

// .env 파일 로드 (Docker 환경변수가 없을 때 fallback)
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf-8").split("\n").forEach((line) => {
    const [key, ...vals] = line.split("=");
    if (key && vals.length && !process.env[key.trim()]) {
      process.env[key.trim()] = vals.join("=").trim();
    }
  });
}

const PORT = process.env.PORT || 3200;
const NAS_URL = process.env.NAS_URL || "http://115.21.223.89:3100";
const POLL_INTERVAL = 15000; // 15초
const SESSION_DIR = process.env.SESSION_DIR || __dirname;
const SESSION_PATH = path.join(SESSION_DIR, "session.json");
const GOOGLE_SESSION_PATH = path.join(SESSION_DIR, "google-session.json");
const QUERYPIE_BASE = "https://querypie.infra.wadcorp.in";
const ZIP_PASSWORD = "qwer1234!";
const QP_EMAIL = process.env.QUERYPIE_EMAIL || "";
const QP_PASSWORD = process.env.QUERYPIE_PASSWORD || "";

// ─── Helpers ───

function isSessionConfigured() {
  try {
    if (!fs.existsSync(SESSION_PATH)) return false;
    const cookies = JSON.parse(fs.readFileSync(SESSION_PATH, "utf-8"));
    return Array.isArray(cookies) && cookies.length > 0;
  } catch {
    return false;
  }
}

function isAuthPage(url) {
  return (
    url.includes("keycloak") ||
    url.includes("/auth") ||
    url.includes("/login") ||
    url.includes("sso")
  );
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function extractXlsxFromZip(zipBuffer, password) {
  const directory = await unzipper.Open.buffer(zipBuffer);
  const xlsxFile = directory.files.find(
    (f) => f.path.endsWith(".xlsx") || f.path.endsWith(".xls"),
  );
  if (!xlsxFile) throw new Error("ZIP에서 엑셀 파일을 찾을 수 없습니다");
  return await xlsxFile.buffer(password);
}

// ─── Google SAML 자동 로그인 ───

function hasGoogleSession() {
  try {
    if (!fs.existsSync(GOOGLE_SESSION_PATH)) return false;
    const cookies = JSON.parse(fs.readFileSync(GOOGLE_SESSION_PATH, "utf-8"));
    return Array.isArray(cookies) && cookies.length > 0;
  } catch {
    return false;
  }
}

function saveGoogleCookies(cookies) {
  const googleCookies = cookies.filter(
    (c) => c.domain.includes("google") || c.domain.includes("gstatic") || c.domain.includes("youtube"),
  );
  if (googleCookies.length > 0) {
    fs.writeFileSync(GOOGLE_SESSION_PATH, JSON.stringify(googleCookies, null, 2), "utf-8");
    console.log(`[Worker]    Google 세션 쿠키 ${googleCookies.length}개 저장`);
  }
}

async function autoLogin() {
  if (!QP_EMAIL || !QP_PASSWORD) {
    throw new Error("QUERYPIE_EMAIL/QUERYPIE_PASSWORD가 .env에 설정되지 않았습니다");
  }

  console.log("[Worker] 🔑 Google SAML 자동 로그인 시작...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const context = await browser.newContext();

    // Google 세션 쿠키가 있으면 로드 (2FA 스킵)
    if (hasGoogleSession()) {
      const googleCookies = JSON.parse(fs.readFileSync(GOOGLE_SESSION_PATH, "utf-8"));
      await context.addCookies(googleCookies);
      console.log(`[Worker]    Google 세션 쿠키 ${googleCookies.length}개 로드`);
    }

    const page = await context.newPage();

    // 1. QueryPie 로그인 페이지
    await page.goto(`${QUERYPIE_BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });

    // 2. Login with SAML 클릭
    await page.locator('button:has-text("Login with SAML")').click();
    await page.waitForLoadState("networkidle");

    const currentUrl = page.url();
    console.log(`[Worker]    SAML 리다이렉트 URL: ${currentUrl}`);

    // Google 세션이 유효하면 자동으로 QueryPie로 리다이렉트됨
    if (currentUrl.includes("querypie.infra.wadcorp.in")) {
      console.log("[Worker]    Google 세션으로 자동 로그인 성공!");
    } else {
      // Google 로그인 필요
      // 이메일 입력 화면인지 확인
      const emailInput = page.locator("#identifierId");
      if ((await emailInput.count()) > 0) {
        await emailInput.fill(QP_EMAIL);
        await page.locator("#identifierNext").click();
        await page.waitForTimeout(3000);
      }

      // 비밀번호 입력 화면인지 확인 (이미 이메일이 선택된 경우도 있음)
      const pwInput = page.locator('input[type="password"][name="Passwd"]');
      try {
        await pwInput.waitFor({ state: "visible", timeout: 5000 });
        await pwInput.fill(QP_PASSWORD);
        await page.locator("#passwordNext").click();
      } catch {
        // 비밀번호 화면이 아닐 수 있음 (이미 인증된 상태)
        console.log("[Worker]    비밀번호 입력 스킵 (이미 인증됨 또는 다른 화면)");
      }

      // 5. QueryPie 대시보드까지 리다이렉트 대기
      try {
        await page.waitForURL("**/querypie.infra.wadcorp.in/**", { timeout: 30000 });
      } catch {
        // 2FA 화면에 걸렸을 가능성
        const url = page.url();
        if (url.includes("google.com")) {
          throw new Error(
            "GOOGLE_2FA_REQUIRED — Google 2단계 인증이 필요합니다. " +
            "'node setup-2fa.js'를 실행하여 수동으로 2FA를 승인하세요.",
          );
        }
        throw new Error(`로그인 리다이렉트 실패 — URL: ${url}`);
      }
    }

    // /dashboard로 이동
    try {
      await page.waitForURL("**/dashboard**", { timeout: 15000 });
    } catch {
      await page.goto(`${QUERYPIE_BASE}/dashboard`, { waitUntil: "networkidle", timeout: 15000 });
    }
    console.log(`[Worker]    최종 URL: ${page.url()}`);

    // 모든 쿠키 저장 (QueryPie + Google)
    const allCookies = await context.cookies();

    // QueryPie 쿠키
    const qpCookies = allCookies.filter((c) => c.domain.includes("querypie"));
    fs.writeFileSync(SESSION_PATH, JSON.stringify(qpCookies, null, 2), "utf-8");
    console.log(`[Worker] ✅ 로그인 성공 — QueryPie 쿠키 ${qpCookies.length}개 저장`);

    // Google 세션 쿠키 갱신
    saveGoogleCookies(allCookies);

    return qpCookies;
  } finally {
    await browser.close();
  }
}

// ─── Playwright extraction ───

// DB 연결 선택 + SQL 실행 + Export 다운로드 (page는 이미 인증된 상태)
async function doExtraction(page, browser, sql) {
  try {
    // 1. Database Connections 페이지로 이동
    console.log("[Worker] Database Connections 이동...");
    await page.goto(`${QUERYPIE_BASE}/databases/connections`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // 2. aws-prod 그룹 펼치기
    console.log("[Worker] aws-prod 트리 펼치기...");
    await page.waitForTimeout(3000); // 트리 렌더링 대기
    await page.locator('text=aws-prod').first().click({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // 3. wad-prod-aurora-mysql 선택
    console.log("[Worker] wad-prod-aurora-mysql 선택...");
    await page.locator('text=wad-prod-aurora-mysql').first().click();
    await page.waitForTimeout(2000);

    // 4. 하위 인스턴스 선택 (wad-prod-aurora-mysql-g-...)
    console.log("[Worker] DB 인스턴스 선택...");
    const instance = page.locator('text=/wad-prod-aurora-mysql-g/').first();
    if ((await instance.count()) > 0) {
      await instance.click();
    }
    await page.waitForTimeout(1000);

    // 5. Connect 버튼 클릭
    console.log("[Worker] Connect 버튼 클릭...");
    await page.locator('button:has-text("Connect")').click();

    // 6. SQL Editor 페이지 대기
    console.log("[Worker] SQL Editor 대기...");
    await page.waitForURL("**/sql-editor**", { timeout: 30000 });
    await page.waitForTimeout(2000);

    // 7. tablenote DB 선택 (ant-select 드롭다운 + 검색)
    console.log("[Worker] tablenote DB 선택...");
    // 선택된 항목 텍스트(awsdms_control)를 클릭하여 드롭다운 열기
    await page.locator('.ant-select-selection-item').first().click();
    await page.waitForTimeout(500);
    // 검색 input에 tablenote 타이핑
    await page.keyboard.type('tablenote');
    await page.waitForTimeout(1000);
    // 드롭다운 옵션 클릭 (body에 포탈로 렌더링됨)
    await page.locator('.ant-select-item-option').filter({ hasText: 'tablenote' }).first().click({ timeout: 5000 });
    await page.waitForTimeout(1000);
    console.log("[Worker]    tablenote 선택 완료");

    // 8. 초기 전체 쿼리 실행 생략 — 바로 shop_seq 청킹으로 진행
    // (이전: 전체 SQL 실행 → 네트워크 파싱 시도(항상 실패) → 청킹 fallback = ~40초 낭비)
    const editorArea = page.locator('.view-lines, .CodeMirror-lines, .cm-content').first();

    // shop_seq 청킹으로 전체 데이터 수집
    // - IN 절을 100개씩 나눠 실행 → 결과가 ~100행으로 가상화 한계(120행) 이내 보장
    // - IN 절 소형화(2640→100)로 쿼리 실행 속도도 향상
    console.log("[Worker] shop_seq 청킹 추출 시작...");

    const readVisibleData = async () => {
      return page.evaluate(() => {
        const grid = document.querySelector('.qp-datagrid');
        if (!grid) return null;
        const fiberKey = Object.keys(grid).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
        if (!fiberKey) return null;
        let fiber = grid[fiberKey];
        for (let i = 0; i < 20 && fiber; i++) {
          const props = fiber.memoizedProps || fiber.pendingProps;
          if (props?.data !== undefined && (props.columns !== undefined || props.dataLength !== undefined)) {
            return JSON.parse(JSON.stringify(props.data));
          }
          fiber = fiber.return;
        }
        return null;
      });
    };

    const extractReactRows = (data) => {
      const rows = [];
      if (!data || typeof data !== 'object') return rows;
      const keys = Object.keys(data).filter(k => !isNaN(k)).sort((a, b) => Number(a) - Number(b));
      for (const key of keys) {
        const row = data[key];
        if (row?.value && Array.isArray(row.value)) {
          rows.push(row.value.map(cell => cell?.n ? '' : String(cell?.v ?? '')));
        }
      }
      return rows;
    };

    // SQL에서 IN 절 shop_seq 목록 추출
    const inMatch = sql.match(/shop_seq\s+IN\s*\(([^)]+)\)/i);
    if (!inMatch) throw new Error('SQL에서 shop_seq IN 절을 찾을 수 없습니다');
    const allShopSeqs = inMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    const sqlTemplate = sql.replace(/shop_seq\s+IN\s*\([^)]+\)/i, 'shop_seq IN (__CHUNK__)');
    const seqChunkSize = 100;
    const totalBatches = Math.ceil(allShopSeqs.length / seqChunkSize);
    console.log(`[Worker]    총 shop_seq: ${allShopSeqs.length}개 → ${totalBatches}배치 (100개씩)`);

    const allRows = [];
    let headers = [];
    for (let i = 0; i < allShopSeqs.length; i += seqChunkSize) {
      const chunk = allShopSeqs.slice(i, i + seqChunkSize);
      const chunkSql = sqlTemplate.replace('__CHUNK__', chunk.join(','));
      const batchNum = Math.floor(i / seqChunkSize) + 1;

      // 에디터 클리어 + 새 SQL 입력 (Monaco API 우선 시도)
      await editorArea.click();
      await page.waitForTimeout(200);
      await page.keyboard.press("Meta+a");
      await page.waitForTimeout(100);
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(200);
      const monacoOk = await page.evaluate((text) => {
        const editors = window.monaco?.editor?.getEditors?.();
        if (editors?.length > 0) { editors[0].setValue(text); return true; }
        document.execCommand('insertText', false, text);
        return false;
      }, chunkSql);
      await page.waitForTimeout(monacoOk ? 100 : 300);

      // 실행 — gRPC getDataTable 응답 대기 (status text 폴링보다 정확)
      const dataPromise = page.waitForResponse(
        resp => resp.url().includes('getDataTable') && resp.status() === 200,
        { timeout: 30000 }
      );
      await editorArea.click();
      await page.keyboard.press("Meta+Enter");

      try {
        await dataPromise;
      } catch {
        // 타임아웃 — 그래도 추출 시도
      }
      await page.waitForTimeout(500); // 그리드 렌더링 대기

      // React fiber에서 데이터 추출
      const chunkData = await readVisibleData();
      const chunkRows = extractReactRows(chunkData);

      // 첫 번째 배치에서 헤더 추출
      if (batchNum === 1) {
        headers = await page.evaluate(() => {
          const headerCols = document.querySelectorAll('.qp-datagrid-header-column');
          return Array.from(headerCols).map(el => el.textContent?.trim() || '').filter(t => t);
        });
        if (headers.length > 0) console.log(`[Worker]    헤더 ${headers.length}개: ${headers.join(', ')}`);
      }

      allRows.push(...chunkRows);
      console.log(`[Worker]    배치 ${batchNum}/${totalBatches} — ${chunkRows.length}행 (누적 ${allRows.length}행)`);
    }

    if (allRows.length > 0) {
      console.log(`[Worker]    총 ${allRows.length}행 수집 완료`);
      let dataHeaders = headers;
      if (dataHeaders.length === 0) dataHeaders = allRows[0].map((_, i) => `col_${i}`);
      const wsData = [dataHeaders, ...allRows];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "추출결과");
      const xlsxBuffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
      console.log(`[Worker] XLSX 생성 완료: ${xlsxBuffer.length} bytes, ${allRows.length}행`);
      return xlsxBuffer;
    }

    throw new Error("그리드 데이터를 추출하지 못했습니다 — debug-result-area.png 확인");
  } finally {
    await browser.close();
  }
}

// 세션 관리 + 추출 실행
async function extractFromQueryPie(sql) {
  // 세션 없으면 자동 로그인
  if (!isSessionConfigured()) {
    await autoLogin();
  }

  const cookies = JSON.parse(fs.readFileSync(SESSION_PATH, "utf-8"));
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const context = await browser.newContext({
      acceptDownloads: true,
      permissions: ["clipboard-read", "clipboard-write"],
    });
    await context.addCookies(cookies);
    const page = await context.newPage();

    // 세션 확인
    console.log("[Worker] QueryPie 접속 중...");
    await page.goto(`${QUERYPIE_BASE}/dashboard`, { waitUntil: "networkidle", timeout: 30000 });

    if (isAuthPage(page.url())) {
      // 세션 만료 → 자동 재로그인 (1회)
      console.log("[Worker] 세션 만료 — 자동 재로그인...");
      await browser.close();
      await autoLogin();

      // 새 브라우저로 재시도
      const newCookies = JSON.parse(fs.readFileSync(SESSION_PATH, "utf-8"));
      const browser2 = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      });
      const ctx2 = await browser2.newContext({ acceptDownloads: true });
      await ctx2.addCookies(newCookies);
      const page2 = await ctx2.newPage();
      await page2.goto(`${QUERYPIE_BASE}/dashboard`, { waitUntil: "networkidle", timeout: 30000 });
      if (isAuthPage(page2.url())) {
        await browser2.close();
        throw new Error("SESSION_EXPIRED — 재로그인 후에도 인증 실패");
      }
      return await doExtraction(page2, browser2, sql);
    }

    return await doExtraction(page, browser, sql);
  } catch (e) {
    // doExtraction이 browser.close()를 호출하므로 여기선 중복 close 방지
    throw e;
  }
}

// ─── Job Polling ───

let polling = false;

async function pollForJobs() {
  if (polling) return;
  polling = true;

  try {
    const res = await fetch(`${NAS_URL}/api/extraction-jobs`, {
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();

    if (!data.job) {
      polling = false;
      return;
    }

    const job = data.job;
    console.log(`[Worker] 🔔 Job 수신: ${job.ticket_key} (${job.extract_type})`);

    if (!isSessionConfigured()) {
      console.log("[Worker] 세션 미설정 — 자동 로그인 시도...");
      try {
        await autoLogin();
      } catch (loginErr) {
        console.error("[Worker] ❌ 자동 로그인 실패:", loginErr.message);
        await submitResult(job.id, null, "자동 로그인 실패: " + loginErr.message);
        polling = false;
        return;
      }
    }

    try {
      const xlsxBuffer = await extractFromQueryPie(job.sql);
      console.log(`[Worker] ✅ 추출 완료: ${xlsxBuffer.length} bytes`);
      await submitResult(job.id, xlsxBuffer, null);
    } catch (err) {
      console.error(`[Worker] ❌ 추출 오류:`, err.message);
      await submitResult(job.id, null, err.message);
    }
  } catch (err) {
    // NAS 연결 실패 — 조용히 무시 (다음 폴링에서 재시도)
    if (!String(err).includes("timeout")) {
      console.error("[Worker] NAS 연결 오류:", err.message);
    }
  }

  polling = false;
}

async function submitResult(jobId, xlsxBuffer, error) {
  try {
    const body = { job_id: jobId };
    if (xlsxBuffer) body.xlsx = xlsxBuffer.toString("base64");
    if (error) body.error = error;

    const res = await fetch(`${NAS_URL}/api/extraction-jobs/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    const data = await res.json();
    if (!res.ok) console.error("[Worker] 결과 전송 실패:", data.error);
    else console.log(`[Worker] 결과 전송 완료: job ${jobId.slice(0, 8)}`);
  } catch (err) {
    console.error("[Worker] 결과 전송 오류:", err.message);
  }
}

// ─── HTTP Server (쿠키 관리 + 상태) ───

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader("Content-Type", "application/json");

  if (req.method === "GET" && url.pathname === "/health") {
    res.end(JSON.stringify({ ok: true, session: isSessionConfigured(), nas: NAS_URL }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/set-cookies") {
    try {
      const body = await parseBody(req);
      if (!Array.isArray(body.cookies) || body.cookies.length === 0) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "cookies 배열 필요" }));
        return;
      }
      fs.writeFileSync(SESSION_PATH, JSON.stringify(body.cookies, null, 2), "utf-8");
      res.end(JSON.stringify({ ok: true, count: body.cookies.length }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`[QueryPie Worker] http://localhost:${PORT}`);
  console.log(`  - NAS: ${NAS_URL}`);
  console.log(`  - 세션 디렉토리: ${SESSION_DIR}`);
  console.log(`  - 폴링 간격: ${POLL_INTERVAL / 1000}초`);
  console.log(`  - 세션: ${isSessionConfigured() ? "✅ 설정됨" : "❌ 미설정"}`);
  console.log(`  - POST /set-cookies — 쿠키 등록`);
  console.log("");

  // 폴링 시작
  setInterval(pollForJobs, POLL_INTERVAL);
  console.log("[Worker] Job 폴링 시작...");
});
