// QueryPie Playwright Worker — 사내망 Mac에서 실행
// NAS 봇의 Job Queue를 폴링하여 QueryPie 추출 수행 후 결과 반환
const http = require("http");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const unzipper = require("unzipper");
const XLSX = require("xlsx");

// .env 파일 로드
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf-8").split("\n").forEach((line) => {
    const [key, ...vals] = line.split("=");
    if (key && vals.length) process.env[key.trim()] = vals.join("=").trim();
  });
}

const PORT = process.env.PORT || 3200;
const NAS_URL = process.env.NAS_URL || "http://115.21.223.89:3100";
const POLL_INTERVAL = 15000; // 15초
const SESSION_PATH = path.join(__dirname, "session.json");
const GOOGLE_SESSION_PATH = path.join(__dirname, "google-session.json");
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

    // 8. SQL 입력 (Monaco Editor API로 직접 설정 — keyboard.type은 자동완성이 SQL 깨뜨림)
    console.log("[Worker] SQL 입력 중...");
    const editorArea = page.locator('.view-lines, .CodeMirror-lines, .cm-content').first();

    const monacoSet = await page.evaluate((text) => {
      // Monaco Editor API
      const editors = window.monaco?.editor?.getEditors?.();
      if (editors && editors.length > 0) {
        editors[0].setValue(text);
        return "monaco";
      }
      // CodeMirror v5
      if (document.querySelector('.CodeMirror')) {
        const cm = document.querySelector('.CodeMirror').CodeMirror;
        if (cm) { cm.setValue(text); return "codemirror5"; }
      }
      // CodeMirror v6
      const cmView = document.querySelector('.cm-editor')?.cmView;
      if (cmView) {
        cmView.view.dispatch({ changes: { from: 0, to: cmView.view.state.doc.length, insert: text } });
        return "codemirror6";
      }
      return null;
    }, sql);

    if (monacoSet) {
      console.log(`[Worker]    SQL 입력 완료 (${sql.length}자, ${monacoSet} API)`);
      await editorArea.click();
    } else {
      // fallback: execCommand insertText (자동완성 트리거하지 않음)
      console.log("[Worker]    Monaco API 없음 — insertText fallback...");
      await editorArea.click();
      await page.waitForTimeout(300);
      await page.keyboard.press("Meta+a");
      await page.waitForTimeout(200);
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(200);
      await page.evaluate((text) => {
        document.execCommand('insertText', false, text);
      }, sql);
      console.log(`[Worker]    SQL 입력 완료 (${sql.length}자, insertText fallback)`);
    }
    await page.waitForTimeout(500);

    // 9. 실행 — 에디터 포커스 확보 후 Cmd+Enter
    console.log("[Worker] 쿼리 실행 (Cmd+Enter)...");
    await editorArea.click();
    await page.waitForTimeout(300);
    await page.keyboard.press("Meta+Enter");

    // 실행 직후 스크린샷
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(__dirname, "debug-after-run.png") });

    // 10. 결과 대기 — 폴링으로 "items fetched" 감지 (최대 120초)
    // 주의: 대용량 쿼리는 QueryPie가 "0 items fetched"를 일시적으로 표시하므로
    //       비-0 카운트가 나올 때까지 계속 폴링, 0이 안정적으로 유지되면(10초) 실제 0건으로 판단
    console.log("[Worker] 결과 대기...");
    const resultStart = Date.now();
    let resultFound = false;
    let fetchedCount = 0;
    let zeroSince = 0; // 0건이 처음 감지된 시각
    while (Date.now() - resultStart < 120000) {
      const bodyText = await page.evaluate(() => document.body.innerText);
      const match = bodyText.match(/(\d+)\s*items?\s*fetched/);
      if (match) {
        const count = parseInt(match[1], 10);
        if (count > 0) {
          // 비-0 결과 → 확정
          fetchedCount = count;
          resultFound = true;
          break;
        } else {
          // 0건 감지 — 대용량 쿼리 로딩 중일 수 있으므로 10초간 더 대기
          if (zeroSince === 0) zeroSince = Date.now();
          if (Date.now() - zeroSince >= 10000) {
            // 10초 동안 계속 0 → 실제 0건으로 확정
            fetchedCount = 0;
            resultFound = true;
            break;
          }
        }
      } else {
        // 아직 결과 없음 → zeroSince 리셋 (로딩 중에 숫자가 사라질 수 있음)
        zeroSince = 0;
      }
      if (bodyText.includes("rows affected")) {
        resultFound = true;
        break;
      }
      await page.waitForTimeout(2000);
    }
    if (!resultFound) {
      await page.screenshot({ path: path.join(__dirname, "debug-no-result.png") });
      throw new Error("쿼리 결과를 120초 내에 감지하지 못했습니다 — debug-no-result.png 확인");
    }
    console.log(`[Worker] 결과 로드 완료: ${fetchedCount}건`);
    await page.screenshot({ path: path.join(__dirname, "debug-result-area.png") });

    if (fetchedCount === 0) {
      throw new Error("쿼리 결과가 0건입니다 — SQL 또는 shop_seq 조건 확인 필요");
    }

    // 11. qp-datagrid에서 헤더 추출 + 그리드 클릭 → Ctrl+A → Ctrl+C로 데이터 복사
    console.log("[Worker] 그리드 데이터 복사 시도...");

    // 헤더 추출 (DOM에 있음)
    const headers = await page.evaluate(() => {
      const headerCols = document.querySelectorAll('.qp-datagrid-header-column');
      return Array.from(headerCols).map(el => el.textContent?.trim() || '').filter(t => t);
    });
    console.log(`[Worker]    헤더 ${headers.length}개: ${headers.join(', ')}`);

    // 클립보드 인터셉트 설정
    await page.evaluate(() => {
      window.__clipboardData = null;
      const origWriteText = navigator.clipboard.writeText;
      navigator.clipboard.writeText = async function(text) {
        window.__clipboardData = text;
        return origWriteText.call(this, text);
      };
      // execCommand('copy') 인터셉트
      document.addEventListener('copy', (e) => {
        // DataTransfer에서 텍스트 읽기
        setTimeout(() => {
          // 마지막 복사 이벤트의 데이터
        }, 0);
      });
    });

    // 그리드 바디 클릭 → Cmd+A → Cmd+C
    const gridBody = page.locator('.qp-datagrid-body').first();
    if ((await gridBody.count()) > 0) {
      await gridBody.click();
      await page.waitForTimeout(300);
      await page.keyboard.press("Meta+a");
      await page.waitForTimeout(300);
      await page.keyboard.press("Meta+c");
      await page.waitForTimeout(1000);
    }

    // 클립보드 데이터 읽기
    let clipData = await page.evaluate(() => window.__clipboardData);

    // 클립보드 직접 읽기 시도 (권한 있을 수 있음)
    if (!clipData) {
      clipData = await page.evaluate(async () => {
        try { return await navigator.clipboard.readText(); } catch { return null; }
      });
    }

    if (clipData && clipData.trim()) {
      console.log(`[Worker]    클립보드 데이터 ${clipData.length}자 캡처`);
      // TSV (탭 구분) 파싱
      const lines = clipData.trim().split('\n');
      const dataHeaders = headers.length > 0 ? headers : lines[0].split('\t');
      const startRow = headers.length > 0 ? 0 : 1;
      const rows = lines.slice(startRow).map(line => line.split('\t'));
      console.log(`[Worker]    파싱: ${dataHeaders.length}열, ${rows.length}행`);

      const wsData = [dataHeaders, ...rows];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "추출결과");
      const xlsxBuffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
      console.log(`[Worker] XLSX 생성 완료: ${xlsxBuffer.length} bytes`);
      return xlsxBuffer;
    }

    console.log("[Worker] 클립보드 캡처 실패 — 대안 시도...");

    // 방법 2: copy 이벤트 직접 트리거하여 clipboardData 캡처
    const copyData = await page.evaluate(async () => {
      return new Promise((resolve) => {
        let captured = null;

        // copy 이벤트 리스너
        const handler = (e) => {
          captured = e.clipboardData?.getData('text/plain') || null;
        };
        document.addEventListener('copy', handler, true);

        // 그리드 클릭 → 전체 선택
        const gridBody = document.querySelector('.qp-datagrid-body');
        if (gridBody) gridBody.click();

        // 짧은 대기 후 Ctrl+A (selectionchange 트리거)
        setTimeout(() => {
          document.execCommand('selectAll');
          // copy 트리거
          setTimeout(() => {
            document.execCommand('copy');
            setTimeout(() => {
              document.removeEventListener('copy', handler, true);
              // qp-datagrid-clip-board 확인
              const cb = document.querySelector('.qp-datagrid-clip-board');
              const cbText = cb?.value || cb?.textContent?.trim() || cb?.innerText?.trim() || '';
              resolve({ captured, cbText, cbTag: cb?.tagName, cbInner: cb?.innerHTML?.slice(0, 500) });
            }, 500);
          }, 300);
        }, 300);
      });
    });
    console.log("[Worker]    copy 이벤트 결과:", JSON.stringify(copyData).slice(0, 500));

    // 방법 3: React 내부 상태에서 데이터 추출
    const reactData = await page.evaluate(() => {
      const grid = document.querySelector('.qp-datagrid');
      if (!grid) return { error: 'qp-datagrid not found' };

      const fiberKey = Object.keys(grid).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (!fiberKey) return { error: 'no react fiber' };

      // fiber 체인에서 data + columns props 찾기
      let fiber = grid[fiberKey];
      for (let i = 0; i < 20 && fiber; i++) {
        const props = fiber.memoizedProps || fiber.pendingProps;
        if (props && props.data !== undefined && props.columns !== undefined) {
          const data = props.data;
          const columns = props.columns;
          const dataType = Array.isArray(data) ? 'array' : typeof data;
          const colType = Array.isArray(columns) ? 'array' : typeof columns;

          return {
            found: true,
            dataType,
            dataLength: Array.isArray(data) ? data.length : (data?.length || 'N/A'),
            colType,
            colLength: Array.isArray(columns) ? columns.length : 'N/A',
            dataSample: JSON.stringify(Array.isArray(data) ? data.slice(0, 2) : data)?.slice(0, 500),
            colSample: JSON.stringify(Array.isArray(columns) ? columns.slice(0, 5) : columns)?.slice(0, 500),
            propsKeys: Object.keys(props),
          };
        }
        // data만 있는 경우도 체크
        if (props && props.data !== undefined && (props.dataLength !== undefined || props.loadingData !== undefined)) {
          const data = props.data;
          return {
            found: true,
            dataType: Array.isArray(data) ? 'array' : typeof data,
            dataLength: Array.isArray(data) ? data.length : (data?.length || 'N/A'),
            dataSample: JSON.stringify(Array.isArray(data) ? data.slice(0, 2) : data)?.slice(0, 500),
            propsKeys: Object.keys(props),
            level: i,
          };
        }
        fiber = fiber.return;
      }
      return { error: 'data props not found' };
    });
    console.log("[Worker]    React 데이터:", JSON.stringify(reactData).slice(0, 2000));

    // 방법 4: 전역 스토어 탐색 (Redux, Zustand 등)
    const storeData = await page.evaluate(() => {
      // Redux
      if (window.__REDUX_STORE__ || window.store) {
        const store = window.__REDUX_STORE__ || window.store;
        const state = store.getState?.();
        if (state) return { type: 'redux', keys: Object.keys(state).slice(0, 20) };
      }
      // window에 노출된 데이터
      const windowKeys = Object.keys(window).filter(k =>
        k.match(/store|state|data|result|query/i) && typeof window[k] === 'object'
      ).slice(0, 10);
      return { type: 'window-scan', keys: windowKeys };
    });
    console.log("[Worker]    전역 스토어:", JSON.stringify(storeData));

    // copyData에서 결과가 있으면 사용
    const textData = copyData?.captured || copyData?.cbText;
    if (textData && textData.trim()) {
      console.log(`[Worker]    데이터 캡처 성공: ${textData.length}자`);
      const lines = textData.trim().split('\n');
      const dataHeaders = headers.length > 0 ? headers : lines[0].split('\t');
      const startRow = headers.length > 0 ? 0 : 1;
      const rows = lines.slice(startRow).map(line => line.split('\t'));

      const wsData = [dataHeaders, ...rows];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "추출결과");
      const xlsxBuffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
      console.log(`[Worker] XLSX 생성 완료: ${xlsxBuffer.length} bytes`);
      return xlsxBuffer;
    }

    // React에서 데이터 추출 성공 시
    if (reactData?.found) {
      console.log("[Worker] React 상태에서 데이터 추출 시도...");
      const fullData = await page.evaluate(() => {
        const grid = document.querySelector('.qp-datagrid');
        const fiberKey = Object.keys(grid).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
        let fiber = grid[fiberKey];
        for (let i = 0; i < 20 && fiber; i++) {
          const props = fiber.memoizedProps || fiber.pendingProps;
          if (props && props.data !== undefined && (props.columns !== undefined || props.dataLength !== undefined)) {
            const data = props.data;
            const columns = props.columns;
            // data가 배열이면 직접 반환
            if (Array.isArray(data)) {
              return { data, columns: columns || null };
            }
            // data가 다른 형태일 수 있음 (Map, Object 등)
            return { data: JSON.parse(JSON.stringify(data)), columns: columns ? JSON.parse(JSON.stringify(columns)) : null };
          }
          fiber = fiber.return;
        }
        return null;
      });

      if (fullData?.data) {
        let dataRows = fullData.data;
        let dataHeaders = headers;
        let rows = [];

        if (Array.isArray(dataRows) && dataRows.length > 0) {
          // 배열 형태 데이터
          if (fullData.columns && Array.isArray(fullData.columns)) {
            dataHeaders = fullData.columns.map(c => c.name || c.key || c.title || c.field || String(c));
          } else if (dataHeaders.length === 0) {
            dataHeaders = Object.keys(dataRows[0]);
          }
          rows = dataRows.map(row => {
            if (Array.isArray(row)) return row.map(v => String(v ?? ''));
            return dataHeaders.map(h => String(row[h] ?? ''));
          });
        } else if (typeof dataRows === 'object' && !Array.isArray(dataRows)) {
          // QueryPie 커스텀 형태: {"0": {"value": [{"v": "셀값"}, ...]}, "1": ...}
          const keys = Object.keys(dataRows).filter(k => !isNaN(k)).sort((a, b) => Number(a) - Number(b));
          for (const key of keys) {
            const row = dataRows[key];
            if (row?.value && Array.isArray(row.value)) {
              rows.push(row.value.map(cell => {
                if (cell?.n) return ''; // null 플래그
                return String(cell?.v ?? '');
              }));
            }
          }
        }

        if (rows.length > 0) {
          if (dataHeaders.length === 0) dataHeaders = rows[0].map((_, i) => `col_${i}`);
          const wsData = [dataHeaders, ...rows];
          const ws = XLSX.utils.aoa_to_sheet(wsData);
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, "추출결과");
          const xlsxBuffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
          console.log(`[Worker] XLSX 생성 완료 (React): ${xlsxBuffer.length} bytes, ${rows.length}행`);
          return xlsxBuffer;
        }
        console.log("[Worker]    데이터 변환 실패 — data 형태:", typeof dataRows, JSON.stringify(dataRows).slice(0, 300));
      }
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
    const context = await browser.newContext({ acceptDownloads: true });
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
      signal: AbortSignal.timeout(30000),
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
  console.log(`  - 폴링 간격: ${POLL_INTERVAL / 1000}초`);
  console.log(`  - 세션: ${isSessionConfigured() ? "✅ 설정됨" : "❌ 미설정"}`);
  console.log(`  - POST /set-cookies — 쿠키 등록`);
  console.log("");

  // 폴링 시작
  setInterval(pollForJobs, POLL_INTERVAL);
  console.log("[Worker] Job 폴링 시작...");
});
