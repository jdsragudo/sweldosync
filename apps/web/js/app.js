/**
 * SweldoSync Frontend Application Controller
 * Handles API synchronization, Velo wallet listener, test presets, and live audit rendering.
 * 0 Emojis rule strictly enforced.
 */

const API_BASE = '';

let state = {
    employees: [],
    workLogs: [],
    auditLog: [],
    connectedWallet: null,
};

// DOM Elements
const employeeListEl = document.getElementById('employeeList');
const employeeSelectEl = document.getElementById('employeeSelect');
const workLogsContainerEl = document.getElementById('workLogsContainer');
const auditFeedContainerEl = document.getElementById('auditFeedContainer');
const auditCountEl = document.getElementById('auditCount');
const agentStatusBadgeEl = document.getElementById('agentStatusBadge');
const walletStatusTextEl = document.getElementById('walletStatusText');

// Metrics Elements
const metricEmployeesEl = document.getElementById('metricEmployees');
const metricPendingEl = document.getElementById('metricPending');
const metricDisbursedEl = document.getElementById('metricDisbursed');
const metricFlaggedEl = document.getElementById('metricFlagged');

// Form Elements
const timesheetForm = document.getElementById('timesheetForm');
const shiftDateInput = document.getElementById('shiftDate');
const hoursLoggedInput = document.getElementById('hoursLogged');
const shiftNotesInput = document.getElementById('shiftNotes');
const btnSubmitLog = document.getElementById('btnSubmitLog');
const btnRunAgentCycle = document.getElementById('btnRunAgentCycle');
const btnRefreshLogs = document.getElementById('btnRefreshLogs');

// Preset Buttons
const btnPresetNormal = document.getElementById('btnPresetNormal');
const btnPresetOvertime = document.getElementById('btnPresetOvertime');
const btnPresetSuspicious = document.getElementById('btnPresetSuspicious');

/**
 * Initialize application state and UI listeners
 */
async function init() {
    // Set default date to today
    if (shiftDateInput) {
        shiftDateInput.value = new Date().toISOString().slice(0, 10);
    }

    initVeloWallet();
    bindEvents();

    await fetchAllData();
}

/**
 * Attach listeners to the embedded Velo Wallet component
 */
function initVeloWallet() {
    const walletEl = document.querySelector('#stellar-wallet');
    if (!walletEl) return;

    walletEl.addEventListener('velo:wallet-connected', (event) => {
        const addr = event.detail?.address;
        if (addr) {
            state.connectedWallet = addr;
            if (walletStatusTextEl) {
                walletStatusTextEl.textContent = `Wallet: ${addr.slice(0, 5)}...${addr.slice(-4)}`;
                walletStatusTextEl.style.color = 'var(--accent-success)';
            }
            console.log('[VELO] Connected', addr);
            renderEmployees();
        }
    });

    walletEl.addEventListener('velo:wallet-disconnected', () => {
        state.connectedWallet = null;
        if (walletStatusTextEl) {
            walletStatusTextEl.textContent = 'Wallet: Disconnected';
            walletStatusTextEl.style.color = 'var(--text-muted)';
        }
        console.log('[VELO] Disconnected');
        renderEmployees();
    });

    walletEl.addEventListener('velo:wallet-error', (event) => {
        console.error('[VELO] Wallet error', event.detail?.error);
    });
}

/**
 * Bind form, button, and preset event listeners
 */
