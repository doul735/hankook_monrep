// ─────────────────────────────────────────────────────────────────────────────
// 한국타이어 네이버 플레이스 월간보고서
// GitHub Pages에서 공개 Google 시트 CSV를 읽어 월별 원본 데이터를 표시합니다.
// ─────────────────────────────────────────────────────────────────────────────

// 웹에 게시한 각 탭에서 보고서 데이터, 매장 설정, 뷰어 설정을 읽습니다.
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTWmF_aoDQ-QJoKSS-9_B14pwOXxglLZHFs8pS2pP-19UBh0TA-nVQODvKpXtXExA1kuOxfEIQLDFtq/pub';
const SHEET_GIDS = Object.freeze({ main: '1185641162', '매장설정': '1874742464', '뷰어설정': '1253945469' });
const SHEET_LOAD_ERROR = '시트 데이터를 불러오지 못했습니다. 시트의 웹에 게시 설정과 게시된 탭(main, 매장설정, 뷰어설정)을 확인해주세요.';

const REPORT_PIN = '8236';
const PIN_SESSION_KEY = 'hankook_month_report_pin_authenticated';
const VIEWER_SESSION_KEY = 'hankook_month_report_viewer';

let reportInitialized = false;
let currentViewer = null;
const RAW = [];

let weekMeta = {};
let weekKeys = [];
let monthKeys = [];
let STORES = [];
let storeSettings = new Map();
let MANAGERS = [];
let TEAMS = [];
let RAW_HEADERS = [];
let ACTIVE_METRICS = [];
let charts = {};
let lastRenderData = null;
const CONVERSION_METRICS = ['conn', 'res_req'];
const conversionVisible = { conn: true, res_req: true };

const METRICS = ['views', 'conn', 'miss', 'res_in', 'res_req', 'review', 'neg_review', 'chat'];
const REPORT_METRICS = ['views', 'conn', 'miss', 'res_in', 'res_req', 'review'];
// 시트 열의 의미는 고정입니다. 값이 0.73이면 해당 성별의 비율은 73%입니다.
const GENDER_SOURCE_HEADERS = Object.freeze({ male: '성별 01', female: '성별 02' });

function teamDisplayName(team) {
  return text(team) || '-';
}

const METRIC_DEFS = {
  views: {
    label: '조회수',
    group: '노출 관련 지표',
    chip: '노출',
    groupKey: 'exposure',
    icon: '◎',
    higher: true,
    desc: '네이버 플레이스에서 매장이 얼마나 많이 조회되었는지 확인하는 핵심 노출 지표입니다.'
  },
  conn: {
    label: '연결콜',
    group: '전환 관련 지표',
    chip: '전환',
    groupKey: 'convert',
    icon: '☎',
    higher: true,
    desc: '고객이 실제 전화 연결까지 이어진 수치입니다. 문의 전환 흐름을 확인할 수 있습니다.'
  },
  miss: {
    label: '미연결콜',
    group: '관리 관련 지표',
    chip: '관리',
    groupKey: 'manage',
    icon: '×',
    higher: false,
    desc: '연결되지 못한 전화입니다. 낮아질수록 응대 관리가 개선된 것으로 볼 수 있습니다.'
  },
  res_in: {
    label: '예약유입',
    group: '노출 관련 지표',
    chip: '노출',
    groupKey: 'exposure',
    icon: '↗',
    higher: true,
    desc: '예약 화면까지 유입된 고객 수입니다. 관심 고객의 행동 흐름을 볼 수 있습니다.'
  },
  res_req: {
    label: '예약신청',
    group: '전환 관련 지표',
    chip: '전환',
    groupKey: 'convert',
    icon: '▣',
    higher: true,
    desc: '실제 예약 신청까지 이어진 수치입니다. 예약 전환 성과를 보는 핵심 지표입니다.'
  },
  review: {
    label: '리뷰',
    group: '관리 관련 지표',
    chip: '관리',
    groupKey: 'manage',
    icon: '☆',
    higher: true,
    desc: '고객 리뷰 발생 수입니다. 매장 신뢰도와 운영 관리 상태를 함께 보여주는 지표입니다.'
  },
  neg_review: {
    label: '부정리뷰',
    group: '관리 관련 지표',
    chip: '관리',
    groupKey: 'manage',
    icon: '!',
    higher: false,
    desc: '부정 리뷰 또는 관리가 필요한 리뷰 수치입니다. 낮아질수록 평판 관리 측면에서 긍정적입니다.'
  },
  chat: {
    label: '톡톡상담',
    group: '관리 관련 지표',
    chip: '관리',
    groupKey: 'manage',
    icon: '●',
    higher: true,
    desc: '네이버 톡톡 상담 수치입니다. 전화 외 문의 채널의 반응을 확인할 수 있습니다.'
  }
};

const GROUPS = [
  {
    key: 'exposure',
    label: '노출 관련 지표',
    color: '#ff7a00',
    metrics: ['views', 'res_in'],
    summary: '조회수 · 예약유입'
  },
  {
    key: 'convert',
    label: '전환 관련 지표',
    color: '#38a7ff',
    metrics: ['conn', 'res_req'],
    summary: '연결콜 · 예약신청'
  },
  {
    key: 'manage',
    label: '관리 관련 지표',
    color: '#32d583',
    metrics: ['miss', 'review'],
    summary: '미연결콜 · 리뷰'
  }
];

function $(id) {
  return document.getElementById(id);
}

function num(value) {
  if (value === null || value === undefined || value === '') return 0;
  return Number(String(value).replace(/,/g, '').trim()) || 0;
}

function metricNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function fmtMetric(value) {
  return value === null || value === undefined ? '—' : fmt(value);
}

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function escapeHtml(value) {
  return text(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function fmt(value) {
  return num(value).toLocaleString('ko-KR');
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function currentPeriodLabel(monthCount) {
  return monthCount === 1 ? '당월' : '선택 기간';
}

function dateText(value) {
  if (!value) return '';

  if (typeof value === 'number') {
    const base = new Date(1899, 11, 30);
    base.setDate(base.getDate() + value);
    return `${base.getFullYear()}-${pad2(base.getMonth() + 1)}-${pad2(base.getDate())}`;
  }

  const raw = String(value).trim();
  if (!raw) return '';

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{4}[./-]\d{1,2}[./-]\d{1,2}/.test(raw)) {
    const [y, m, d] = raw.split(/[.\-/]/).map(Number);
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
  }

  return raw.slice(0, 10);
}

function normalizeFieldKey(value) {
  return String(value || '')
    .replace(/[\s_\-./()\[\]{}·:：]+/g, '')
    .toLowerCase();
}

function pickRaw(row, keys) {
  if (!row) return undefined;

  // 1차: 원본 컬럼명 그대로 매칭
  for (const key of keys) {
    if (
      Object.prototype.hasOwnProperty.call(row, key) &&
      row[key] !== null &&
      row[key] !== undefined &&
      row[key] !== ''
    ) {
      return row[key];
    }
  }

  // 2차: 공백/언더바/괄호/대소문자 차이를 제거하고 매칭
  const normalizedMap = {};
  Object.keys(row).forEach(originalKey => {
    const cleanKey = normalizeFieldKey(originalKey);
    if (!normalizedMap[cleanKey]) normalizedMap[cleanKey] = originalKey;
  });

  for (const key of keys) {
    const cleanKey = normalizeFieldKey(key);
    const originalKey = normalizedMap[cleanKey];

    if (
      originalKey &&
      row[originalKey] !== null &&
      row[originalKey] !== undefined &&
      row[originalKey] !== ''
    ) {
      return row[originalKey];
    }
  }

  // 3차: 부정리뷰처럼 시트마다 이름이 조금씩 다른 컬럼 보강
  const wantsNegativeReview = keys.some(key => {
    const cleanKey = normalizeFieldKey(key);
    return cleanKey.includes('부정') || cleanKey.includes('negative') || cleanKey.includes('badreview');
  });

  if (wantsNegativeReview) {
    const foundKey = Object.keys(row).find(originalKey => {
      const cleanKey = normalizeFieldKey(originalKey);
      return (
        (cleanKey.includes('부정') && cleanKey.includes('리뷰')) ||
        cleanKey.includes('negative') ||
        cleanKey.includes('negreview') ||
        cleanKey.includes('badreview')
      );
    });

    if (
      foundKey &&
      row[foundKey] !== null &&
      row[foundKey] !== undefined &&
      row[foundKey] !== ''
    ) {
      return row[foundKey];
    }
  }

  return undefined;
}

function monthParts(row) {
  const yearText = text(pickRaw(row, ['연', '년', '연도', 'yr', 'year']));
  const monthText = text(pickRaw(row, ['월', '월별', 'mo', 'month']));
  const rawYear = Number(yearText.replace(/[^0-9]/g, '')) || 0;
  const year = rawYear >= 20 && rawYear <= 99 ? 2000 + rawYear : rawYear;
  const month = Number(monthText.replace(/[^0-9]/g, '')) || 0;
  if (year >= 2000 && month >= 1 && month <= 12) return { year, month };

  const period = text(pickRaw(row, ['연월', '년월', '기준월', '기간', 'period', 'year_month'])) || yearText;
  const periodMonth = period.match(/^M\s*(0?[1-9]|1[0-2])$/i);
  if (year >= 2000 && periodMonth) return { year, month: Number(periodMonth[1]) };
  const match = period.match(/(20\d{2}|\d{2})\s*(?:년|[./-])\s*(1[0-2]|0?[1-9])(?:\s*월)?/);
  return match
    ? { year: match[1].length === 2 ? 2000 + Number(match[1]) : Number(match[1]), month: Number(match[2]) }
    : { year: 0, month: 0 };
}

function rowsFromPayload(data) {
  let rows =
    Array.isArray(data) ? data :
    Array.isArray(data?.data) ? data.data :
    Array.isArray(data?.rows) ? data.rows :
    Array.isArray(data?.values) ? data.values :
    [];

  if (!rows.length) return [];

  if (Array.isArray(rows[0])) {
    let headers = Array.isArray(data?.headers) ? data.headers : Array.isArray(data?.columns) ? data.columns : null;

    if (!headers && rows[0].every(v => typeof v === 'string')) {
      headers = rows[0];
      rows = rows.slice(1);
    }

    if (headers) {
      return rows.map(arr => {
        const obj = {};
        headers.forEach((header, index) => {
          obj[String(header).trim()] = arr[index];
        });
        return obj;
      });
    }
  }

  return rows;
}

function normalizePlaceRow(r) {
  const { year, month } = monthParts(r);
  const negReviewValue = pickRaw(r, [
    '부정리뷰',
    '부정 리뷰',
    '부정리뷰수',
    '부정 리뷰수',
    '부정리뷰 감지',
    '부정 리뷰 감지',
    '부정리뷰관리',
    '부정 리뷰 관리',
    '부정',
    'negative_review',
    'negativeReview',
    'negative_reviews',
    'negativeReviews',
    'neg_review',
    'negReview',
    'bad_review',
    'badReview'
  ]);

  return {
    yr: year,
    mo: month,
    wk: num(pickRaw(r, ['주', '주차', 'wk', 'week'])),
    start: dateText(pickRaw(r, ['시작일(월)', '시작일', 'start', 'start_date', 'startDate'])),
    end: dateText(pickRaw(r, ['종료일(일)', '종료일', 'end', 'end_date', 'endDate'])),
    store: text(pickRaw(r, ['매장명', '매장', 'store', 'store_name', 'storeName'])),
    team: text(pickRaw(r, ['팀구분', '팀', 'team', 'teamName'])),
    group: text(pickRaw(r, ['그룹라벨', '그룹', 'group', 'group_label'])),
    manager: text(pickRaw(r, ['담당자', '담당자명', '담당자 이름', '매장 담당자', '담당', 'manager', 'managerName', 'person_in_charge'])),
    views: metricNumber(pickRaw(r, ['조회수', '플레이스 조회수', 'views', 'place_views', 'placeViews'])),
    conn: metricNumber(pickRaw(r, ['연결콜', '연결 콜', 'conn', 'connected_call', 'connectedCall'])),
    miss: metricNumber(pickRaw(r, ['미연결콜', '미연결 콜', 'miss', 'missed_call', 'missedCall'])),
    res_in: metricNumber(pickRaw(r, ['예약유입', '예약 유입', 'res_in', 'resIn', 'reservation_in', 'reservationIn'])),
    res_req: metricNumber(pickRaw(r, ['예약신청', '예약 신청', 'res_req', 'resReq', 'reservation_request', 'reservationRequest'])),
    review: metricNumber(pickRaw(r, ['리뷰', '리뷰수', 'review', 'reviews'])),
    // 부정리뷰는 명시적인 부정리뷰 계열 컬럼이 있을 때만 사용합니다.
    // 컬럼명이 조금 달라도 자동으로 찾아오되, 일반 리뷰/톡톡상담 값이 밀려 들어가지 않게 합니다.
    neg_review: metricNumber(negReviewValue),
    chat: metricNumber(pickRaw(r, ['실시간상담', '톡톡상담', '톡톡 상담', '톡톡', '톡톡상담수', '네이버톡톡', 'chat', 'talk', 'talktalk', 'talkTalk', 'naver_talk'])),
    source: r
  };
}

function normalizeRows(data) {
  return rowsFromPayload(data)
    .map(normalizePlaceRow)
    .filter(r => r.yr && r.mo >= 1 && r.mo <= 12 && r.store && !/^(합계|총합계|총계|전체)$/.test(r.store));
}

function parseCsv(csv) {
  // 자체 파서로 따옴표와 줄바꿈을 처리해 외부 라이브러리 없이 원본 문자열을 보존합니다.
  const records = [];
  let row = [];
  let value = '';
  let quoted = false;
  const input = csv.replace(/^\uFEFF/, '');
  const finishRow = () => {
    row.push(value);
    if (row.some(cell => cell.trim() !== '')) records.push(row);
    row = [];
    value = '';
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          value += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        value += char;
      }
    } else if (char === '"' && value === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n' || char === '\r') {
      finishRow();
      if (char === '\r' && input[i + 1] === '\n') i += 1;
    } else {
      value += char;
    }
  }
  if (quoted) throw new Error('CSV 따옴표가 닫히지 않았습니다.');
  finishRow();

  const headers = (records.shift() || []).map(header => header.trim());
  return records.map(cells => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
}

async function fetchSheetCsv(sheet) {
  const gid = SHEET_GIDS[sheet];
  if (!gid) throw new Error(`알 수 없는 시트: ${sheet}`);
  const url = `${SHEET_CSV_URL}?single=true&output=csv&gid=${gid}&_=${Date.now()}`;
  const response = await fetch(url, { cache: 'no-store' });
  const csv = await response.text();
  if (/^\s*(?:<!DOCTYPE|<html)/i.test(csv)) throw new Error(`${sheet} 탭이 게시되지 않음`);
  if (!response.ok) throw new Error(`${sheet} CSV HTTP ${response.status}`);
  // 헤더만 있는 탭은 "정상이지만 비어 있음"이다. 실패(throw)와 구분해 빈 배열로 돌려준다 —
  // 뷰어설정이 비면 닫힌 허용목록, 매장설정이 비면 전 매장 활성, main이 비면 loadData가 오류로 처리한다.
  return parseCsv(csv);
}

function normalizeViewers(rows) {
  return rows.filter(row => text(row['활성']).toUpperCase() !== 'N' && text(row['PIN']))
    .map(row => ({
      뷰어명: text(row['뷰어명']),
      PIN: text(row['PIN']),
      범위유형: text(row['범위유형']),
      범위값: text(row['범위값'])
    }));
}

async function loadViewerSettings() {
  try {
    const viewers = normalizeViewers(await fetchSheetCsv('뷰어설정'));
    if (!viewers.length) {
      // 설정은 정상인데 활성 뷰어가 0명이면 닫힌 상태다 — 전체 열람 폴백으로 넘기지 않는다.
      console.warn('뷰어설정에 활성 뷰어가 없어 어떤 PIN도 받지 않습니다.');
      return [];
    }
    const byPin = new Map();
    viewers.forEach(viewer => {
      if (byPin.has(viewer.PIN)) {
        console.warn('뷰어설정에 중복 PIN이 있어 첫 활성 행을 사용합니다.');
      } else {
        byPin.set(viewer.PIN, viewer);
      }
    });
    return [...byPin.values()];
  } catch (error) {
    console.warn('뷰어설정을 사용할 수 없어 기본 PIN으로 그룹 전체 열람을 허용합니다.', error);
    // 전체 그룹 허용은 설정을 읽지 못했을 때의 폴백에만 사용합니다.
    return [{ 뷰어명: '그룹 전체 열람', PIN: REPORT_PIN, 범위유형: '그룹', 범위값: '', allGroups: true }];
  }
}

function shouldSkipGroupFilter(rows, viewer) {
  return text(viewer?.범위유형) === '그룹' && viewer.allGroups !== true &&
    rows.length > 0 && rows.every(row => !text(row.group));
}

function filterRowsForViewer(rows, viewer, sourceRows = rows) {
  if (!viewer) return [];
  const type = text(viewer.범위유형);
  const value = text(viewer.범위값);
  if (type === '그룹') {
    if (viewer.allGroups === true || shouldSkipGroupFilter(sourceRows, viewer)) return rows;
    return rows.filter(row => text(row.group) === value);
  }
  if (type === '팀') return rows.filter(row => text(row.team) === value);
  console.warn(`뷰어설정의 범위유형이 '그룹' 또는 '팀'이 아니라 표시할 행이 없습니다: ${type}`);
  return [];
}

async function loadData() {
  const [data, settings] = await Promise.all([
    fetchSheetCsv('main'),
    fetchSheetCsv('매장설정').catch(error => {
      console.warn('매장설정을 불러오지 못해 전 매장을 활성으로 표시합니다.', error);
      return [];
    })
  ]);
  const rows = normalizeRows(data);
  if (!rows.length) {
    throw new Error('월별 데이터가 없습니다. main 시트의 연·월·매장명 열을 확인해주세요.');
  }

  storeSettings = new Map(settings.filter(row => text(row['매장명'])).map(row => {
    const order = text(row['표시순서']);
    return [text(row['매장명']), {
      active: text(row['활성']).toUpperCase() !== 'N',
      order: order !== '' && Number.isFinite(Number(order)) ? Number(order) : Infinity
    }];
  }));
  RAW.length = 0;
  const activeRows = rows.filter(row => storeSettings.get(row.store)?.active !== false);
  if (shouldSkipGroupFilter(rows, currentViewer)) {
    console.warn('main의 그룹라벨이 모두 비어 있어 그룹 범위 필터를 건너뜁니다.');
  }
  filterRowsForViewer(activeRows, currentViewer, rows).forEach(row => RAW.push(row));

  RAW_HEADERS = [...new Set(RAW.flatMap(row => Object.keys(row.source || {})))]
    .filter(header => RAW.some(row => hasValue(row.source?.[header])));
  ACTIVE_METRICS = REPORT_METRICS.filter(key => RAW.some(row => row[key] !== null));

  rebuildMetaFromRaw();
}

function rebuildMetaFromRaw() {
  weekMeta = {};

  RAW.forEach(r => {
    const key = `${r.yr}-${r.mo}-${r.wk}`;
    if (!weekMeta[key]) {
      weekMeta[key] = {
        key,
        yr: r.yr,
        mo: r.mo,
        wk: r.wk,
        start: r.start,
        end: r.end,
        label: `${r.yr}년 ${r.mo}월 ${r.wk}주차`,
        short: `${r.mo}월 ${r.wk}주`
      };
    }
  });

  weekKeys = Object.keys(weekMeta).sort((a, b) => {
    const aa = weekMeta[a];
    const bb = weekMeta[b];
    const da = aa.start ? new Date(aa.start).getTime() : aa.yr * 10000 + aa.mo * 100 + aa.wk;
    const db = bb.start ? new Date(bb.start).getTime() : bb.yr * 10000 + bb.mo * 100 + bb.wk;
    return da - db;
  });

  monthKeys = [...new Set(RAW.map(r => `${r.yr}-${r.mo}`))].sort((a, b) => {
    const [ay, am] = a.split('-').map(Number);
    const [by, bm] = b.split('-').map(Number);
    return ay === by ? am - bm : ay - by;
  });

  STORES = [...new Set(RAW.map(r => r.store).filter(Boolean))].sort((a, b) => ((storeSettings.get(a)?.order ?? Infinity) - (storeSettings.get(b)?.order ?? Infinity)) || a.localeCompare(b, 'ko'));
  MANAGERS = [...new Set(RAW.map(r => r.manager).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  TEAMS = [...new Set(RAW.map(r => r.team).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
}

function sumRows(rows) {
  const s = {};
  METRICS.forEach(key => { s[key] = null; });
  rows.forEach(r => METRICS.forEach(key => {
    if (r[key] !== null && r[key] !== undefined) s[key] = (s[key] ?? 0) + r[key];
  }));
  return s;
}

function hasAnyData(sum) {
  return ACTIVE_METRICS.some(key => sum[key] !== null && sum[key] !== undefined);
}

function getRowsByWeekKey(weekKey, store = 'ALL', manager = 'ALL', team = 'ALL') {
  const meta = weekMeta[weekKey];
  if (!meta) return [];

  return RAW.filter(r =>
    r.yr === meta.yr &&
    r.mo === meta.mo &&
    r.wk === meta.wk &&
    (team === 'ALL' || r.team === team) &&
    (store === 'ALL' || r.store === store) &&
    (manager === 'ALL' || r.manager === manager)
  );
}

function getRowsByMonthKey(monthKey, store = 'ALL', manager = 'ALL', team = 'ALL') {
  const [yr, mo] = String(monthKey || '').split('-').map(Number);
  if (!yr || !mo) return [];

  return RAW.filter(r =>
    r.yr === yr &&
    r.mo === mo &&
    (team === 'ALL' || r.team === team) &&
    (store === 'ALL' || r.store === store) &&
    (manager === 'ALL' || r.manager === manager)
  );
}

function monthOrdinal(monthKey) {
  const [year, month] = String(monthKey || '').split('-').map(Number);
  return year >= 2000 && month >= 1 && month <= 12 ? year * 12 + month - 1 : NaN;
}

function shiftMonthKey(monthKey, offset) {
  const shifted = monthOrdinal(monthKey) + offset;
  if (!Number.isFinite(shifted)) return '';
  return `${Math.floor(shifted / 12)}-${shifted % 12 + 1}`;
}

function getRowsByMonthRange(startKey, endKey, store = 'ALL', manager = 'ALL', team = 'ALL') {
  const start = monthOrdinal(startKey);
  const end = monthOrdinal(endKey);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return [];
  return RAW.filter(row => {
    const month = row.yr * 12 + row.mo - 1;
    return month >= start && month <= end &&
      (team === 'ALL' || row.team === team) &&
      (store === 'ALL' || row.store === store) &&
      (manager === 'ALL' || row.manager === manager);
  });
}

function getRowsByPeriod(mode, key, store = 'ALL', manager = 'ALL', team = 'ALL') {
  return mode === 'MONTH'
    ? getRowsByMonthKey(key, store, manager, team)
    : getRowsByWeekKey(key, store, manager, team);
}

function getMonthMeta(monthKey) {
  const [yr, mo] = String(monthKey || '').split('-').map(Number);

  return {
    key: monthKey,
    yr,
    mo,
    label: `${yr}년 ${mo}월`,
    short: `${String(yr).slice(-2)}.${pad2(mo)}`,
    start: `${yr}-${pad2(mo)}-01`,
    end: `${yr}-${pad2(mo)}-${pad2(new Date(yr, mo, 0).getDate())}`
  };
}

function getMonthRangeMeta(startKey, endKey) {
  const first = getMonthMeta(startKey);
  const last = getMonthMeta(endKey);
  const monthCount = monthOrdinal(endKey) - monthOrdinal(startKey) + 1;
  return {
    key: endKey,
    startKey,
    endKey,
    monthCount,
    yr: last.yr,
    mo: last.mo,
    label: startKey === endKey ? first.label : `${first.label} ~ ${last.label}`,
    start: first.start,
    end: last.end
  };
}

function prevMonthKeyForWeek(yr, mo, wk) {
  let pmo = mo - 1;
  let pyr = yr;

  if (pmo < 1) {
    pmo = 12;
    pyr -= 1;
  }

  // 1순위: 전월의 같은 주차
  const sameWeekKey = `${pyr}-${pmo}-${wk}`;
  if (weekMeta[sameWeekKey]) {
    return sameWeekKey;
  }

  // 2순위: 같은 주차가 없으면 전월의 직전 주차부터 확인
  // 예: 현재 5주차인데 전월 5주차가 없으면 전월 4주차 사용
  for (let fallbackWeek = wk - 1; fallbackWeek >= 1; fallbackWeek -= 1) {
    const fallbackKey = `${pyr}-${pmo}-${fallbackWeek}`;

    if (weekMeta[fallbackKey]) {
      return fallbackKey;
    }
  }

  return null;
}

function prevYearKeyForWeek(yr, mo, wk) {
  const key = `${yr - 1}-${mo}-${wk}`;
  return weekMeta[key] ? key : null;
}

function prevMonthKeyForMonth(monthKey) {
  const [yr, mo] = monthKey.split('-').map(Number);
  let pmo = mo - 1;
  let pyr = yr;
  if (pmo < 1) {
    pmo = 12;
    pyr -= 1;
  }
  const key = `${pyr}-${pmo}`;
  return monthKeys.includes(key) ? key : null;
}

function prevYearKeyForMonth(monthKey) {
  const [yr, mo] = monthKey.split('-').map(Number);
  const key = `${yr - 1}-${mo}`;
  return monthKeys.includes(key) ? key : null;
}

function deltaRate(current, previous, higher = true) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  const prev = num(previous);
  if (!prev) return null;

  const value = ((num(current) - prev) / prev) * 100;
  return {
    value,
    good: higher ? value >= 0 : value <= 0
  };
}

function rateHtml(current, previous, higher) {
  const rate = deltaRate(current, previous, higher);
  if (!rate) return '<span class="rate-flat">—</span>';

  const arrow = rate.value > 0 ? '▲' : rate.value < 0 ? '▼' : '–';
  const cls = rate.good ? 'rate-up' : 'rate-down';
  return `<span class="${cls}">${arrow} ${Math.abs(rate.value).toFixed(1)}%</span>`;
}

function metricSelectOptionsHtml(metrics) {
  return metrics.map(key => `<option value="${key}">${METRIC_DEFS[key].label}</option>`).join('');
}

function fillMetricSelects(metrics = REPORT_METRICS) {
  const trend = $('trendMetricSelect');
  const compare = $('compareMetricSelect');
  if (trend) {
    const selected = trend.value;
    trend.innerHTML = metricSelectOptionsHtml(metrics);
    trend.value = metrics.includes(selected) ? selected : (metrics.includes('views') ? 'views' : metrics[0] || '');
  }
  if (compare) {
    const selected = compare.value;
    compare.innerHTML = metricSelectOptionsHtml(metrics);
    compare.value = metrics.includes(selected) ? selected : (metrics.includes('views') ? 'views' : metrics[0] || '');
  }
}

function getReportMode() {
  return 'MONTH';
}

function updatePeriodModeUI() {
  document.querySelector('.month-filter')?.classList.add('is-active');
}

function initSelects() {
  const selTeam = $('sel-team');
  const selStore = $('sel-store');
  const selManager = $('sel-manager');
  const selMonthStart = $('sel-month-start');
  const selMonthEnd = $('sel-month-end');

  if (!selTeam || !selStore || !selManager || !selMonthStart || !selMonthEnd) return;

  selTeam.innerHTML = '<option value="ALL">전체 팀</option>';
  TEAMS.forEach(team => selTeam.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(team)}">${escapeHtml(teamDisplayName(team))}</option>`));
  updateDependentFilterOptions();

  selMonthStart.innerHTML = '';
  selMonthEnd.innerHTML = '';
  monthKeys.forEach(key => {
    const [yr, mo] = key.split('-').map(Number);
    const option = `<option value="${key}">${yr}년 ${mo}월</option>`;
    selMonthStart.insertAdjacentHTML('beforeend', option);
    selMonthEnd.insertAdjacentHTML('beforeend', option);
  });

  const latestMonth = [...monthKeys].reverse().find(key => hasAnyData(sumRows(getRowsByMonthKey(key))))
    || monthKeys[monthKeys.length - 1] || '';
  selMonthStart.value = latestMonth;
  selMonthEnd.value = latestMonth;

  selTeam.onchange = () => { updateDependentFilterOptions(); renderDashboard(); };
  selStore.onchange = () => { updateManagerOptions(); renderDashboard(); };
  selManager.onchange = renderDashboard;

  selMonthStart.onchange = () => {
    if (monthOrdinal(selMonthStart.value) > monthOrdinal(selMonthEnd.value)) selMonthEnd.value = selMonthStart.value;
    renderDashboard();
  };
  selMonthEnd.onchange = () => {
    if (monthOrdinal(selMonthEnd.value) < monthOrdinal(selMonthStart.value)) selMonthStart.value = selMonthEnd.value;
    renderDashboard();
  };

  const trendMetricSelect = $('trendMetricSelect');
  const compareMetricSelect = $('compareMetricSelect');
  const rankingMetricSelect = $('rankingMetricSelect');
  if (trendMetricSelect) trendMetricSelect.onchange = renderDashboard;
  if (compareMetricSelect) compareMetricSelect.onchange = renderDashboard;
  if (rankingMetricSelect) {
    const previousMetric = rankingMetricSelect.value;
    rankingMetricSelect.innerHTML = metricSelectOptionsHtml(REPORT_METRICS);
    rankingMetricSelect.value = REPORT_METRICS.includes(previousMetric) ? previousMetric : 'views';
    rankingMetricSelect.onchange = renderDashboard;
  }

  updatePeriodModeUI();
}

function updateOptions(select, values, allLabel) {
  if (!select) return;
  const previous = select.value;
  select.innerHTML = `<option value="ALL">${allLabel}</option>`;
  values.forEach(value => select.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`));
  select.value = values.includes(previous) ? previous : 'ALL';
}

function updateManagerOptions() {
  const team = $('sel-team')?.value || 'ALL';
  const store = $('sel-store')?.value || 'ALL';
  const managers = [...new Set(RAW.filter(row => (team === 'ALL' || row.team === team) &&
    (store === 'ALL' || row.store === store)).map(row => row.manager).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ko'));
  updateOptions($('sel-manager'), managers, '전체 담당자');
}

function updateDependentFilterOptions() {
  const team = $('sel-team')?.value || 'ALL';
  const stores = STORES.filter(store => RAW.some(row => row.store === store && (team === 'ALL' || row.team === team)));
  updateOptions($('sel-store'), stores, '전체 매장');
  updateManagerOptions();
}

function renderManagerSummary(state) {
  const summary = $('manager-summary');
  if (!summary) return;
  summary.hidden = state.manager === 'ALL';
  if (summary.hidden) return;

  const rows = getRowsByMonthRange(state.startKey, state.endKey, 'ALL', state.manager, state.team);
  const stores = [...new Set(rows.map(row => row.store).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  $('manager-summary-title').textContent = `${state.manager} · ${stores.length}개 매장`;
  $('manager-summary-stores').innerHTML = stores.length
    ? stores.map(store => `<span class="manager-store-chip">${escapeHtml(store)}</span>`).join('')
    : '<span class="no-source-data">선택 기간에 수집된 담당 매장이 없습니다.</span>';
}

function renderPeriodCards(mode, meta, prevMoMeta, prevYrMeta) {
  const periodText = (period, caption) =>
    `${period.start} ~ ${period.end}<br>${caption} (${period.monthCount}개월 합계)`;

  $('period-prev-year-title').textContent = '전년';
  $('period-prev-month-title').textContent = '전월';
  $('period-current-title').textContent = currentPeriodLabel(meta.monthCount);
  $('period-prev-year').innerHTML = periodText(prevYrMeta, '전년 같은 기간');
  $('period-prev-month').innerHTML = periodText(prevMoMeta, '직전 같은 길이의 기간');
  $('period-current').innerHTML = periodText(meta, '선택 조건');
  $('header-period').textContent = `${meta.label} · ${meta.monthCount}개월 조회`;
}

function renderKpiCards(cur, prevMo, prevYr, metrics, rows, monthCount = 1) {
  const grid = $('kpi-grid');
  if (!grid) return;

  const metricCards = metrics.map(key => {
    const def = METRIC_DEFS[key];
    const covered = rows.filter(row => row[key] !== null).length;
    return `
      <article class="kpi-card ${def.groupKey}" data-metric="${key}" tabindex="0" role="button" aria-label="${def.label} 상세 보기">
        <div class="kpi-head">
          <div class="kpi-head-left">
            <div class="kpi-icon">${def.icon}</div>
            <div>
              <h3 class="kpi-title">${def.label}</h3>
              <div class="kpi-group">${def.group}</div>
            </div>
          </div>
          <div class="kpi-chip">${def.chip}</div>
        </div>

        ${covered < rows.length ? `<div class="kpi-coverage">수집 ${covered}/${rows.length}건 합계</div>` : ''}
        <div class="kpi-period-grid">
          <div class="kpi-period-column">
            <div class="kpi-period-box" title="전년 같은 기간">
              <span class="rate-label">전년</span>
              <strong>${prevYr ? fmtMetric(prevYr[key]) : '—'}</strong>
            </div>
            <div class="kpi-period-change">전년 대비 ${rateHtml(cur[key], prevYr ? prevYr[key] : null, def.higher)}</div>
          </div>
          <div class="kpi-period-column">
            <div class="kpi-period-box" title="${monthCount > 1 ? '직전 같은 길이의 기간' : '전월'}">
              <span class="rate-label">전월</span>
              <strong>${prevMo ? fmtMetric(prevMo[key]) : '—'}</strong>
            </div>
            <div class="kpi-period-change">전월 대비 ${rateHtml(cur[key], prevMo ? prevMo[key] : null, def.higher)}</div>
          </div>
          <div class="kpi-period-column">
            <div class="kpi-period-box current" title="선택 기간">
              <span class="rate-label">${currentPeriodLabel(monthCount)}</span>
              <strong>${fmtMetric(cur[key])}</strong>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join('');

  grid.innerHTML = metricCards;

  document.querySelectorAll('.kpi-card[data-metric]').forEach(card => {
    const handler = () => openKpiModal(card.dataset.metric);
    card.addEventListener('click', handler);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handler();
      }
    });
  });
}

const chartValueLabelPlugin = {
  id: 'chartValueLabelPlugin',
  afterDatasetsDraw(chart, args, pluginOptions) {
    if (pluginOptions && pluginOptions.display === false) return;

    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    ctx.save();
    ctx.font = '700 11px Pretendard, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const placedLabels = [];

    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (!meta || meta.hidden) return;

      meta.data.forEach((element, index) => {
        const value = dataset.data[index];
        if (value === null || value === undefined || Number.isNaN(Number(value))) return;

        const pos = element.tooltipPosition();
        const label = fmt(value);
        const width = ctx.measureText(label).width;
        const x = Math.max(chartArea.left + width / 2 + 3, Math.min(chartArea.right - width / 2 - 3, pos.x));
        let y = Math.max(chartArea.top + 16, Math.min(chartArea.bottom - 5, pos.y - 8));
        const overlaps = candidate => placedLabels.some(box =>
          x - width / 2 < box.right + 4 && x + width / 2 > box.left - 4 &&
          candidate - 12 < box.bottom + 3 && candidate > box.top - 3);
        if (overlaps(y)) {
          const below = y + 17;
          const above = y - 17;
          if (below <= chartArea.bottom - 5 && !overlaps(below)) y = below;
          else if (above >= chartArea.top + 16 && !overlaps(above)) y = above;
          else return;
        }

        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(2, 6, 23, .82)';
        ctx.fillStyle = '#f8fafc';
        ctx.strokeText(label, x, y);
        ctx.fillText(label, x, y);
        placedLabels.push({ left: x - width / 2, right: x + width / 2, top: y - 12, bottom: y });
      });
    });

    ctx.restore();
  }
};

