// วางโค้ดนี้ไว้บนสุดของไฟล์ Code.gs
function doGet(e) {
  // ใช้สำหรับทดสอบว่า API ทำงานหรือไม่
  return ContentService.createTextOutput("API is running.").setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const params = body.params;

    let result;

    // Router: ตรวจสอบ action ที่ส่งมา แล้วเรียกฟังก์ชันที่เหมาะสม
    switch (action) {
      case 'verifyUser':
        result = verifyUser(params.username, params.password);
        break;
      case 'getPaginatedData':
        result = getPaginatedData(params.user, params.page, params.pageSize, params.searchTerm, params.filterZone, params.filterStatus);
        break;
      case 'getOverallStats':
        result = getOverallStats();
        break;
      case 'getScopedStats':
        result = getScopedStats(params.user);
        break;
      case 'getFilterOptions':
        result = getFilterOptions();
        break;
      case 'updateRecord':
        result = updateRecord(params.data);
        break;
      // เพิ่ม case สำหรับฟังก์ชันอื่นๆ ตามต้องการ
      default:
        throw new Error("Invalid action specified.");
    }

    // ส่งผลลัพธ์กลับไปในรูปแบบ JSON
    return ContentService.createTextOutput(JSON.stringify({ success: true, data: result }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    // กรณีเกิดข้อผิดพลาด ให้ส่ง error กลับไป
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
// ===============================================================
// CONFIGURATION
// ===============================================================
const SPREADSHEET_ID = "1QDUfREj7kuuHmgP-D6LibUBul6Rvwp_wB7bF_9oJ5Bw";
const BACKUP_FOLDER_ID = "1nBdBqHYCXfVm0tmV6jxyfXqvNMfaki5P";

// ===============================================================
// WEB APP CORE
// ===============================================================
function doGet(e) {
  let template = HtmlService.createTemplateFromFile('Index');
  template.css = HtmlService.createHtmlOutputFromFile('Stylesheet').getContent();
  template.js = HtmlService.createHtmlOutputFromFile('JavaScript').getContent();
  
  return template.evaluate()
    .setTitle('ระบบติดตามการเรียกเก็บเงินส่งบัตรเลือกตั้ง')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ===============================================================
// DASHBOARD & DATA FUNCTIONS
// ===============================================================

/**
 * UPDATED FUNCTION - To be run by a trigger to update the DashboardStats sheet.
 * Now calculates detailed financial stats.
 */
function updateDashboardStatsTrigger() {
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const masterSheet = spreadsheet.getSheetByName("Master");
    const statsSheet = spreadsheet.getSheetByName("DashboardStats");

    if (!masterSheet || !statsSheet) {
      console.error("Master or DashboardStats sheet not found.");
      return;
    }

    const dataRange = masterSheet.getRange("A2:O" + masterSheet.getLastRow());
    const values = dataRange.getValues();

    let totalRevenue = 0;
    let collectedRevenue = 0;
    let totalLocations = 0;
    let statusComplete = 0;
    let statusInProgress = 0;
    let statusNotStarted = 0;

    values.forEach(row => {
      if (row[0]) { // Check if row is not empty
        totalLocations++;
        const revenue = parseFloat(row[13]) || 0; // Column N for total revenue
        totalRevenue += revenue;

        const statusCode = row[14]; // Column O for status code
        if (statusCode === 3) {
          statusComplete++;
          collectedRevenue += revenue; // Add to collected revenue if status is complete
        } else if (statusCode === 2) {
          statusInProgress++;
        } else if (statusCode === 0) {
          statusNotStarted++;
        }
      }
    });

    const pendingTasks = statusInProgress + statusNotStarted;
    const uncollectedRevenue = totalRevenue - collectedRevenue;

    // Write the new set of calculated stats to the DashboardStats sheet
    statsSheet.getRange("A1:B6").setValues([
      ["totalRevenue", totalRevenue],
      ["collectedRevenue", collectedRevenue],
      ["uncollectedRevenue", uncollectedRevenue],
      ["totalLocations", totalLocations],
      ["statusComplete", statusComplete],
      ["pendingTasks", pendingTasks]
    ]);
    console.log("Dashboard stats updated successfully with financial details.");

  } catch (e) {
    console.error("updateDashboardStatsTrigger Error: " + e.toString());
  }
}

/**
 * UPDATED FUNCTION - Reads the new set of pre-calculated stats.
 */
function getOverallStats() {
  try {
    const statsSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("DashboardStats");
    if (!statsSheet || statsSheet.getLastRow() < 6) {
      updateDashboardStatsTrigger(); 
    }
    const statsValues = statsSheet.getRange("A1:B6").getValues();
    const stats = statsValues.reduce((obj, row) => {
      obj[row[0]] = row[1];
      return obj;
    }, {});

    return { success: true, stats: stats };
  } catch (e) {
    console.error("getOverallStats Error: " + e.toString());
    return { success: false, error: e.message };
  }
}

/**
 * Calculates real-time stats based on the logged-in user's scope.
 */
function getScopedStats(user) {
  if (!user || user.role === 'admin') {
    return { success: true, stats: null };
  }

  try {
    const sheetName = "Master";
    let permissionQuery = "WHERE A IS NOT NULL";
    if (user.role === 'staff') {
      permissionQuery += ` AND G = '${user.filterValue}'`;
    } else if (user.role === 'manager') {
      permissionQuery += ` AND H = '${user.filterValue}'`;
    } else if (user.role === 'prov_manager') {
      const filterParts = user.filterValue.split(',');
      const province = filterParts[0] ? filterParts[0].trim() : null;
      const zipCode = filterParts[1] ? filterParts[1].trim() : null;
      let provQuery = [];
      if (province) { provQuery.push(`B = '${province}'`); }
      if (zipCode) { provQuery.push(`G = '${zipCode}'`); }
      if (provQuery.length > 0) {
        permissionQuery += ` AND (${provQuery.join(' OR ')})`;
      } else {
        return { success: true, stats: { totalRevenue: 0, totalLocations: 0, statusComplete: 0, pendingTasks: 0 } };
      }
    } else {
        return { success: true, stats: null };
    }

    const aggSelect = "SELECT SUM(N), COUNT(A)";
    const aggQuery = `${aggSelect} ${permissionQuery}`;
    const aggUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?sheet=${sheetName}&tq=${encodeURIComponent(aggQuery)}`;
    const aggResponse = UrlFetchApp.fetch(aggUrl, { headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() } });
    const aggJsonText = aggResponse.getContentText().match(/setResponse\((.*)\)/s)[1];
    const aggJson = JSON.parse(aggJsonText);
    
    let totalRevenue = 0;
    let totalLocations = 0;
    if (aggJson.table.rows.length > 0 && aggJson.table.rows[0].c[0] && aggJson.table.rows[0].c[0].v !== null) {
      totalRevenue = aggJson.table.rows[0].c[0].v;
      totalLocations = aggJson.table.rows[0].c[1].v;
    }

    const statusSelect = "SELECT O, COUNT(O)";
    const statusGroup = "GROUP BY O";
    const statusFullQuery = `${statusSelect} ${permissionQuery} ${statusGroup}`;
    const statusUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?sheet=${sheetName}&tq=${encodeURIComponent(statusFullQuery)}`;
    const statusResponse = UrlFetchApp.fetch(statusUrl, { headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() } });
    const statusJsonText = statusResponse.getContentText().match(/setResponse\((.*)\)/s)[1];
    const statusJson = JSON.parse(statusJsonText);
    
    const stats = {
      totalRevenue: totalRevenue,
      totalLocations: totalLocations,
      statusComplete: 0,
      statusInProgress: 0,
      statusNotStarted: 0
    };

    if (statusJson.table.rows.length > 0) {
      statusJson.table.rows.forEach(row => {
        const statusCode = row.c[0] ? row.c[0].v : null;
        const count = row.c[1] ? row.c[1].v : 0;
        if (statusCode === 3) stats.statusComplete = count;
        else if (statusCode === 2) stats.statusInProgress = count;
        else if (statusCode === 0) stats.statusNotStarted = count;
      });
    }
    
    stats.pendingTasks = stats.statusInProgress + stats.statusNotStarted;

    return { success: true, stats: stats };
  } catch(e) {
    console.error("getScopedStats Error: " + e.toString());
    return { success: false, error: e.message };
  }
}

// --- PASTE ALL YOUR OTHER FUNCTIONS (verifyUser, getPaginatedData, etc.) BELOW THIS LINE ---
function verifyUser(username, password) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const userSheet = spreadsheet.getSheetByName("Users");
  if (!userSheet) { throw new Error("ไม่พบชีต 'Users'"); }
  const userValues = userSheet.getRange(2, 1, userSheet.getLastRow() - 1, 5).getValues();
  const users = userValues.map(u => ({ 
      username: u[0], password: u[1], fullName: u[2], 
      role: u[3], filterValue: u[4] 
  }));
  const foundUser = users.find(u => u.username === username && u.password === password);
  if (foundUser) { return { success: true, user: foundUser }; }
  else { return { success: false, message: "Username หรือ Password ไม่ถูกต้อง" }; }
}

function getFilterOptions() {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("Master");
    if (sheet.getLastRow() < 2) { return { zones: [] }; }
    const zoneValues = sheet.getRange(2, 8, sheet.getLastRow() - 1, 1).getValues();
    const uniqueZones = [...new Set(zoneValues.flat().filter(zone => zone))];
    return { zones: uniqueZones.sort() };
  } catch (e) {
    return { zones: [] };
  }
}

