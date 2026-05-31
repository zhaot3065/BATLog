/**
 * BATLog - 리튬 배터리 충전 이력 추적 API
 *
 * Batteries: A=BatteryID, B=Model, C=StartDate, D=MaxCycles
 * ChargingLogs: A=Timestamp, B=BatteryID, C=Worker
 * AppearanceReports: A=Timestamp, B=BatteryID, C=Worker, D=Issues, E=Note, F=Status
 *
 * Battery ID 형식: {CHEM}-{N}S-{CAP}-{SEQ}
 * 예) LPO-6S-22-001  (LiPo, 6S, 22000mAh, 1번)
 */
const DEFAULT_ADMIN_PIN = '8842';
const PIN_PROPERTY_KEY = 'ADMIN_PIN';
const REGISTER_OPTIONS_KEY = 'REGISTER_OPTIONS';
const ADMIN_EMAIL_PROPERTY_KEY = 'ADMIN_EMAIL';
const ADMIN_EMAILS_PROPERTY_KEY = 'ADMIN_EMAILS';
const APPEARANCE_REPORT_HEADERS = ['Timestamp', 'BatteryID', 'Worker', 'Issues', 'Note', 'Status'];

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function formatDate_(value) {
  if (!value) {
    return '';
  }
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value);
}

function formatTimestamp_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function parseMaxCycles_(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return 0;
  }
  return Math.floor(num);
}

function getAdminPin_() {
  const stored = PropertiesService.getScriptProperties().getProperty(PIN_PROPERTY_KEY);
  return stored || DEFAULT_ADMIN_PIN;
}

function verifyAdminPin_(pin) {
  return String(pin || '') === getAdminPin_();
}

function getRegisterOptions_() {
  const raw = PropertiesService.getScriptProperties().getProperty(REGISTER_OPTIONS_KEY);
  if (!raw) {
    return { chem: [], cells: [], capacity: [], maxCycles: [] };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      chem: Array.isArray(parsed.chem) ? parsed.chem : [],
      cells: Array.isArray(parsed.cells) ? parsed.cells : [],
      capacity: Array.isArray(parsed.capacity) ? parsed.capacity : [],
      maxCycles: Array.isArray(parsed.maxCycles) ? parsed.maxCycles : [],
    };
  } catch (err) {
    return { chem: [], cells: [], capacity: [], maxCycles: [] };
  }
}

function saveRegisterOptions_(options) {
  PropertiesService.getScriptProperties().setProperty(
    REGISTER_OPTIONS_KEY,
    JSON.stringify(options)
  );
}

function normalizeRegisterOptionItem_(type, value, label) {
  if (type === 'chem') {
    const code = normalizeBatteryId_(value);
    const display = String(label || code).trim();
    if (!/^[A-Z]{2,3}$/.test(code)) {
      throw new Error('종류 코드는 영문 2~3자여야 합니다.');
    }
    if (!display) {
      throw new Error('종류 표시 이름이 필요합니다.');
    }
    return { value: code, label: display };
  }

  const num = Math.floor(Number(value));
  if (!num || num <= 0) {
    throw new Error('올바른 숫자를 입력해 주세요.');
  }

  return String(num);
}

function addRegisterOption_(type, value, label, pin) {
  if (!verifyAdminPin_(pin)) {
    throw new Error('관리자 PIN이 올바르지 않습니다.');
  }

  const allowed = { chem: true, cells: true, capacity: true, maxCycles: true };
  if (!allowed[type]) {
    throw new Error('지원하지 않는 선택지 유형입니다.');
  }

  const item = normalizeRegisterOptionItem_(type, value, label);
  const options = getRegisterOptions_();
  const list = options[type];

  if (type === 'chem') {
    if (list.some(function (entry) { return entry.value === item.value; })) {
      return options;
    }
    list.push(item);
  } else if (list.indexOf(item) !== -1) {
    return options;
  } else {
    list.push(item);
    list.sort(function (a, b) { return Number(a) - Number(b); });
  }

  saveRegisterOptions_(options);
  return options;
}

