'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function SyncEspnButton() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const router = useRouter();

  const handleSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncStatus('idle');
    setErrorMessage(null);

    try {
      const res = await fetch('/api/sync-espn', {
        method: 'GET',
        cache: 'no-store',
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Sync request failed');
      }

      setSyncStatus('success');
      router.refresh();
      setTimeout(() => setSyncStatus('idle'), 3500);
    } catch (err: unknown) {
      console.error('ESPN Sync error:', err);
      setSyncStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Sync failed');
      setTimeout(() => setSyncStatus('idle'), 4000);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="relative inline-flex items-center">
      <button
        onClick={handleSync}
        disabled={isSyncing}
        title="Sync ESPN Rosters and Transactions"
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-md transition-all ${
          isSyncing
            ? 'bg-indigo-950 text-indigo-300 border border-indigo-700/60 cursor-wait'
            : syncStatus === 'success'
            ? 'bg-emerald-900/80 text-emerald-200 border border-emerald-600'
            : syncStatus === 'error'
            ? 'bg-rose-950 text-rose-300 border border-rose-700'
            : 'bg-indigo-600 hover:bg-indigo-500 text-white active:scale-95'
        }`}
      >
        {isSyncing ? (
          <>
            <svg
              className="animate-spin -ml-0.5 h-3.5 w-3.5 text-indigo-300"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
            <span>Syncing ESPN...</span>
          </>
        ) : syncStatus === 'success' ? (
          <>
            <span>✓</span>
            <span>Rosters Synced</span>
          </>
        ) : syncStatus === 'error' ? (
          <>
            <span>⚠️</span>
            <span>Sync Failed</span>
          </>
        ) : (
          <>
            <span>🔄</span>
            <span>Sync ESPN</span>
          </>
        )}
      </button>

      {syncStatus === 'error' && errorMessage && (
        <span className="absolute -bottom-6 right-0 text-[10px] text-rose-400 whitespace-nowrap font-medium">
          {errorMessage}
        </span>
      )}
    </div>
  );
}