function getPaginatedData(user, page = 1, pageSize = 50, searchTerm = "", filterZone = "", filterStatus = "") {
  try {
    const sheetName = "Master";
    
    let permissionQuery = "WHERE A IS NOT NULL";
    if (user.role === 'staff') {
      permissionQuery += ` AND G = '${user.filterValue}'`;
    } else if (user.role === 'manager') {
      permissionQuery += ` AND H = '${user.filterValue}'`;
    } else if (user.role === 'prov_manager') {
      const filterParts = user.filterValue.split(',');
      const province = filterParts[0] ? filterParts[0].trim() : null;
      const zipCode = filterParts[1] ? filterParts[1].trim() : null;
      let provQuery = [];
      if (province) { provQuery.push(`B = '${province}'`); }
      if (zipCode) { provQuery.push(`G = '${zipCode}'`); }
      if (provQuery.length > 0) {
        permissionQuery += ` AND (${provQuery.join(' OR ')})`;
      } else {
        permissionQuery += ` AND A IS NULL`;
      }
    }

    const buildQuery = (selectClause, basePermission) => {
        let query = `${selectClause} ${basePermission}`;
        if (filterZone) { query += ` AND H = '${filterZone.replace(/'/g, "''")}'`; }
        if (filterStatus !== "") { query += ` AND O = ${filterStatus}`; }
        if (searchTerm) {
          const lowerCaseSearchTerm = searchTerm.toLowerCase().replace(/'/g, "''");
          query += ` AND (lower(B) contains '${lowerCaseSearchTerm}' OR lower(D) contains '${lowerCaseSearchTerm}' OR lower(E) contains '${lowerCaseSearchTerm}' OR G contains '${lowerCaseSearchTerm}')`;
        }
        return query;
    };
    
    const countQuery = buildQuery("SELECT count(A)", permissionQuery);
    const countUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?sheet=${sheetName}&tq=${encodeURIComponent(countQuery)}`;
    const countResponse = UrlFetchApp.fetch(countUrl, { headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() } });
    const countJsonText = countResponse.getContentText().match(/setResponse\((.*)\)/s)[1];
    const countJson = JSON.parse(countJsonText);
    const totalRows = countJson.table.rows.length > 0 && countJson.table.rows[0].c[0] ? countJson.table.rows[0].c[0].v : 0;

    let dataQuery = buildQuery("SELECT *", permissionQuery);
    const offset = (page - 1) * pageSize;
    dataQuery += ` ORDER BY A LIMIT ${pageSize} OFFSET ${offset}`;
    
    const dataUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?sheet=${sheetName}&tq=${encodeURIComponent(dataQuery)}`;
    const dataResponse = UrlFetchApp.fetch(dataUrl, { headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() } });
    const dataJsonText = dataResponse.getContentText().match(/setResponse\((.*)\)/s)[1];
    const dataJson = JSON.parse(dataJsonText);
    
    const data = dataJson.table.rows.map(r => {
      const rowData = r.c.map(c => c ? (c.f || c.v) : null);
      return {
        id: rowData[0], province: rowData[1], typeOpt: rowData[2], location: rowData[3], district: rowData[4],
        postOffice: rowData[5], zipCode: rowData[6], respZone: rowData[7], 
        status1: rowData[8], status2: rowData[9], status3: rowData[10], 
        transportFee: rowData[11], deliveryFee: rowData[12], totalRevenue: rowData[13], 
        opStatusCode: rowData[14], notes: rowData[15],
        columnQ: rowData[16], columnR: rowData[17]
      };
    });
    return { data: data, totalRows: totalRows };
  } catch(e) {
    console.error("getPaginatedData Error: " + e.toString());
    return { data: [], totalRows: 0, error: e.message };
  }
}