function handleRegisterOptionsGet_(params) {
  if (!verifyAdminPin_(params.pin)) {
    return jsonResponse_({ success: false, error: '관리자 PIN이 올바르지 않습니다.' });
  }

  return jsonResponse_({ success: true, options: getRegisterOptions_() });
}

function handleRegisterInit_(params, sheet) {
  if (!verifyAdminPin_(params.pin)) {
    return jsonResponse_({ success: false, error: '관리자 PIN이 올바르지 않습니다.' });
  }

  const prefix = buildBatteryIdPrefix_(params.chem, params.cells, params.capacity);

  return jsonResponse_({
    success: true,
    options: getRegisterOptions_(),
    prefix: prefix,
    nextId: generateNextBatteryId_(sheet, prefix),
  });
}

function handleAddRegisterOption_(params) {
  const type = String(params.optionType || '').trim();
  const options = addRegisterOption_(type, params.value, params.label, params.pin);
  return jsonResponse_({ success: true, options: options });
}

function normalizeBatteryId_(value) {
  return String(value || '').trim().toUpperCase();
}

function isValidBatteryId_(batteryId) {
  return /^[A-Z]{2,3}-\d+S-\d+-\d{3,}$/.test(batteryId) || /^BT\d{3,}$/.test(batteryId);
}

function buildBatteryIdPrefix_(chem, cells, capacityMah) {
  const chemCode = normalizeBatteryId_(chem);
  const cellCount = Math.floor(Number(cells));
  const capAh = Math.round(Number(capacityMah) / 1000);

  if (!/^[A-Z]{2,3}$/.test(chemCode)) {
    throw new Error('배터리 종류 코드가 올바르지 않습니다.');
  }

  if (!cellCount || cellCount <= 0) {
    throw new Error('셀 수(S)가 올바르지 않습니다.');
  }

  if (!capAh || capAh <= 0) {
    throw new Error('용량(mAh)이 올바르지 않습니다.');
  }

  return chemCode + '-' + cellCount + 'S-' + capAh;
}

function generateNextBatteryId_(sheet, prefix) {
  const normalizedPrefix = normalizeBatteryId_(prefix);
  const rows = sheet.getDataRange().getValues();
  let maxSeq = 0;
  const escapedPrefix = normalizedPrefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const pattern = new RegExp('^' + escapedPrefix + '-(\\d{3,})$');

  for (let i = 1; i < rows.length; i++) {
    const match = normalizeBatteryId_(rows[i][0]).match(pattern);
    if (match) {
      maxSeq = Math.max(maxSeq, Number(match[1]));
    }
  }

  return normalizedPrefix + '-' + String(maxSeq + 1).padStart(3, '0');
}

function listBatteries_(sheet) {
  const rows = sheet.getDataRange().getValues();
  const batteries = [];

  for (let i = 1; i < rows.length; i++) {
    const id = normalizeBatteryId_(rows[i][0]);
    if (!id) {
      continue;
    }
    batteries.push({
      id: id,
      model: String(rows[i][1] || ''),
    });
  }

  batteries.sort(function (a, b) {
    return a.id.localeCompare(b.id);
  });

  return batteries;
}

function handleBatteryList_(params, sheet) {
  if (!verifyAdminPin_(params.pin)) {
    return jsonResponse_({ success: false, error: '관리자 PIN이 올바르지 않습니다.' });
  }

  return jsonResponse_({ success: true, batteries: listBatteries_(sheet) });
}

function findBattery_(sheet, batteryId) {
  const rows = sheet.getDataRange().getValues();
  const normalizedId = normalizeBatteryId_(batteryId);

  for (let i = 1; i < rows.length; i++) {
    if (normalizeBatteryId_(rows[i][0]) === normalizedId) {
      return {
        model: rows[i][1],
        startDate: formatDate_(rows[i][2]),
        maxCycles: parseMaxCycles_(rows[i][3]),
      };
    }
  }

  return null;
}

