// ─────────────────────────────────────────────────────────────────────────────
// 한국타이어 네이버 플레이스 월간보고서
// 기존 대시보드 디자인을 유지하면서 월별 원본 데이터 한 행을 직접 읽습니다.
// ─────────────────────────────────────────────────────────────────────────────

// 새 Google 시트에 연결한 Apps Script 웹앱의 /exec 주소로 교체합니다.
// 기존 tna-week의 주소를 복사하지 마세요.
const DATA_URL = '__NEW_APPS_SCRIPT_WEB_APP_URL__';

const REPORT_PIN = '0517';
const PIN_SESSION_KEY = 'hankook_month_report_pin_authenticated';

let reportInitialized = false;
const RAW = [];

let weekMeta = {};
let weekKeys = [];
let monthKeys = [];
let STORES = [];
let MANAGERS = [];
let charts = {};
let lastRenderData = null;

const METRICS = ['views', 'conn', 'miss', 'res_in', 'res_req', 'review', 'neg_review', 'chat'];

const METRIC_DEFS = {
  views: {
    label: '플레이스 조회수',
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
    metrics: ['miss', 'review', 'neg_review', 'chat'],
    summary: '미연결콜 · 리뷰 · 부정리뷰 · 톡톡상담'
  }
];

function $(id) {
  return document.getElementById(id);
}

function num(value) {
  if (value === null || value === undefined || value === '') return 0;
  return Number(String(value).replace(/,/g, '').trim()) || 0;
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

function cacheBustUrl(url) {
  return url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now();
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
  const yearText = text(pickRaw(row, ['년', '연도', 'yr', 'year']));
  const monthText = text(pickRaw(row, ['월', '월별', 'mo', 'month']));
  const rawYear = Number(yearText.replace(/[^0-9]/g, '')) || 0;
  const year = rawYear >= 20 && rawYear <= 99 ? 2000 + rawYear : rawYear;
  const month = Number(monthText.replace(/[^0-9]/g, '')) || 0;
  if (year >= 2000 && month >= 1 && month <= 12) return { year, month };

  const period = text(pickRaw(row, ['연월', '년월', '기준월', '기간', 'period', 'year_month'])) || yearText;
  const match = period.match(/(20\d{2}|\d{2})\s*(?:년|[./-])\s*(1[0-2]|0?[1-9])(?:\s*월)?/);
  return match
    ? { year: match[1].length === 2 ? 2000 + Number(match[1]) : Number(match[1]), month: Number(match[2]) }
    : { year: 0, month: 0 };
}

async function fetchJsonWithCache(url, cacheKey, ttlMs = 5 * 60 * 1000, forceFresh = false) {
  const now = Date.now();

  if (!forceFresh) {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed?.ts && now - parsed.ts < ttlMs) return parsed.data;
      }
    } catch (e) {
      console.warn('캐시 읽기 실패:', e);
    }
  }

  const res = await fetch(forceFresh ? cacheBustUrl(url) : url);
  if (!res.ok) throw new Error('데이터 요청 실패: ' + res.status);

  const data = await res.json();

  try {
    localStorage.setItem(cacheKey, JSON.stringify({ ts: now, data }));
  } catch (e) {
    console.warn('캐시 저장 실패:', e);
  }

  return data;
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
    manager: text(pickRaw(r, ['담당자', '담당자명', '담당자 이름', '매장 담당자', '담당', 'manager', 'managerName', 'person_in_charge'])),
    views: num(pickRaw(r, ['조회수', '플레이스 조회수', 'views', 'place_views', 'placeViews'])),
    conn: num(pickRaw(r, ['연결콜', '연결 콜', 'conn', 'connected_call', 'connectedCall'])),
    miss: num(pickRaw(r, ['미연결콜', '미연결 콜', 'miss', 'missed_call', 'missedCall'])),
    res_in: num(pickRaw(r, ['예약유입', '예약 유입', 'res_in', 'resIn', 'reservation_in', 'reservationIn'])),
    res_req: num(pickRaw(r, ['예약신청', '예약 신청', 'res_req', 'resReq', 'reservation_request', 'reservationRequest'])),
    review: num(pickRaw(r, ['리뷰', '리뷰수', 'review', 'reviews'])),
    // 부정리뷰는 명시적인 부정리뷰 계열 컬럼이 있을 때만 사용합니다.
    // 컬럼명이 조금 달라도 자동으로 찾아오되, 일반 리뷰/톡톡상담 값이 밀려 들어가지 않게 합니다.
    neg_review: negReviewValue === undefined ? 0 : num(negReviewValue),
    chat: num(pickRaw(r, ['톡톡상담', '톡톡 상담', '톡톡', '톡톡상담수', '네이버톡톡', 'chat', 'talk', 'talktalk', 'talkTalk', 'naver_talk']))
  };
}

