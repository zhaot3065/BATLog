/**
 * BATLog - 리튬 배터리 충전 이력 추적 API
 *
 * 스프레드시트 시트 구성:
 * - Batteries: A=BatteryID, B=Model, C=StartDate, D=MaxCycles
 * - ChargingLogs: A=Timestamp, B=BatteryID, C=Worker
 *
 * 관리자 PIN 변경 시 index.html의 ADMIN_PIN도 함께 수정하세요.
 */
const ADMIN_PIN = '8842';

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

function verifyAdminPin_(pin) {
  return String(pin || '') === ADMIN_PIN;
}

function normalizeBatteryId_(value) {
  return String(value || '').trim().toUpperCase();
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

function generateNextBatteryId_(sheet) {
  const rows = sheet.getDataRange().getValues();
  let maxNum = 0;

  for (let i = 1; i < rows.length; i++) {
    const match = normalizeBatteryId_(rows[i][0]).match(/^BT(\d+)$/);
    if (match) {
      maxNum = Math.max(maxNum, Number(match[1]));
    }
  }

  return 'BT' + String(maxNum + 1).padStart(3, '0');
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
  };

  if (e && e.parameter) {
    params.action = String(e.parameter.action || '').trim();
    params.id = String(e.parameter.id || '').trim();
    params.worker = String(e.parameter.worker || '').trim();
    params.model = String(e.parameter.model || '').trim();
    params.startDate = String(e.parameter.startDate || '').trim();
    params.maxCycles = String(e.parameter.maxCycles || '').trim();
    params.pin = String(e.parameter.pin || '').trim();
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

    params.action = params.action || String(body.action || '').trim();
    params.id = params.id || String(body.id || '').trim();
    params.worker = params.worker || String(body.worker || '').trim();
    params.model = params.model || String(body.model || '').trim();
    params.startDate = params.startDate || String(body.startDate || '').trim();
    params.maxCycles = params.maxCycles || String(body.maxCycles || '').trim();
    params.pin = params.pin || String(body.pin || '').trim();
  }

  return params;
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

  if (!/^BT\d{3,}$/.test(batteryId)) {
    return jsonResponse_({ success: false, error: 'Battery ID는 BT001 형식이어야 합니다.' });
  }

  if (!model) {
    return jsonResponse_({ success: false, error: '모델명이 필요합니다.' });
  }

  if (!startDate) {
    return jsonResponse_({ success: false, error: '사용 시작일이 필요합니다.' });
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

    if (action === 'nextid') {
      if (!verifyAdminPin_(params.pin)) {
        return jsonResponse_({ success: false, error: '관리자 PIN이 올바르지 않습니다.' });
      }

      return jsonResponse_({
        success: true,
        nextId: generateNextBatteryId_(sheets.batteriesSheet),
      });
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

    return handleChargingLog_(params);
  } catch (err) {
    return jsonResponse_({ success: false, error: err.message || String(err) });
  }
}