function batteryExists_(sheet, batteryId) {
  return findBattery_(sheet, batteryId) !== null;
}

function countCycles_(sheet, batteryId) {
  const rows = sheet.getDataRange().getValues();
  const normalizedId = normalizeBatteryId_(batteryId);
  let count = 0;

  for (let i = 1; i < rows.length; i++) {
    if (normalizeBatteryId_(rows[i][1]) === normalizedId) {
      count++;
    }
  }

  return count;
}

function getSpreadsheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const batteriesSheet = ss.getSheetByName('Batteries');
  const logsSheet = ss.getSheetByName('ChargingLogs');

  if (!batteriesSheet || !logsSheet) {
    throw new Error('Batteries 또는 ChargingLogs 시트가 없습니다.');
  }

  return { batteriesSheet, logsSheet };
}

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail_(email));
}

function getAdminEmails_() {
  const props = PropertiesService.getScriptProperties();
  const rawList = props.getProperty(ADMIN_EMAILS_PROPERTY_KEY);

  if (rawList) {
    try {
      const parsed = JSON.parse(rawList);
      if (Array.isArray(parsed)) {
        return parsed
          .map(normalizeEmail_)
          .filter(function (email) { return email && isValidEmail_(email); });
      }
    } catch (err) {
      // JSON 파싱 실패 시 legacy/fallback 처리
    }
  }

  const legacy = props.getProperty(ADMIN_EMAIL_PROPERTY_KEY);
  if (legacy) {
    const email = normalizeEmail_(legacy);
    if (isValidEmail_(email)) {
      return [email];
    }
  }

  try {
    const deployer = Session.getEffectiveUser().getEmail();
    const email = normalizeEmail_(deployer);
    return isValidEmail_(email) ? [email] : [];
  } catch (err) {
    return [];
  }
}

function saveAdminEmails_(emails) {
  const unique = [];

  emails.forEach(function (email) {
    const normalized = normalizeEmail_(email);
    if (normalized && isValidEmail_(normalized) && unique.indexOf(normalized) < 0) {
      unique.push(normalized);
    }
  });

  PropertiesService.getScriptProperties().setProperty(
    ADMIN_EMAILS_PROPERTY_KEY,
    JSON.stringify(unique)
  );
}

function getAdminEmail_() {
  const emails = getAdminEmails_();
  return emails.length ? emails.join(',') : '';
}

function formatReportTimestamp_(value) {
  if (value instanceof Date) {
    return formatTimestamp_(value);
  }

  return String(value || '');
}

function isResolvedAppearanceStatus_(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'resolved' || normalized === '해결' || normalized === '완료';
}

function ensureAppearanceReportsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('AppearanceReports');

  if (!sheet) {
    sheet = ss.insertSheet('AppearanceReports');
    sheet.appendRow(APPEARANCE_REPORT_HEADERS);
    return sheet;
  }

  const headerRow = sheet.getRange(1, 1, 1, APPEARANCE_REPORT_HEADERS.length).getValues()[0];
  const hasStatus = String(headerRow[5] || '').trim().toLowerCase() === 'status';

  if (!hasStatus) {
    sheet.getRange(1, 6).setValue('Status');
  }

  return sheet;
}

function findOpenAppearanceReport_(sheet, batteryId) {
  if (!sheet || sheet.getLastRow() < 2) {
    return null;
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(function (header) {
    return String(header || '').trim().toLowerCase();
  });
  const statusCol = headers.indexOf('status');

  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    const rowBatteryId = normalizeBatteryId_(row[1]);

    if (rowBatteryId !== batteryId) {
      continue;
    }

    const status = statusCol >= 0 ? row[statusCol] : '';
    if (isResolvedAppearanceStatus_(status)) {
      continue;
    }

    return {
      timestamp: formatReportTimestamp_(row[0]),
      batteryId: rowBatteryId,
      worker: String(row[2] || ''),
      issues: String(row[3] || ''),
      note: String(row[4] || ''),
    };
  }

  return null;
}

