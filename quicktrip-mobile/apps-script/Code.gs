/**
 * Sheet Proxy — Apps Script bound to Buffer Sheet (ADR 0014, ADR 0023 dual-sheet)
 * Install: Extensions → Apps Script → paste this file → Deploy → Web App → Execute as you, Anyone with link (or restrict).
 * Sheet must have header row exactly: Date | Start KM | End KM | Distance | Start Time | End Time | Private / Official | Places Visited | Fuel Pumped | Fuel Order No
 * Headers validated order-enforced case-insensitive; Type col accepts alias; Fuel col accepts Fuel Drawn alias.
 * Second sheet "Leaves" with Date | Note (aliases Notes/Remark/Remarks/Leave Note) is managed for dual-sheet sync.
 */
const HEADERS = ['Date','Start KM','End KM','Distance','Start Time','End Time','Private / Official','Places Visited','Fuel Pumped','Fuel Order No','Full Tank','Pump Timing'];
const SHEET_NAME = 'All Trips';
const LEAVES_HEADERS = ['Date','Note'];
const LEAVES_SHEET_NAME = 'Leaves';

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.getSheets()[0];
  return sh;
}
function getLeavesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(LEAVES_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(LEAVES_SHEET_NAME);
    sh.getRange(1,1,1,LEAVES_HEADERS.length).setValues([LEAVES_HEADERS]);
    sh.getRange(1,1,1,LEAVES_HEADERS.length).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
    sh.setTabColor('F59E0B');
  }
  return sh;
}

function roundIntKm_(n){ return Math.round(Number(n)); }
function round1_(n){ return Math.round(Number(n)*10)/10; }

function doGet(e){
  const action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'last10' || action === 'last' ) {
    const sh = getSheet_();
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return json_({ rows: [] });
    const start = Math.max(2, lastRow - 9);
    const range = sh.getRange(start, 1, lastRow - start + 1, HEADERS.length);
    const vals = range.getValues();
    const disp = range.getDisplayValues();
    const rows = vals.map((r,i) => ({
      date: formatDate_(r[0]),
      start_km: roundIntKm_(r[1]),
      end_km: roundIntKm_(r[2]),
      trip_distance: roundIntKm_(r[3] || (Number(r[2])-Number(r[1]))),
      start_time: formatTime_(disp[i][4] || r[4]),
      end_time: formatTime_(disp[i][5] || r[5]),
      trip_type: String(r[6]).toLowerCase().includes('priv') ? 'Private' : 'Official',
      places_visited: String(r[7]||''),
      fuel_pumped_amount: Number(r[8]) ? round1_(r[8]) : 0,
      fuel_order_no: String(r[9]||''),
      is_full_tank: (function(v){ var s=String(v||'').trim().toLowerCase(); return ['yes','y','true','1','full','★'].indexOf(s)>=0; })(r[10]),
      pump_timing: (function(v){ var s=String(v||'').trim().toLowerCase(); return s==='start'||s==='s' ? 'START' : 'END'; })(r[11]),
    })).filter(r => r.date && r.places_visited);
    return json_({ rows });
  }
  if (action === 'allRows') {
    const sh = getSheet_();
    const lastRow = sh.getLastRow();
    var rows = [];
    if (lastRow >= 2) {
      const range2 = sh.getRange(2, 1, lastRow - 1, HEADERS.length);
      const vals = range2.getValues();
      const disp = range2.getDisplayValues();
      rows = vals.map((r,i) => ({
        date: formatDate_(r[0]),
        start_km: roundIntKm_(r[1]),
        end_km: roundIntKm_(r[2]),
        trip_distance: roundIntKm_(r[3]),
        start_time: formatTime_(disp[i][4] || r[4]),
        end_time: formatTime_(disp[i][5] || r[5]),
        trip_type: String(r[6]).toLowerCase().includes('priv') ? 'Private' : 'Official',
        places_visited: String(r[7]||''),
        fuel_pumped_amount: Number(r[8]) ? round1_(r[8]) : 0,
        fuel_order_no: String(r[9]||''),
        is_full_tank: (function(v){ var s=String(v||'').trim().toLowerCase(); return ['yes','y','true','1','full','★'].indexOf(s)>=0; })(r[10]),
        pump_timing: (function(v){ var s=String(v||'').trim().toLowerCase(); return s==='start'||s==='s' ? 'START' : 'END'; })(r[11]),
      }));
    }
    // Leaves sheet
    var leaves = [];
    var leavesSheet = null;
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      leavesSheet = ss.getSheetByName(LEAVES_SHEET_NAME);
    } catch(e0) {}
    if (leavesSheet) {
      var lLast = leavesSheet.getLastRow();
      if (lLast >= 2) {
        var lVals = leavesSheet.getRange(2, 1, lLast - 1, LEAVES_HEADERS.length).getValues();
        leaves = lVals.map(function(r){
          return { date: formatDate_(r[0]), note: String(r[1]||'') };
        }).filter(function(r){ return !!r.date; });
      }
    }
    return json_({ rows: rows, leaves: leaves });
  }
  return json_({ ok: true, headers: HEADERS, leavesHeaders: LEAVES_HEADERS, hint: '?action=last10 or ?action=allRows' });
}

