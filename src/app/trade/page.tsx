'use client';
import { KeeperSurplusBadge } from '@/components/KeeperSurplusBadge';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { calculatePickEquity, calculateRosTradeValue, getDampenedFppg , calculateKeeperSurplus} from '@/lib/valuationEngine';
import { useFreezeDeadline } from '@/hooks/useFreezeDeadline';

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

export default function TradeEvaluatorPage() {
  const { isFrozen, formattedDeadline } = useFreezeDeadline();

  const [teams, setTeams] = useState<TeamData[]>([]);
  const [rosterData, setRosterData] = useState<RosterItem[]>([]);
  const [managerA, setManagerA] = useState<string>('Jim');
  const [managerB, setManagerB] = useState<string>('John');

  const [selectedPlayersA, setSelectedPlayersA] = useState<string[]>([]);
  const [selectedPlayersB, setSelectedPlayersB] = useState<string[]>([]);
  const [selectedPicksA, setSelectedPicksA] = useState<number[]>([]);
  const [selectedPicksB, setSelectedPicksB] = useState<number[]>([]);
  const [allowPickTrading, setAllowPickTrading] = useState<boolean>(false);

  useEffect(() => {
    async function loadData() {
      const { data: teamsData } = await supabase
        .from('teams')
        .select('id, manager_name, team_name')
        .order('manager_name', { ascending: true });

      if (teamsData) {
        setTeams(teamsData);
        if (teamsData.length >= 2) {
          // If query params passed managerA or managerB
          const urlParams = new URLSearchParams(window.location.search);
          const qmA = urlParams.get('managerA');
          const qmB = urlParams.get('managerB');

          if (qmA && teamsData.some(t => t.manager_name === qmA)) {
            setManagerA(qmA);
          } else {
            setManagerA(teamsData[0].manager_name);
          }

          if (qmB && teamsData.some(t => t.manager_name === qmB)) {
            setManagerB(qmB);
          } else {
            setManagerB(teamsData[1].manager_name);
          }
        }
      }

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

  // Filter rosters
  const rosterA = useMemo(() => {
    return rosterData.filter((r) => r.team?.manager_name === managerA);
  }, [rosterData, managerA]);

  const rosterB = useMemo(() => {
    return rosterData.filter((r) => r.team?.manager_name === managerB);
  }, [rosterData, managerB]);

  // Valuation helper for an individual item
  function evaluateItem(item: RosterItem) {
    const proj = item.player?.projections?.[0] || { season_fppg: 0, projected_adp: 180, gp: 0, fpts: 0 };
    const originalRound = item.draft_round || 12;
    const playerObj = item.player;
      const tenureYears = (playerObj?.keeper_years_accumulated != null && playerObj.keeper_years_accumulated > 0)
        ? playerObj.keeper_years_accumulated
        : (item.keeper_years_accumulated || 0);
      const isKeptYear2 = Boolean(playerObj?.is_kept_year_2 || item.is_kept_year_2);
    const pos = item.player?.position || 'WR';

    // Year 1 keeps at draft round; Year 2 keeps escalate 1 round
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

    return {
      rosValue,
      surplusEquity,
      totalTradeValue,
      costRound,
      isEligible,
      ineligibilityReason: isIneligibleRound ? 'Rounds 1–2 Ineligible' : isOverTenure ? '2-Year Cap Reached' : null,
      projAdp
    };
  }

  // Sorted list for clean scannability
  const sortedRosterA = useMemo(() => {
    return rosterA.map((item) => ({ item, val: evaluateItem(item) })).sort((a, b) => b.val.totalTradeValue - a.val.totalTradeValue);
  }, [rosterA]);

  const sortedRosterB = useMemo(() => {
    return rosterB.map((item) => ({ item, val: evaluateItem(item) })).sort((a, b) => b.val.totalTradeValue - a.val.totalTradeValue);
  }, [rosterB]);

  // Aggregate selected trade values
  const sideAItems = sortedRosterA.filter((x) => selectedPlayersA.includes(x.item.id));
  const sideBItems = sortedRosterB.filter((x) => selectedPlayersB.includes(x.item.id));

  const sideARosTotal = sideAItems.reduce((acc, curr) => acc + curr.val.rosValue, 0);
  const sideASurplusTotal = sideAItems.reduce((acc, curr) => acc + curr.val.surplusEquity, 0);
  const sideAPicksTotal = selectedPicksA.reduce((acc, rd) => acc + calculatePickEquity(getCostPickNumber(rd)), 0);
  const totalSideA = sideARosTotal + sideASurplusTotal + sideAPicksTotal;

  const sideBRosTotal = sideBItems.reduce((acc, curr) => acc + curr.val.rosValue, 0);
  const sideBSurplusTotal = sideBItems.reduce((acc, curr) => acc + curr.val.surplusEquity, 0);
  const sideBPicksTotal = selectedPicksB.reduce((acc, rd) => acc + calculatePickEquity(getCostPickNumber(rd)), 0);
  const totalSideB = sideBRosTotal + sideBSurplusTotal + sideBPicksTotal;

  // Differentials
  const netTotalDiff = Math.round((totalSideA - totalSideB) * 100) / 100;
  const netRosDiff = Math.round((sideARosTotal - sideBRosTotal) * 100) / 100;
  const netSurplusDiff = Math.round((sideASurplusTotal - sideBSurplusTotal) * 100) / 100;

  function togglePlayerA(id: string) {
    setSelectedPlayersA((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function togglePlayerB(id: string) {
    setSelectedPlayersB((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function togglePickA(round: number) {
    setSelectedPicksA((prev) => (prev.includes(round) ? prev.filter((r) => r !== round) : [...prev, round]));
  }

  function togglePickB(round: number) {
    setSelectedPicksB((prev) => (prev.includes(round) ? prev.filter((r) => r !== round) : [...prev, round]));
  }

  // Verdict evaluation
  const absDiff = Math.abs(netTotalDiff);
  let verdictColor = 'text-emerald-400 border-emerald-800 bg-emerald-950/60';
  let verdictLabel = 'Even Trade';

  // If Side A sends more value than Side B, Team B is receiving the better package
  const favoredManager = netTotalDiff > 0 ? managerB : managerA;

  if (absDiff > 2.5) {
    verdictColor = absDiff > 6.0
      ? 'text-rose-400 border-rose-800 bg-rose-950/60'
      : 'text-amber-400 border-amber-800 bg-amber-950/60';
    verdictLabel = `This trade favors ${favoredManager}`;
  }
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">

        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-3xl">⚖️</span>
              <h1 className="text-3xl font-extrabold tracking-tight text-white">
                Trade Evaluator
              </h1>
              {isFrozen ? (
                <span className="text-xs uppercase tracking-widest px-2.5 py-1 rounded bg-rose-950 text-rose-400 border border-rose-800 font-semibold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                  Market Frozen (Simulation Only)
                </span>
              ) : (
                <span className="text-xs uppercase tracking-widest px-2.5 py-1 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-semibold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Market Active
                </span>
              )}
            </div>
            <p className="text-slate-400 text-sm mt-1">
              Evaluates ROS Production + 2027 Keeper Surplus + Future Draft Pick Equity
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <Link
              href="/"
              className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 text-xs font-medium transition"
            >
              ← Dashboard
            </Link>
            <Link
              href="/radar"
              className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 text-xs font-medium transition"
            >
              📡 Radar
            </Link>
            <Link
              href="/projections"
              className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition"
            >
              🔮 2027 ADP
            </Link>
          </div>
        </header>

        {/* Frozen Mode Banner if active */}
        {isFrozen && (
          <div className="bg-rose-950/40 border border-rose-800/80 rounded-xl p-4 flex items-center justify-between text-xs text-rose-300">
            <div className="flex items-center gap-2">
              <span className="text-lg">🔒</span>
              <div>
                <span className="font-bold text-rose-200">Post-Deadline Simulation Mode:</span> The official freeze deadline ({formattedDeadline}) has passed. Trades evaluated here are for projection and simulation purposes only and cannot alter locked keeper rights.
              </div>
            </div>
          </div>
        )}

        {/* Verdict Banner */}
        <section className={`border rounded-2xl p-6 shadow-2xl flex flex-col md:flex-row justify-between items-center gap-6 ${verdictColor}`}>
          <div>
            <div className="text-xs font-mono uppercase tracking-wider opacity-80">Package Evaluation</div>
            <div className="text-2xl font-black tracking-tight mt-0.5">{verdictLabel}</div>
            <div className="text-xs mt-1 opacity-90">
              Net Value Difference: <span className="font-mono font-bold">{formatCurrency(absDiff)}</span>
              {' • '}
              ROS Gap: <span className="font-mono">{formatCurrency(netRosDiff, true)}</span>
              {' • '}
              Keeper Gap: <span className="font-mono">{formatCurrency(netSurplusDiff, true)}</span>
            </div>
          </div>

          <div className="flex items-center gap-8 font-mono">
            <div className="text-right">
              <div className="text-xs text-slate-400">{managerA} Total</div>
              <div className="text-2xl font-extrabold text-cyan-400">{formatCurrency(totalSideA)}</div>
            </div>
            <div className="text-slate-500 text-xl font-bold">VS</div>
            <div className="text-left">
              <div className="text-xs text-slate-400">{managerB} Total</div>
              <div className="text-2xl font-extrabold text-cyan-400">{formatCurrency(totalSideB)}</div>
            </div>
          </div>
        </section>

        {/* Trade Matrix Sides */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Side A */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase font-bold text-slate-400">Team A:</span>
                <select
                  value={managerA}
                  onChange={(e) => {
                    setManagerA(e.target.value);
                    setSelectedPlayersA([]);
                  }}
                  className="bg-slate-950 text-white font-bold text-sm rounded-lg px-2.5 py-1 border border-slate-700 focus:outline-none focus:border-cyan-500"
                >
                  {teams.map((t) => (
                    <option key={t.id} value={t.manager_name}>{t.manager_name}</option>
                  ))}
                </select>
              </div>
              <div className="font-mono text-xs font-semibold text-cyan-400">
                Selected: {sideAItems.length} Players, {selectedPicksA.length} Picks
              </div>
            </div>

            {/* Pick Selector if enabled */}
            {allowPickTrading && (
              <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                <span className="text-[11px] uppercase font-mono text-slate-400 block mb-2">2027 Draft Picks</span>
                <div className="grid grid-cols-6 gap-1.5">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((rd) => {
                    const isSel = selectedPicksA.includes(rd);
                    return (
                      <button
                        key={rd}
                        type="button"
                        onClick={() => togglePickA(rd)}
                        className={`py-1 text-xs font-mono rounded border transition ${
                          isSel
                            ? 'bg-cyan-600 border-cyan-500 text-white font-bold'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        Rd {rd}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Players List */}
            <div className="space-y-2">
              {sortedRosterA.map(({ item, val }) => {
                const isSelected = selectedPlayersA.includes(item.id);
                return (
                  <div
                    key={item.id}
                    onClick={() => togglePlayerA(item.id)}
                    className={`p-3 rounded-xl border cursor-pointer transition flex items-center justify-between ${
                      isSelected
                        ? 'bg-cyan-950/50 border-cyan-500/80 text-white shadow-md'
                        : 'bg-slate-950/40 border-slate-800/80 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${
                        isSelected ? 'bg-cyan-500 border-cyan-400 text-black font-bold' : 'border-slate-600'
                      }`}>
                        {isSelected && '✓'}
                      </div>
                      <div>
                        <div className="font-bold text-sm flex items-center gap-1.5">
                          <span>{item.player?.full_name}</span>
                          <span className="text-xs px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-normal">
                            {item.player?.position}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {val.isEligible ? (
                            <span>Cost: <strong className="text-amber-400">Rd {val.costRound}</strong></span>
                          ) : (
                            <span className="text-rose-400">{val.ineligibilityReason}</span>
                          )}
                          {' • '}
                          <span>2027 Proj: #{val.projAdp} ({getProjectedRound(val.projAdp)})</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right font-mono text-xs">
                      <div className="font-extrabold text-cyan-400 text-sm">
                        {formatCurrency(val.totalTradeValue)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        ROS {formatCurrency(val.rosValue)} | KP {formatCurrency(val.surplusEquity, true)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Side B */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase font-bold text-slate-400">Team B:</span>
                <select
                  value={managerB}
                  onChange={(e) => {
                    setManagerB(e.target.value);
                    setSelectedPlayersB([]);
                  }}
                  className="bg-slate-950 text-white font-bold text-sm rounded-lg px-2.5 py-1 border border-slate-700 focus:outline-none focus:border-cyan-500"
                >
                  {teams.map((t) => (
                    <option key={t.id} value={t.manager_name}>{t.manager_name}</option>
                  ))}
                </select>
              </div>
              <div className="font-mono text-xs font-semibold text-cyan-400">
                Selected: {sideBItems.length} Players, {selectedPicksB.length} Picks
              </div>
            </div>

            {/* Pick Selector if enabled */}
            {allowPickTrading && (
              <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                <span className="text-[11px] uppercase font-mono text-slate-400 block mb-2">2027 Draft Picks</span>
                <div className="grid grid-cols-6 gap-1.5">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((rd) => {
                    const isSel = selectedPicksB.includes(rd);
                    return (
                      <button
                        key={rd}
                        type="button"
                        onClick={() => togglePickB(rd)}
                        className={`py-1 text-xs font-mono rounded border transition ${
                          isSel
                            ? 'bg-cyan-600 border-cyan-500 text-white font-bold'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        Rd {rd}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Players List */}
            <div className="space-y-2">
              {sortedRosterB.map(({ item, val }) => {
                const isSelected = selectedPlayersB.includes(item.id);
                return (
                  <div
                    key={item.id}
                    onClick={() => togglePlayerB(item.id)}
                    className={`p-3 rounded-xl border cursor-pointer transition flex items-center justify-between ${
                      isSelected
                        ? 'bg-cyan-950/50 border-cyan-500/80 text-white shadow-md'
                        : 'bg-slate-950/40 border-slate-800/80 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${
                        isSelected ? 'bg-cyan-500 border-cyan-400 text-black font-bold' : 'border-slate-600'
                      }`}>
                        {isSelected && '✓'}
                      </div>
                      <div>
                        <div className="font-bold text-sm flex items-center gap-1.5">
                          <span>{item.player?.full_name}</span>
                          <span className="text-xs px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-normal">
                            {item.player?.position}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {val.isEligible ? (
                            <span>Cost: <strong className="text-amber-400">Rd {val.costRound}</strong></span>
                          ) : (
                            <span className="text-rose-400">{val.ineligibilityReason}</span>
                          )}
                          {' • '}
                          <span>2027 Proj: #{val.projAdp} ({getProjectedRound(val.projAdp)})</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right font-mono text-xs">
                      <div className="font-extrabold text-cyan-400 text-sm">
                        {formatCurrency(val.totalTradeValue)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        ROS {formatCurrency(val.rosValue)} | KP {formatCurrency(val.surplusEquity, true)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

      </div>
    </main>
  );
}






