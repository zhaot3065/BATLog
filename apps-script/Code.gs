/**
 * BATLog - 리튬 배터리 충전 이력 추적 API
 *
 * 스프레드시트 시트 구성:
 * - Batteries: A=BatteryID, B=Model, C=StartDate, D=MaxCycles
 * - ChargingLogs: A=Timestamp, B=BatteryID, C=Worker
 */

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

function findBattery_(sheet, batteryId) {
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === batteryId) {
      return {
        model: rows[i][1],
        startDate: formatDate_(rows[i][2]),
        maxCycles: parseMaxCycles_(rows[i][3]),
      };
    }
  }

  return null;
}

function countCycles_(sheet, batteryId) {
  const rows = sheet.getDataRange().getValues();
  let count = 0;

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() === batteryId) {
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

function parsePostParams_(e) {
  let id = '';
  let worker = '';

  if (e.parameter) {
    id = String(e.parameter.id || '').trim();
    worker = String(e.parameter.worker || '').trim();
  }

  if ((!id || !worker) && e.postData && e.postData.contents) {
    const contentType = String(e.postData.type || '').toLowerCase();

    if (contentType.indexOf('application/json') !== -1) {
      const body = JSON.parse(e.postData.contents);
      id = id || String(body.id || '').trim();
      worker = worker || String(body.worker || '').trim();
    } else {
      const pairs = e.postData.contents.split('&');
      pairs.forEach(function (pair) {
        const parts = pair.split('=');
        const key = decodeURIComponent(parts[0] || '');
        const value = decodeURIComponent((parts[1] || '').replace(/\+/g, ' '));

        if (key === 'id') {
          id = value.trim();
        }
        if (key === 'worker') {
          worker = value.trim();
        }
      });
    }
  }

  return { id: id, worker: worker };
}

function doGet(e) {
  try {
    const batteryId = String((e && e.parameter && e.parameter.id) || '').trim();

    if (!batteryId) {
      return jsonResponse_({ success: false, error: 'Battery ID가 필요합니다.' });
    }

    const sheets = getSpreadsheet_();
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
    const params = parsePostParams_(e);
    const batteryId = params.id;
    const worker = params.worker;

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
  } catch (err) {
    return jsonResponse_({ success: false, error: err.message || String(err) });
  }
}