const doughnutCenterTextPlugin = {
  id: 'doughnutCenterTextPlugin',
  afterDraw(chart, args, pluginOptions) {
    if (!pluginOptions || !pluginOptions.text) return;

    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data || !meta.data.length) return;

    const { ctx } = chart;
    const x = meta.data[0].x;
    const y = meta.data[0].y;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f8fafc';
    ctx.font = '950 26px Pretendard, sans-serif';
    ctx.fillText(pluginOptions.text, x, y - 8);
    ctx.fillStyle = '#9fb0c2';
    ctx.font = '800 12px Pretendard, sans-serif';
    ctx.fillText(pluginOptions.subtext || '', x, y + 18);
    ctx.restore();
  }
};

if (window.Chart) {
  Chart.register(chartValueLabelPlugin, doughnutCenterTextPlugin);
}

function chartBaseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: { top: 12, right: 10, bottom: 0, left: 0 }
    },
    plugins: {
      chartValueLabelPlugin: { display: true },
      legend: {
        labels: {
          color: '#d6e4f3',
          font: { size: 13, family: 'Pretendard', weight: '800' },
          boxWidth: 12,
          boxHeight: 12,
          padding: 22
        }
      },
      tooltip: {
        backgroundColor: '#111827',
        borderColor: 'rgba(255,255,255,.12)',
        borderWidth: 1,
        titleColor: '#f8fafc',
        bodyColor: '#cbd5e1',
        padding: 12
      }
    },
    scales: {
      x: {
        ticks: { color: '#cbd5e1', font: { size: 12, family: 'Pretendard', weight: '700' } },
        grid: { color: 'rgba(148, 163, 184, .12)' }
      },
      y: {
        beginAtZero: true,
        grace: '20%',
        ticks: { color: '#cbd5e1', font: { size: 12, family: 'Pretendard', weight: '700' } },
        grid: { color: 'rgba(148, 163, 184, .13)' }
      }
    }
  };
}