function sendAppearanceReportEmail_(report) {
  const adminEmails = getAdminEmails_();
  if (!adminEmails.length) {
    return {
      sent: false,
      error: '등록된 알림 메일이 없습니다. 관리자 설정에서 메일을 추가해 주세요.',
    };
  }

  const subject = '[BATLog] 외관 이상 보고 — ' + report.batteryId;
  const body = [
    'BATLog 외관 이상 보고가 접수되었습니다.',
    '',
    '배터리 ID: ' + report.batteryId,
    '모델: ' + (report.model || '-'),
    '작업자: ' + report.worker,
    '이상 항목: ' + report.issues,
    '특이사항: ' + (report.note || '-'),
    '보고 시각: ' + report.timestamp,
    '',
    '해당 배터리는 사용·충전하지 마세요.',
    '점검 완료 후 AppearanceReports 시트의 Status 열을 resolved 로 변경하면 다시 사용할 수 있습니다.',
  ].join('\n');

  try {
    MailApp.sendEmail({
      to: adminEmails.join(','),
      subject: subject,
      body: body,
    });

    return {
      sent: true,
      recipients: adminEmails,
    };
  } catch (err) {
    return {
      sent: false,
      error: err.message || String(err),
    };
  }
}

/**
 * Apps Script 편집기에서 1회 실행해 메일 발송 권한을 승인합니다.
 * 실행 → 권한 검토 → 허용 → 배포 관리에서 새 버전 배포
 */
function authorizeMailPermission() {
  const result = sendAppearanceReportEmail_({
    batteryId: 'MAIL-AUTH-TEST',
    model: '-',
    worker: '시스템',
    issues: '권한 테스트',
    note: 'BATLog 메일 발송 권한 확인용입니다.',
    timestamp: formatTimestamp_(new Date()),
  });
  Logger.log(JSON.stringify(result));
  return result;
}

function getAppearanceReportsSheet_() {
  return ensureAppearanceReportsSheet_();
}

function parseRequestParams_(e) {
  const params = {
    action: '',
    id: '',
    worker: '',
    model: '',
    startDate: '',
    maxCycles: '',
    pin: '',
    chem: '',
    cells: '',
    capacity: '',
    oldPin: '',
    newPin: '',
    optionType: '',
    value: '',
    label: '',
    issues: '',
    note: '',
    email: '',
  };

  if (e && e.parameter) {
    params.action = String(e.parameter.action || '').trim();
    params.id = String(e.parameter.id || '').trim();
    params.worker = String(e.parameter.worker || '').trim();
    params.model = String(e.parameter.model || '').trim();
    params.startDate = String(e.parameter.startDate || '').trim();
    params.maxCycles = String(e.parameter.maxCycles || '').trim();
    params.pin = String(e.parameter.pin || '').trim();
    params.chem = String(e.parameter.chem || '').trim();
    params.cells = String(e.parameter.cells || '').trim();
    params.capacity = String(e.parameter.capacity || '').trim();
    params.oldPin = String(e.parameter.oldPin || '').trim();
    params.newPin = String(e.parameter.newPin || '').trim();
    params.optionType = String(e.parameter.optionType || '').trim();
    params.value = String(e.parameter.value || '').trim();
    params.label = String(e.parameter.label || '').trim();
    params.issues = String(e.parameter.issues || '').trim();
    params.note = String(e.parameter.note || '').trim();
    params.email = String(e.parameter.email || '').trim();
  }

  if (e && e.postData && e.postData.contents) {
    const contentType = String(e.postData.type || '').toLowerCase();
    let body = {};

    if (contentType.indexOf('application/json') !== -1) {
      body = JSON.parse(e.postData.contents);
    } else {
      e.postData.contents.split('&').forEach(function (pair) {
        const parts = pair.split('=');
        const key = decodeURIComponent(parts[0] || '');
        const value = decodeURIComponent((parts[1] || '').replace(/\+/g, ' '));
        body[key] = value;
      });
    }

    Object.keys(params).forEach(function (key) {
      if (!params[key] && body[key] !== undefined) {
        params[key] = String(body[key]).trim();
      }
    });
  }

  return params;
}

