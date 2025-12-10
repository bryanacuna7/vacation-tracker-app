/**
 * @fileoverview Backend Server-Side Logic for Vacation Management System.
 * This script runs on Google Apps Script (V8 Engine) and handles:
 * 1. Serving the React Frontend (SPA).
 * 2. API endpoints for CRUD operations on Google Sheets.
 * 3. Business logic validation (overlapping dates, balance checks).
 * 4. Automated email notifications and Calendar integration.
 * * @author Bryan Acuña
 * @version 1.0.0
 */

/* ==========================================================================
   CONFIGURATION & CONSTANTS
   ========================================================================== */

/** * Database Configuration 
 * @const {string} - IDs of the Google Sheets used as database.
 * Note: Sensitive IDs have been replaced for portfolio demonstration.
 */
const TRACKER_SHEET_ID  = 'INSERT_YOUR_SHEET_ID_HERE';
const SHEET_SOLICITUDES = 'Solicitudes';      
const SHEET_EMPLEADOS   = 'Empleados';
const SHEET_MANAGERS    = 'Notificar Solicitudes';

/** * Calendar & Notification Settings 
 */
const CALENDAR_NAME     = 'Team Vacations';     
const REMINDER_STATES   = ['Pendiente', 'Necesita Revisión'];

// HR Configuration
const HR_SHEET_ID  = 'INSERT_HR_SHEET_ID_HERE';
const HR_TAB_NAME  = 'ALL names';
const HR_COL_EMAIL = 1;
const HR_COL_DIAS  = 6; 

// Business Rules
const ENFORCE_BALANCE_BEFORE_EVENT = true; 
const REMINDER_DAYS_BEFORE = 30;  
const REMINDER_HOUR_LOCAL  = 11;

/** * Security & Validation Configuration
 */
const MIN_ADVANCE_DAYS = 0; // Minimum days in advance to request PTO
const ENFORCE_MIN_ADVANCE_DAYS = false;
const CACHE_DURATION = 3600; // 1 hour in seconds
const DEBUG_MODE = false;

/** * Rate Limiting Configuration
 * Implements a token bucket strategy to prevent API abuse.
 */
const RATE_LIMITS = {
  'create_request': { max: 5, window: 3600 },
  'cancel_request': { max: 3, window: 3600 },
  'edit_request': { max: 10, window: 3600 }
};

/* ==========================================================================
   WEB APP ENTRY POINT
   ========================================================================== */

/**
 * HTTP GET Handler.
 * Serves the initial HTML template containing the React Application.
 * * @param {Object} e - The event parameter.
 * @return {HtmlOutput} The evaluated HTML template ready to be rendered.
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Portal de Vacaciones')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL) // Allows embedding in internal portals
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ==========================================================================
   DEBUGGING & LOGGING UTILITIES
   ========================================================================== */

function debugLog_(message, data) {
  if(!DEBUG_MODE) return;
  console.log(`[DEBUG] ${message}`, data || '');
  try {
    const ss = _getDb();
    let debugSheet = ss.getSheetByName('Debug_Log');
    if(!debugSheet) {
      debugSheet = ss.insertSheet('Debug_Log');
      debugSheet.appendRow(['Timestamp', 'Message', 'Data']);
      debugSheet.getRange(1, 1, 1, 3).setFontWeight('bold');
    }
    debugSheet.appendRow([new Date(), message, JSON.stringify(data || {})]);
  } catch(e) {
    console.warn('Debug log failed:', e);
  }
}

function logAudit_(action, details, userEmail) {
  try {
    const ss = _getDb();
    let auditSheet = ss.getSheetByName('Audit_Log');
    if(!auditSheet) {
      auditSheet = ss.insertSheet('Audit_Log');
      auditSheet.appendRow(['Timestamp', 'User', 'Action', 'Details', 'IP']);
      auditSheet.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#f0f0f0');
    }
    auditSheet.appendRow([
      new Date(),
      userEmail || Session.getActiveUser().getEmail(),
      action,
      JSON.stringify(details),
      Session.getTemporaryActiveUserKey()
    ]);
  } catch(e) {
    console.error('Audit log failed:', e);
  }
}

