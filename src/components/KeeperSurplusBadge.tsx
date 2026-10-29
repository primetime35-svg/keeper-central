'use client';

import React from 'react';
import { KeeperSurplusBreakdown, formatCurrency } from '@/lib/valuationEngine';

interface KeeperSurplusBadgeProps {
  breakdown: KeeperSurplusBreakdown;
  className?: string;
}

export function KeeperSurplusBadge({ breakdown, className = '' }: KeeperSurplusBadgeProps) {
  const { totalSurplus, surplus2027, surplus2028, costRound2027, costRound2028, isEligible2027, isEligible2028 } = breakdown;

  if (!isEligible2027 || totalSurplus <= 0) {
    return <span className="text-slate-500 font-mono text-xs">KP $0</span>;
  }

  const tenureYears = isEligible2028 ? 2 : 1;
  const pillStyle = tenureYears === 2
    ? 'border-emerald-500/40 bg-emerald-950/60 text-emerald-300'
    : 'border-cyan-500/40 bg-cyan-950/60 text-cyan-300';

  return (
    <div className={`relative group inline-flex items-center cursor-default ${className}`}>
      {/* Badge Pill */}
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono font-medium border ${pillStyle} transition-all group-hover:scale-105`}>
        <span>KP {formatCurrency(totalSurplus, true)}</span>
        <span className="text-[9px] px-1 py-0.2 rounded bg-slate-900/80 text-slate-300 font-sans uppercase tracking-tight">
          {tenureYears}y
        </span>
      </span>

      {/* Floating Tooltip */}
      <div className="absolute bottom-full right-0 mb-1.5 hidden group-hover:flex flex-col z-50 w-48 p-2 rounded-md shadow-xl bg-slate-900/95 border border-slate-700 backdrop-blur-sm text-left pointer-events-none">
        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold border-b border-slate-800 pb-1 mb-1.5 flex justify-between">
          <span>Keeper Runway</span>
          <span className="text-emerald-400">{tenureYears} Year{tenureYears > 1 ? 's' : ''}</span>
        </div>

        <div className="space-y-1 text-xs font-mono">
          <div className="flex justify-between items-center text-slate-300">
            <span>2027 (Rd {costRound2027}):</span>
            <span className="text-emerald-400 font-semibold">{formatCurrency(surplus2027, true)}</span>
          </div>

          {isEligible2028 && (
            <div className="flex justify-between items-center text-slate-300">
              <span>2028 (Rd {costRound2028}):</span>
              <span className="text-emerald-400 font-semibold">{formatCurrency(surplus2028, true)}</span>
            </div>
          )}

          {!isEligible2028 && (
            <div className="flex justify-between items-center text-slate-500 text-[10px]">
              <span>2028:</span>
              <span className="italic">Tenure Cap</span>
            </div>
          )}
        </div>

        <div className="mt-1.5 pt-1 border-t border-slate-800 flex justify-between items-center text-[11px] font-bold">
          <span className="text-slate-300">Total Surplus:</span>
          <span className="text-emerald-300 font-mono">{formatCurrency(totalSurplus, true)}</span>
        </div>
      </div>
    </div>
  );
}
