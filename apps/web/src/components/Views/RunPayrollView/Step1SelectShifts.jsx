// apps/web/src/components/Views/RunPayrollView/Step1SelectShifts.jsx
import React, { useState } from 'react';
import {
  Check,
  AlertTriangle,
  Clock,
  ShieldCheck,
  ArrowRight,
  Edit2,
  PauseCircle,
  PlayCircle,
  User,
  Ban,
} from 'lucide-react';
import { Badge } from '../../Common/Badge';
import { AddressChip } from '../../Common/AddressChip';
import { Modal } from '../../Common/Modal';
import { api } from '../../../services/api';
import { useApp } from '../../../context/AppContext';

export function Step1SelectShifts({
  selectedIds,
  setSelectedIds,
  onProceed,
}) {
  const { data, refreshData, addToast } = useApp();

  // Dialog states for Override & Edit
  const [overrideModal, setOverrideModal] = useState({ isOpen: false, timesheet: null, reason: '' });
  const [editModal, setEditModal] = useState({ isOpen: false, timesheet: null, hours: '' });

  // Timesheets eligible for pay run: non-PAID
  const allQueueTimesheets = (data.timesheets || []).filter(
    (t) => t.status !== 'PAID'
  );

  // Eligible to be checked: NOT HELD and NOT BLOCKED
  const selectableTimesheets = allQueueTimesheets.filter(
    (t) => t.status !== 'HELD' && t.guardrailStatus !== 'BLOCKED'
  );

  const employeesMap = new Map((data.employees || []).map((e) => [e.id, e]));

  const allSelected =
    selectableTimesheets.length > 0 &&
    selectableTimesheets.every((t) => selectedIds.includes(t.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(selectableTimesheets.map((t) => t.id));
    }
  };

  const toggleSelectOne = (id) => {
    const t = allQueueTimesheets.find((item) => item.id === id);
    if (t?.status === 'HELD' || t?.guardrailStatus === 'BLOCKED') return;

    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((item) => item !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  // Override Handler
  const handleApproveOverride = async (e) => {
    e.preventDefault();
    const { timesheet, reason } = overrideModal;
    if (!timesheet) return;

    if (!reason.trim()) {
      addToast({
        type: 'warning',
        title: 'Override Reason Required',
        message: 'Please provide a clear supervisor justification for the audit log.',
      });
      return;
    }

    try {
      await api.updateTimesheet(timesheet.id, {
        isOverridden: true,
        overrideReason: reason.trim(),
        status: 'READY',
      });
      addToast({
        type: 'success',
        title: 'Guardrail Override Approved',
        message: `Shift ${timesheet.id} unlocked with audit log reason: "${reason.trim()}".`,
      });
      setOverrideModal({ isOpen: false, timesheet: null, reason: '' });
      await refreshData();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Override Failed',
        message: err.message || 'Could not update timesheet.',
      });
    }
  };

  // Edit Hours Handler
  const handleEditHours = async (e) => {
    e.preventDefault();
    const { timesheet, hours } = editModal;
    if (!timesheet) return;

    const parsedHours = parseFloat(hours);
    if (isNaN(parsedHours) || parsedHours <= 0) {
      addToast({
        type: 'warning',
        title: 'Invalid Hours',
        message: 'Hours must be a positive number.',
      });
      return;
    }

    try {
      await api.updateTimesheet(timesheet.id, {
        hoursLogged: parsedHours,
      });
      addToast({
        type: 'success',
        title: 'Timesheet Hours Updated',
        message: `Updated shift to ${parsedHours} hours.`,
      });
      setEditModal({ isOpen: false, timesheet: null, hours: '' });
      await refreshData();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Edit Failed',
        message: err.message || 'Could not update hours.',
      });
    }
  };

  // Hold / Release Handler - immediately unchecks if placed on hold!
  const handleToggleHold = async (timesheet) => {
    const newStatus = timesheet.status === 'HELD' ? 'PENDING' : 'HELD';
    if (newStatus === 'HELD') {
      setSelectedIds((prev) => prev.filter((id) => id !== timesheet.id));
    }
    try {
      await api.updateTimesheet(timesheet.id, { status: newStatus });
      addToast({
        type: 'info',
        title: newStatus === 'HELD' ? 'Shift Held' : 'Shift Released',
        message: `Timesheet ${timesheet.id} set to ${newStatus}.`,
      });
      await refreshData();
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Action Failed',
        message: err.message,
      });
    }
  };

  // Selected counts (ensuring no held or blocked shifts count)
  const validSelectedIds = selectedIds.filter((id) => {
    const t = allQueueTimesheets.find((item) => item.id === id);
    return t && t.status !== 'HELD' && t.guardrailStatus !== 'BLOCKED';
  });

  const selectedTimesheets = allQueueTimesheets.filter((t) => validSelectedIds.includes(t.id));
  const selectedHours = selectedTimesheets.reduce(
    (acc, t) => acc + (Number(t.hoursLogged) || 0),
    0
  );
  const unapprovedWarningsCount = selectedTimesheets.filter(
    (t) => (t.flags && t.flags.length > 0 && !t.isOverridden) || t.status === 'FLAGGED'
  ).length;

  return (
    <div className="space-y-6">
      {/* Table of selectable timesheets */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Timesheet Queue & Guardrail Audit
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Select verified shifts for this pay period. Review and clear any automated warning flags.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleSelectAll}
            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
          >
            {allSelected ? 'Deselect All' : 'Select All Eligible'}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/70 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-100 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Team Member</th>
                <th className="py-3 px-4 text-right">Hours</th>
                <th className="py-3 px-4">Work Summary / Notes</th>
                <th className="py-3 px-4">Guardrail Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
              {allQueueTimesheets.length > 0 ? (
                allQueueTimesheets.map((t) => {
                  const emp = employeesMap.get(t.employeeId) || { name: t.employeeName || 'Unknown' };
                  const isHeld = t.status === 'HELD';
                  const isBlocked = t.guardrailStatus === 'BLOCKED';
                  const isSelectable = !isHeld && !isBlocked;
                  const isSelected = validSelectedIds.includes(t.id);
                  const hasFlags = (t.flags && t.flags.length > 0) || t.status === 'FLAGGED';
                  const isOverridden = t.isOverridden;

                  return (
                    <tr
                      key={t.id}
                      onClick={() => isSelectable && toggleSelectOne(t.id)}
                      className={`transition-colors ${
                        !isSelectable
                          ? 'opacity-60 bg-slate-50/30 dark:bg-slate-900/40 cursor-not-allowed'
                          : isSelected
                          ? 'bg-blue-50/40 dark:bg-blue-950/20 cursor-pointer'
                          : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/40 cursor-pointer'
                      }`}
                    >
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          disabled={!isSelectable}
                          checked={isSelected}
                          onChange={() => toggleSelectOne(t.id)}
                          className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500 disabled:opacity-40"
                        />
                      </td>
                      <td className="py-3 px-4 font-mono font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {t.date || '2026-11-24'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 font-sans">
                          {emp.name}
                        </div>
                        <div className="text-[11px] text-slate-400 font-sans">
                          {emp.role || 'Member'}
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
                      <td className="py-3 px-4 max-w-xs truncate text-slate-500 dark:text-slate-400">
                        {t.notes || 'Routine scheduled sprint shifts'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {isBlocked ? (
                            <Badge variant="blocked">
                              <Ban className="w-3 h-3 mr-1 inline" />
                              Blocked (Policy)
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
                              {(t.flags || [{ code: 'ATTENTION', message: 'Review threshold' }]).map(
                                (f, idx) => (
                                  <Badge key={idx} variant="warning">
                                    <AlertTriangle className="w-3 h-3 mr-1 inline text-amber-600" />
                                    {f.code || f.message || 'Warning'}
                                  </Badge>
                                )
                              )}
                            </div>
                          ) : (
                            <Badge variant="ready" dot>
                              Ready
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Approve Override button if flagged */}
                          {hasFlags && !isOverridden && !isBlocked && (
                            <button
                              type="button"
                              onClick={() =>
                                setOverrideModal({ isOpen: true, timesheet: t, reason: '' })
                              }
                              className="px-2 py-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 dark:bg-amber-950/80 dark:hover:bg-amber-900 dark:text-amber-300 text-[11px] font-semibold transition-colors cursor-pointer"
                            >
                              Approve Override
                            </button>
                          )}

                          {/* Edit Hours button */}
                          <button
                            type="button"
                            onClick={() =>
                              setEditModal({ isOpen: true, timesheet: t, hours: String(t.hoursLogged) })
                            }
                            title="Edit Hours"
                            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          {/* Hold / Release toggle */}
                          <button
                            type="button"
                            onClick={() => handleToggleHold(t)}
                            title={isHeld ? 'Release from Hold' : 'Place on Hold'}
                            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            {isHeld ? (
                              <PlayCircle className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <PauseCircle className="w-3.5 h-3.5 text-amber-600" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400 italic font-sans">
                    No pending timesheets found. Log new shifts or import CSV from the Timesheets view.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary Action Bar */}
      <div className="p-4 rounded-xl bg-slate-900 dark:bg-slate-800 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-md">
        <div className="flex items-center gap-4 text-xs font-sans">
          <div>
            <span className="text-slate-400 block">Selected Shifts</span>
            <span className="text-sm font-semibold font-mono tabular-nums">
              {selectedTimesheets.length} shifts ({selectedHours.toFixed(1)} hrs)
            </span>
          </div>

          <div className="h-8 w-px bg-slate-700 hidden sm:block" />

          <div>
            <span className="text-slate-400 block">Guardrail Status</span>
            <span className="text-xs font-medium">
              {unapprovedWarningsCount > 0 ? (
                <span className="text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {unapprovedWarningsCount} shift(s) pending override
                </span>
              ) : (
                <span className="text-emerald-400 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  All selected shifts approved
                </span>
              )}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onProceed}
          disabled={selectedTimesheets.length === 0}
          className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold shadow-xs transition-all ${
            selectedTimesheets.length === 0
              ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer'
          }`}
        >
          <span>Continue to Compensation Preview</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Approve Override Modal */}
      <Modal
        isOpen={overrideModal.isOpen}
        onClose={() => setOverrideModal({ isOpen: false, timesheet: null, reason: '' })}
        title="Approve Guardrail Policy Override"
        subtitle="This action will be recorded in the SQLite audit log with cryptographic signature."
      >
        <form onSubmit={handleApproveOverride} className="space-y-4">
          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 text-xs text-amber-800 dark:text-amber-300">
            <span className="font-semibold block mb-0.5">Shift Details:</span>
            <span>
              {overrideModal.timesheet?.employeeName} · {overrideModal.timesheet?.date} ·{' '}
              {overrideModal.timesheet?.hoursLogged} hours
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Justification / Reason for Audit Record
            </label>
            <textarea
              required
              rows={3}
              placeholder="e.g. Approved by Operations Lead for weekend deployment sprint..."
              value={overrideModal.reason}
              onChange={(e) =>
                setOverrideModal({ ...overrideModal, reason: e.target.value })
              }
              className="w-full p-2.5 rounded-lg text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() =>
                setOverrideModal({ isOpen: false, timesheet: null, reason: '' })
              }
              className="px-3 py-1.5 rounded-lg text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-xs"
            >
              Confirm Override
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Hours Modal */}
      <Modal
        isOpen={editModal.isOpen}
        onClose={() => setEditModal({ isOpen: false, timesheet: null, hours: '' })}
        title="Adjust Shift Hours"
        subtitle="Update hours logged before building the immutable payroll batch."
      >
        <form onSubmit={handleEditHours} className="space-y-4">
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
              value={editModal.hours}
              onChange={(e) => setEditModal({ ...editModal, hours: e.target.value })}
              className="w-full p-2.5 rounded-lg text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditModal({ isOpen: false, timesheet: null, hours: '' })}
              className="px-3 py-1.5 rounded-lg text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs"
            >
              Save Hours
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