function doPost(e){
  try {
    let body = {};
    try {
      const raw = (e.postData && e.postData.contents) ? e.postData.contents : (e.postData ? e.postData.getDataAsString() : '');
      body = raw ? JSON.parse(raw) : {};
      // Apps Script can also deliver JSON as parameter when Content-Type is text/plain missing
      if (!body.action && e.parameter && e.parameter.action) body.action = e.parameter.action;
      if (!body.rows && e.parameter && e.parameter.rows) {
        try { body.rows = JSON.parse(e.parameter.rows); } catch(_){ body.rows = []; }
      }
      if (!body.leaves && e.parameter && e.parameter.leaves) {
        try { body.leaves = JSON.parse(e.parameter.leaves); } catch(_){ body.leaves = []; }
      }
    } catch(parseErr) {
      // fallback to parameter object
      body = { action: (e.parameter && e.parameter.action) || '' };
    }
    // normalize aliases
    if (body.action === 'rewriteSheet' || body.action === 'pushAll' || body.action === 'rewrite' || body.action === 'export') {
      // accept rows / trips alias (already normalized above)
      const rows = body.rows || body.trips || [];
      const leaves = body.leaves || [];
      if (!Array.isArray(rows)) return json_({ ok:false, error:'rows must be an array' });
      if (leaves && !Array.isArray(leaves)) return json_({ ok:false, error:'leaves must be an array' });
      const lock = LockService.getDocumentLock();
      const gotLock = lock.tryLock(30000);
      if (!gotLock) return json_({ ok:false, error:'Could not acquire lock — try again' });
      try {
        const sh = getSheet_();
        ensureHeaders_(sh);
        // Atomic batch rewrite: clear + header + values
        sh.clear();
        sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
        sh.getRange(1,1,1,HEADERS.length).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
        if (rows.length > 0) {
          const values = rows.map(function(t){
            var sKm = roundIntKm_(t.start_km);
            var eKm = roundIntKm_(t.end_km);
            var dist = roundIntKm_(t.trip_distance != null ? t.trip_distance : (eKm - sKm));
            var fuel = t.fuel_pumped_amount != null && Number(t.fuel_pumped_amount) !== 0 ? round1_(t.fuel_pumped_amount) : 0;
            var isFull = t.is_full_tank ? 'YES' : '';
            var timing = (t.pump_timing === 'START' && fuel>0) ? 'START' : 'END';
            if (fuel===0) timing = '';
            return [
              String(t.date||''),
              sKm,
              eKm,
              dist,
              String(t.start_time||''),
              String(t.end_time||''),
              t.trip_type === 'Private' ? 'Private' : 'Official',
              String(t.places_visited||''),
              fuel,
              String(t.fuel_order_no||''),
              isFull,
              timing,
            ];
          });
          sh.getRange(2, 1, values.length, HEADERS.length).setValues(values);
          sh.getRange(2, 2, values.length, 3).setNumberFormat('0');
          sh.getRange(2, 9, values.length, 1).setNumberFormat('0.0');
        }
        // Leaves sheet rewrite (second sheet)
        var leavesSheet = getLeavesSheet_();
        ensureLeavesHeaders_(leavesSheet);
        leavesSheet.clear();
        leavesSheet.getRange(1,1,1,LEAVES_HEADERS.length).setValues([LEAVES_HEADERS]);
        leavesSheet.getRange(1,1,1,LEAVES_HEADERS.length).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
        leavesSheet.setTabColor('F59E0B');
        if (leaves && leaves.length > 0) {
          var lVals = leaves.map(function(l){
            var note = String(l.note||'');
            if (note.length > 200) note = note.slice(0,200);
            return [String(l.date||''), note];
          });
          leavesSheet.getRange(2,1,lVals.length,LEAVES_HEADERS.length).setValues(lVals);
          leavesSheet.getRange(2,1,lVals.length,1).setNumberFormat('@');
        }
        return json_({ ok: true, rows: rows.length, leaves: leaves ? leaves.length : 0 });
      } finally {
        try { lock.releaseLock(); } catch(e2) {}
      }
    }
    if (body.action !== 'appendTrip' || !body.trip) return json_({ ok:false, error:'expected {action:appendTrip,trip} or {action:rewriteSheet,rows} (got action:' + (body.action||'empty') + ') — your Apps Script is outdated. Update Code.gs and redeploy as Anyone with link.' });
    const t = body.trip;
    const date = String(t.date||'').trim();
    const places = String(t.places_visited||'').trim();
    const endTime = String(t.end_time||'').trim();
    const sKm = roundIntKm_(t.start_km);
    const eKm = roundIntKm_(t.end_km);
    const dist = roundIntKm_(t.trip_distance != null ? t.trip_distance : (eKm - sKm));
    if (!date) return json_({ ok:false, error:'Date required' });
    if (!places) return json_({ ok:false, error:'Places Visited required' });
    if (!endTime) return json_({ ok:false, error:'End Time required' });
    if (isNaN(sKm) || isNaN(eKm)) return json_({ ok:false, error:'Start/End KM required' });
    if (eKm < sKm) return json_({ ok:false, error:'End KM < Start KM' });

    const sh = getSheet_();
    ensureHeaders_(sh);
    sh.appendRow([
      date,
      sKm,
      eKm,
      dist,
      String(t.start_time||''),
      endTime,
      t.trip_type === 'Private' ? 'Private' : 'Official',
      places,
      t.fuel_pumped_amount != null && Number(t.fuel_pumped_amount) !== 0 ? round1_(t.fuel_pumped_amount) : 0,
      String(t.fuel_order_no||''),
      t.is_full_tank ? 'YES' : '',
      (t.fuel_pumped_amount != null && Number(t.fuel_pumped_amount) !== 0 && String(t.pump_timing||'').toUpperCase()==='START') ? 'START' : ((t.fuel_pumped_amount != null && Number(t.fuel_pumped_amount) !== 0) ? 'END' : ''),
    ]);
    // Format int cols as 0, fuel as 0.0
    const lr = sh.getLastRow();
    sh.getRange(lr, 2, 1, 3).setNumberFormat('0');
    sh.getRange(lr, 9, 1, 1).setNumberFormat('0.0');
    return json_({ ok: true, row: lr });
  } catch(err){
    return json_({ ok:false, error: String(err) });
  }
}

