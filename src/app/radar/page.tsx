'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { calculatePickEquity, calculateRosTradeValue, getDampenedFppg } from '@/lib/valuationEngine';

interface PlayerProjection {
  season_fppg: number;
  projected_adp: number;
  gp: number;
  fpts: number;
}

interface RosterItem {
  id: string;
  draft_round: number;
  acquisition_type: string;
  keeper_years_accumulated: number;
  is_kept_year_2: boolean;
  team_id: string;
  team: {
    manager_name: string;
    team_name: string;
  };
  player: {
    id: string;
    full_name: string;
    position: string;
    team: string | null;
    injury_status: string;
    injury_notes: string;
    keeper_years_accumulated?: number;
    is_kept_year_2?: boolean;
    projections: PlayerProjection[];
  };
}

interface TeamData {
  id: string;
  manager_name: string;
  team_name: string;
}

function formatCurrency(amount: number, showPlus: boolean = false): string {
  const rounded = Math.round(amount * 100) / 100;
  const isWhole = Number.isInteger(rounded);
  const formatted = isWhole ? rounded.toString() : rounded.toFixed(2);
  const prefix = showPlus && rounded > 0 ? '+$' : '$';
  return `${prefix}${formatted}`;
}

function getCostPickNumber(round: number): number {
  return Math.max(1, (round - 1) * 12 + 6);
}

function getProjectedRound(adp: number): string {
  if (adp <= 0 || adp > 192) return 'Undrafted';
  const round = Math.ceil(adp / 12);
  const pickInRound = ((adp - 1) % 12) + 1;
  return `Rd ${round}.${pickInRound.toString().padStart(2, '0')}`;
}