function makeChart(id, config) {
  const canvas = $(id);
  if (!canvas || !window.Chart) return;

  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(canvas.getContext('2d'), config);
}

function getTrendKeys(mode, currentKey, startKey = currentKey) {
  const source = mode === 'MONTH' ? monthKeys : weekKeys;
  const currentIndex = source.indexOf(currentKey);
  if (currentIndex < 0) return [];
  const startIndex = Math.max(0, source.indexOf(startKey));
  return source.slice(Math.max(0, startIndex - (startKey === currentKey ? 6 : 3)), currentIndex + 1);
}

function labelForPeriodKey(mode, key) {
  if (mode === 'MONTH') return getMonthMeta(key).short;
  return weekMeta[key]?.short || key;
}

function renderGroupSummary(cur, metrics) {
  const target = $('group-summary');
  if (!target) return;

  target.innerHTML = GROUPS.filter(group => group.metrics.some(key => metrics.includes(key))).map(group => {
    const visible = group.metrics.filter(key => metrics.includes(key));
    const rows = visible.map(metricKey => `${METRIC_DEFS[metricKey].label} ${fmtMetric(cur[metricKey])}`).join(' · ');
    const dotClass = group.key === 'exposure' ? 'orange' : group.key === 'convert' ? 'blue' : 'green';

    return `
      <div>
        <span class="legend-dot ${dotClass}"></span>
        <b>${group.label}<span class="group-count">${visible.length}개 항목</span></b>
        <p>${rows}</p>
      </div>
    `;
  }).join('');
}