function handleVerifyPin_(params) {
  if (!verifyAdminPin_(params.pin)) {
    return jsonResponse_({ success: false, error: '관리자 PIN이 올바르지 않습니다.' });
  }

  return jsonResponse_({ success: true });
}

function handleNextId_(params, sheet) {
  if (!verifyAdminPin_(params.pin)) {
    return jsonResponse_({ success: false, error: '관리자 PIN이 올바르지 않습니다.' });
  }

  const prefix = buildBatteryIdPrefix_(params.chem, params.cells, params.capacity);

  return jsonResponse_({
    success: true,
    prefix: prefix,
    nextId: generateNextBatteryId_(sheet, prefix),
  });
}

function handleChangePin_(params) {
  if (!verifyAdminPin_(params.oldPin || params.pin)) {
    return jsonResponse_({ success: false, error: '현재 PIN이 올바르지 않습니다.' });
  }

  const newPin = String(params.newPin || '').trim();

  if (!/^\d{4,8}$/.test(newPin)) {
    return jsonResponse_({ success: false, error: '새 PIN은 4~8자리 숫자여야 합니다.' });
  }

  PropertiesService.getScriptProperties().setProperty(PIN_PROPERTY_KEY, newPin);

  return jsonResponse_({ success: true });
}

function handleRegisterBattery_(params) {
  if (!verifyAdminPin_(params.pin)) {
    return jsonResponse_({ success: false, error: '관리자 PIN이 올바르지 않습니다.' });
  }

  const batteryId = normalizeBatteryId_(params.id);
  const model = String(params.model || '').trim();
  const startDate = String(params.startDate || '').trim();
  const maxCycles = parseMaxCycles_(params.maxCycles);

  if (!batteryId) {
    return jsonResponse_({ success: false, error: 'Battery ID가 필요합니다.' });
  }

  if (!isValidBatteryId_(batteryId)) {
    return jsonResponse_({ success: false, error: 'Battery ID 형식이 올바르지 않습니다.' });
  }

  if (!model) {
    return jsonResponse_({ success: false, error: '모델명(Model)이 필요합니다.' });
  }

  if (!startDate) {
    return jsonResponse_({ success: false, error: '사용 시작일(StartDate)이 필요합니다.' });
  }

  if (!maxCycles) {
    return jsonResponse_({ success: false, error: '권장 수명(MaxCycles)이 필요합니다.' });
  }

  const sheets = getSpreadsheet_();

  if (batteryExists_(sheets.batteriesSheet, batteryId)) {
    return jsonResponse_({ success: false, error: '이미 등록된 Battery ID입니다.' });
  }

  sheets.batteriesSheet.appendRow([
    batteryId,
    model,
    startDate,
    maxCycles,
  ]);

  return jsonResponse_({
    success: true,
    id: batteryId,
    model: model,
    startDate: startDate,
    maxCycles: maxCycles,
  });
}

function formatAppearanceIssues_(issuesParam) {
  const labels = {
    swelling: '스웰링',
    dent: '찍힘·파손',
    leak: '누액·이상 냄새',
    connector: '커넥터 손상',
  };

  return String(issuesParam || '')
    .split(',')
    .map(function (part) { return part.trim(); })
    .filter(function (part) { return part; })
    .map(function (id) { return labels[id] || id; })
    .join(', ');
}

