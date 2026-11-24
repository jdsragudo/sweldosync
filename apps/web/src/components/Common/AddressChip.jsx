// apps/web/src/components/Common/AddressChip.jsx
import React, { useState } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { truncateStellarAddress, formatExplorerAccountUrl } from '../../services/stellar';
import { useApp } from '../../context/AppContext';

export function AddressChip({ address, lead = 4, tail = 4, showLink = true, className = '' }) {
  const [copied, setCopied] = useState(false);
  const { network } = useApp();

  if (!address) {
    return <span className="text-slate-400 text-xs italic font-mono">Unset</span>;
  }

  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const truncated = truncateStellarAddress(address, lead, tail);
  const explorerUrl = formatExplorerAccountUrl(address, network);

  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 text-xs text-slate-700 dark:text-slate-300 ${className}`}>
      <span className="font-mono tabular-nums tracking-tight font-medium" title={address}>
        {truncated}
      </span>

      <button
        type="button"
        onClick={handleCopy}
        title={copied ? 'Copied full address!' : 'Copy full address'}
        className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors rounded"
      >
        {copied ? (
          <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
      </button>

      {showLink && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Inspect on Stellar Expert"
          className="p-0.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors rounded"
        >
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}