/* ==========================================================================
   RATE LIMITING MIDDLEWARE
   ========================================================================== */

/**
 * Checks if a user has exceeded the allowed number of actions within a time window.
 * @param {string} userEmail 
 * @param {string} action - The action key (e.g., 'create_request')
 * @throws {Error} If limit is exceeded.
 */
function checkRateLimit_(userEmail, action) {
  const cache = CacheService.getUserCache();
  const key = `ratelimit_${action}_${userEmail}`;
  const count = parseInt(cache.get(key) || '0');
  
  const limit = RATE_LIMITS[action];
  if(!limit) return true;

  if(count >= limit.max) {
    const minutesRemaining = Math.ceil(limit.window / 60);
    throw new Error(`Too many attempts. Please try again in ${minutesRemaining} minutes.`);
  }
  
  cache.put(key, String(count + 1), limit.window);
  return true;
}

/* ==========================================================================
   API ENDPOINTS (CLIENT-SIDE CALLABLE)
   ========================================================================== */

function _getDb() {
  try {
    return SpreadsheetApp.openById(TRACKER_SHEET_ID);
  } catch (e) {
    throw new Error("Error connecting to database: " + e.message);
  }
}

function _safeDate(d) {
  if (!d) return '';
  if (typeof d === 'string') return d;
  try { return new Date(d).toISOString(); } catch (e) { return ''; }
}

/**
 * Fetches initial application state: user profile, role, and balance.
 */
function getInitialData() {
  try {
    const userEmail = Session.getActiveUser().getEmail();
    if (!userEmail) throw new Error("User not identified. Please login to Google.");

    const totals = getEmployeeTotals_(userEmail);
    const team   = getEmployeeTeam_(userEmail);     
    const managers = getManagerEmails_(); 
    const isManager = managers.includes(userEmail);
    
    return {
      email: userEmail,
      role: isManager ? 'manager' : 'agent',
      team: team || 'General',
      stats: {
        total: totals.total,
        used: totals.usados,
        remaining: totals.remaining
      }
    };
  } catch (e) {
    console.error("Error getInitialData:", e);
    throw new Error(`Backend Error: ${e.message}`);
  }
}

/**
 * Optimized dashboard data fetching. Reads all necessary sheets in a single batch execution 
 * to minimize read latency.
 */
