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
<script>
    let currentUser = null;
    let appData = [];
    let notesModal = null;
    let notificationToast = null;
    let currentPage = 1;
    let pageSize = 50;
    let totalRows = 0;
    let searchTimeout;

    // --- INITIALIZATION ---
    document.addEventListener("DOMContentLoaded", function() {
        notesModal = new bootstrap.Modal(document.getElementById('edit-notes-modal'));
        notificationToast = new bootstrap.Toast(document.getElementById('notification-popup'));
        const loginForm = document.getElementById('login-form');
        if (loginForm) loginForm.addEventListener('submit', handleLogin);
    });

    function initializeApp() {
        document.getElementById('user-greeting').textContent = 'ยินดีต้อนรับ, ' + currentUser.fullName;
        document.getElementById('user-role-display').textContent = currentUser.role;

        if (currentUser.role === 'admin') {
            document.getElementById('admin-panel').classList.remove('d-none');
        }
        
        document.getElementById('logout-button').addEventListener('click', handleLogout);
        document.getElementById('import-btn').addEventListener('click', handleInitialImport);
        document.getElementById('save-notes-btn').addEventListener('click', handleSaveNotes);
        document.getElementById('search-input').addEventListener('keyup', handleSearch);
        document.getElementById('zone-filter').addEventListener('change', handleFilterChange);
        document.getElementById('status-filter').addEventListener('change', handleFilterChange);
        document.getElementById('prev-page-btn').addEventListener('click', () => changePage(-1));
        document.getElementById('next-page-btn').addEventListener('click', () => changePage(1));
        
        const tableBody = document.getElementById('table-body');
        tableBody.addEventListener('change', handleTableChange);
        tableBody.addEventListener('click', handleTableClick);

        const reloadPage = (e) => { e.preventDefault(); window.top.location.reload(); };
        document.getElementById('home-link-nav').addEventListener('click', reloadPage);
        document.getElementById('home-link-sidebar').addEventListener('click', reloadPage);

        populateFilters();
        loadDashboardData(1);
        loadOverallStats();
        loadScopedStats(); // NEW: Load user-specific stats
    }
    
    // --- LOGIN/LOGOUT LOGIC ---
    function handleLogin(e) {
        e.preventDefault();
        const loginButton = document.getElementById('login-button');
        loginButton.disabled = true;
        loginButton.querySelector('.spinner-border').classList.remove('d-none');
        google.script.run
            .withSuccessHandler(onLoginSuccess)
            .withFailureHandler(onLoginFailure)
            .verifyUser(document.getElementById('username').value, document.getElementById('password').value);
    }

    function onLoginSuccess(response) {
        if (response.success) {
            currentUser = response.user;
            document.getElementById('login-container').classList.add('d-none');
            document.getElementById('app-view').classList.remove('d-none');
            initializeApp();
        } else {
            onLoginFailure({ message: response.message });
        }
    }

    function onLoginFailure(error) {
        const errorMessage = document.getElementById('error-message');
        errorMessage.textContent = error.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อ';
        errorMessage.classList.remove('d-none');
        const loginButton = document.getElementById('login-button');
        loginButton.disabled = false;
        loginButton.querySelector('.spinner-border').classList.add('d-none');
    }

    function handleLogout() {
        currentUser = null;
        document.getElementById('app-view').classList.add('d-none');
        document.getElementById('login-container').classList.remove('d-none');
        document.getElementById('login-form').reset();
        document.getElementById('error-message').classList.add('d-none');
    }
    
    // --- DATA FETCHING & RENDERING ---
    function loadDashboardData(page) {
        const zoneFilter = document.getElementById('zone-filter')?.value || "";
        const statusFilter = document.getElementById('status-filter')?.value || "";
        const searchTerm = document.getElementById('search-input')?.value || "";
        
        document.getElementById('loading-spinner').classList.remove('d-none');
        document.getElementById('data-table').classList.add('d-none');
        document.getElementById('pagination-controls').parentElement.style.display = 'none';

        google.script.run
            .withSuccessHandler(response => {
                if (response.error) {
                    showNotification("Error: " + response.error, 'danger');
                    document.getElementById('loading-spinner').classList.add('d-none');
                    return;
                }
                currentPage = page;
                totalRows = response.totalRows;
                renderTable(response.data);
                updatePaginationControls();
            })
            .getPaginatedData(currentUser, page, pageSize, searchTerm, zoneFilter, statusFilter);
    }

    function loadOverallStats() {
        const statsContainer = document.getElementById('dashboard-stats');
        statsContainer.innerHTML = '<div class="col text-center p-4"><div class="spinner-border text-primary" role="status"></div></div>';

        google.script.run
            .withSuccessHandler(response => {
                if (response.success) { renderStats(response.stats, 'dashboard-stats'); } 
                else { console.error("Failed to load stats:", response.error); }
            })
            .getOverallStats();
    }

    // NEW: Function to load user-specific stats
    function loadScopedStats() {
        if (currentUser.role === 'admin') { return; } // Admins don't need this section

        const container = document.getElementById('scoped-stats-container');
        const statsRow = document.getElementById('scoped-stats-row');
        container.classList.remove('d-none');
        statsRow.innerHTML = '<div class="col text-center p-4"><div class="spinner-border text-secondary" role="status"></div><p class="text-muted mt-2">กำลังโหลดสถิติของคุณ...</p></div>';

        google.script.run
            .withSuccessHandler(response => {
                if (response.success && response.stats) {
                    renderScopedStats(response.stats);
                } else if (response.error) {
                    console.error("Failed to load scoped stats:", response.error);
                    statsRow.innerHTML = '<div class="col text-center p-4 text-danger">ไม่สามารถโหลดสถิติส่วนตัวได้</div>';
                }
            })
            .getScopedStats(currentUser);
    }

    function renderStats(stats, containerId) {
        const statsContainer = document.getElementById(containerId);
        if (!statsContainer) return;

        const formattedRevenue = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(stats.totalRevenue || 0);

        statsContainer.innerHTML = `
            <div class="col-xl-3 col-md-6 mb-4">
                <div class="card border-left-success shadow h-100 py-2">
                    <div class="card-body"><div class="row g-0 align-items-center">
                        <div class="col mr-2">
                            <div class="text-xs fw-bold text-success text-uppercase mb-1">ยอดรายรับรวมทั้งหมด</div>
                            <div class="h5 mb-0 fw-bold text-gray-800">${formattedRevenue}</div>
                        </div>
                        <div class="col-auto"><i class="bi bi-cash-coin fs-2 text-success"></i></div>
                    </div></div>
                </div>
            </div>
            <div class="col-xl-3 col-md-6 mb-4">
                <div class="card border-left-info shadow h-100 py-2">
                    <div class="card-body"><div class="row g-0 align-items-center">
                        <div class="col mr-2">
                            <div class="text-xs fw-bold text-info text-uppercase mb-1">อปท. ทั้งหมด</div>
                            <div class="h5 mb-0 fw-bold text-gray-800">${(stats.totalLocations || 0).toLocaleString('th-TH')}</div>
                        </div>
                        <div class="col-auto"><i class="bi bi-pin-map-fill fs-2 text-info"></i></div>
                    </div></div>
                </div>
            </div>
            <div class="col-xl-3 col-md-6 mb-4">
                <div class="card border-left-success shadow h-100 py-2">
                    <div class="card-body"><div class="row g-0 align-items-center">
                        <div class="col mr-2">
                            <div class="text-xs fw-bold text-success text-uppercase mb-1">ดำเนินการเรียบร้อย</div>
                            <div class="h5 mb-0 fw-bold text-gray-800">${(stats.statusComplete || 0).toLocaleString('th-TH')}</div>
                        </div>
                        <div class="col-auto"><i class="bi bi-check-circle-fill fs-2 text-success"></i></div>
                    </div></div>
                </div>
            </div>
            <div class="col-xl-3 col-md-6 mb-4">
                <div class="card border-left-warning shadow h-100 py-2">
                    <div class="card-body"><div class="row g-0 align-items-center">
                        <div class="col mr-2">
                            <div class="text-xs fw-bold text-warning text-uppercase mb-1">งานคงค้าง</div>
                            <div class="h5 mb-0 fw-bold text-gray-800">${(stats.pendingTasks || 0).toLocaleString('th-TH')}</div>
                        </div>
                        <div class="col-auto"><i class="bi bi-clock-history fs-2 text-warning"></i></div>
                    </div></div>
                </div>
            </div>`;
    }

    // NEW: Function to render user-specific stats
    function renderScopedStats(stats) {
        const statsRow = document.getElementById('scoped-stats-row');
        if (!statsRow) return;

        const formattedRevenue = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(stats.totalRevenue || 0);

        statsRow.innerHTML = `
            <div class="col-xl-3 col-md-6 mb-4">
                <div class="card border-left-primary shadow h-100 py-2">
                    <div class="card-body"><div class="row g-0 align-items-center">
                        <div class="col mr-2">
                            <div class="text-xs fw-bold text-primary text-uppercase mb-1">ยอดรายรับ (ของคุณ)</div>
                            <div class="h5 mb-0 fw-bold text-gray-800">${formattedRevenue}</div>
                        </div>
                        <div class="col-auto"><i class="bi bi-wallet2 fs-2 text-primary"></i></div>
                    </div></div>
                </div>
            </div>
            <div class="col-xl-3 col-md-6 mb-4">
                <div class="card border-left-info shadow h-100 py-2">
                    <div class="card-body"><div class="row g-0 align-items-center">
                        <div class="col mr-2">
                            <div class="text-xs fw-bold text-info text-uppercase mb-1">อปท. (ของคุณ)</div>
                            <div class="h5 mb-0 fw-bold text-gray-800">${(stats.totalLocations || 0).toLocaleString('th-TH')}</div>
                        </div>
                        <div class="col-auto"><i class="bi bi-person-workspace fs-2 text-info"></i></div>
                    </div></div>
                </div>
            </div>
            <div class="col-xl-3 col-md-6 mb-4">
                <div class="card border-left-success shadow h-100 py-2">
                    <div class="card-body"><div class="row g-0 align-items-center">
                        <div class="col mr-2">
                            <div class="text-xs fw-bold text-success text-uppercase mb-1">งานเรียบร้อย (ของคุณ)</div>
                            <div class="h5 mb-0 fw-bold text-gray-800">${(stats.statusComplete || 0).toLocaleString('th-TH')}</div>
                        </div>
                        <div class="col-auto"><i class="bi bi-person-check-fill fs-2 text-success"></i></div>
                    </div></div>
                </div>
            </div>
            <div class="col-xl-3 col-md-6 mb-4">
                <div class="card border-left-warning shadow h-100 py-2">
                    <div class="card-body"><div class="row g-0 align-items-center">
                        <div class="col mr-2">
                            <div class="text-xs fw-bold text-warning text-uppercase mb-1">งานคงค้าง (ของคุณ)</div>
                            <div class="h5 mb-0 fw-bold text-gray-800">${(stats.pendingTasks || 0).toLocaleString('th-TH')}</div>
                        </div>
                        <div class="col-auto"><i class="bi bi-person-exclamation fs-2 text-warning"></i></div>
                    </div></div>
                </div>
            </div>
        `;
    }
    
    function renderTable(data) {
        appData = data;
        const tableBody = document.getElementById('table-body');
        if (!tableBody) return;
        
        let tableHtml = '';
        if (data.length === 0) {
            tableHtml = '<tr><td colspan="18" class="text-center text-muted p-4">ไม่พบข้อมูลตามตัวกรอง</td></tr>';
        } else {
            data.forEach(item => {
                const isChecked1 = String(item.status1).toLowerCase() === 'true';
                const isChecked2 = String(item.status2).toLowerCase() === 'true';
                const isChecked3 = String(item.status3).toLowerCase() === 'true';
                const L = parseFloat(item.transportFee || 0);
                const M = parseFloat(item.deliveryFee || 0);
                const totalRevenue = (L + M).toFixed(2);
                const notesText = item.notes || '';
                const statusCode = calculateOpStatusCode([isChecked1, isChecked2, isChecked3], notesText);
                const statusEmoji = getStatusEmoji(statusCode);
                
                tableHtml += `
                    <tr data-id="${item.id}">
                        <td>${item.id || ''}</td><td>${item.province || ''}</td><td>${item.typeOpt || ''}</td><td>${item.location || ''}</td>
                        <td>${item.district || ''}</td><td>${item.postOffice || ''}</td><td>${item.zipCode || ''}</td>
                        <td>${item.respZone || ''}</td>
                        <td class="text-center"><input class="form-check-input record-checkbox" type="checkbox" data-type="status1" ${isChecked1 ? 'checked' : ''}></td>
                        <td class="text-center"><input class="form-check-input record-checkbox" type="checkbox" data-type="status2" ${isChecked2 ? 'checked' : ''}></td>
                        <td class="text-center"><input class="form-check-input record-checkbox" type="checkbox" data-type="status3" ${isChecked3 ? 'checked' : ''}></td>
                        <td><input type="number" step="0.01" class="form-control form-control-sm text-end numeric-input" data-type="transportFee" value="${L.toFixed(2)}" ${currentUser.role !== 'admin' ? 'disabled' : ''}></td>
                        <td><input type="number" step="0.01" class="form-control form-control-sm text-end numeric-input" data-type="deliveryFee" value="${M.toFixed(2)}"></td>
                        <td class="text-end fw-bold"><span class="total-revenue">${totalRevenue}</span></td>
                        <td class="text-center"><span class="op-status">${statusEmoji}</span></td>
                        <td><div class="d-flex justify-content-between align-items-center"><span class="notes-display" title="${notesText}">${notesText}</span><button class="btn btn-outline-secondary btn-sm edit-notes-btn" title="แก้ไขหมายเหตุ">✏️</button></div></td>
                        <td>${item.columnQ || ''}</td>
                        <td>${item.columnR || ''}</td>
                    </tr>`;
            });
        }
        tableBody.innerHTML = tableHtml;

        document.getElementById('loading-spinner').classList.add('d-none');
        document.getElementById('data-table').classList.remove('d-none');
        document.getElementById('pagination-controls').parentElement.style.display = 'flex';

        try {
            if ($("#data-table").hasClass("CRZ")) { $("#data-table").colResizable({ disable: true }); }
            if (data.length > 0) {
                $("#data-table").colResizable({
                    liveDrag: true,
                    gripInnerHtml: "<div class='grip'></div>", 
                    draggingClass: "dragging",
                    minWidth: 30
                });
            }
        } catch(e) { console.error("colResizable error:", e); }
    }
    
    // --- UI EVENT HANDLERS ---
    function handleTableChange(e) {
        const target = e.target;
        if (!target.classList.contains('record-checkbox') && !target.classList.contains('numeric-input')) return;
        
        const row = target.closest('tr');
        const recordId = row.dataset.id;
        const dataToSave = { recordId: recordId, userFullName: currentUser.fullName };
        dataToSave[target.dataset.type] = target.classList.contains('record-checkbox') ? target.checked : target.value;
        
        updateRowUI(row);

        dataToSave.totalRevenue = row.querySelector('.total-revenue').textContent;
        dataToSave.opStatus = calculateOpStatusCode(Array.from(row.querySelectorAll('.record-checkbox')).map(cb => cb.checked), row.querySelector('.notes-display')?.textContent || '');
        
        google.script.run.withSuccessHandler(res => console.log(res.message)).updateRecord(dataToSave);
    }

    function handleTableClick(e) {
        const target = e.target.closest('.edit-notes-btn');
        if (!target) return;
        
        const row = target.closest('tr');
        const recordId = row.dataset.id;
        const item = appData.find(d => String(d.id) === String(recordId));
        if (!item) return;

        document.getElementById('edit-record-id').value = recordId;
        document.getElementById('modal-org-name').textContent = item.location;
        document.getElementById('notes-textarea').value = item.notes || '';
        notesModal.show();
    }
    
    function handleSaveNotes() {
        const recordId = document.getElementById('edit-record-id').value;
        const notes = document.getElementById('notes-textarea').value;
        const dataToSave = { recordId: recordId, notes: notes, userFullName: currentUser.fullName };
        
        const row = document.querySelector(`tr[data-id='${recordId}']`);
        if (row) {
            dataToSave.opStatus = calculateOpStatusCode(Array.from(row.querySelectorAll('.record-checkbox')).map(cb => cb.checked), notes);
        }
        
        google.script.run.withSuccessHandler(onSaveNotesSuccess).updateRecord(dataToSave);
        notesModal.hide();
    }

    function onSaveNotesSuccess(response) {
        if (response.success) {
            showNotification('บันทึกหมายเหตุเรียบร้อย', 'success');
            loadDashboardData(currentPage);
        } else {
            showNotification(`เกิดข้อผิดพลาด: ${response.message}`, 'danger');
        }
    }

    function handleSearch(e) {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            loadDashboardData(1);
        }, 500);
    }

    function handleFilterChange() {
        loadDashboardData(1);
    }
    
    function changePage(direction) {
        const newPage = currentPage + direction;
        const totalPages = Math.ceil(totalRows / pageSize) || 1;
        if (newPage >= 1 && newPage <= totalPages) {
            loadDashboardData(newPage);
        }
    }
    
    // --- ADMIN FUNCTIONS (IMPORT) ---
    let isImporting = false;
    function handleInitialImport() {
        if (isImporting) return;
        isImporting = true;
        const importStatus = document.getElementById('import-status');
        const importBtn = document.getElementById('import-btn');
        importStatus.textContent = 'กำลังตรวจสอบ...';
        importBtn.disabled = true;
        google.script.run.withSuccessHandler(handleImportResponse).startImportProcess();
    }

    function handleImportResponse(response) {
        const importStatus = document.getElementById('import-status');
        const importBtn = document.getElementById('import-btn');
        importStatus.textContent = response.message;

        if (response.status === 'CONTINUE') {
            google.script.run.withSuccessHandler(handleImportResponse).processNextSheetInQueue();
        } else {
            showNotification(response.message, response.status === 'COMPLETE' ? 'success' : 'danger');
            importStatus.textContent = '';
            importBtn.disabled = false;
            isImporting = false;
            loadDashboardData(1);
            loadOverallStats(); // Refresh stats after import
        }
    }
    
    // --- HELPER & UTILITY FUNCTIONS ---
    function populateFilters() {
        google.script.run.withSuccessHandler(options => {
            const zoneFilter = document.getElementById('zone-filter');
            if (!zoneFilter) return;
            zoneFilter.innerHTML = '<option value="">ทั้งหมด ปน./ปข.</option>';
            options.zones.forEach(zone => {
                const option = document.createElement('option');
                option.value = zone;
                option.textContent = zone;
                zoneFilter.appendChild(option);
            });
        }).getFilterOptions();
    }

    function updatePaginationControls() {
        const pageInfo = document.getElementById('page-info');
        const prevBtn = document.getElementById('prev-page-btn');
        const nextBtn = document.getElementById('next-page-btn');
        const totalPages = Math.ceil(totalRows / pageSize) || 1;
        
        if (totalRows === 0) {
            pageInfo.textContent = "ไม่พบข้อมูล";
            prevBtn.disabled = true;
            nextBtn.disabled = true;
        } else {
            pageInfo.textContent = `หน้า ${currentPage} / ${totalPages} (ทั้งหมด ${totalRows} รายการ)`;
            prevBtn.disabled = currentPage === 1;
            nextBtn.disabled = currentPage === totalPages;
        }
    }

    function updateRowUI(rowElement) {
        const inputs = rowElement.querySelectorAll('.numeric-input');
        const checkboxes = rowElement.querySelectorAll('.record-checkbox');
        const notesDisplay = rowElement.querySelector('.notes-display');
        const notesText = notesDisplay ? notesDisplay.textContent : '';

        if (inputs.length < 2) return;
        const L = parseFloat(inputs[0].value) || 0;
        const M = parseFloat(inputs[1].value) || 0;
        
        const totalRevenueSpan = rowElement.querySelector('.total-revenue');
        if (totalRevenueSpan) totalRevenueSpan.textContent = (L + M).toFixed(2);
        
        const statusCode = calculateOpStatusCode(Array.from(checkboxes).map(cb => cb.checked), notesText);
        const opStatusSpan = rowElement.querySelector('.op-status');
        if (opStatusSpan) opStatusSpan.innerHTML = getStatusEmoji(statusCode);
    }
    
    function calculateOpStatusCode(statuses, notesText) {
        const count = statuses.filter(Boolean).length;
        const hasNotes = notesText && notesText.trim() !== '';
        if (count === 3 && hasNotes) return 3;
        if (count > 0 || hasNotes) return 2;
        return 0;
    }

    function getStatusEmoji(statusCode) {
        if (statusCode === 3) return "🟢";
        if (statusCode === 2) return "🟠";
        return "🔴";
    }

    function showNotification(message, type = 'primary') {
      const toastBody = document.querySelector('#notification-popup .toast-body');
      const toastHeader = document.querySelector('#notification-popup .toast-header');
      const toastEl = document.getElementById('notification-popup');
      
      toastBody.textContent = message;
      toastEl.className = 'toast hide';
      toastHeader.className = 'toast-header';

      if (type === 'success') {
        toastHeader.classList.add('bg-success', 'text-white');
      } else if (type === 'danger') {
        toastHeader.classList.add('bg-danger', 'text-white');
      } else {
        toastHeader.classList.add('bg-primary', 'text-white');
      }

      notificationToast.show();
    }
</script>
