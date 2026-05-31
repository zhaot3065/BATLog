/**
 * BATLog - 리튬 배터리 충전 이력 추적 API
 *
 * Batteries: A=BatteryID, B=Model, C=StartDate, D=MaxCycles
 * ChargingLogs: A=Timestamp, B=BatteryID, C=Worker
 *
 * Battery ID 형식: {CHEM}-{N}S-{CAP}-{SEQ}
 * 예) LPO-6S-22-001  (LiPo, 6S, 22000mAh, 1번)
 */
const DEFAULT_ADMIN_PIN = '8842';
const PIN_PROPERTY_KEY = 'ADMIN_PIN';

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

    const batteryId = normalizeBatteryId_(params.id);

    if (!batteryId) {
      return jsonResponse_({ success: false, error: 'Battery ID가 필요합니다.' });
    }

    const battery = findBattery_(sheets.batteriesSheet, batteryId);

    if (!battery) {
      return jsonResponse_({ success: false, error: '등록되지 않은 배터리 ID입니다.' });
    }

    const cycleCount = countCycles_(sheets.logsSheet, batteryId);

    return jsonResponse_({
      success: true,
      id: batteryId,
      model: battery.model,
      startDate: battery.startDate,
      maxCycles: battery.maxCycles,
      cycleCount: cycleCount,
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

    return handleChargingLog_(params);
  } catch (err) {
    return jsonResponse_({ success: false, error: err.message || String(err) });
  }
}
