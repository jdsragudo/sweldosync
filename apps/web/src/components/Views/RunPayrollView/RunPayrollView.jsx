// apps/web/src/components/Views/RunPayrollView/RunPayrollView.jsx
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  Clock,
  DollarSign,
  FileCheck2,
  Layers,
  Sparkles,
} from 'lucide-react';
import { Step1SelectShifts } from './Step1SelectShifts';
import { Step2CompensationPreview } from './Step2CompensationPreview';
import { Step3PreflightSign } from './Step3PreflightSign';
import { Step4ConfirmedReceipts } from './Step4ConfirmedReceipts';
import { SettlementChoreographyModal } from './SettlementChoreographyModal';
import { useApp } from '../../../context/AppContext';

const STEPS = [
  { id: 1, title: 'Select Shifts & Guardrails', icon: Clock },
  { id: 2, title: 'Compensation Preview', icon: DollarSign },
  { id: 3, title: 'Preflight & Sign', icon: FileCheck2 },
  { id: 4, title: 'Confirmed Receipts', icon: CheckCircle2 },
];

export function RunPayrollView() {
  const { data, network, refreshData } = useApp();

  // Wizard state
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedShiftIds, setSelectedShiftIds] = useState(() => {
    // Default select all eligible pending/flagged shifts (excluding HELD and BLOCKED)
    return (data.timesheets || [])
      .filter((t) => t.status !== 'PAID' && t.status !== 'HELD' && t.guardrailStatus !== 'BLOCKED')
      .map((t) => t.id);
  });
  const [periodLabel, setPeriodLabel] = useState('Nov 15 - Nov 30, 2026 Cutoff');
  const [previewData, setPreviewData] = useState(null);

  // Settlement Choreography Modal state
  const [choreographyOpen, setChoreographyOpen] = useState(false);
  const [choreographyStage, setChoreographyStage] = useState(1);
  const [choreographyError, setChoreographyError] = useState(null);
  const [settlementResult, setSettlementResult] = useState(null);

  const handleStartChoreography = () => {
    setChoreographyOpen(true);
    setChoreographyStage(1);
    setChoreographyError(null);
  };

  const handleUpdateChoreographyStage = (stage, result = null) => {
    setChoreographyStage(stage);
    if (result) setSettlementResult(result);
  };

  const handleFailChoreography = (errorMsg) => {
    setChoreographyError(errorMsg);
  };

  const handleCompleteChoreography = async (result) => {
    setSettlementResult(result);
    await refreshData(true);
    setChoreographyOpen(false);
    setCurrentStep(4);
  };

  const handleResetRun = () => {
    setCurrentStep(1);
    setSelectedShiftIds([]);
    setPreviewData(null);
    setSettlementResult(null);
    setChoreographyError(null);
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* View Title */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
          Run Payroll
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Guided 4-step trustless disbursement pipeline on Stellar Horizon.
        </p>
      </div>

      {/* Stepper Header with Spring Indicator */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-1.5 rounded-xl shadow-xs">
        {STEPS.map((step) => {
          const Icon = step.icon;
          const isActive = currentStep === step.id;
          const isDone = currentStep > step.id;

          return (
            <div
              key={step.id}
              className={`relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                isActive
                  ? 'text-blue-600 dark:text-blue-400 font-semibold'
                  : isDone
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-slate-400 dark:text-slate-500'
              }`}
            >
              {/* Shared layoutId spring background */}
              {isActive && (
                <motion.div
                  layoutId="activeStepIndicator"
                  className="absolute inset-0 bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200/60 dark:border-blue-800/60 rounded-lg -z-0"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                />
              )}

              <div className="relative z-10 flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-mono">
                {isDone ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center ${
                      isActive
                        ? 'bg-blue-600 text-white font-bold'
                        : 'border border-slate-300 dark:border-slate-700 text-slate-400'
                    }`}
                  >
                    {step.id}
                  </span>
                )}
              </div>

              <span className="relative z-10 truncate">{step.title}</span>
            </div>
          );
        })}
      </div>

      {/* Step Views with AnimatePresence */}
      <AnimatePresence mode="wait">
        {currentStep === 1 && (
          <motion.div
            key="step1"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
          >
            <Step1SelectShifts
              selectedIds={selectedShiftIds}
              setSelectedIds={setSelectedShiftIds}
              onProceed={() => setCurrentStep(2)}
            />
          </motion.div>
        )}

        {currentStep === 2 && (
          <motion.div
            key="step2"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
          >
            <Step2CompensationPreview
              selectedIds={selectedShiftIds}
              periodLabel={periodLabel}
              setPeriodLabel={setPeriodLabel}
              previewData={previewData}
              setPreviewData={setPreviewData}
              onBack={() => setCurrentStep(1)}
              onProceed={() => setCurrentStep(3)}
            />
          </motion.div>
        )}

        {currentStep === 3 && (
          <motion.div
            key="step3"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
          >
            <Step3PreflightSign
              selectedIds={selectedShiftIds}
              periodLabel={periodLabel}
              previewData={previewData}
              onBack={() => setCurrentStep(2)}
              onStartChoreography={handleStartChoreography}
              onUpdateChoreographyStage={handleUpdateChoreographyStage}
              onFailChoreography={handleFailChoreography}
              onCompleteChoreography={handleCompleteChoreography}
            />
          </motion.div>
        )}

        {currentStep === 4 && (
          <motion.div
            key="step4"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
          >
            <Step4ConfirmedReceipts
              settlementResult={settlementResult}
              previewData={previewData}
              periodLabel={periodLabel}
              onReset={handleResetRun}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Interactive 4-Stage Settlement Choreography Modal */}
      <SettlementChoreographyModal
        isOpen={choreographyOpen}
        onClose={() => setChoreographyOpen(false)}
        stage={choreographyStage}
        settlementResult={settlementResult}
        errorMessage={choreographyError}
        network={network}
      />
    </div>
  );
}
