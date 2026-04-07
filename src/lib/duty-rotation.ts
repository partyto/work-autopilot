// 데이터 추출 당번 로테이션 상태 관리
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

const STATE_PATH = path.join(process.cwd(), "data", "duty-state.json");

export interface DutyMember {
  name: string;
  slack_id: string;
  email: string;
  index: number;
  jira_account_id: string | null;
}

export interface DutyState {
  members: DutyMember[];
  current_week: string;
  current_duty_index: number;
  current_duty_name: string;
  start_date: string;
  start_index: number;
  vacation_overrides: Record<string, number>; // week -> replacement index
  last_checked_ts: string | null;
  processed_threads: string[];
  sql_templates: {
    marketing: string;
    notice: string;
  };
  announcement_channel: string;
}

const DEFAULT_STATE: DutyState = {
  members: [
    { name: "주현우", slack_id: "U042YQ0RUAY", email: "hw.joo@catchtable.co.kr", index: 0, jira_account_id: "63d8cbafc2b1cb6b346f8ab4" },
    { name: "옥동민", slack_id: "U021C8DFPH8", email: "d.ok@catchtable.co.kr", index: 1, jira_account_id: "63d8cb6efb75f8568f5ee308" },
    { name: "황유진", slack_id: "U08Q1AFBC3E", email: "youjin.h@catchtable.co.kr", index: 2, jira_account_id: "712020:23cf070e-eecc-4864-92e5-5014c318e9ae" },
    { name: "임미연", slack_id: "U0357K6GQNN", email: "my.lim@catchtable.co.kr", index: 3, jira_account_id: "63d8cbecc2b1cb6b346f8ad0" },
  ],
  current_week: "",
  current_duty_index: 0,
  current_duty_name: "주현우",
  start_date: "2026-03-30",
  start_index: 3,
  vacation_overrides: {},
  last_checked_ts: null,
  processed_threads: [],
  sql_templates: {
    marketing: `SELECT DISTINCT
    tsm.shop_seq,
    tsm.shop_name AS '매장명',
    tse.employee_info AS '담당자(대표연락처)명',
    tse.employee_contact_info AS '담당자 전화번호',
    tse.can_send_sms_yn AS '문자 발신 가능 번호',
    tse.memo AS '메모',
    tse.represent_yn AS '대표담당자여부',
    tse.sms_marketing_yn AS '1차-마케팅수신동의',
    CASE
        WHEN bts.is_agree = '1' THEN '수신동의'
        WHEN bts.is_agree = '0' THEN '미동의'
        WHEN bts.is_agree IS NULL THEN '미참여'
        ELSE '알수없음'
    END AS '2차-마케팅문자수신동의'
FROM tn_shop_master tsm
LEFT JOIN tn_shop_employee tse ON tse.shop_seq = tsm.shop_seq
LEFT JOIN biz_terms_shop bts ON bts.shop_id = tse.shop_seq
WHERE tsm.state = 'a'
    AND tsm.inhouse_yn = 'n'
    AND tsm.chain_level = 'a'
    AND tse.sms_marketing_yn = 'y'
    AND tse.represent_yn = 'y'
    AND bts.is_agree = '1'
    AND bts.term_type = 'MARKETING'
    AND tsm.shop_seq IN ({shop_seq_list})
;`,
    notice: `SELECT
    tsm.shop_seq,
    tsm.shop_name AS '매장명',
    tse.employee_info AS '담당자(대표연락처)명',
    tse.employee_contact_info AS '담당자 전화번호',
    tse.can_send_sms_yn AS '담당자-문자발신가능번호',
    tse.memo AS '메모',
    tse.represent_yn AS '대표담당자여부',
    tse.sms_marketing_yn AS '1차-마케팅수신동의',
    CASE
        WHEN bts.is_agree = '1' THEN '수신동의'
        WHEN bts.is_agree = '0' THEN '미동의'
        WHEN bts.is_agree IS NULL THEN '미참여'
        ELSE '알수없음'
    END AS '2차-마케팅문자수신동의',
    tsm.shop_phone AS '[참고]매장전화번호'
FROM tn_shop_master tsm
LEFT JOIN tn_shop_employee tse ON tse.shop_seq = tsm.shop_seq
LEFT JOIN (
    SELECT shop_id, MAX(is_agree) as is_agree
    FROM biz_terms_shop
    WHERE term_type = 'MARKETING'
    GROUP BY shop_id
) bts ON bts.shop_id = tsm.shop_seq
WHERE 1=1
    AND tsm.state = 'a'
    AND tsm.inhouse_yn = 'n'
    AND tsm.chain_level = 'a'
    AND tsm.shop_seq IN ({shop_seq_list})
;`,
  },
  announcement_channel: "C08PN7A9R0X",
};

export function getDutyState(): DutyState {
  if (!existsSync(STATE_PATH)) {
    writeFileSync(STATE_PATH, JSON.stringify(DEFAULT_STATE, null, 2));
    return DEFAULT_STATE;
  }
  return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
}

export function saveDutyState(state: DutyState): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function getISOWeek(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export function calculateDutyIndex(state: DutyState): number {
  const start = new Date(state.start_date);
  const now = new Date();
  const weeksDiff = Math.floor((now.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
  const idx = (state.start_index + weeksDiff) % state.members.length;

  const week = getISOWeek(now);
  if (state.vacation_overrides[week] !== undefined) {
    return state.vacation_overrides[week];
  }
  return idx;
}

export function getCurrentDuty(state: DutyState): DutyMember {
  const idx = calculateDutyIndex(state);
  return state.members[idx];
}

export function swapDuty(currentIndex: number, replacementIndex: number): DutyState {
  const state = getDutyState();
  const week = getISOWeek(new Date());
  state.vacation_overrides[week] = replacementIndex;
  state.current_week = week;
  state.current_duty_index = replacementIndex;
  state.current_duty_name = state.members[replacementIndex].name;
  saveDutyState(state);
  return state;
}

export function confirmDuty(): DutyState {
  const state = getDutyState();
  const week = getISOWeek(new Date());
  const duty = getCurrentDuty(state);
  state.current_week = week;
  state.current_duty_index = duty.index;
  state.current_duty_name = duty.name;
  saveDutyState(state);
  return state;
}

export function getWeekRange(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  return { start: fmt(monday), end: fmt(friday) };
}

export function generateSQL(type: "marketing" | "notice", shopSeqList: string): string {
  const state = getDutyState();
  const template = state.sql_templates[type];
  return template.replace("{shop_seq_list}", shopSeqList);
}