function bindEvents() {
    // Preset: Normal 8h shift
    btnPresetNormal?.addEventListener('click', () => {
        if (state.employees.length > 0) {
            employeeSelectEl.value = state.employees[0].id;
        }
        shiftDateInput.value = new Date().toISOString().slice(0, 10);
        hoursLoggedInput.value = '8.0';
        shiftNotesInput.value = 'Standard 8h engineering shift: smart contract test suite';
    });

    // Preset: Overtime 10h shift
    btnPresetOvertime?.addEventListener('click', () => {
        if (state.employees.length > 1) {
            employeeSelectEl.value = state.employees[1].id;
        }
        shiftDateInput.value = new Date().toISOString().slice(0, 10);
        hoursLoggedInput.value = '10.0';
        shiftNotesInput.value = '10h sprint shift: Velo wallet integration and responsive frontend styling';
    });

    // Preset: Suspicious 18h shift
    btnPresetSuspicious?.addEventListener('click', () => {
        if (state.employees.length > 2) {
            employeeSelectEl.value = state.employees[2].id;
        } else if (state.employees.length > 0) {
            employeeSelectEl.value = state.employees[0].id;
        }
        shiftDateInput.value = new Date().toISOString().slice(0, 10);
        hoursLoggedInput.value = '18.0';
        shiftNotesInput.value = 'Anomalous 18h continuous shift: test anomaly rejection';
    });

    // Submit Timesheet Form
    timesheetForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            employeeId: employeeSelectEl.value,
            date: shiftDateInput.value,
            hoursLogged: Number(hoursLoggedInput.value),
            notes: shiftNotesInput.value.trim(),
        };

        if (!payload.employeeId || !payload.hoursLogged) return;

        btnSubmitLog.disabled = true;
        btnSubmitLog.textContent = 'Submitting...';

        try {
            const resp = await fetch(`${API_BASE}/api/worklogs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await resp.json();
            if (data.success) {
                // Reset form inputs except date
                hoursLoggedInput.value = '';
                shiftNotesInput.value = '';
                await fetchAllData();
            } else {
                alert(`Error: ${data.error}`);
            }
        } catch (err) {
            console.error('Failed to submit worklog:', err);
        } finally {
            btnSubmitLog.disabled = false;
            btnSubmitLog.textContent = 'Submit Timesheet WorkLog';
        }
    });

    // Run Agent Cycle
    btnRunAgentCycle?.addEventListener('click', async () => {
        btnRunAgentCycle.disabled = true;
        btnRunAgentCycle.textContent = '[RUNNING] Ingesting & Disbursing...';
        if (agentStatusBadgeEl) {
            agentStatusBadgeEl.textContent = '[AGENT EVALUATING]';
            agentStatusBadgeEl.className = 'badge badge-active';
        }

        try {
            const resp = await fetch(`${API_BASE}/api/agent/cycle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            const data = await resp.json();
            console.log('[Agent Cycle Completed]', data);
            await fetchAllData();
        } catch (err) {
            console.error('Failed to run agent cycle:', err);
        } finally {
            btnRunAgentCycle.disabled = false;
            btnRunAgentCycle.textContent = '[RUN] Autonomous Agent Payroll Cycle';
            if (agentStatusBadgeEl) {
                agentStatusBadgeEl.textContent = '[AGENT IDLE]';
                agentStatusBadgeEl.className = 'badge badge-idle';
            }
        }
    });

    // Refresh button
    btnRefreshLogs?.addEventListener('click', fetchAllData);
}

/**
 * Fetch all remote data from server
 */
async function fetchAllData() {
    try {
        const [empRes, logRes, auditRes] = await Promise.all([
            fetch(`${API_BASE}/api/employees`).then((r) => r.json()),
            fetch(`${API_BASE}/api/worklogs`).then((r) => r.json()),
            fetch(`${API_BASE}/api/payroll/audit-log`).then((r) => r.json()),
        ]);

        if (empRes.success) {
            state.employees = empRes.employees || [];
            renderEmployees();
        }

        if (logRes.success) {
            state.workLogs = logRes.workLogs || [];
            renderWorkLogs();
        }

        if (auditRes.success) {
            state.auditLog = auditRes.auditLog || [];
            renderAuditLog();
        }

        updateMetrics();
    } catch (err) {
        console.error('Error fetching data:', err);
    }
}

/**
 * Render Employee Roster Cards
 */
