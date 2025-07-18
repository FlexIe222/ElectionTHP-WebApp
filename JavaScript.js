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