export default function TradeRadarPage() {
  const [teams, setTeams] = useState<TeamData[]>([]);
  const [rosterData, setRosterData] = useState<RosterItem[]>([]);
  const [selectedMyManager, setSelectedMyManager] = useState<string>('Jim');
  const [selectedTargetManager, setSelectedTargetManager] = useState<string>('All');
  const [activeTab, setActiveTab] = useState<'surplus' | 'rentals' | 'buylow'>('surplus');

  useEffect(() => {
    async function loadData() {
      const { data: teamsData } = await supabase
        .from('teams')
        .select('id, manager_name, team_name')
        .order('manager_name', { ascending: true });

      if (teamsData) setTeams(teamsData);

      const { data: rosters } = await supabase
        .from('rosters')
        .select(`
          id,
          team_id,
          draft_round,
          acquisition_type,
          keeper_years_accumulated,
          is_kept_year_2,
          team:teams (
            manager_name,
            team_name
          ),
          player:players (
            id,
            full_name,
            position,
            team,
            injury_status,
            injury_notes,
            keeper_years_accumulated,
            is_kept_year_2,
            projections:player_projections (
              season_fppg,
              projected_adp,
              gp,
              fpts
            )
          )
        `);

      if (rosters) {
        setRosterData(rosters as unknown as RosterItem[]);
      }
    }
    loadData();
  }, []);

  const evaluatedPlayers = useMemo(() => {
    return rosterData.map((item) => {
      const proj = item.player?.projections?.[0] || {
        season_fppg: 0,
        projected_adp: 180,
        gp: 0,
        fpts: 0,
      };
      const originalRound = item.draft_round || 12;
      const playerObj = item.player;
      const tenureYears = (playerObj?.keeper_years_accumulated != null && playerObj.keeper_years_accumulated > 0)
        ? playerObj.keeper_years_accumulated
        : (item.keeper_years_accumulated || 0);
      const isKeptYear2 = Boolean(playerObj?.is_kept_year_2 || item.is_kept_year_2);
      const pos = item.player?.position || 'WR';

      // Year 1 keeps at exact cost; Year 2 keeps escalate 1 round
      const costRound = tenureYears === 1 ? Math.max(1, originalRound - 1) : originalRound;

      const isIneligibleRound = originalRound <= 2;
      const isOverTenure = tenureYears >= 2 || isKeptYear2;
      const isEligible = !isIneligibleRound && !isOverTenure;

      const gp = proj.gp || 0;
      const fpts = proj.fpts || 0;
      const dampenedFppg = getDampenedFppg(fpts, gp, proj.season_fppg);

      const rosValue = calculateRosTradeValue(
        pos,
        dampenedFppg,
        proj.projected_adp || 180,
        item.player?.injury_status,
        undefined,
        gp,
        item.player?.injury_notes
      );

      const projAdp = proj.projected_adp || 180;
      const projEquity = calculatePickEquity(projAdp, pos);
      const costEquity = calculatePickEquity(getCostPickNumber(costRound), pos);
      const rawSurplus = projEquity - costEquity;
      const surplusEquity = isEligible && rawSurplus > 0 ? Math.round(rawSurplus * 100) / 100 : 0;
      const totalTradeValue = Math.round((rosValue + surplusEquity) * 100) / 100;

      const normInjury = (item.player?.injury_status || '').toLowerCase();
      const isBuyLowOrStash =
        (normInjury === 'ir' || normInjury === 'out' || normInjury === 'questionable' || gp <= 2) &&
        (projAdp <= 135 || rosValue >= 2.0);

      return {
        ...item,
        managerName: item.team?.manager_name || 'Free Agent',
        costRound,
        originalRound,
        tenureYears,
        isEligible,
        ineligibilityReason: isIneligibleRound
          ? 'Rounds 1–2 Ineligible'
          : isOverTenure
          ? '2-Year Cap Reached'
          : null,
        rosValue,
        surplusEquity,
        totalTradeValue,
        projAdp,
        isBuyLowOrStash,
      };
    });
  }, [rosterData]);

  // 1. Top Keeper Surplus Targets (Excluding selected manager's own players)
  const topSurplusTargets = useMemo(() => {
    return evaluatedPlayers
      .filter((p) => p.isEligible && p.surplusEquity > 0)
      .filter((p) => p.managerName !== selectedMyManager)
      .filter((p) => selectedTargetManager === 'All' || p.managerName === selectedTargetManager)
      .sort((a, b) => b.surplusEquity - a.surplusEquity);
  }, [evaluatedPlayers, selectedTargetManager, selectedMyManager]);

  // 2. Top Win-Now Rentals (High ROS, ineligible or minimal keeper equity)
  const topRentals = useMemo(() => {
    return evaluatedPlayers
      .filter((p) => p.rosValue >= 10 && (!p.isEligible || p.surplusEquity <= 2))
      .filter((p) => p.managerName !== selectedMyManager)
      .filter((p) => selectedTargetManager === 'All' || p.managerName === selectedTargetManager)
      .sort((a, b) => b.rosValue - a.rosValue);
  }, [evaluatedPlayers, selectedTargetManager, selectedMyManager]);

  // 3. Buy-Low / Injured Returnees / Handcuffs
  const topBuyLows = useMemo(() => {
    return evaluatedPlayers
      .filter((p) => p.isBuyLowOrStash)
      .filter((p) => p.managerName !== selectedMyManager)
      .filter((p) => selectedTargetManager === 'All' || p.managerName === selectedTargetManager)
      .sort((a, b) => b.totalTradeValue - a.totalTradeValue);
  }, [evaluatedPlayers, selectedTargetManager, selectedMyManager]);

  const activeDisplayList =
    activeTab === 'surplus'
      ? topSurplusTargets
      : activeTab === 'rentals'
      ? topRentals
      : topBuyLows;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">

        {/* Navigation & Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-3xl">📡</span>
              <h1 className="text-3xl font-extrabold tracking-tight text-white">League Trade Radar</h1>
              <span className="text-xs uppercase tracking-widest px-2.5 py-1 rounded bg-amber-950 text-amber-400 border border-amber-800 font-semibold">
                Market Intelligence
              </span>
            </div>
            <p className="text-slate-400 text-sm mt-1">
              Scans all opponent rosters for high-surplus keeper values, win-now rentals, and buy-low candidates.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 text-xs font-medium transition"
            >
              ← Dashboard
            </Link>
            <Link
              href="/trade"
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md transition"
            >
              ⚖️ Trade Evaluator
            </Link>
          </div>
        </header>

        {/* Global Controls & Manager Filters */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">My Team:</span>
            <select
              value={selectedMyManager}
              onChange={(e) => setSelectedMyManager(e.target.value)}
              className="bg-slate-950 text-white font-bold text-sm rounded-lg px-3 py-1.5 border border-slate-700 focus:outline-none focus:border-cyan-500"
            >
              {teams.map((t) => (
                <option key={t.id} value={t.manager_name}>{t.manager_name}</option>
              ))}
            </select>

            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider ml-4">Filter Target Team:</span>
            <select
              value={selectedTargetManager}
              onChange={(e) => setSelectedTargetManager(e.target.value)}
              className="bg-slate-950 text-white font-bold text-sm rounded-lg px-3 py-1.5 border border-slate-700 focus:outline-none focus:border-cyan-500"
            >
              <option value="All">All Opponents (11 Teams)</option>
              {teams.filter(t => t.manager_name !== selectedMyManager).map((t) => (
                <option key={t.id} value={t.manager_name}>{t.manager_name}</option>
              ))}
            </select>
          </div>

          {/* Tab Switcher */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveTab('surplus')}
              className={`px-4 py-1.5 text-xs font-bold rounded-lg transition ${
                activeTab === 'surplus'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              💎 Keeper Surplus ({topSurplusTargets.length})
            </button>
            <button
              onClick={() => setActiveTab('rentals')}
              className={`px-4 py-1.5 text-xs font-bold rounded-lg transition ${
                activeTab === 'rentals'
                  ? 'bg-amber-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              🏆 Win-Now Rentals ({topRentals.length})
            </button>
            <button
              onClick={() => setActiveTab('buylow')}
              className={`px-4 py-1.5 text-xs font-bold rounded-lg transition ${
                activeTab === 'buylow'
                  ? 'bg-cyan-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              🎯 Buy-Low / Stashes ({topBuyLows.length})
            </button>
          </div>
        </section>

        {/* Master Radar Table */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-800/90 uppercase text-[11px] tracking-wider text-slate-400 border-b border-slate-700/60">
                <tr>
                  <th className="py-3.5 px-4">Player</th>
                  <th className="py-3.5 px-4">Pos</th>
                  <th className="py-3.5 px-4">Owner</th>
                  <th className="py-3.5 px-4">2027 Cost</th>
                  <th className="py-3.5 px-4">ROS 2026 ($)</th>
                  <th className="py-3.5 px-4 text-center">2027 Proj ADP</th>
                  <th className="py-3.5 px-4">Keeper Surplus ($)</th>
                  <th className="py-3.5 px-4">Total Trade Value ($)</th>
                  <th className="py-3.5 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {activeDisplayList.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-10 text-center text-slate-500 text-sm">
                      No matching targets found for the selected filter.
                    </td>
                  </tr>
                ) : (
                  activeDisplayList.map((row) => {
                    const hasPositiveSurplus = row.surplusEquity > 0;
                    return (
                      <tr key={row.id} className="transition-colors hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-semibold text-white">
                          {row.player?.full_name}
                          {row.player?.team && (
                            <span className="ml-2 text-xs font-normal text-slate-400">
                              ({row.player.team})
                            </span>
                          )}
                          {row.player?.injury_status && row.player.injury_status !== 'Healthy' && (
                            <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-amber-950 text-amber-400 border border-amber-800">
                              {row.player.injury_status}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-800 text-slate-300">
                            {row.player?.position}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-bold text-cyan-400">
                          {row.managerName}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-amber-400">
                          {row.isEligible ? `Round ${row.costRound}` : '—'}
                          {row.tenureYears === 1 && (
                            <span className="ml-1 text-[10px] text-amber-500 font-normal">(Y2 +1)</span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono font-semibold text-slate-200">
                          {formatCurrency(row.rosValue)}
                        </td>
                        <td className="py-3 px-4 font-mono text-center">
                          <span className="text-indigo-400 font-bold mr-1.5">
                            #{row.projAdp}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            ({getProjectedRound(row.projAdp)})
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono font-bold">
                          {row.isEligible ? (
                            hasPositiveSurplus ? (
                              <span className="text-emerald-400">
                                {formatCurrency(row.surplusEquity, true)}
                              </span>
                            ) : (
                              <span className="text-slate-500 font-normal">$0</span>
                            )
                          ) : (
                            <span className="text-rose-400 text-xs font-normal">
                              {row.ineligibilityReason}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono font-extrabold text-base text-cyan-400">
                          {formatCurrency(row.totalTradeValue)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Link
                            href={`/trade?managerA=${encodeURIComponent(selectedMyManager)}&managerB=${encodeURIComponent(row.managerName)}`}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-cyan-600 hover:text-white text-xs font-medium text-slate-300 transition"
                          >
                            Propose Trade →
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

      </div>
    </main>
  );
}