function renderEmployees() {
    if (!employeeListEl) return;
    employeeListEl.innerHTML = '';

    // Also populate select dropdown if empty or count changed
    if (employeeSelectEl) {
        const currentVal = employeeSelectEl.value;
        employeeSelectEl.innerHTML = '<option value="">Select Employee...</option>';
        state.employees.forEach((emp) => {
            const opt = document.createElement('option');
            opt.value = emp.id;
            opt.textContent = `${emp.name} (${emp.id} - ${emp.role})`;
            employeeSelectEl.appendChild(opt);
        });
        if (currentVal) employeeSelectEl.value = currentVal;
    }

    if (state.employees.length === 0) {
        employeeListEl.innerHTML = '<div class="empty-state">No employees found in roster.</div>';
        return;
    }

    state.employees.forEach((emp) => {
        const card = document.createElement('div');
        card.className = 'employee-card';
        const isBoundToConnected = state.connectedWallet && emp.walletAddress === state.connectedWallet;
        const bindButtonHtml = state.connectedWallet && !isBoundToConnected
            ? `<button type="button" class="btn btn-outline btn-xs" style="margin-top:6px;" onclick="bindEmployeeWallet('${emp.id}', '${state.connectedWallet}')">[BIND CONNECTED WALLET]</button>`
            : (isBoundToConnected ? `<span class="badge badge-active" style="margin-top:6px; font-size:10px;">[BOUND TO YOUR WALLET]</span>` : '');

        card.innerHTML = `
            <div class="employee-card-header">
                <span class="employee-name">${emp.name}</span>
                <span class="badge ${emp.isActive ? 'badge-active' : 'badge-idle'}">
                    ${emp.isActive ? '[ACTIVE]' : '[INACTIVE]'}
                </span>
            </div>
            <div class="employee-role">${emp.role} (${emp.id})</div>
            <div class="employee-rates">
                <span>Rate: ${Number(emp.rateXlm).toFixed(2)} XLM/h</span>
                <span>Max Auto: ${Number(emp.maxAutoPayoutXlm).toFixed(2)} XLM</span>
            </div>
            <div class="employee-wallet" title="Stellar Public Key">${emp.walletAddress}</div>
            ${bindButtonHtml}
        `;
        employeeListEl.appendChild(card);
    });
}

/**
 * Bind an employee profile to the user's currently connected Stellar wallet
 */