function normalizeRows(data) {
  return rowsFromPayload(data)
    .map(normalizePlaceRow)
    .filter(r => r.yr && r.mo >= 1 && r.mo <= 12 && r.store && !/^(합계|총합계|총계|전체)$/.test(r.store));
}

async function loadData(forceFresh = false) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(DATA_URL)) {
    throw new Error('새 Google Apps Script의 /exec 주소가 설정되지 않았습니다.');
  }
  const data = await fetchJsonWithCache(DATA_URL, 'hankook_month_dashboard_rows_v1', 5 * 60 * 1000, forceFresh);
  if (data?.error) throw new Error(String(data.error));
  const rows = normalizeRows(data);
  if (!rows.length) {
    throw new Error('월별 데이터가 없습니다. 시트의 년·월(또는 연월)·매장명 열을 확인해주세요.');
  }

  RAW.length = 0;
  rows.forEach(row => RAW.push(row));

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

  STORES = [...new Set(RAW.map(r => r.store).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  MANAGERS = [...new Set(RAW.map(r => r.manager).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
}

function sumRows(rows) {
  const s = {};
  METRICS.forEach(key => { s[key] = 0; });
  rows.forEach(r => METRICS.forEach(key => { s[key] += num(r[key]); }));
  return s;
}

function hasAnyData(sum) {
  return METRICS.some(key => num(sum[key]) > 0);
}

function getRowsByWeekKey(weekKey, store = 'ALL', manager = 'ALL') {
  const meta = weekMeta[weekKey];
  if (!meta) return [];

  return RAW.filter(r =>
    r.yr === meta.yr &&
    r.mo === meta.mo &&
    r.wk === meta.wk &&
    (store === 'ALL' || r.store === store) &&
    (manager === 'ALL' || r.manager === manager)
  );
}

function getRowsByMonthKey(monthKey, store = 'ALL', manager = 'ALL') {
  const [yr, mo] = String(monthKey || '').split('-').map(Number);
  if (!yr || !mo) return [];

  return RAW.filter(r =>
    r.yr === yr &&
    r.mo === mo &&
    (store === 'ALL' || r.store === store) &&
    (manager === 'ALL' || r.manager === manager)
  );
}

function getRowsByPeriod(mode, key, store = 'ALL', manager = 'ALL') {
  return mode === 'MONTH'
    ? getRowsByMonthKey(key, store, manager)
    : getRowsByWeekKey(key, store, manager);
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

function metricSelectOptionsHtml() {
  return METRICS.map(key => `<option value="${key}">${METRIC_DEFS[key].label}</option>`).join('');
}

function fillMetricSelects() {
  const trend = $('trendMetricSelect');
  const compare = $('compareMetricSelect');
  if (trend) {
    trend.innerHTML = metricSelectOptionsHtml();
    trend.value = 'views';
  }
  if (compare) {
    compare.innerHTML = metricSelectOptionsHtml();
    compare.value = 'views';
  }
}

function getReportMode() {
  return 'MONTH';
}

function updatePeriodModeUI() {
  document.querySelector('.month-filter')?.classList.add('is-active');
}

function initSelects() {
  const selStore = $('sel-store');
  const selManager = $('sel-manager');
  const selMonth = $('sel-month');

  if (!selStore || !selManager || !selMonth) return;

  selStore.innerHTML = '<option value="ALL">전체 매장</option>';
  STORES.forEach(store => {
    selStore.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(store)}">${escapeHtml(store)}</option>`);
  });

  selManager.innerHTML = '<option value="ALL">전체 담당자</option>';
  MANAGERS.forEach(manager => {
    selManager.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(manager)}">${escapeHtml(manager)}</option>`);
  });

  selMonth.innerHTML = '';
  monthKeys.forEach(key => {
    const [yr, mo] = key.split('-').map(Number);
    selMonth.insertAdjacentHTML('beforeend', `<option value="${key}">${yr}년 ${mo}월</option>`);
  });

  selMonth.value = [...monthKeys].reverse().find(key => hasAnyData(sumRows(getRowsByMonthKey(key))))
    || monthKeys[monthKeys.length - 1] || '';

  selStore.onchange = renderDashboard;
  selManager.onchange = renderDashboard;

  selMonth.onchange = renderDashboard;

  const trendMetricSelect = $('trendMetricSelect');
  const compareMetricSelect = $('compareMetricSelect');
  if (trendMetricSelect) trendMetricSelect.onchange = renderDashboard;
  if (compareMetricSelect) compareMetricSelect.onchange = renderDashboard;

  updatePeriodModeUI();
}

function renderPeriodCards(mode, meta, prevMoMeta, prevYrMeta) {
  const isMonth = mode === 'MONTH';

  if ($('period-current-title')) $('period-current-title').textContent = isMonth ? '선택 월별 조회' : '선택 주간 조회';
  if ($('period-prev-month-title')) $('period-prev-month-title').textContent = isMonth ? '전월' : '전월 같은 주차';
  if ($('period-prev-year-title')) $('period-prev-year-title').textContent = isMonth ? '전년 같은 월' : '전년 같은 기간';

  const rangeText = meta.start && meta.end ? `${meta.start} ~ ${meta.end}` : meta.label;
  const currentText = isMonth
    ? `${rangeText}<br>${meta.label} 전체 합산 기준`
    : `${rangeText}<br>월요일~일요일 1주 기준`;

  if ($('period-current')) $('period-current').innerHTML = currentText;
  if ($('header-period')) $('header-period').textContent = isMonth
    ? `${meta.label} 전체 · 월별 조회`
    : `${rangeText} · ${meta.mo}월 ${meta.wk}주차`;

  if ($('period-prev-month')) {
    $('period-prev-month').innerHTML = prevMoMeta
      ? `${prevMoMeta.start && prevMoMeta.end ? `${prevMoMeta.start} ~ ${prevMoMeta.end}` : prevMoMeta.label}<br>${isMonth ? '전월 전체 합산' : '전월 같은 주차'}`
      : '비교 데이터 없음';
  }

  if ($('period-prev-year')) {
    $('period-prev-year').innerHTML = prevYrMeta
      ? `${prevYrMeta.start && prevYrMeta.end ? `${prevYrMeta.start} ~ ${prevYrMeta.end}` : prevYrMeta.label}<br>${isMonth ? '전년 같은 월 전체' : '전년 같은 기간'}`
      : '비교 데이터 없음';
  }
}

function renderKpiCards(cur, prevMo, prevYr) {
  const grid = $('kpi-grid');
  if (!grid) return;

  grid.innerHTML = METRICS.map(key => {
    const def = METRIC_DEFS[key];
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

        <div class="kpi-value">${fmt(cur[key])}</div>

        <div class="kpi-rates">
          <div class="kpi-rate-box">
            <span class="rate-label">전월</span>
            <span class="rate-value">${prevMo ? fmt(prevMo[key]) : '-'}</span>
            ${rateHtml(cur[key], prevMo ? prevMo[key] : null, def.higher)}
          </div>
          <div class="kpi-rate-box">
            <span class="rate-label">전년 같은 달</span>
            <span class="rate-value">${prevYr ? fmt(prevYr[key]) : '-'}</span>
            ${rateHtml(cur[key], prevYr ? prevYr[key] : null, def.higher)}
          </div>
        </div>
      </article>
    `;
  }).join('');

  document.querySelectorAll('.kpi-card').forEach(card => {
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

    const { ctx } = chart;
    ctx.save();
    ctx.font = '700 11px Pretendard, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (!meta || meta.hidden) return;

      meta.data.forEach((element, index) => {
        const value = dataset.data[index];
        if (value === null || value === undefined || Number.isNaN(Number(value))) return;

        const pos = element.tooltipPosition();
        const y = Math.max(18, pos.y - 8);
        const label = fmt(value);

        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(2, 6, 23, .82)';
        ctx.fillStyle = '#f8fafc';
        ctx.strokeText(label, pos.x, y);
        ctx.fillText(label, pos.x, y);
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
      padding: { top: 28, right: 10, bottom: 0, left: 0 }
    },
    plugins: {
      chartValueLabelPlugin: { display: true },
      legend: {
        labels: {
          color: '#d6e4f3',
          font: { size: 13, family: 'Pretendard', weight: '800' },
          boxWidth: 12,
          boxHeight: 12
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

function getTrendKeys(mode, currentKey) {
  const source = mode === 'MONTH' ? monthKeys : weekKeys;
  const currentIndex = source.indexOf(currentKey);
  if (currentIndex < 0) return [];
  return source.slice(Math.max(0, currentIndex - 6), currentIndex + 1);
}

function labelForPeriodKey(mode, key) {
  if (mode === 'MONTH') return getMonthMeta(key).short;
  return weekMeta[key]?.short || key;
}

function renderGroupSummary(cur) {
  const target = $('group-summary');
  if (!target) return;

  target.innerHTML = GROUPS.map(group => {
    const rows = group.metrics.map(metricKey => `${METRIC_DEFS[metricKey].label} ${fmt(cur[metricKey])}`).join(' · ');
    const dotClass = group.key === 'exposure' ? 'orange' : group.key === 'convert' ? 'blue' : 'green';

    return `
      <div>
        <span class="legend-dot ${dotClass}"></span>
        <b>${group.label}<span class="group-count">${group.metrics.length}개 항목</span></b>
        <p>${rows}</p>
      </div>
    `;
  }).join('');
}

function renderCharts(mode, cur, prevMo, prevYr, trendKeys, store, manager) {
  const trendMetric = $('trendMetricSelect')?.value || 'views';
  const compareMetric = $('compareMetricSelect')?.value || 'views';

  const labels = trendKeys.map(key => labelForPeriodKey(mode, key));
  const trendValues = trendKeys.map(key => sumRows(getRowsByPeriod(mode, key, store, manager))[trendMetric]);
  const connValues = trendKeys.map(key => sumRows(getRowsByPeriod(mode, key, store, manager)).conn);
  const resReqValues = trendKeys.map(key => sumRows(getRowsByPeriod(mode, key, store, manager)).res_req);

  if ($('trendChartTitle')) $('trendChartTitle').textContent = mode === 'MONTH' ? '월별 지표 추이' : '주차별 지표 추이';
  if ($('conversionChartTitle')) $('conversionChartTitle').textContent = mode === 'MONTH' ? '월별 전환 지표 추이' : '주차별 전환 지표 추이';

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
      labels: GROUPS.map(g => `${g.label} (${g.metrics.length}개)`),
      datasets: [{
        data: GROUPS.map(g => g.metrics.length),
        backgroundColor: GROUPS.map(g => g.color),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '58%',
      plugins: {
        chartValueLabelPlugin: { display: false },
        doughnutCenterTextPlugin: { text: `${METRICS.length}개`, subtext: '전체 지표' },
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

  makeChart('chart-reservation', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '연결콜',
          data: connValues,
          backgroundColor: '#38a7ff',
          borderRadius: 8
        },
        {
          label: '예약신청',
          data: resReqValues,
          backgroundColor: '#ff7a00',
          borderRadius: 8
        }
      ]
    },
    options: chartBaseOptions()
  });

  makeChart('chart-compare', {
    type: 'bar',
    data: {
      labels: [mode === 'MONTH' ? '선택 월' : '선택 주', '전월', '전년 같은 달'],
      datasets: [{
        label: METRIC_DEFS[compareMetric].label,
        data: [
          cur[compareMetric] || 0,
          prevMo ? prevMo[compareMetric] || 0 : 0,
          prevYr ? prevYr[compareMetric] || 0 : 0
        ],
        backgroundColor: ['#ff7a00', '#38a7ff', '#8b5cf6'],
        borderRadius: 8
      }]
    },
    options: chartBaseOptions()
  });

  renderGroupSummary(cur);
}

function aggregateRowsByStoreManager(rows) {
  const map = new Map();

  rows.forEach(row => {
    const key = `${row.store}__${row.manager || ''}`;
    if (!map.has(key)) {
      map.set(key, {
        store: row.store,
        manager: row.manager || '',
        views: 0,
        conn: 0,
        miss: 0,
        res_in: 0,
        res_req: 0,
        review: 0,
        neg_review: 0,
        chat: 0
      });
    }

    const target = map.get(key);
    METRICS.forEach(metric => {
      target[metric] += num(row[metric]);
    });
  });

  return [...map.values()].sort((a, b) => {
    const storeCompare = a.store.localeCompare(b.store, 'ko');
    return storeCompare || a.manager.localeCompare(b.manager, 'ko');
  });
}

function renderDetailTable(rows, mode) {
  const tbody = $('detail-tbody');
  if (!tbody) return;

  const tableRows = aggregateRowsByStoreManager(rows);
  const total = sumRows(tableRows);

  if ($('table-caption')) {
    $('table-caption').textContent = mode === 'MONTH'
      ? '선택한 월 전체 데이터를 매장별로 합산했습니다.'
      : '선택한 월~일 주간 데이터를 매장별로 합산했습니다.';
  }

  const html = tableRows.map(r => `
    <tr>
      <td>${escapeHtml(r.store)}</td>
      <td>${escapeHtml(r.manager || '-')}</td>
      <td>${fmt(r.views)}</td>
      <td>${fmt(r.conn)}</td>
      <td>${fmt(r.miss)}</td>
      <td>${fmt(r.res_in)}</td>
      <td>${fmt(r.res_req)}</td>
      <td>${fmt(r.review)}</td>
      <td>${fmt(r.neg_review)}</td>
      <td>${fmt(r.chat)}</td>
    </tr>
  `).join('');

  tbody.innerHTML = html + `
    <tr class="total-row">
      <td>합계</td>
      <td>-</td>
      <td>${fmt(total.views)}</td>
      <td>${fmt(total.conn)}</td>
      <td>${fmt(total.miss)}</td>
      <td>${fmt(total.res_in)}</td>
      <td>${fmt(total.res_req)}</td>
      <td>${fmt(total.review)}</td>
      <td>${fmt(total.neg_review)}</td>
      <td>${fmt(total.chat)}</td>
    </tr>
  `;
}

function renderInsight(mode, cur, prevMo) {
  const target = $('weekly-insight');
  if (!target) return;

  if (!prevMo || !hasAnyData(prevMo)) {
    target.textContent = `비교 가능한 전월 데이터가 없어 ${mode === 'MONTH' ? '선택 월' : '이번 주'} 성과만 표시하고 있습니다.`;
    return;
  }

  const prefix = mode === 'MONTH' ? '선택 월 기준으로' : '이번 주 기준으로';
  const messages = [];
  const viewsRate = deltaRate(cur.views, prevMo.views, true);
  const callRate = deltaRate(cur.conn, prevMo.conn, true);
  const reserveRate = deltaRate(cur.res_req, prevMo.res_req, true);
  const missRate = deltaRate(cur.miss, prevMo.miss, false);
  const negRate = deltaRate(cur.neg_review, prevMo.neg_review, false);

  if (viewsRate) messages.push(`플레이스 조회수는 전월 대비 ${viewsRate.value >= 0 ? '상승' : '하락'}했습니다.`);
  if (callRate) messages.push(`연결콜은 ${callRate.value >= 0 ? '증가' : '감소'} 흐름입니다.`);
  if (reserveRate) messages.push(`예약 신청은 ${reserveRate.value >= 0 ? '개선' : '감소'}되었습니다.`);
  if (missRate && missRate.good) messages.push('미연결콜은 줄어 응대 관리 측면에서 긍정적입니다.');
  if (negRate && negRate.good) messages.push('부정리뷰도 줄어 평판 관리 흐름이 좋아졌습니다.');

  target.textContent = `${prefix} ${messages.join(' ') || '핵심 지표를 확인해보세요.'}`;
}

function getCurrentPeriodState() {
  const mode = getReportMode();
  const store = $('sel-store')?.value || 'ALL';
  const manager = $('sel-manager')?.value || 'ALL';

  if (mode === 'MONTH') {
    const currentKey = $('sel-month')?.value || monthKeys[monthKeys.length - 1];
    const meta = getMonthMeta(currentKey);
    const pmKey = prevMonthKeyForMonth(currentKey);
    const pyKey = prevYearKeyForMonth(currentKey);

    return {
      mode,
      currentKey,
      store,
      manager,
      meta,
      prevMonthKey: pmKey,
      prevYearKey: pyKey,
      prevMoMeta: pmKey ? getMonthMeta(pmKey) : null,
      prevYrMeta: pyKey ? getMonthMeta(pyKey) : null
    };
  }

  const currentKey = $('sel-week')?.value || weekKeys[weekKeys.length - 1];
  const meta = weekMeta[currentKey];
  const pmKey = meta ? prevMonthKeyForWeek(meta.yr, meta.mo, meta.wk) : null;
  const pyKey = meta ? prevYearKeyForWeek(meta.yr, meta.mo, meta.wk) : null;

  return {
    mode,
    currentKey,
    store,
    manager,
    meta,
    prevMonthKey: pmKey,
    prevYearKey: pyKey,
    prevMoMeta: pmKey ? weekMeta[pmKey] : null,
    prevYrMeta: pyKey ? weekMeta[pyKey] : null
  };
}

function renderDashboard() {
  const state = getCurrentPeriodState();
  if (!state.meta) return;

  const curRows = getRowsByPeriod(state.mode, state.currentKey, state.store, state.manager);
  const curSum = sumRows(curRows);
  const prevMoSum = state.prevMonthKey ? sumRows(getRowsByPeriod(state.mode, state.prevMonthKey, state.store, state.manager)) : null;
  const prevYrSum = state.prevYearKey ? sumRows(getRowsByPeriod(state.mode, state.prevYearKey, state.store, state.manager)) : null;
  const trendKeys = getTrendKeys(state.mode, state.currentKey);

  lastRenderData = {
    mode: state.mode,
    meta: state.meta,
    curSum,
    prevMoSum,
    prevYrSum
  };

  renderPeriodCards(state.mode, state.meta, state.prevMoMeta, state.prevYrMeta);
  renderKpiCards(curSum, prevMoSum, prevYrSum);
  renderCharts(state.mode, curSum, prevMoSum, prevYrSum, trendKeys, state.store, state.manager);
  renderDetailTable(curRows, state.mode);
  renderInsight(state.mode, curSum, prevMoSum);
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
  if ($('modalValue')) $('modalValue').textContent = fmt(cur[metricKey]);
  if ($('modalPrevMonth')) $('modalPrevMonth').textContent = prevMo ? fmt(prevMo[metricKey]) : '-';
  if ($('modalPrevYear')) $('modalPrevYear').textContent = prevYr ? fmt(prevYr[metricKey]) : '-';
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
      <p class="modal-eyebrow">선택 월 상세 분석</p>
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
  const modeText = lastRenderData.mode === 'MONTH' ? '선택 월' : '이번 주';

  return METRICS.map(key => {
    const def = METRIC_DEFS[key];
    const current = num(cur[key]);
    const pm = num(prevMo[key]);
    const py = num(prevYr[key]);
    const monthRate = insightRateText(current, pm, def.higher);
    const yearRate = insightRateText(current, py, def.higher);

    return `
      <div class="insight-detail-card">
        <strong>${def.label} ${fmt(current)}</strong>
        <p>
          ${modeText} ${def.label}은 전월 ${lastRenderData.prevMoSum ? fmt(pm) : '-'} 대비
          <span class="${monthRate.cls}">${monthRate.text}</span>,
          전년 같은 달 ${lastRenderData.prevYrSum ? fmt(py) : '-'} 대비
          <span class="${yearRate.cls}">${yearRate.text}</span>입니다.
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
  return RAW.map(r => ({
    년: r.yr,
    월: r.mo,
    매장명: r.store,
    담당자: r.manager,
    조회수: r.views,
    연결콜: r.conn,
    미연결콜: r.miss,
    예약유입: r.res_in,
    예약신청: r.res_req,
    리뷰: r.review,
    부정리뷰: r.neg_review,
    톡톡상담: r.chat
  }));
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

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '불러오는 중...';
    }

    await loadData(true);
    initSelects();
    renderDashboard();
    if ($('empty-state')) $('empty-state').hidden = true;
  } catch (e) {
    console.error(e);
    if ($('empty-state')) $('empty-state').hidden = false;
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
  fillMetricSelects();

  const refreshBtn = $('refreshBtn');
  const downloadRawBtn = $('downloadRawBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', refreshData);
  if (downloadRawBtn) downloadRawBtn.addEventListener('click', downloadRawExcel);

  try {
    await loadData(false);

    if (!RAW.length) {
      if ($('empty-state')) $('empty-state').hidden = false;
      return;
    }

    initSelects();
    renderDashboard();
    if ($('empty-state')) $('empty-state').hidden = true;
  } catch (e) {
    console.error(e);
    if ($('empty-state')) $('empty-state').hidden = false;
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

function initPinGate() {
  const pinGate = $('pinGate');
  const reportApp = $('reportApp');
  const pinForm = $('pinForm');
  const pinInput = $('pinInput');
  const pinError = $('pinError');

  /*
   * PIN 화면이 없는 경우를 대비한 안전장치
   */
  if (!pinGate || !reportApp || !pinForm || !pinInput) {
    init();
    return;
  }

  document.body.classList.add('pin-locked');
  reportApp.hidden = true;
  pinGate.hidden = false;

  /*
   * 같은 브라우저 탭에서 이미 인증한 경우
   * 새로고침해도 다시 묻지 않습니다.
   */
  if (sessionStorage.getItem(PIN_SESSION_KEY) === 'true') {
    openReport();
    return;
  }

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

    if (pinInput.value !== REPORT_PIN) {
      pinInput.value = '';
      pinInput.classList.add('is-error');

      if (pinError) {
        pinError.hidden = false;
      }

      pinInput.focus();
      return;
    }

    sessionStorage.setItem(PIN_SESSION_KEY, 'true');

    await openReport();
  });

  pinInput.focus();
}

/*
 * 테스트나 로그아웃이 필요할 때 개발자 도구에서
 * logoutHankookReport()를 실행하면 PIN 인증이 초기화됩니다.
 */
window.logoutHankookReport = function () {
  sessionStorage.removeItem(PIN_SESSION_KEY);
  window.location.reload();
};

document.addEventListener('DOMContentLoaded', initPinGate);