function syncConversionLegend(metrics = CONVERSION_METRICS) {
  CONVERSION_METRICS.forEach(key => {
    const button = $(`conversion-toggle-${key}`);
    if (!button) return;
    button.hidden = !metrics.includes(key);
    button.setAttribute('aria-pressed', String(conversionVisible[key]));
    button.classList.toggle('is-off', !conversionVisible[key]);
  });
}

function toggleConversionMetric(key) {
  if (!CONVERSION_METRICS.includes(key)) return;
  conversionVisible[key] = !conversionVisible[key];
  syncConversionLegend();

  const chart = charts['chart-reservation'];
  if (!chart) return;
  const index = chart.data.datasets.findIndex(dataset => dataset.label === METRIC_DEFS[key].label);
  if (index < 0) return;
  chart.setDatasetVisibility(index, conversionVisible[key]);
  chart.update();
}

function bindConversionLegend() {
  CONVERSION_METRICS.forEach(key => {
    $(`conversion-toggle-${key}`)?.addEventListener('click', () => toggleConversionMetric(key));
  });
  syncConversionLegend();
}

function renderCharts(mode, cur, prevMo, prevYr, trendKeys, store, manager, team, metrics, monthCount = 1) {
  const trendMetric = $('trendMetricSelect')?.value || metrics[0];
  const compareMetric = $('compareMetricSelect')?.value || metrics[0];

  const labels = trendKeys.map(key => labelForPeriodKey(mode, key));
  const trendSums = trendKeys.map(key => sumRows(getRowsByPeriod(mode, key, store, manager, team)));
  const trendValues = trendSums.map(sum => sum[trendMetric]);
  const conversionMetrics = CONVERSION_METRICS.filter(key => metrics.includes(key));
  const groups = GROUPS.filter(group => group.metrics.some(key => metrics.includes(key)));

  syncConversionLegend(conversionMetrics);

  document.querySelector('.trend-card').hidden = !metrics.length;
  document.querySelector('.compare-card').hidden = !metrics.length;
  document.querySelector('.conversion-card').hidden = !conversionMetrics.length;
  document.querySelector('.group-card').hidden = !groups.length;
  if (!metrics.length) return;

  if ($('trendChartTitle')) $('trendChartTitle').textContent = mode === 'MONTH' ? '월별 지표 추이' : '주차별 지표 추이';
  if ($('conversionChartTitle')) $('conversionChartTitle').textContent = mode === 'MONTH' ? '월별 전환 지표 추이' : '주차별 전환 지표 추이';
  if ($('compareChartTitle')) $('compareChartTitle').textContent = `전년 · 전월 · ${currentPeriodLabel(monthCount)} 비교`;

  makeChart('chart-trend', {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: METRIC_DEFS[trendMetric].label,
        data: trendValues,
        borderColor: '#ff7a00',
        backgroundColor: 'rgba(255, 122, 0, .22)',
        fill: true,
        tension: 0.34,
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBackgroundColor: '#ff7a00'
      }]
    },
    options: chartBaseOptions()
  });

  makeChart('chart-groups', {
    type: 'doughnut',
    data: {
      labels: groups.map(g => `${g.label} (${g.metrics.filter(key => metrics.includes(key)).length}개)`),
      datasets: [{
        data: groups.map(g => g.metrics.filter(key => metrics.includes(key)).length),
        backgroundColor: groups.map(g => g.color),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '58%',
      plugins: {
        chartValueLabelPlugin: { display: false },
        doughnutCenterTextPlugin: { text: `${metrics.length}개`, subtext: '보고 지표' },
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: context => `${context.label}: ${context.parsed}개 항목`
          },
          backgroundColor: '#111827',
          titleColor: '#f8fafc',
          bodyColor: '#cbd5e1',
          padding: 12
        }
      }
    }
  });

  const reservationOptions = chartBaseOptions();
  reservationOptions.plugins.legend.display = false;
  makeChart('chart-reservation', {
    type: 'bar',
    data: {
      labels,
      datasets: conversionMetrics.map(key => ({
        label: METRIC_DEFS[key].label,
        data: trendSums.map(sum => sum[key]),
        backgroundColor: key === 'conn' ? '#38a7ff' : '#ff7a00',
        hidden: !conversionVisible[key],
        borderRadius: 8
      }))
    },
    options: reservationOptions
  });

  makeChart('chart-compare', {
    type: 'bar',
    data: {
      labels: ['전년', '전월', currentPeriodLabel(monthCount)],
      datasets: [{
        label: METRIC_DEFS[compareMetric].label,
        data: [
          prevYr ? prevYr[compareMetric] : null,
          prevMo ? prevMo[compareMetric] : null,
          cur[compareMetric]
        ],
        backgroundColor: ['#8b5cf6', '#38a7ff', '#ff7a00'],
        borderRadius: 8
      }]
    },
    options: chartBaseOptions()
  });

  renderGroupSummary(cur, metrics);
}

function aggregateRowsByStoreManager(rows) {
  const map = new Map();

  rows.forEach(row => {
    const key = JSON.stringify([row.team, row.store]);
    if (!map.has(key)) {
      map.set(key, {
        team: row.team,
        store: row.store,
        managers: new Set(),
        ...Object.fromEntries(METRICS.map(metric => [metric, null]))
      });
    }

    const target = map.get(key);
    if (row.manager) target.managers.add(row.manager);
    METRICS.forEach(metric => {
      if (row[metric] !== null) target[metric] = (target[metric] ?? 0) + row[metric];
    });
  });

  return [...map.values()].map(row => ({
    ...row,
    manager: [...row.managers].sort((a, b) => a.localeCompare(b, 'ko')).join(', ')
  }));
}

function renderDetailTable(rows, mode, metrics) {
  const tbody = $('detail-tbody');
  if (!tbody) return;

  const tableRows = aggregateRowsByStoreManager(rows);
  const total = sumRows(tableRows);
  const rankMetric = REPORT_METRICS.includes($('rankingMetricSelect')?.value)
    ? $('rankingMetricSelect').value : 'views';
  const higherIsBetter = METRIC_DEFS[rankMetric].higher;
  tableRows.sort((a, b) => {
    if (a[rankMetric] === null) return b[rankMetric] === null ? a.store.localeCompare(b.store, 'ko') : 1;
    if (b[rankMetric] === null) return -1;
    return (higherIsBetter ? b[rankMetric] - a[rankMetric] : a[rankMetric] - b[rankMetric]) ||
      a.store.localeCompare(b.store, 'ko');
  });

  if ($('table-caption')) {
    $('table-caption').textContent = `선택 기간 매장별 합계 · ${METRIC_DEFS[rankMetric].label} ${higherIsBetter ? '높은' : '낮은'} 순 · 값이 없는 매장은 순위 제외`;
  }

  const headers = $('detail-head');
  if (headers) headers.innerHTML = `<th>순위</th><th>팀</th><th>매장명</th><th>담당자</th>` +
    metrics.map(key => `<th>${escapeHtml(METRIC_DEFS[key].label)}</th>`).join('');

  let previousRank = 0;
  const html = tableRows.map((r, index) => {
    const rank = r[rankMetric] === null ? null
      : (index && tableRows[index - 1][rankMetric] === r[rankMetric] ? previousRank : index + 1);
    if (rank !== null) previousRank = rank;
    return `
    <tr class="${rank === 1 ? 'top-store-row' : ''}">
      <td>${rank === null ? '—' : `<span class="rank-badge ${rank === 1 ? 'rank-first' : ''}">${rank}위</span>`}</td>
      <td>${escapeHtml(teamDisplayName(r.team))}</td>
      <td>${escapeHtml(r.store)}</td>
      <td>${escapeHtml(r.manager || '-')}</td>
      ${metrics.map(key => `<td>${fmtMetric(r[key])}</td>`).join('')}
    </tr>
  `;
  }).join('');

  tbody.innerHTML = (html || `<tr><td colspan="${4 + metrics.length}">해당 조건에 수집된 데이터가 없습니다.</td></tr>`) + (tableRows.length ? `
    <tr class="total-row">
      <td>—</td>
      <td>합계</td>
      <td>-</td>
      <td>-</td>
      ${metrics.map(key => `<td>${fmtMetric(total[key])}</td>`).join('')}
    </tr>
  ` : '');
}

