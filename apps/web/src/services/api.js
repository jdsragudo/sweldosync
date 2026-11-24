// apps/web/src/services/api.js

const API_BASE = '';

function getHeaders(customHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };

  const adminToken = sessionStorage.getItem('sweldosync_admin_token');
  if (adminToken) {
    headers['Authorization'] = `Bearer ${adminToken}`;
  }

  return headers;
}

async function request(url, options = {}) {
  const headers = getHeaders(options.headers);
  const resp = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
  });

  if (!resp.ok) {
    let errorMsg = `HTTP ${resp.status} ${resp.statusText}`;
    try {
      const errJson = await resp.json();
      errorMsg = errJson.error || errJson.message || errorMsg;
    } catch {
      // ignore json parse error
    }
    const err = new Error(errorMsg);
    err.status = resp.status;
    throw err;
  }

  const contentType = resp.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return resp.json();
  }
  return resp.text();
}

export const api = {
  // Bootstrap & Health
  getHealth: () => request('/healthz'),
  getBootstrap: (network = 'testnet') => request(`/api/bootstrap?network=${network}`),

  // Employees (People)
  createEmployee: (data) =>
    request('/api/employees', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateEmployee: (id, data) =>
    request(`/api/employees/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteEmployee: (id) =>
    request(`/api/employees/${id}`, {
      method: 'DELETE',
    }),

  // Timesheets
  createTimesheet: (data) =>
    request('/api/timesheets', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateTimesheet: (id, data) =>
    request(`/api/timesheets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteTimesheet: (id) =>
    request(`/api/timesheets/${id}`, {
      method: 'DELETE',
    }),
  importTimesheetsCsv: (csvContent) =>
    request('/api/timesheets/import-csv', {
      method: 'POST',
      body: JSON.stringify({ csv: csvContent }),
    }),
  loadScenario: (scenario) =>
    request('/api/timesheets/load-scenario', {
      method: 'POST',
      body: JSON.stringify({ scenario }),
    }),

  // Guardrail Policy
  updatePolicy: (policyData) =>
    request('/api/policy', {
      method: 'PATCH',
      body: JSON.stringify(policyData),
    }),

  // Demo Treasury Funder (Testnet)
  fundDemoTreasury: (network = 'testnet') =>
    request('/api/demo/fund', {
      method: 'POST',
      body: JSON.stringify({ network }),
    }),

  // Pay Runs
  previewPayRun: ({ timesheetIds, periodLabel = '', network = 'testnet', settlementAsset = 'XLM', treasuryPublicKey = null }) =>
    request('/api/payruns/preview', {
      method: 'POST',
      body: JSON.stringify({ timesheetIds, periodLabel, network, settlementAsset, treasuryPublicKey }),
    }),
  createPayRun: ({ timesheetIds, periodLabel = '', network = 'testnet', settlementAsset = 'XLM', treasuryPublicKey = null }) =>
    request('/api/payruns', {
      method: 'POST',
      body: JSON.stringify({ timesheetIds, periodLabel, network, settlementAsset, treasuryPublicKey }),
    }),
  buildPayRunXdr: (payRunId, chunkIndex = 0, payload = {}) =>
    request(`/api/payruns/${payRunId}/chunks/${chunkIndex}/build-xdr`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  demoSignChunk: (payRunId, chunkIndex = 0) =>
    request(`/api/payruns/${payRunId}/chunks/${chunkIndex}/demo-sign`, {
      method: 'POST',
    }),
  submitSignedChunk: (payRunId, chunkIndex = 0, signedXdr) =>
    request(`/api/payruns/${payRunId}/chunks/${chunkIndex}/submit-signed`, {
      method: 'POST',
      body: JSON.stringify({ signedXdr }),
    }),
  verifyMemo: (payload) =>
    request('/api/verify-memo', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getExportCsvUrl: (payRunId) => `/api/payruns/${payRunId}/export.csv`,

  // Workspace Backup & Restore
  exportWorkspace: () => request('/api/workspace/export'),
  importWorkspace: (workspaceData) =>
    request('/api/workspace/import', {
      method: 'POST',
      body: JSON.stringify(workspaceData),
    }),
};
