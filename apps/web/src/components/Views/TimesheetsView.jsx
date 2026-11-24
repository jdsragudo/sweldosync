// apps/web/src/components/Views/TimesheetsView.jsx
import React, { useState } from 'react';
import {
  Clock,
  Plus,
  Upload,
  ChevronDown,
  Filter,
  Trash2,
  Edit2,
  PauseCircle,
  PlayCircle,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Drawer } from '../Common/Drawer';
import { Modal } from '../Common/Modal';
import { Badge } from '../Common/Badge';
import { AddressChip } from '../Common/AddressChip';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';

export function TimesheetsView() {
  const { data, refreshData, addToast } = useApp();

  const [statusFilter, setStatusFilter] = useState('ALL'); // ALL, PENDING, HELD, PAID
  const [employeeFilter, setEmployeeFilter] = useState('ALL');

  // Drawers & Modals
  const [logShiftDrawer, setLogShiftDrawer] = useState(false);
  const [importCsvModal, setImportCsvModal] = useState(false);
  const [scenarioMenuOpen, setScenarioMenuOpen] = useState(false);
  const [csvContent, setCsvContent] = useState('');

  // Log Shift Form state
  const initialShiftForm = {
    employeeId: data.employees?.[0]?.id || '',
    date: new Date().toISOString().split('T')[0],
    hoursLogged: 8,
    notes: 'Sprint development and code reviews',
  };
  const [shiftForm, setShiftForm] = useState(initialShiftForm);

  const employeesMap = new Map((data.employees || []).map((e) => [e.id, e]));

  // Filtered timesheets
  const timesheets = data.timesheets || [];
  const filteredTimesheets = timesheets.filter((t) => {
    if (statusFilter !== 'ALL') {
      if (statusFilter === 'PENDING' && t.status !== 'PENDING' && t.status !== 'FLAGGED' && t.status !== 'READY') return false;
      if (statusFilter === 'HELD' && t.status !== 'HELD') return false;
      if (statusFilter === 'PAID' && t.status !== 'PAID') return false;
    }
    if (employeeFilter !== 'ALL' && t.employeeId !== employeeFilter) {
      return false;
    }
    return true;
  });

  const handleLogShift = async (e) => {
    e.preventDefault();
    try {
      await api.createTimesheet({
        ...shiftForm,
        hoursLogged: parseFloat(shiftForm.hoursLogged) || 8,
      });
      addToast({
        type: 'success',
        title: 'Shift Logged',
        message: 'Timesheet recorded and evaluated against company policy guardrails.',
      });
      setLogShiftDrawer(false);
      setShiftForm(initialShiftForm);
      await refreshData();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to Log Shift',
        message: err.message,
      });
    }
  };

  const handleImportCsv = async (e) => {
    e.preventDefault();
    if (!csvContent.trim()) {
      addToast({
        type: 'warning',
        title: 'Empty CSV',
        message: 'Please provide CSV rows.',
      });
      return;
    }

    try {
      await api.importTimesheetsCsv(csvContent.trim());
      addToast({
        type: 'success',
        title: 'CSV Import Completed',
        message: 'Successfully parsed and saved timesheet batch.',
      });
      setImportCsvModal(false);
      setCsvContent('');
      await refreshData();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'CSV Import Failed',
        message: err.message,
      });
    }
  };

  const handleLoadScenario = async (scenario) => {
    setScenarioMenuOpen(false);
    try {
      await api.loadScenario(scenario);
      addToast({
        type: 'success',
        title: 'Cutoff Scenario Loaded',
        message: `Active timesheets reset to "${scenario}" test fixtures.`,
      });
      await refreshData();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to Load Scenario',
        message: err.message,
      });
    }
  };

  const handleToggleHold = async (timesheet) => {
    const newStatus = timesheet.status === 'HELD' ? 'PENDING' : 'HELD';
    try {
      await api.updateTimesheet(timesheet.id, { status: newStatus });
      addToast({
        type: 'info',
        title: newStatus === 'HELD' ? 'Shift Held' : 'Shift Released',
        message: `Timesheet status changed to ${newStatus}.`,
      });
      await refreshData();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Update Failed',
        message: err.message,
      });
    }
  };

  const handleDelete = async (timesheet) => {
    if (!confirm(`Delete timesheet for ${timesheet.date}?`)) return;
    try {
      await api.deleteTimesheet(timesheet.id);
      addToast({
        type: 'info',
        title: 'Timesheet Deleted',
        message: `Removed shift ${timesheet.id}.`,
      });
      await refreshData();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Delete Failed',
        message: err.message,
      });
    }
  };

  // Live calculation preview in drawer
  const selectedEmp = employeesMap.get(shiftForm.employeeId);
  const hourlyRate = selectedEmp ? Number(selectedEmp.hourlyRate) : 25;
  const hours = parseFloat(shiftForm.hoursLogged) || 0;
  const regHours = Math.min(hours, 8);
  const otHours = Math.max(0, hours - 8);
  const estGross = regHours * hourlyRate + otHours * (hourlyRate * 1.25);
  const withholdingPct = selectedEmp ? Number(selectedEmp.withholdingPct) || 5 : 5;
  const estWithholding = estGross * (withholdingPct / 100);
  const estNet = estGross - estWithholding;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header & Main Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-100 dark:border-slate-800/80">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            Timesheets & Shifts
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Track daily worklogs, automated overtime rules, and pre-settlement approval states.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {/* Subtle Load Sample Cutoff Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setScenarioMenuOpen(!scenarioMenuOpen)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-500" />
              <span>Load Cutoff Sample</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </button>

            {scenarioMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setScenarioMenuOpen(false)}
                />
                <div className="absolute right-0 mt-1 w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-lg z-30 py-1 text-xs">
                  <button
                    type="button"
                    onClick={() => handleLoadScenario('compliant_cutoff')}
                    className="w-full px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex flex-col"
                  >
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      Compliant Cutoff
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Standard 8h shifts, 100% ready
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLoadScenario('overtime_sprint')}
                    className="w-full px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex flex-col"
                  >
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      Overtime Sprint
                    </span>
                    <span className="text-[11px] text-slate-400">
                      10-12h shifts with 1.25x OT
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLoadScenario('anomaly_stress')}
                    className="w-full px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex flex-col"
                  >
                    <span className="font-semibold text-amber-700 dark:text-amber-400">
                      Anomaly Stress Test
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Duplicate date & &gt;16h warnings
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Import CSV Modal Button */}
          <button
            type="button"
            onClick={() => setImportCsvModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import CSV</span>
          </button>

          {/* Log Shift Drawer Button */}
          <button
            type="button"
            onClick={() => {
              if (data.employees && data.employees.length > 0) {
                setShiftForm((prev) => ({ ...prev, employeeId: data.employees[0].id }));
              }
              setLogShiftDrawer(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Log Shift</span>
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Filter Status:
          </span>
          <div className="flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs">
            {['ALL', 'PENDING', 'HELD', 'PAID'].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setStatusFilter(f)}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  statusFilter === f
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs font-semibold'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-400">Team Member:</span>
          <select
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
            className="px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none"
          >
            <option value="ALL">All Team Members</option>
            {(data.employees || []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Timesheets Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/70 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-100 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Team Member</th>
                <th className="py-3 px-4 text-right">Hours Logged</th>
                <th className="py-3 px-4">Work Summary / Notes</th>
                <th className="py-3 px-4">Guardrail Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
              {filteredTimesheets.length > 0 ? (
                filteredTimesheets.map((t) => {
                  const emp = employeesMap.get(t.employeeId) || { name: t.employeeName || 'Unknown' };
                  const isPaid = t.status === 'PAID';
                  const isHeld = t.status === 'HELD';
                  const isOverridden = t.isOverridden;
                  const hasFlags = (t.flags && t.flags.length > 0) || t.status === 'FLAGGED';

                  return (
                    <tr
                      key={t.id}
                      className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-4 font-mono font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {t.date}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {emp.name}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {emp.role || 'Contributor'}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                        {Number(t.hoursLogged).toFixed(1)}h
                        {Number(t.hoursLogged) > 8 && (
                          <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400 font-normal">
                            (+{(Number(t.hoursLogged) - 8).toFixed(1)} OT)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 max-w-sm truncate text-slate-500 dark:text-slate-400">
                        {t.notes || 'Routine scheduled sprint shifts'}
                      </td>
                      <td className="py-3 px-4">
                        {isPaid ? (
                          <Badge variant="settled" dot>
                            Settled on Ledger
                          </Badge>
                        ) : isHeld ? (
                          <Badge variant="held">Held</Badge>
                        ) : isOverridden ? (
                          <Badge variant="settled">
                            <ShieldCheck className="w-3 h-3 mr-1 inline" />
                            Overridden
                          </Badge>
                        ) : hasFlags ? (
                          <div className="flex flex-wrap gap-1">
                            {(t.flags || [{ code: 'ATTENTION', message: 'Review' }]).map((f, i) => (
                              <Badge key={i} variant="warning">
                                <AlertTriangle className="w-3 h-3 mr-1 inline text-amber-600" />
                                {f.code || f.message || 'Warning'}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <Badge variant="ready" dot>
                            Ready
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {!isPaid && (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleToggleHold(t)}
                              title={isHeld ? 'Release from Hold' : 'Place on Hold'}
                              className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                              {isHeld ? (
                                <PlayCircle className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <PauseCircle className="w-3.5 h-3.5 text-amber-600" />
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDelete(t)}
                              title="Delete Timesheet"
                              className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400 italic">
                    No timesheets found matching your filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Log Shift Slide-over Drawer */}
      <Drawer
        isOpen={logShiftDrawer}
        onClose={() => setLogShiftDrawer(false)}
        title="Log Contributor Shift"
        subtitle="Timesheets are evaluated automatically against company overtime thresholds."
      >
        <form onSubmit={handleLogShift} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Team Member
            </label>
            <select
              required
              value={shiftForm.employeeId}
              onChange={(e) => setShiftForm({ ...shiftForm, employeeId: e.target.value })}
              className="w-full px-3 py-2 rounded-lg text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
            >
              {(data.employees || []).map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} — ${emp.hourlyRate}/hr ({emp.role})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Shift Date
              </label>
              <input
                type="date"
                required
                value={shiftForm.date}
                onChange={(e) => setShiftForm({ ...shiftForm, date: e.target.value })}
                className="w-full px-3 py-2 rounded-lg text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Hours Logged
              </label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="24"
                required
                value={shiftForm.hoursLogged}
                onChange={(e) => setShiftForm({ ...shiftForm, hoursLogged: e.target.value })}
                className="w-full px-3 py-2 rounded-lg text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Work Notes / Deliverables
            </label>
            <textarea
              rows={3}
              value={shiftForm.notes}
              onChange={(e) => setShiftForm({ ...shiftForm, notes: e.target.value })}
              placeholder="e.g. Completed Soroban XDR verification test suite..."
              className="w-full p-2.5 rounded-lg text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Live compensation breakdown card */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 text-xs space-y-1.5 font-mono">
            <span className="text-slate-400 font-sans block text-[11px] mb-1 font-semibold uppercase">
              Live Shift Estimate
            </span>
            <div className="flex justify-between text-slate-700 dark:text-slate-300">
              <span className="font-sans">Regular Pay ({regHours.toFixed(1)}h @ ${hourlyRate}):</span>
              <span>${(regHours * hourlyRate).toFixed(2)}</span>
            </div>
            {otHours > 0 && (
              <div className="flex justify-between text-amber-700 dark:text-amber-400">
                <span className="font-sans">Overtime ({otHours.toFixed(1)}h @ 1.25x):</span>
                <span>+${(otHours * (hourlyRate * 1.25)).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-slate-500 dark:text-slate-400">
              <span className="font-sans">Estimated Withholding ({withholdingPct}%):</span>
              <span>-${estWithholding.toFixed(2)}</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-slate-200 dark:border-slate-700 font-bold text-slate-900 dark:text-slate-100">
              <span className="font-sans">Net Payout:</span>
              <span className="text-blue-600 dark:text-blue-400">${estNet.toFixed(2)}</span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setLogShiftDrawer(false)}
              className="px-4 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs cursor-pointer"
            >
              Record Timesheet
            </button>
          </div>
        </form>
      </Drawer>

      {/* Import CSV Modal */}
      <Modal
        isOpen={importCsvModal}
        onClose={() => setImportCsvModal(false)}
        title="Batch Import Timesheets (CSV)"
        subtitle="Upload or paste comma-delimited shift records."
      >
        <form onSubmit={handleImportCsv} className="space-y-4">
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 text-xs">
            <span className="font-semibold block mb-1">Expected CSV Format:</span>
            <code className="font-mono text-[11px] text-slate-600 dark:text-slate-300 block">
              date,employeeId,hoursLogged,notes<br />
              2026-11-24,emp_01,8.0,Sprint engineering<br />
              2026-11-24,emp_02,10.5,Deploy release
            </code>
          </div>

          <div>
            <textarea
              required
              rows={6}
              value={csvContent}
              onChange={(e) => setCsvContent(e.target.value)}
              placeholder="Paste raw CSV content here..."
              className="w-full p-2.5 rounded-lg text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setImportCsvModal(false)}
              className="px-3 py-1.5 rounded-lg text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs"
            >
              Parse & Save Batch
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