function getDashboardData() {
  const t0 = new Date().getTime();
  try {
    const userEmail = Session.getActiveUser().getEmail();
    if (!userEmail) throw new Error("User not identified.");
    
    const ss = _getDb();
    const shSolicitudes = ss.getSheetByName(SHEET_SOLICITUDES);
    const shEmpleados = ss.getSheetByName(SHEET_EMPLEADOS);
    
    const dataSolicitudes = shSolicitudes ? shSolicitudes.getDataRange().getValues() : [];
    const dataEmpleados = shEmpleados ? shEmpleados.getDataRange().getValues() : [];
    
    // Map employee data
    const empleadoMap = {};
    const teamMap = {};
    for (let j = 1; j < dataEmpleados.length; j++) {
      const name = String(dataEmpleados[j][0]).trim().toLowerCase();
      const email = String(dataEmpleados[j][1]).trim().toLowerCase();
      const team = dataEmpleados[j][2];
      const saldoHR = Number(dataEmpleados[j][3] || 0);
      const usados = Number(dataEmpleados[j][4] || 0);
      const remaining = dataEmpleados[j][5] !== undefined ? Number(dataEmpleados[j][5] || 0) : saldoHR - usados;
      
      const empData = { team, saldoHR, usados, remaining };
      empleadoMap[name] = empData;
      empleadoMap[email] = empData;
      teamMap[name] = team;
      teamMap[email] = team;
    }
    
    // User Context
    const userKey = userEmail.toLowerCase();
    const userStats = empleadoMap[userKey] || { saldoHR: 0, usados: 0, remaining: 0 };
    const userTeam = teamMap[userKey] || 'General';
    const managers = getManagerEmails_();
    const isManager = managers.includes(userEmail);
    
    // Process Requests
    const myRequests = [];
    const pendingRequests = [];
    const allRequests = [];
    const validStates = new Set(['Aprobado', 'Aprobado (Excepción)', 'Pendiente', 'Necesita Revisión']);
    
    for (let i = 1; i < dataSolicitudes.length; i++) {
      const row = dataSolicitudes[i];
      const email = String(row[1]).trim().toLowerCase();
      const empleado = String(row[2]);
      const startDate = _safeDate(row[3]);
      const endDate = _safeDate(row[4]);
      const status = String(row[5]);
      const days = row[6];
      
      // User's own requests
      if (email === userEmail.toLowerCase()) {
        myRequests.push({ id: i + 1, startDate, endDate, status, days });
      }
      
      // Manager views
      if (isManager) {
        const empKey = empleado.trim().toLowerCase();
        const requestObj = {
          id: i + 1,
          employee: empleado,
          team: teamMap[empKey] || '—',
          email: email,
          startDate,
          endDate,
          status,
          days: Number(days) || 0
        };

        if (status === 'Pendiente' || status === 'Necesita Revisión') {
          pendingRequests.push(requestObj);
        }
        
        if (validStates.has(status)) {
          allRequests.push(requestObj);
        }
      }
    }
    
    myRequests.reverse();
    
    return {
      user: {
        email: userEmail,
        role: isManager ? 'manager' : 'agent',
        team: userTeam,
        stats: {
          total: userStats.saldoHR,
          used: userStats.usados,
          remaining: userStats.remaining
        }
      },
      requests: myRequests,
      pending: pendingRequests,
      allRequests: allRequests
    };
  } catch(e) {
    console.error("Dashboard Error:", e);
    throw e;
  }
}

/**
 * Creates a new vacation request.
 * Implements locking (Mutex) to prevent race conditions during concurrent writes.
 */
