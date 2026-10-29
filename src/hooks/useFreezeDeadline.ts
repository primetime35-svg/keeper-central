'use client';

import { useState, useEffect } from 'react';

export const TRADE_DEADLINE = '2026-12-04T03:00:00-05:00';
export const ROSTER_FREEZE_DEADLINE = '2026-12-08T00:00:00-05:00';

function calculateTimeLeft(targetDate: Date, now: Date | null) {
  if (!now) {
    return {
      diffMs: 0,
      isPassed: false,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    };
  }
  const diffMs = targetDate.getTime() - now.getTime();
  const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
  return {
    diffMs,
    isPassed: diffMs <= 0,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

export function useFreezeDeadline() {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    setMounted(true);
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const tradeDate = new Date(TRADE_DEADLINE);
  const freezeDate = new Date(ROSTER_FREEZE_DEADLINE);

  const tradeStatus = calculateTimeLeft(tradeDate, now);
  const freezeStatus = calculateTimeLeft(freezeDate, now);

  const formatOptions: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  };

  return {
    mounted,
    isTradeDeadlinePassed: tradeStatus.isPassed,
    tradeTimeLeft: tradeStatus,
    formattedTradeDeadline: tradeDate.toLocaleDateString('en-US', formatOptions),

    isRosterFrozen: freezeStatus.isPassed,
    freezeTimeLeft: freezeStatus,
    formattedFreezeDeadline: freezeDate.toLocaleDateString('en-US', formatOptions),

    // Backward compatibility
    isFrozen: tradeStatus.isPassed,
    timeLeft: tradeStatus,
    formattedDeadline: tradeDate.toLocaleDateString('en-US', formatOptions),
  };
}