function renderRawItemsTable(rows) {
  const head = $('raw-items-head');
  const body = $('raw-items-body');
  const count = $('raw-items-count');
  if (!head || !body) return;

  const headers = RAW_HEADERS.filter(header => rows.some(row => hasValue(row.source?.[header])));
  if (count) count.textContent = `선택 조건 ${rows.length}건 · 값이 있는 ${headers.length}개 열`;
  head.innerHTML = headers.map(header => `<th>${escapeHtml(header)}</th>`).join('');
  body.innerHTML = rows.length && headers.length
    ? rows.map(row => `<tr>${headers.map(header => `<td>${escapeHtml(row.source?.[header] ?? '')}</td>`).join('')}</tr>`).join('')
    : '<tr><td>선택 조건에 수집된 원본 항목이 없습니다.</td></tr>';
}

function rankedSourceValues(row, prefix) {
  const source = row.source || {};
  return [1, 2, 3, 4, 5].map(index =>
    text(pickRaw(source, [`${prefix} ${pad2(index)}`, `${prefix} ${index}`, `${prefix}${index}`]))
  ).filter(value => value && !/^(?:없음|\(검색어 없음\)|-|—|N\/A)$/i.test(value));
}

function summarizeSourceTerms(rows, prefix) {
  const terms = new Map();
  let eligibleRows = 0;
  let totalEntries = 0;
  rows.forEach(row => {
    const values = rankedSourceValues(row, prefix);
    if (!values.length) return;
    eligibleRows += 1;
    const seen = new Set();
    values.forEach((value, index) => {
      if (seen.has(value)) return;
      seen.add(value);
      totalEntries += 1;
      const previous = terms.get(value) || { name: value, count: 0, rankSum: 0 };
      previous.count += 1;
      previous.rankSum += index + 1;
      terms.set(value, previous);
    });
  });
  const top = [...terms.values()].sort((a, b) =>
    b.count - a.count || a.rankSum / a.count - b.rankSum / b.count || a.name.localeCompare(b.name, 'ko')
  ).slice(0, 5);
  return { top, eligibleRows, totalEntries };
}

function renderSourceRankCard(rows, prefix, title, icon) {
  const { top, eligibleRows, totalEntries } = summarizeSourceTerms(rows, prefix);
  const list = top.length ? `
    <p class="source-card-meta">선택 기간 · ${eligibleRows}개 매장·월 기록</p>
    <ol class="source-stat-list">${top.map((term, index) => {
      const share = term.count / totalEntries * 100;
      return `<li class="source-stat-item ${index === 0 ? 'is-leading' : ''}" style="--share:${share.toFixed(2)}%">
        <span class="source-stat-position">${index + 1}</span>
        <strong class="source-stat-term" title="${escapeHtml(term.name)}">${escapeHtml(term.name)}</strong>
        <b class="source-stat-share">${share.toFixed(2)}%</b>
      </li>`;
    }).join('')}</ol>`
    : '<p class="no-source-data">선택 기간에 기록된 항목이 없습니다.</p>';

  return `
    <div class="kpi-head">
      <div class="kpi-head-left">
        <div class="kpi-icon">${icon}</div>
        <div><h3 class="kpi-title">${title}</h3><div class="kpi-group">상위 5개 항목</div></div>
      </div>
      <div class="kpi-chip">TOP 5</div>
    </div>
    ${list}
    <p class="source-card-note">표시된 비율은 시트의 상위 5개 기록 칸에서 차지한 비중입니다. 실제 검색·유입량 비율은 아닙니다.</p>
  `;
}