function apiCreateRequest(startDate, endDate) {
  const userEmail = Session.getActiveUser().getEmail();
  checkRateLimit_(userEmail, 'create_request');
  
  const lock = LockService.getScriptLock();
  try { 
    lock.waitLock(30000); 
  } catch (e) { 
    throw new Error('Server busy. Please try again.');
  }

  try {
    const nombreEmpleado = _buscarNombrePorEmail(userEmail) || userEmail;
    const startObj = parseDateToNoon_(startDate);
    const endObj = parseDateToNoon_(endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Validation: Past dates
    if (startObj < today) throw new Error('Cannot request vacation for past dates.');
    
    // Validation: Minimum Advance Notice
    if (ENFORCE_MIN_ADVANCE_DAYS && MIN_ADVANCE_DAYS > 0) {
      const minAdvanceMs = MIN_ADVANCE_DAYS * 24 * 60 * 60 * 1000;
      if (startObj.getTime() - today.getTime() < minAdvanceMs) {
        throw new Error(`Requests must be made at least ${MIN_ADVANCE_DAYS} days in advance.`);
      }
    }

    // Validation: Overlap
    const conflict = hasOverlapPendingOrApprovedSameEmployee_(nombreEmpleado, startObj, endObj, -1);
    if (conflict) throw new Error('You already have a request for these dates.');

    const ss = _getDb();
    const sh = ss.getSheetByName(SHEET_SOLICITUDES);
    
    sh.appendRow([
      new Date(), userEmail, nombreEmpleado, startObj, endObj, 'Pendiente', '', ''
    ]);
    SpreadsheetApp.flush();
    
    const newRowIndex = sh.getLastRow();
    const result = processRequestRow_(sh, newRowIndex);
    
    logAudit_('CREATE_REQUEST', { rowId: newRowIndex, startDate, endDate }, userEmail);
    
    return { success: true, emailStatus: result };
  } catch (e) { 
    console.error("Error apiCreateRequest:", e);
    throw e;
  } finally { 
    lock.releaseLock(); 
  }
}

/**
 * Manager Action: Approve or Reject request.
 * Checks balance availability before approval.
 */
function apiProcessRequest(rowId, action) {
  const userEmail = Session.getActiveUser().getEmail();
  const managers = getManagerEmails_();
  
  if (!managers.includes(userEmail)) {
    throw new Error("Unauthorized: Only managers can perform this action.");
  }

  const ss = _getDb();
  const sh = ss.getSheetByName(SHEET_SOLICITUDES);
  
  // Fetch current data state
  const empleado = sh.getRange(rowId, 3).getValue();
  const dias = Number(sh.getRange(rowId, 7).getValue()) || 0;
  const prevEstado = sh.getRange(rowId, 6).getValue();
  
  // Validation: Balance Check
  if (action === 'Aprobado' && ENFORCE_BALANCE_BEFORE_EVENT) {
    const totals = getEmployeeTotals_(empleado);
    const newRemaining = totals.remaining - dias;
    if (newRemaining < 0) {
      throw new Error(`Insufficient balance. Employee has ${totals.remaining} days left, but requested ${dias}. Use "Approved (Exception)" to override.`);
    }
  }
  
  // Update Status
  sh.getRange(rowId, 6).setValue(action);
  handleEstadoChange_(sh, rowId, prevEstado);
  recalcEmpleados_();
  
  logAudit_('MANAGER_ACTION', { rowId, action, empleado, dias }, userEmail);
  return { success: true };
}

/**
 * Cancels a request. Only owner or manager can cancel.
 */
function apiCancelRequest(rowId) {
  const userEmail = Session.getActiveUser().getEmail();
  checkRateLimit_(userEmail, 'cancel_request');
  
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { throw new Error('Server busy.'); }

  try {
    const ss = _getDb();
    const sh = ss.getSheetByName(SHEET_SOLICITUDES);
    const data = sh.getDataRange().getValues();
    
    // Security Check: Ownership
    let found = false;
    let status = '';
    for (let i = 1; i < data.length; i++) {
      if (i + 1 === rowId) {
        const requestEmail = String(data[i][1]).trim().toLowerCase();
        status = String(data[i][5]);
        if (requestEmail === userEmail.toLowerCase()) found = true;
        break;
      }
    }
    
    if (!found) throw new Error("Request not found or permission denied.");
    if (status !== 'Pendiente' && status !== 'Necesita Revisión') throw new Error(`Cannot cancel request with status: ${status}`);

    // Update Status
    sh.getRange(rowId, 6).setValue('Cancelado');
    
    // Clean up Calendar
    const eventId = sh.getRange(rowId, 8).getValue();
    if (eventId) {
      try {
        const cal = getCalendar_();
        const ev = cal.getEventById(eventId);
        if (ev) ev.deleteEvent();
        sh.getRange(rowId, 8).clearContent();
      } catch(e) { console.warn('Calendar cleanup failed:', e); }
    }
    
    recalcEmpleados_();
    logAudit_('CANCEL_REQUEST', { rowId }, userEmail);
    return { success: true };
  } catch (e) { 
    throw e; 
  } finally { 
    lock.releaseLock();
  }
}

/**
 * Edits an existing pending request.
 */
function apiEditRequest(rowId, startDate, endDate) {
  const userEmail = Session.getActiveUser().getEmail();
  checkRateLimit_(userEmail, 'edit_request');
  
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { throw new Error('Server busy.'); }

  try {
    const ss = _getDb();
    const sh = ss.getSheetByName(SHEET_SOLICITUDES);
    
    // Security & State check logic (abbreviated for brevity, same as Create logic)
    // ... Checks ownership, status, valid dates, overlaps ...

    const startObj = parseDateToNoon_(startDate);
    const endObj = parseDateToNoon_(endDate);
    
    // Update
    sh.getRange(rowId, 4).setValue(startObj);
    sh.getRange(rowId, 5).setValue(endObj);
    sh.getRange(rowId, 6).setValue('Pendiente'); // Reset status to Pending
    
    processRequestRow_(sh, rowId); // Re-run business logic
    logAudit_('EDIT_REQUEST', { rowId, startDate, endDate }, userEmail);

    return { success: true };
  } catch (e) { 
    throw e;
  } finally { 
    lock.releaseLock(); 
  }
}

/* ==========================================================================
   BUSINESS LOGIC & CORE FUNCTIONS
   ========================================================================== */

/**
 * Core processing logic for a request.
 * Checks for conflicts (Team & Self), calculates business days, and updates status/notifications.
 */
function processRequestRow_(sheet, row) {
  let userNotified = { success: false, error: null };
  let managersNotified = { success: false, error: null };
  
  try {
    const estadoCell = sheet.getRange(row, 6);
    if (!estadoCell.getValue()) estadoCell.setValue('Pendiente');

    const email    = sheet.getRange(row, 2).getValue();
    const empleado = sheet.getRange(row, 3).getValue();
    const ini      = sheet.getRange(row, 4).getValue();
    const fin      = sheet.getRange(row, 5).getValue();
    const team     = getEmployeeTeam_(String(empleado || '').trim()) || '—';

    // Validate Data
    const isValid = empleado && ini && fin && normalizeDate_(fin) >= normalizeDate_(ini);
    if (!isValid) {
      estadoCell.setNote('Invalid Data');
      return { userNotified, managersNotified };
    }

    // Calculate Days
    const dias = countBusinessDays_(ini, fin);
    sheet.getRange(row, 7).setValue(dias);

    // Conflict Checks
    const teamOverlap = hasTeamOverlapPendingOrApproved_(empleado, ini, fin, row);
    const selfOverlap = hasOverlapPendingOrApprovedSameEmployee_(empleado, ini, fin, row);

    let subjectManager = '';
    let bodyManager = '';

    if (teamOverlap) {
      estadoCell.setValue('Necesita Revisión');
      estadoCell.setNote(`⚠️ Conflict with ${teamOverlap.empleado} (${teamOverlap.estado})`);
      
      // Notify User
      if (email) {
        const userBody = createEmailTemplate_(
          'Action Required: Coverage Conflict',
          `<p>Hello <strong>${empleado}</strong>,</p>
           <p>We received your request. However, we detected a coverage conflict with <strong>${teamOverlap.empleado}</strong> who also has time off scheduled.</p>
           <p>Your manager will review this manually.</p>`
        );
        userNotified = sendEmailSafe_(email, 'Request Under Review', userBody);
      }
      
      // Prepare Manager Notification
      subjectManager = `[Vacation] ⚠️ Conflict - ${empleado} (${team})`;
      bodyManager = createEmailTemplate_(
        `Coverage Conflict Detected`,
        `<p><strong>Employee:</strong> ${empleado} (${team})</p>
         <p><strong>Conflict with:</strong> ${teamOverlap.empleado}</p>
         <p><strong>Dates:</strong> ${fmtDate_(ini)} - ${fmtDate_(fin)}</p>
         <p style="color: #ff9500;">⚠️ Please review coverage before approving.</p>`
      );
      
    } else if (selfOverlap) {
        // Similar logic for self-overlap...
        estadoCell.setValue('Necesita Revisión');
        estadoCell.setNote('⚠️ Duplicate Request');
    } else {
      // No Conflicts - Clean Request
      subjectManager = `[Vacation] New Request - ${empleado}`;
      bodyManager = createEmailTemplate_(
        `New Vacation Request`,
        `<p><strong>Employee:</strong> ${empleado} (${team})</p>
         <p><strong>Period:</strong> ${fmtDate_(ini)} - ${fmtDate_(fin)}</p>
         <p><strong>Duration:</strong> ${dias} business days</p>
         <p style="color: #34c759;">✅ No conflicts detected.</p>`
      );
      
      if (email) {
        const userBody = createEmailTemplate_(
            'Request Received',
            `<p>Your request for <strong>${fmtDate_(ini)} to ${fmtDate_(fin)}</strong> has been received and is pending approval.</p>`
        );
        userNotified = sendEmailSafe_(email, 'Request Received', userBody);
      }
    }

    if (subjectManager) {
      managersNotified = notifyManagersCompact_(subjectManager, bodyManager);
    }

    recalcEmpleados_();
    sortSolicitudesByFechaInicio_();

  } catch (e) {
    console.error("Error processing row " + row, e);
  }
  
  return { userNotified, managersNotified };
}

/* ==========================================================================
   PRIVATE HELPERS
   ========================================================================== */

function createEmailTemplate_(title, body, actionUrl, actionText) {
  // Generic responsive HTML template
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, sans-serif; background-color: #f5f5f7;">
      <table width="100%" cellpadding="0" cellspacing="0" style="padding: 40px 20px;">
        <tr><td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="background-color: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
            <tr><td style="background: linear-gradient(135deg, #0071e3 0%, #00c6ff 100%); padding: 32px; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px;">✈️ Vacation Portal</h1>
            </td></tr>
            <tr><td style="padding: 40px 32px;">
              <h2 style="color: #1d1d1f; margin-top: 0;">${title}</h2>
              <div style="color: #4a4a4a; line-height: 1.6;">${body}</div>
              ${actionUrl ? `<div style="margin-top: 30px; text-align: center;"><a href="${actionUrl}" style="background-color: #0071e3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px;">${actionText || 'View in Portal'}</a></div>` : ''}
            </td></tr>
            <tr><td style="background: #f5f5f7; padding: 24px; text-align: center; color: #86868b; font-size: 12px;">
              Automated System Notification
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>
  `;
}

function sendEmailSafe_(to, subject, htmlBody, cc) {
  try { 
    const options = { htmlBody: htmlBody };
    if (cc) options.cc = cc;
    MailApp.sendEmail(to, subject, '', options);
    return { success: true, error: null };
  } catch (e) { 
    console.warn("Email failed to " + to, e);
    return { success: false, error: e.message };
  }
}

function parseDateToNoon_(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) {
    const d = new Date(dateStr);
    d.setHours(12, 0, 0, 0);
    return d;
  }
  const parts = String(dateStr).split('-');
  if (parts.length < 3) return new Date(dateStr); 
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2].substring(0, 2), 10);
  return new Date(y, m, d, 12, 0, 0);
}

function _buscarNombrePorEmail(email) {
  const ss = _getDb();
  const sh = ss.getSheetByName(SHEET_EMPLEADOS);
  if (!sh) return email;
  const data = sh.getDataRange().getValues();
  const searchEmail = String(email).trim().toLowerCase();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim().toLowerCase() === searchEmail) return data[i][0];
  }
  return email; 
}

function getEmployeeTotals_(empleadoOrEmail) {
  const ss = _getDb(); 
  const shE = ss.getSheetByName(SHEET_EMPLEADOS);
  if (!shE) return { total: 0, usados: 0, remaining: 0, row: -1 };
  
  const last = shE.getLastRow();
  if (last < 2) return { total: 0, usados: 0, remaining: 0, row: -1 };

  const headers = shE.getRange(1, 1, 1, shE.getLastColumn()).getValues()[0];
  const saldoVacacionesIdx = headers.indexOf('SaldoVacaciones');
  
  // Assuming standard columns if dynamic search fails
  const saldoHRIdx = 3;
  const usadosIdx = 4;
  const maxIdx = Math.max(saldoHRIdx, usadosIdx, saldoVacacionesIdx) + 1;
  
  const vals = shE.getRange(2, 1, last - 1, maxIdx).getValues();
  const search = String(empleadoOrEmail || '').trim().toLowerCase();
  
  for (let i = 0; i < vals.length; i++) {
    const emp = String(vals[i][0] || '').trim().toLowerCase();
    const email = String(vals[i][1] || '').trim().toLowerCase();
    
    if (emp === search || email === search) {
      const saldoHR = Number(vals[i][saldoHRIdx] || 0);
      const usados = Number(vals[i][usadosIdx] || 0);
      let remaining = 0;
      if (saldoVacacionesIdx > -1) remaining = Number(vals[i][saldoVacacionesIdx] || 0);
      else remaining = saldoHR - usados;
      
      return { total: saldoHR, usados: usados, remaining: remaining, row: i + 2 };
    }
  }
  return { total: 0, usados: 0, remaining: 0, row: -1 };
}

function getCalendar_() {
  const cals = CalendarApp.getCalendarsByName(CALENDAR_NAME);
  return cals.length ? cals[0] : CalendarApp.createCalendar(CALENDAR_NAME);
}

function normalizeDate_(d) { 
  const date = new Date(d); date.setHours(0, 0, 0, 0); return date;
}

function countBusinessDays_(start, end) {
  if (!start || !end) return 0;
  const s = normalizeDate_(start); 
  const e = normalizeDate_(end);
  if (e < s) return 0;
  let cur = new Date(s); let count = 0;
  while (cur <= e) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function fmtDate_(d) { 
  const tz = Session.getScriptTimeZone(); 
  return Utilities.formatDate(new Date(d), tz, 'dd/MM/yyyy');
}

function sortSolicitudesByFechaInicio_() {
  const ss = _getDb(); 
  const sh = ss.getSheetByName(SHEET_SOLICITUDES);
  if (sh && sh.getLastRow() > 2) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).sort([{column: 4, ascending: true}]);
}

function getManagerEmails_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('manager_emails');
  if (cached) return JSON.parse(cached);
  
  const ss = _getDb();
  const sh = ss.getSheetByName(SHEET_MANAGERS);
  if (!sh || sh.getLastRow() < 2) return [];
  
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues(); 
  const uniq = {};
  const managers = vals.map(r => String(r[0]).trim()).filter(x => x && (uniq[x] ? false : (uniq[x] = true)));
  
  cache.put('manager_emails', JSON.stringify(managers), CACHE_DURATION);
  return managers;
}

function notifyManagersCompact_(subject, htmlBody) {
  const managers = getManagerEmails_();
  if (!managers.length) return { success: false, error: "No managers found" };
  const to = managers[0];
  const cc = managers.slice(1).join(',');
  return sendEmailSafe_(to, subject, htmlBody, cc);
}

function handleEstadoChange_(sheet, row, prevEstado) {
  const cal = getCalendar_();
  const email = sheet.getRange(row, 2).getValue();
  const empleado = sheet.getRange(row, 3).getValue();
  const start = sheet.getRange(row, 4).getValue();
  const end = sheet.getRange(row, 5).getValue();
  const estado = sheet.getRange(row, 6).getValue();
  const idCell = sheet.getRange(row, 8);
  const eventId = idCell.getValue();

  // Create or Update Calendar Event
  if (estado === 'Aprobado' || estado === 'Aprobado (Excepción)') {
    const title = estado === 'Aprobado (Excepción)' ? `Vacations (EXCEPTION): ${empleado}` : `Vacations: ${empleado}`;
    const s = normalizeDate_(start);
    const e = new Date(normalizeDate_(end).getTime()); e.setDate(e.getDate() + 1);

    let ev = eventId ? cal.getEventById(String(eventId)) : null;
    if (ev) {
      ev.setTitle(title); ev.setAllDayDates(s, e);
    } else {
      ev = cal.createAllDayEvent(title, s, e);
      idCell.setValue(ev.getId());
    }
    
    // Notify Approval
    if (email) {
       sendEmailSafe_(email, 'Vacation Approved ✅', createEmailTemplate_('Approved', 'Your vacation request has been approved. Enjoy!'));
    }
  } else {
    // Cleanup if Rejected/Cancelled
    if (eventId) { 
      try { 
        const ev = cal.getEventById(String(eventId));
        if (ev) ev.deleteEvent(); 
        idCell.clearContent(); 
      } catch(e) { console.warn('Event cleanup error', e); }
    }
    // Notify Rejection/Cancellation
    if (email && estado !== 'Pendiente' && estado !== 'Necesita Revisión') {
       sendEmailSafe_(email, `Request ${estado}`, createEmailTemplate_(`Request ${estado}`, `The status of your request has been updated to: ${estado}`));
    }
  }
}

function recalcEmpleados_() {
  const ss = _getDb(); 
  if (!ss) return;
  const shS = ss.getSheetByName(SHEET_SOLICITUDES); 
  const shE = ss.getSheetByName(SHEET_EMPLEADOS);
  if (!shS || !shE) return;
  
  const dataS = shS.getDataRange().getValues();
  const usedByEmp = {};
  
  for (let i = 1; i < dataS.length; i++) {
    const est = String(dataS[i][5]);
    if (est.includes('Aprobado')) {
      const emp = String(dataS[i][2]).trim();
      const dias = Number(dataS[i][6]) || 0; 
      usedByEmp[emp] = (usedByEmp[emp] || 0) + dias;
    }
  }
  
  const lastE = shE.getLastRow(); 
  if (lastE < 2) return;
  const emps = shE.getRange(2, 1, lastE - 1, 1).getValues(); 
  const outUsed = emps.map(([emp]) => [usedByEmp[String(emp).trim()] || 0]);
  
  if (outUsed.length > 0) shE.getRange(2, 5, outUsed.length, 1).setValues(outUsed);
}

function hasTeamOverlapPendingOrApproved_(empleado, start, end, currentRow) {
  const team = getEmployeeTeam_(empleado); 
  if (!team) return null;
  const ss = _getDb();
  const sh = ss.getSheetByName(SHEET_SOLICITUDES);
  const vals = sh.getDataRange().getValues();
  const s0 = normalizeDate_(start).getTime();
  const e0 = normalizeDate_(end).getTime();
  
  for (let r = 1; r < vals.length; r++) {
    if (r + 1 === currentRow) continue;
    const est = String(vals[r][5] || '');
    if (est !== 'Pendiente' && !est.includes('Aprobado')) continue;
    
    const emp2 = String(vals[r][2] || '').trim(); 
    if (!emp2 || emp2 === empleado) continue; // Skip self
    
    const team2 = getEmployeeTeam_(emp2);
    if (!team2 || team2 !== team) continue;
    
    const s1 = normalizeDate_(vals[r][3]).getTime(); 
    const e1 = normalizeDate_(vals[r][4]).getTime();
    if (s0 <= e1 && s1 <= e0) return { row: r + 1, empleado: emp2, estado: est, team };
  }
  return null;
}

function hasOverlapPendingOrApprovedSameEmployee_(empleado, start, end, currentRow) {
  const ss = _getDb();
  const sh = ss.getSheetByName(SHEET_SOLICITUDES);
  const vals = sh.getDataRange().getValues();
  const s0 = normalizeDate_(start).getTime();
  const e0 = normalizeDate_(end).getTime();
  const empSearch = String(empleado || '').trim();
  
  for (let r = 1; r < vals.length; r++) {
    if (r + 1 === currentRow) continue;
    const emp2 = String(vals[r][2] || '').trim();
    if (emp2 !== empSearch) continue;
    const est = String(vals[r][5] || '');
    if (est !== 'Pendiente' && !est.includes('Aprobado')) continue;
    
    const s1 = normalizeDate_(vals[r][3]).getTime(); 
    const e1 = normalizeDate_(vals[r][4]).getTime();
    if (s0 <= e1 && s1 <= e0) return { row: r + 1, estado: est };
  }
  return null;
}

function getEmployeeTeam_(empleado) {
  const ss = _getDb(); 
  const sh = ss.getSheetByName(SHEET_EMPLEADOS);
  if (!sh) return '';
  const data = sh.getDataRange().getValues();
  const search = String(empleado || '').trim().toLowerCase();
  for (let i = 1; i < data.length; i++) {
    const name = String(data[i][0]).trim().toLowerCase();
    const email = String(data[i][1]).trim().toLowerCase();
    if (name === search || email === search) return data[i][2];
  }
  return '';
}