async function bindEmployeeWallet(empId, walletAddress) {
    try {
        const resp = await fetch(`${API_BASE}/api/employees/${empId}/bind-wallet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletAddress }),
        });
        const data = await resp.json();
        if (data.success) {
            await fetchAllData();
        } else {
            alert(`Binding failed: ${data.error}`);
        }
    } catch (err) {
        console.error('Error binding wallet:', err);
    }
}
window.bindEmployeeWallet = bindEmployeeWallet;

/**
 * Render Recent WorkLogs Table
 */
function renderWorkLogs() {
    if (!workLogsContainerEl) return;
    workLogsContainerEl.innerHTML = '';

    if (state.workLogs.length === 0) {
        workLogsContainerEl.innerHTML = '<div class="empty-state">No worklogs recorded yet.</div>';
        return;
    }

    state.workLogs.forEach((log) => {
        const item = document.createElement('div');
        item.className = 'worklog-item';

        let badgeClass = 'badge-idle';
        let statusText = `[${log.status}]`;

        if (log.status === 'DISBURSED') {
            badgeClass = 'badge-active';
        } else if (log.status === 'FLAGGED_FOR_AUDIT') {
            badgeClass = 'btn-danger';
        } else if (log.status === 'PENDING') {
            badgeClass = 'badge-testnet';
        }

        item.innerHTML = `
            <div class="worklog-info">
                <span class="worklog-title">${log.employeeId} - ${log.hoursLogged}h (${log.date})</span>
                <span class="worklog-desc">${log.notes || 'No description provided'}</span>
            </div>
            <span class="badge ${badgeClass}">${statusText}</span>
        `;
        workLogsContainerEl.appendChild(item);
    });
}

/**
 * Render Real-Time Audit Feed
 */
function renderAuditLog() {
    if (!auditFeedContainerEl) return;
    auditFeedContainerEl.innerHTML = '';

    if (auditCountEl) {
        auditCountEl.textContent = `${state.auditLog.length} records`;
    }

    if (state.auditLog.length === 0) {
        auditFeedContainerEl.innerHTML = '<div class="empty-state">No audit receipts logged.</div>';
        return;
    }

    state.auditLog.forEach((entry) => {
        const card = document.createElement('div');

        let cardClass = 'audit-receipt-card';
        let tagClass = 'audit-tag';
        let tagLabel = `[${entry.action}]`;

        if (entry.action === 'AUTONOMOUSLY_DISBURSED') {
            cardClass += ' disbursed';
            tagClass += ' disbursed';
        } else if (entry.action === 'FLAGGED_FOR_AUDIT') {
            cardClass += ' flagged';
            tagClass += ' flagged';
        } else if (entry.action === 'HOLD_FOR_APPROVAL') {
            cardClass += ' hold';
            tagClass += ' hold';
        }

        const dateStr = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';

        let txSection = '';
        if (entry.explorerUrl && entry.txHash) {
            txSection = `
                <a class="audit-tx-link" href="${entry.explorerUrl}" target="_blank" rel="noopener noreferrer">
                    Explorer Tx: ${entry.txHash.slice(0, 16)}...${entry.txHash.slice(-8)}
                </a>
            `;
        }

        card.className = cardClass;
        card.innerHTML = `
            <div class="audit-card-top">
                <span class="${tagClass}">${tagLabel}</span>
                <span class="audit-time">${dateStr}</span>
            </div>
            <div class="audit-emp-row">${entry.employeeName || entry.employeeId} (${entry.workLogId})</div>
            <div class="audit-amounts">
                Gross: ${Number(entry.grossXlm || 0).toFixed(4)} XLM | 
                5% Withholding: ${Number(entry.withholdingXlm || 0).toFixed(4)} XLM | 
                Net: ${Number(entry.netXlm || 0).toFixed(4)} XLM
            </div>
            <div class="audit-reason">${entry.reasoning || 'No details'}</div>
            ${txSection}
        `;

        auditFeedContainerEl.appendChild(card);
    });
}

/**
 * Update Ribbon Metrics
 */
function updateMetrics() {
    if (metricEmployeesEl) {
        metricEmployeesEl.textContent = state.employees.length;
    }

    const pendingCount = state.workLogs.filter((l) => l.status === 'PENDING').length;
    if (metricPendingEl) {
        metricPendingEl.textContent = pendingCount;
    }

    const disbursedTotal = state.auditLog
        .filter((r) => r.action === 'AUTONOMOUSLY_DISBURSED')
        .reduce((sum, r) => sum + (Number(r.netXlm) || 0), 0);

    if (metricDisbursedEl) {
        metricDisbursedEl.textContent = `${disbursedTotal.toFixed(2)} XLM`;
    }

    const flaggedCount = state.auditLog.filter(
        (r) => r.action === 'FLAGGED_FOR_AUDIT' || r.action === 'HOLD_FOR_APPROVAL'
    ).length;

    if (metricFlaggedEl) {
        metricFlaggedEl.textContent = flaggedCount;
    }
}

/**
 * Switch between dashboard portal tabs (Console, Timesheets, Roster, Protocol)
 */
function switchTab(tabId) {
    const validTabs = ['console', 'timesheets', 'roster', 'protocol'];
    if (!validTabs.includes(tabId)) return;

    // Toggle active chip
    document.querySelectorAll('.tab-chip').forEach((chip) => {
        if (chip.getAttribute('data-tab') === tabId) {
            chip.classList.add('active');
        } else {
            chip.classList.remove('active');
        }
    });

    // Toggle active content pane
    document.querySelectorAll('.tab-content').forEach((pane) => {
        if (pane.id === `tab-${tabId}`) {
            pane.classList.add('active-tab');
        } else {
            pane.classList.remove('active-tab');
        }
    });
}
window.switchTab = switchTab;

// Boot application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
