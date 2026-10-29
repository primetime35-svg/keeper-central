'use client';

import { useFreezeDeadline } from '@/hooks/useFreezeDeadline';

export default function FreezeBanner() {
  const {
    mounted,
    isTradeDeadlinePassed,
    tradeTimeLeft,
    formattedTradeDeadline,
    isRosterFrozen,
    freezeTimeLeft,
    formattedFreezeDeadline,
  } = useFreezeDeadline();

  if (!mounted) {
    return (
      <div className="w-full bg-slate-900 border-b border-slate-800 text-slate-400 px-4 py-2 text-xs font-mono">
        Loading deadline status...
      </div>
    );
  }

  // Phase 3: Post-Dec 8 Roster Freeze
  if (isRosterFrozen) {
    return (
      <div className="w-full bg-slate-900 border-b border-amber-900/60 text-amber-200/90 px-4 py-2 text-xs font-mono flex items-center justify-between">
        <div className="flex items-center gap-2 mx-auto">
          <span className="text-sm">🔒</span>
          <span>
            <strong className="text-amber-400">ROSTERS FROZEN:</strong> Roster transactions locked on {formattedFreezeDeadline}. Keeper eligibility & costs are set. (Keepers designated 1 week prior to 2027 draft).
          </span>
        </div>
      </div>
    );
  }

  // Phase 2: Dec 4 - Dec 8 (Trades locked, Roster freeze pending)
  if (isTradeDeadlinePassed) {
    return (
      <div className="w-full bg-slate-900 border-b border-rose-900/60 text-slate-300 px-4 py-2 text-xs font-mono flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-rose-400 font-bold">🔒 Trades Closed</span>
          <span className="text-slate-500">•</span>
          <span className="text-slate-400">Roster & Keeper Freeze:</span>
          <span className="text-white font-bold">{formattedFreezeDeadline}</span>
        </div>
        <div className="flex items-center gap-1.5 font-bold">
          <span className="text-slate-400 font-normal">Freeze in:</span>
          <span className="bg-slate-950 px-2 py-0.5 rounded border border-slate-700 text-amber-400">
            {freezeTimeLeft.days}d {freezeTimeLeft.hours}h {freezeTimeLeft.minutes}m {freezeTimeLeft.seconds}s
          </span>
        </div>
      </div>
    );
  }

  // Phase 1: Current Season (Pre-Trade Deadline)
  return (
    <div className="w-full bg-slate-900 border-b border-slate-800 text-slate-300 px-4 py-2 text-xs font-mono flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-amber-400">⏳</span>
        <span className="text-slate-400">Trade Deadline:</span>
        <span className="text-white font-bold">{formattedTradeDeadline}</span>
        <span className="text-slate-500 hidden md:inline">
          (Roster Freeze: Dec 8 • Keeper Designations: 1 wk before draft)
        </span>
      </div>
      <div className="flex items-center gap-1.5 font-bold">
        <span className="text-slate-400 font-normal">Trade window closes:</span>
        <span className="bg-slate-950 px-2 py-0.5 rounded border border-slate-700 text-amber-400">
          {tradeTimeLeft.days}d {tradeTimeLeft.hours}h {tradeTimeLeft.minutes}m {tradeTimeLeft.seconds}s
        </span>
      </div>
    </div>
  );
}