function handleAppearanceReport_(params) {
  const batteryId = normalizeBatteryId_(params.id);
  const worker = String(params.worker || '').trim();
  const issuesText = formatAppearanceIssues_(params.issues);
  const note = String(params.note || '').trim();

  if (!batteryId) {
    return jsonResponse_({ success: false, error: 'Battery ID가 필요합니다.' });
  }

  if (!worker) {
    return jsonResponse_({ success: false, error: '작업자 이름이 필요합니다.' });
  }

  if (!issuesText && !note) {
    return jsonResponse_({ success: false, error: '이상 항목 또는 특이사항을 입력해 주세요.' });
  }

  const sheets = getSpreadsheet_();
  const battery = findBattery_(sheets.batteriesSheet, batteryId);

  if (!battery) {
    return jsonResponse_({ success: false, error: '등록되지 않은 배터리 ID입니다.' });
  }

  const now = new Date();
  const timestamp = formatTimestamp_(now);
  getAppearanceReportsSheet_().appendRow([
    timestamp,
    batteryId,
    worker,
    issuesText,
    note,
    'open',
  ]);

  const mailResult = sendAppearanceReportEmail_({
    batteryId: batteryId,
    model: battery.model,
    worker: worker,
    issues: issuesText,
    note: note,
    timestamp: timestamp,
  });

  return jsonResponse_({
    success: true,
    report: true,
    id: batteryId,
    worker: worker,
    issues: issuesText,
    note: note,
    timestamp: timestamp,
    model: battery.model,
    startDate: battery.startDate,
    maxCycles: battery.maxCycles,
    cycleCount: countCycles_(sheets.logsSheet, batteryId),
    emailSent: !!mailResult.sent,
    emailWarning: mailResult.sent ? '' : (mailResult.error || '알림 메일 발송에 실패했습니다.'),
  });
}

function handleAdminEmailsGet_(params) {
  if (!verifyAdminPin_(params.pin)) {
    return jsonResponse_({ success: false, error: '관리자 PIN이 올바르지 않습니다.' });
  }

  return jsonResponse_({
    success: true,
    emails: getAdminEmails_(),
  });
}

function handleAdminEmailAdd_(params) {
  if (!verifyAdminPin_(params.pin)) {
    return jsonResponse_({ success: false, error: '관리자 PIN이 올바르지 않습니다.' });
  }

  const email = normalizeEmail_(params.email);
  if (!isValidEmail_(email)) {
    return jsonResponse_({ success: false, error: '올바른 이메일 주소를 입력해 주세요.' });
  }

  const emails = getAdminEmails_();
  if (emails.indexOf(email) >= 0) {
    return jsonResponse_({ success: false, error: '이미 등록된 이메일입니다.' });
  }

  emails.push(email);
  saveAdminEmails_(emails);

  return jsonResponse_({
    success: true,
    emails: getAdminEmails_(),
  });
}

function handleAdminEmailRemove_(params) {
  if (!verifyAdminPin_(params.pin)) {
    return jsonResponse_({ success: false, error: '관리자 PIN이 올바르지 않습니다.' });
  }

  const email = normalizeEmail_(params.email);
  if (!email) {
    return jsonResponse_({ success: false, error: '삭제할 이메일이 필요합니다.' });
  }

  const emails = getAdminEmails_().filter(function (item) {
    return item !== email;
  });
  saveAdminEmails_(emails);

  return jsonResponse_({
    success: true,
    emails: getAdminEmails_(),
  });
}

function handleSendTestEmail_(params) {
  if (!verifyAdminPin_(params.pin)) {
    return jsonResponse_({ success: false, error: '관리자 PIN이 올바르지 않습니다.' });
  }

  const mailResult = sendAppearanceReportEmail_({
    batteryId: 'MAIL-TEST',
    model: 'BATLog 테스트',
    worker: '관리자',
    issues: '메일 발송 테스트',
    note: '관리자 설정에서 보낸 테스트 메일입니다.',
    timestamp: formatTimestamp_(new Date()),
  });

  if (!mailResult.sent) {
    return jsonResponse_({
      success: false,
      error: mailResult.error || '테스트 메일 발송에 실패했습니다.',
    });
  }

  return jsonResponse_({
    success: true,
    recipients: mailResult.recipients || [],
  });
}