function percentFromSource(value) {
  if (!hasValue(value)) return null;
  const raw = String(value).trim();
  const parsed = Number(raw.replace(/[%\s,]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  const result = raw.includes('%') ? parsed : parsed <= 1 ? parsed * 100 : parsed;
  return result >= 0 && result <= 100 ? result : null;
}

function summarizeDemographics(rows) {
  const genders = [];
  const ages = new Map();
  rows.forEach(row => {
    const source = row.source || {};
    // 고정 매핑: 성별 01 = 남자, 성별 02 = 여자.
    const male = percentFromSource(pickRaw(source, [GENDER_SOURCE_HEADERS.male]));
    const female = percentFromSource(pickRaw(source, [GENDER_SOURCE_HEADERS.female]));
    if (male !== null && female !== null && male + female > 0) {
      genders.push({ male: male / (male + female) * 100, female: female / (male + female) * 100 });
    }
    Object.entries(source).forEach(([header, value]) => {
      if (!/연령/.test(header)) return;
      const match = header.match(/(10|20|30|40|50|60|70|80|90)\s*대/);
      const share = percentFromSource(value);
      if (!match || share === null) return;
      const label = `${match[1]}대`;
      const entry = ages.get(label) || { sum: 0, count: 0 };
      entry.sum += share;
      entry.count += 1;
      ages.set(label, entry);
    });
  });
  return {
    male: genders.length ? genders.reduce((sum, row) => sum + row.male, 0) / genders.length : null,
    female: genders.length ? genders.reduce((sum, row) => sum + row.female, 0) / genders.length : null,
    genderRows: genders.length,
    ages: [...ages].sort((a, b) => Number(a[0].slice(0, -1)) - Number(b[0].slice(0, -1)))
  };
}

function renderDemographics(rows) {
  const target = $('demographic-summary');
  if (!target) return;
  const data = summarizeDemographics(rows);
  const lead = data.male === null ? null : Math.abs(data.male - data.female);
  const leadingGender = data.male >= data.female ? '남자' : '여자';
  const trailingGender = data.male >= data.female ? '여자' : '남자';
  const insight = lead === null ? '' : lead < 0.05
    ? '남자와 여자 비율이 비슷합니다.'
    : `${leadingGender} 비율이 ${trailingGender}보다 <strong>${lead.toFixed(1)}%p</strong> 높습니다.`;
  const genderHtml = data.male === null
    ? '<p class="no-source-data">선택 기간에 성별 비율이 없습니다.</p>'
    : `<div class="gender-summary">
        <div class="gender-donut" style="--male-share:${data.male.toFixed(1)}%" role="img" aria-label="남자 ${data.male.toFixed(1)}%, 여자 ${data.female.toFixed(1)}%"><span>성별</span></div>
        <div class="gender-legend">
          <div><span class="gender-dot male"></span><span>남자</span><strong>${data.male.toFixed(1)}%</strong></div>
          <div><span class="gender-dot female"></span><span>여자</span><strong>${data.female.toFixed(1)}%</strong></div>
        </div>
      </div><p class="gender-insight">${insight}</p>`;
  target.innerHTML = genderHtml;
}

function renderAudience(rows) {
  const route = $('source-route-card');
  const keyword = $('source-keyword-card');
  if (route) route.innerHTML = renderSourceRankCard(rows, '유입경로', '유입경로', '↗');
  if (keyword) keyword.innerHTML = renderSourceRankCard(rows, '유입키워드', '유입키워드', '⌕');
  renderDemographics(rows);
}

function renderInsight(mode, cur, prevMo, prevYr, monthCount = 1) {
  const target = $('weekly-insight');
  if (!target) return;
  const recentLabel = monthCount === 1 ? '전월' : '직전 같은 길이의 기간';

  if (!hasAnyData(cur)) {
    target.textContent = '선택한 조회 조건에 수집된 지표 데이터가 없습니다.';
    return;
  }

  const comparison = prevMo && hasAnyData(prevMo) ? prevMo : prevYr && hasAnyData(prevYr) ? prevYr : null;
  const comparisonLabel = comparison === prevMo ? recentLabel : '전년 같은 기간';
  if (!comparison) {
    target.textContent = `비교 가능한 전년·전월 데이터가 없어 ${mode === 'MONTH' ? '선택 기간' : '이번 주'} 성과를 표시하고 있습니다.`;
    return;
  }

  const prefix = mode === 'MONTH' ? '선택 기간 기준으로' : '이번 주 기준으로';
  const messages = [];
  const viewsRate = deltaRate(cur.views, comparison.views, true);
  const callRate = deltaRate(cur.conn, comparison.conn, true);
  const reserveRate = deltaRate(cur.res_req, comparison.res_req, true);
  const missRate = deltaRate(cur.miss, comparison.miss, false);

  if (viewsRate) messages.push(`조회수는 ${comparisonLabel} 대비 ${viewsRate.value >= 0 ? '상승' : '하락'}했습니다.`);
  if (callRate) messages.push(`연결콜은 ${callRate.value >= 0 ? '증가' : '감소'} 흐름입니다.`);
  if (reserveRate) messages.push(`예약 신청은 ${reserveRate.value >= 0 ? '개선' : '감소'}되었습니다.`);
  if (missRate && missRate.good) messages.push('미연결콜은 줄어 응대 관리 측면에서 긍정적입니다.');

  target.textContent = `${prefix} ${messages.join(' ') || '핵심 지표를 확인해보세요.'}`;
}

function getCurrentPeriodState() {
  const mode = getReportMode();
  const team = $('sel-team')?.value || 'ALL';
  const store = $('sel-store')?.value || 'ALL';
  const manager = $('sel-manager')?.value || 'ALL';
  let startKey = $('sel-month-start')?.value || monthKeys[monthKeys.length - 1];
  const endKey = $('sel-month-end')?.value || monthKeys[monthKeys.length - 1];
  if (!startKey || !endKey) return { mode, meta: null };
  if (monthOrdinal(startKey) > monthOrdinal(endKey)) startKey = endKey;
  const length = monthOrdinal(endKey) - monthOrdinal(startKey) + 1;
  const prevMonthStartKey = shiftMonthKey(startKey, -length);
  const prevMonthEndKey = shiftMonthKey(endKey, -length);
  const prevYearStartKey = shiftMonthKey(startKey, -12);
  const prevYearEndKey = shiftMonthKey(endKey, -12);

  return {
    mode,
    currentKey: endKey,
    startKey,
    endKey,
    team,
    store,
    manager,
    meta: getMonthRangeMeta(startKey, endKey),
    prevMonthStartKey,
    prevMonthEndKey,
    prevYearStartKey,
    prevYearEndKey,
    prevMoMeta: getMonthRangeMeta(prevMonthStartKey, prevMonthEndKey),
    prevYrMeta: getMonthRangeMeta(prevYearStartKey, prevYearEndKey)
  };
}

function renderDashboard() {
  const state = getCurrentPeriodState();
  if (!state.meta) {
    // 전 매장이 비활성이어도 이전 조회의 수치와 차트가 남지 않도록 비웁니다.
    lastRenderData = null;
    Object.values(charts).forEach(chart => chart.destroy());
    charts = {};
    closeKpiModal();
    closeInsightModal();
    if ($('manager-summary')) $('manager-summary').hidden = true;
    ['header-period', 'period-prev-year', 'period-prev-month', 'period-current'].forEach(id => {
      if ($(id)) $(id).textContent = '—';
    });
    const emptySum = sumRows([]);
    renderKpiCards(emptySum, null, null, REPORT_METRICS, []);
    renderGroupSummary(emptySum, REPORT_METRICS);
    renderAudience([]);
    renderDetailTable([], state.mode, REPORT_METRICS);
    renderRawItemsTable([]);
    renderInsight(state.mode, emptySum, null, null);
    return;
  }

  const curRows = getRowsByMonthRange(state.startKey, state.endKey, state.store, state.manager, state.team);
  const curSum = sumRows(curRows);
  const prevMoRows = getRowsByMonthRange(state.prevMonthStartKey, state.prevMonthEndKey, state.store, state.manager, state.team);
  const prevYrRows = getRowsByMonthRange(state.prevYearStartKey, state.prevYearEndKey, state.store, state.manager, state.team);
  const prevMoSum = prevMoRows.length ? sumRows(prevMoRows) : null;
  const prevYrSum = prevYrRows.length ? sumRows(prevYrRows) : null;
  const trendKeys = getTrendKeys(state.mode, state.currentKey, state.startKey);
  fillMetricSelects(REPORT_METRICS);

  lastRenderData = {
    mode: state.mode,
    meta: state.meta,
    prevMoMeta: state.prevMoMeta,
    prevYrMeta: state.prevYrMeta,
    curSum,
    prevMoSum,
    prevYrSum
  };

  renderManagerSummary(state);
  renderPeriodCards(state.mode, state.meta, state.prevMoMeta, state.prevYrMeta);
  renderKpiCards(curSum, prevMoSum, prevYrSum, REPORT_METRICS, curRows, state.meta.monthCount);
  renderCharts(state.mode, curSum, prevMoSum, prevYrSum, trendKeys, state.store, state.manager, state.team, REPORT_METRICS, state.meta.monthCount);
  renderAudience(curRows);
  renderDetailTable(curRows, state.mode, REPORT_METRICS);
  renderRawItemsTable(curRows);
  renderInsight(state.mode, curSum, prevMoSum, prevYrSum, state.meta.monthCount);
}

function openKpiModal(metricKey) {
  if (!lastRenderData) return;

  const def = METRIC_DEFS[metricKey];
  const cur = lastRenderData.curSum;
  const prevMo = lastRenderData.prevMoSum;
  const prevYr = lastRenderData.prevYrSum;
  const modal = $('kpiModal');

  if (!def || !modal) return;

  const moRate = prevMo ? deltaRate(cur[metricKey], prevMo[metricKey], def.higher) : null;
  const yrRate = prevYr ? deltaRate(cur[metricKey], prevYr[metricKey], def.higher) : null;

  if ($('modalGroup')) $('modalGroup').textContent = def.group;
  if ($('modalTitle')) $('modalTitle').textContent = def.label;
  if ($('modalCurrentLabel')) $('modalCurrentLabel').textContent = currentPeriodLabel(lastRenderData.meta?.monthCount);
  if ($('modalValue')) $('modalValue').textContent = fmtMetric(cur[metricKey]);
  if ($('modalPrevMonth')) $('modalPrevMonth').textContent = prevMo ? fmtMetric(prevMo[metricKey]) : '-';
  if ($('modalPrevYear')) $('modalPrevYear').textContent = prevYr ? fmtMetric(prevYr[metricKey]) : '-';
  if ($('modalDesc')) $('modalDesc').textContent = def.desc;

  if ($('modalPrevMonthRate')) {
    $('modalPrevMonthRate').innerHTML = moRate
      ? `<span class="${moRate.good ? 'rate-up' : 'rate-down'}">${moRate.value >= 0 ? '▲' : '▼'} ${Math.abs(moRate.value).toFixed(1)}%</span>`
      : '<span class="rate-flat">비교 불가</span>';
  }

  if ($('modalPrevYearRate')) {
    $('modalPrevYearRate').innerHTML = yrRate
      ? `<span class="${yrRate.good ? 'rate-up' : 'rate-down'}">${yrRate.value >= 0 ? '▲' : '▼'} ${Math.abs(yrRate.value).toFixed(1)}%</span>`
      : '<span class="rate-flat">비교 불가</span>';
  }

  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeKpiModal() {
  const modal = $('kpiModal');
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = '';
}

function ensureInsightModal() {
  if ($('insightModal')) return;

  const modal = document.createElement('div');
  modal.id = 'insightModal';
  modal.className = 'insight-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="insight-modal-card" role="dialog" aria-modal="true" aria-labelledby="insightModalTitle">
      <button type="button" class="insight-modal-close" id="insightModalClose" aria-label="닫기">×</button>
      <p class="modal-eyebrow">선택 기간 상세 분석</p>
      <h2 id="insightModalTitle">월간 성과 상세 요약</h2>
      <div class="insight-detail-box" id="insightDetailContent"></div>
    </div>
  `;

  document.body.appendChild(modal);

  const style = document.createElement('style');
  style.textContent = `
    .insight-modal[hidden] { display: none !important; }
    .insight-modal {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgba(2, 6, 12, .72);
      backdrop-filter: blur(8px);
    }
    .insight-modal-card {
      position: relative;
      width: min(760px, 94vw);
      max-height: 86vh;
      overflow: auto;
      border: 1px solid rgba(255, 122, 0, .45);
      border-radius: 26px;
      padding: 32px;
      background:
        radial-gradient(circle at top right, rgba(255, 122, 0, .18), transparent 36%),
        linear-gradient(135deg, rgba(15, 32, 46, .98), rgba(14, 21, 30, .98));
      box-shadow: 0 28px 90px rgba(0, 0, 0, .55);
      color: #f8fafc;
    }
    .insight-modal-close {
      position: absolute;
      top: 18px;
      right: 18px;
      width: 42px;
      height: 42px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, .25);
      background: rgba(255, 255, 255, .08);
      color: #fff;
      font-size: 27px;
      line-height: 1;
      cursor: pointer;
    }
    .insight-detail-box {
      margin-top: 22px;
      display: grid;
      gap: 14px;
    }
    .insight-detail-card {
      border: 1px solid rgba(148, 163, 184, .2);
      border-radius: 16px;
      padding: 16px 18px;
      background: rgba(15, 23, 42, .48);
    }
    .insight-detail-card strong {
      display: block;
      margin-bottom: 8px;
      font-size: 17px;
      color: #fff;
    }
    .insight-detail-card p {
      margin: 0;
      color: #cbd5e1;
      font-size: 14px;
      line-height: 1.65;
      font-weight: 700;
    }
    .insight-detail-card .good { color: #32d583; font-weight: 950; }
    .insight-detail-card .bad { color: #fb7185; font-weight: 950; }
    .insight-detail-card .flat { color: #94a3b8; font-weight: 950; }
  `;
  document.head.appendChild(style);

  $('insightModalClose')?.addEventListener('click', closeInsightModal);
  modal.addEventListener('click', e => {
    if (e.target === modal) closeInsightModal();
  });
}

function insightRateText(current, previous, higher) {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return { text: '비교 데이터 없음', cls: 'flat' };
  }
  const prev = num(previous);
  if (!prev) return { text: '비교 데이터 없음', cls: 'flat' };

  const rate = ((num(current) - prev) / prev) * 100;
  const good = higher ? rate >= 0 : rate <= 0;
  const direction = rate > 0 ? '증가' : rate < 0 ? '감소' : '변동 없음';

  return {
    text: `${direction} ${Math.abs(rate).toFixed(1)}%`,
    cls: good ? 'good' : 'bad'
  };
}

function buildInsightDetailHtml() {
  if (!lastRenderData) {
    return `
      <div class="insight-detail-card">
        <strong>데이터 없음</strong>
        <p>아직 선택된 데이터가 없습니다. 최신 조회를 눌러 데이터를 먼저 불러와 주세요.</p>
      </div>
    `;
  }

  const cur = lastRenderData.curSum || {};
  const prevMo = lastRenderData.prevMoSum || {};
  const prevYr = lastRenderData.prevYrSum || {};
  const modeText = lastRenderData.mode === 'MONTH' ? '선택 기간' : '이번 주';
  const comparisonLabel = lastRenderData.meta?.monthCount === 1 ? '전월' : '직전 기간';

  const visible = ACTIVE_METRICS.filter(key => cur[key] !== null);
  if (!visible.length) return '<div class="insight-detail-card"><strong>데이터 없음</strong><p>선택한 조건에 수집된 지표가 없습니다.</p></div>';

  return visible.map(key => {
    const def = METRIC_DEFS[key];
    const current = cur[key];
    const pm = prevMo[key];
    const py = prevYr[key];
    const monthRate = insightRateText(current, pm, def.higher);
    const yearRate = insightRateText(current, py, def.higher);

    return `
      <div class="insight-detail-card">
        <strong>${def.label}: 전년 ${lastRenderData.prevYrSum ? fmtMetric(py) : '—'} → 전월 ${lastRenderData.prevMoSum ? fmtMetric(pm) : '—'} → ${modeText} ${fmtMetric(current)}</strong>
        <p>
          전년 같은 기간 대비 <span class="${yearRate.cls}">${yearRate.text}</span>,
          ${comparisonLabel} 대비 <span class="${monthRate.cls}">${monthRate.text}</span>입니다.
          ${def.desc}
        </p>
      </div>
    `;
  }).join('');
}

function openInsightModal() {
  ensureInsightModal();
  const content = $('insightDetailContent');
  if (content) content.innerHTML = buildInsightDetailHtml();

  const modal = $('insightModal');
  if (!modal) return;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeInsightModal() {
  const modal = $('insightModal');
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = '';
}

function bindInsightEvents() {
  const insightPanel = document.querySelector('.insight-panel');
  if (!insightPanel || insightPanel.dataset.boundInsight === 'true') return;

  insightPanel.dataset.boundInsight = 'true';
  insightPanel.style.cursor = 'pointer';
  insightPanel.addEventListener('click', e => {
    const clickedButton = e.target.closest('button');
    const clickedPanel = e.target.closest('.insight-panel');
    if (clickedButton || clickedPanel) {
      e.preventDefault();
      openInsightModal();
    }
  });
}

window.openInsightModal = openInsightModal;
window.closeInsightModal = closeInsightModal;


window.openKpiModal = openKpiModal;
window.closeKpiModal = closeKpiModal;

function rawRowsForExport() {
  return RAW.map(row => Object.fromEntries(RAW_HEADERS.map(header => [header, row.source?.[header] ?? ''])));
}

function downloadCsvFallback(rows, filename) {
  const headers = Object.keys(rows[0] || {});
  const csv = [
    headers.join(','),
    ...rows.map(row => headers.map(header => {
      const value = row[header] ?? '';
      return `"${String(value).replace(/"/g, '""')}"`;
    }).join(','))
  ].join('\n');

  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/\.xlsx$/i, '.csv');
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadRawExcel() {
  const rows = rawRowsForExport();
  if (!rows.length) {
    alert('내려받을 데이터가 없습니다. 먼저 최신 조회를 눌러 데이터를 불러와 주세요.');
    return;
  }

  const now = new Date();
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}`;
  const filename = `hankook_month_raw_data_${stamp}.xlsx`;

  if (window.XLSX) {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'RAW_DATA');
    XLSX.writeFile(workbook, filename);
    return;
  }

  downloadCsvFallback(rows, filename);
}

async function refreshData() {
  const btn = $('refreshBtn');
  const originalText = btn ? btn.textContent : '';
  const previous = Object.fromEntries(['sel-team', 'sel-store', 'sel-manager', 'sel-month-start', 'sel-month-end']
    .map(id => [id, $(id)?.value]));

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '불러오는 중...';
    }

    await loadData();
    initSelects();
    if (TEAMS.includes(previous['sel-team'])) $('sel-team').value = previous['sel-team'];
    updateDependentFilterOptions();
    if (STORES.includes(previous['sel-store']) &&
      [...$('sel-store').options].some(option => option.value === previous['sel-store'])) {
      $('sel-store').value = previous['sel-store'];
    }
    updateManagerOptions();
    if (MANAGERS.includes(previous['sel-manager']) &&
      [...$('sel-manager').options].some(option => option.value === previous['sel-manager'])) {
      $('sel-manager').value = previous['sel-manager'];
    }
    if (monthKeys.includes(previous['sel-month-start'])) $('sel-month-start').value = previous['sel-month-start'];
    if (monthKeys.includes(previous['sel-month-end'])) $('sel-month-end').value = previous['sel-month-end'];
    renderDashboard();
    if ($('empty-state')) $('empty-state').hidden = true;
  } catch (e) {
    console.error(e);
    if ($('header-period')) $('header-period').textContent = '데이터 연결 오류';
    if ($('empty-state')) {
      $('empty-state').textContent = SHEET_LOAD_ERROR;
      $('empty-state').hidden = false;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

function bindModalEvents() {
  const modal = $('kpiModal');
  const closeBtn = $('modalCloseBtn');

  if (modal) modal.hidden = true;
  if (closeBtn) closeBtn.addEventListener('click', closeKpiModal);

  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target === modal) closeKpiModal();
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeKpiModal();
      closeInsightModal();
    }
  });
}

async function init() {
  bindModalEvents();
  bindInsightEvents();
  bindConversionLegend();
  fillMetricSelects();

  const refreshBtn = $('refreshBtn');
  const downloadRawBtn = $('downloadRawBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', refreshData);
  if (downloadRawBtn) downloadRawBtn.addEventListener('click', downloadRawExcel);

  try {
    await loadData();

    initSelects();
    renderDashboard();
    if ($('empty-state')) $('empty-state').hidden = true;
  } catch (e) {
    console.error(e);
    if ($('header-period')) $('header-period').textContent = '데이터 연결 오류';
    if ($('empty-state')) {
      $('empty-state').textContent = SHEET_LOAD_ERROR;
      $('empty-state').hidden = false;
    }
  }
}


window.debugHankookColumns = function () {
  const first = RAW[0] || null;
  console.log('RAW length:', RAW.length);
  console.log('첫 번째 정규화 데이터:', first);
  console.table(RAW.slice(0, 5).map(row => ({
    매장명: row.store,
    연월: `${row.yr}-${pad2(row.mo)}`,
    리뷰: row.review,
    부정리뷰: row.neg_review,
    톡톡상담: row.chat
  })));
};

async function openReport() {
  const pinGate = $('pinGate');
  const reportApp = $('reportApp');
  const subtitle = document.querySelector('.brand-text p');
  if (subtitle) subtitle.textContent = `도울기획 · 주요 성과 요약 대시보드 · 열람: ${currentViewer?.뷰어명 || '-'}`;

  if (pinGate) {
    pinGate.hidden = true;
  }

  if (reportApp) {
    reportApp.hidden = false;
  }

  document.body.classList.remove('pin-locked');

  if (!reportInitialized) {
    reportInitialized = true;
    await init();
  }
}

async function initPinGate() {
  const pinGate = $('pinGate');
  const reportApp = $('reportApp');
  const pinForm = $('pinForm');
  const pinInput = $('pinInput');
  const pinError = $('pinError');

  if (!pinGate || !reportApp || !pinForm || !pinInput) {
    console.warn('PIN 화면을 찾을 수 없어 보고서를 열지 않습니다.');
    return;
  }

  document.body.classList.add('pin-locked');
  reportApp.hidden = true;
  pinGate.hidden = false;

  let viewers = null;
  const submitButton = pinForm.querySelector('button[type="submit"]');
  pinInput.disabled = true;
  if (submitButton) submitButton.disabled = true;

  /*
   * 숫자만 최대 4자리 입력 가능
   */
  pinInput.addEventListener('input', () => {
    pinInput.value = pinInput.value
      .replace(/\D/g, '')
      .slice(0, 4);

    pinInput.classList.remove('is-error');

    if (pinError) {
      pinError.hidden = true;
    }
  });

  pinForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!viewers) return;

    const viewer = viewers.find(row => row.PIN === pinInput.value);
    if (!viewer) {
      pinInput.value = '';
      pinInput.classList.add('is-error');

      if (pinError) {
        pinError.hidden = false;
      }

      pinInput.focus();
      return;
    }

    currentViewer = viewer;
    sessionStorage.setItem(VIEWER_SESSION_KEY, JSON.stringify(currentViewer));
    sessionStorage.setItem(PIN_SESSION_KEY, 'true');

    await openReport();
  });

  viewers = await loadViewerSettings();
  pinInput.disabled = false;
  if (submitButton) submitButton.disabled = false;

  // 저장된 PIN을 현재 활성 목록과 대조해 변경된 범위와 비활성 여부도 반영합니다.
  try {
    if (sessionStorage.getItem(PIN_SESSION_KEY) === 'true') {
      const savedViewer = JSON.parse(sessionStorage.getItem(VIEWER_SESSION_KEY) || 'null');
      currentViewer = viewers.find(viewer => viewer.PIN === savedViewer?.PIN) || null;
      if (currentViewer) {
        sessionStorage.setItem(VIEWER_SESSION_KEY, JSON.stringify(currentViewer));
        await openReport();
        return;
      }
    }
  } catch (error) {
    console.warn('저장된 뷰어를 복원하지 못해 PIN을 다시 확인합니다.', error);
  }
  sessionStorage.removeItem(PIN_SESSION_KEY);
  sessionStorage.removeItem(VIEWER_SESSION_KEY);
  pinInput.focus();
}

/*
 * 테스트나 로그아웃이 필요할 때 개발자 도구에서
 * logoutHankookReport()를 실행하면 PIN 인증이 초기화됩니다.
 */
window.logoutHankookReport = function () {
  sessionStorage.removeItem(PIN_SESSION_KEY);
  sessionStorage.removeItem(VIEWER_SESSION_KEY);
  window.location.reload();
};

document.addEventListener('DOMContentLoaded', () => {
  return initPinGate();
});