function ensureHeaders_(sh){
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.getRange(1,1,1,HEADERS.length).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
    return;
  }
  const h = sh.getRange(1,1,1,HEADERS.length).getValues()[0].map(v=>String(v).trim());
  const norm = s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
  // allow 10-col legacy (no Full Tank) for back-compat
  var expLen = HEADERS.length;
  if (h.length === expLen - 1 && norm(h[expLen-1]) !== norm(HEADERS[expLen-1])) {
    // legacy 10-col already covered
  }
  const ok = (h.length >= expLen - 2 && h.length <= expLen) && HEADERS.slice(0, h.length).every(function(exp,i){ return norm(h[i])===norm(exp) || (i===6 && ['type','triptype','privateofficial'].indexOf(norm(h[i]))>=0) || (i===8 && ['fuelpumped','fueldrawn'].indexOf(norm(h[i]))>=0) || (i===10 && ['fulltank','full','isfull'].indexOf(norm(h[i]))>=0) || (i===11 && ['pumptiming','fueltiming','pumpat','fueledat'].indexOf(norm(h[i]))>=0); });
  if (!ok) throw new Error('Header row mismatch. Expected: ' + HEADERS.join(' | '));
}
function ensureLeavesHeaders_(sh){
  if (sh.getLastRow() === 0) {
    sh.appendRow(LEAVES_HEADERS);
    sh.getRange(1,1,1,LEAVES_HEADERS.length).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
    return;
  }
  const h = sh.getRange(1,1,1,LEAVES_HEADERS.length).getValues()[0].map(v=>String(v).trim());
  const norm = s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
  const ok = LEAVES_HEADERS.every((exp,i)=> {
    var n = norm(h[i]||'');
    var e = norm(exp);
    if (i===1) return n===e || ['notes','remark','remarks','leavenote','leavenotes'].indexOf(n)>=0;
    return n===e;
  });
  if (!ok) throw new Error('Leaves header mismatch. Expected: ' + LEAVES_HEADERS.join(' | '));
}

function formatDate_(v){
  if (!v) return '';
  var tz = Session.getScriptTimeZone();
  try { var sstz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(); if (sstz) tz = sstz; } catch(e) {}
  if (Object.prototype.toString.call(v)==='[object Date]' && !isNaN(v)){
    if (v.getFullYear()===1899) return '';
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
  const s=String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d=new Date(s);
  if (!isNaN(d) && d.getFullYear()>=2000) return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  return s;
}
function formatTime_(v){
  if (!v) return '';
  var tz = Session.getScriptTimeZone();
  try { var sstz2 = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(); if (sstz2) tz = sstz2; } catch(e2) {}
  if (Object.prototype.toString.call(v)==='[object Date]' && !isNaN(v)){
    return Utilities.formatDate(v, tz, 'HH:mm');
  }
  if (typeof v==='number' && v>=0 && v<1){
    const mins=Math.round(v*1440);
    return ('0'+Math.floor(mins/60)%24).slice(-2)+':'+('0'+mins%60).slice(-2);
  }
  const s=String(v).trim();
  const m=s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return ('0'+m[1]).slice(-2)+':'+m[2];
  return s;
}
function json_(o){
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