function handleChargingLog_(params) {
  const batteryId = normalizeBatteryId_(params.id);
  const worker = String(params.worker || '').trim();

  if (!batteryId) {
    return jsonResponse_({ success: false, error: 'Battery ID가 필요합니다.' });
  }

  if (!worker) {
    return jsonResponse_({ success: false, error: '작업자 이름이 필요합니다.' });
  }

  const sheets = getSpreadsheet_();
  const battery = findBattery_(sheets.batteriesSheet, batteryId);

  if (!battery) {
    return jsonResponse_({ success: false, error: '등록되지 않은 배터리 ID입니다.' });
  }

  const openAppearanceReport = findOpenAppearanceReport_(getAppearanceReportsSheet_(), batteryId);
  if (openAppearanceReport) {
    return jsonResponse_({
      success: false,
      error: '외관 이상이 보고된 배터리입니다. 사용·충전할 수 없습니다.',
    });
  }

  const now = new Date();
  sheets.logsSheet.appendRow([
    formatTimestamp_(now),
    batteryId,
    worker,
  ]);

  const cycleCount = countCycles_(sheets.logsSheet, batteryId);

  return jsonResponse_({
    success: true,
    id: batteryId,
    worker: worker,
    timestamp: formatTimestamp_(now),
    maxCycles: battery.maxCycles,
    cycleCount: cycleCount,
  });
}

function doGet(e) {
  try {
    const params = parseRequestParams_(e);
    const action = params.action;
    const sheets = getSpreadsheet_();

    if (action === 'verifypin') {
      return handleVerifyPin_(params);
    }

    if (action === 'nextid') {
      return handleNextId_(params, sheets.batteriesSheet);
    }

    if (action === 'registeroptions') {
      return handleRegisterOptionsGet_(params);
    }

    if (action === 'registerinit') {
      return handleRegisterInit_(params, sheets.batteriesSheet);
    }

    if (action === 'batterylist') {
      return handleBatteryList_(params, sheets.batteriesSheet);
    }

    if (action === 'adminemails') {
      return handleAdminEmailsGet_(params);
    }

    const batteryId = normalizeBatteryId_(params.id);

    if (!batteryId) {
      return jsonResponse_({ success: false, error: 'Battery ID가 필요합니다.' });
    }

    const battery = findBattery_(sheets.batteriesSheet, batteryId);

    if (!battery) {
      return jsonResponse_({ success: false, error: '등록되지 않은 배터리 ID입니다.' });
    }

    const cycleCount = countCycles_(sheets.logsSheet, batteryId);
    const openAppearanceReport = findOpenAppearanceReport_(getAppearanceReportsSheet_(), batteryId);

    return jsonResponse_({
      success: true,
      id: batteryId,
      model: battery.model,
      startDate: battery.startDate,
      maxCycles: battery.maxCycles,
      cycleCount: cycleCount,
      appearanceReport: openAppearanceReport
        ? {
          active: true,
          timestamp: openAppearanceReport.timestamp,
          worker: openAppearanceReport.worker,
          issues: openAppearanceReport.issues,
          note: openAppearanceReport.note,
        }
        : { active: false },
    });
  } catch (err) {
    return jsonResponse_({ success: false, error: err.message || String(err) });
  }
}

function doPost(e) {
  try {
    const params = parseRequestParams_(e);

    if (params.action === 'register') {
      return handleRegisterBattery_(params);
    }

    if (params.action === 'changepin') {
      return handleChangePin_(params);
    }

    if (params.action === 'addregisteroption') {
      return handleAddRegisterOption_(params);
    }

    if (params.action === 'reportappearance') {
      return handleAppearanceReport_(params);
    }

    if (params.action === 'addadminemail') {
      return handleAdminEmailAdd_(params);
    }

    if (params.action === 'removeadminemail') {
      return handleAdminEmailRemove_(params);
    }

    if (params.action === 'sendtestemail') {
      return handleSendTestEmail_(params);
    }

    return handleChargingLog_(params);
  } catch (err) {
    return jsonResponse_({ success: false, error: err.message || String(err) });
  }
}
