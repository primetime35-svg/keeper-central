import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { KeeperSurplusBadge } from '@/components/KeeperSurplusBadge';
import { SyncEspnButton } from '@/components/SyncEspnButton';
import { calculatePickEquity, calculateRosTradeValue, getDampenedFppg , calculateKeeperSurplus} from '@/lib/valuationEngine';

interface RosterPlayer {
  id: string;
  draft_round: number;
  acquisition_type: string;
  keeper_years_accumulated: number;
  is_kept_year_2: boolean;
  player: {
    id: string;
    full_name: string;
    position: string;
    team: string | null;
    injury_status: string;
    injury_notes: string;
    projections: {
      season_fppg: number;
      projected_adp: number;
      gp: number;
      fpts: number;
    }[];
  };
}

interface TeamData {
  id: string;
  manager_name: string;
  team_name: string;
}

export const instant = false;

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

export default async function DashboardPage(props: {
  searchParams?: Promise<{ manager?: string }>;
}) {
  const searchParams = await props.searchParams;
  const currentManager = searchParams?.manager || 'Jim';

  const { data: teams } = await supabase
    .from('teams')
    .select('id, manager_name, team_name')
    .order('manager_name', { ascending: true });

  const activeTeam =
    teams?.find(
      (t) => t.manager_name.toLowerCase() === currentManager.toLowerCase()
    ) || teams?.[0];

  let rosterRows: RosterPlayer[] = [];
  if (activeTeam) {
    const { data: roster } = await supabase
      .from('rosters')
      .select(`
        id,
        draft_round,
        acquisition_type,
        keeper_years_accumulated,
        is_kept_year_2,
        player:players (
          id,
          full_name,
          position,
          team,
          injury_status,
          injury_notes,
          projections:player_projections (
            season_fppg,
            projected_adp,
            gp,
            fpts
          )
        )
      `)
      .eq('team_id', activeTeam.id);

    rosterRows = (roster as unknown as RosterPlayer[]) || [];
  }

  const evaluatedRoster = rosterRows.map((item) => {
    const proj = item.player?.projections?.[0] || {
      season_fppg: 0,
      projected_adp: 180,
      gp: 0,
      fpts: 0,
    };
    const originalRound = item.draft_round || 12;
    const tenureYears = item.keeper_years_accumulated || 0;
    const pos = item.player?.position || 'WR';

    const costRound = tenureYears === 1 ? Math.max(1, originalRound - 1) : originalRound;

    const isIneligibleRound = originalRound <= 2;
    const isOverTenure = tenureYears >= 2 || item.is_kept_year_2;
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

          const projectedAdpPick = proj.projected_adp || 180;
                  const keeperBreakdown = calculateKeeperSurplus({
        draftRound: originalRound,
        keeperYearsAccumulated: tenureYears,
        isKeptYear2: item.is_kept_year_2 || false,
        projectedAdp2027: projectedAdpPick,
        pos,
        age: 25,
      });
      if (item.player?.full_name?.includes('Goff')) {
        console.log('DEBUG GOFF BREAKDOWN:', keeperBreakdown);
      }
      const surplusEquity = keeperBreakdown.totalSurplus;

    const totalTradeValue = Math.round((rosValue + surplusEquity) * 100) / 100;

    return {
      ...item,
      proj,
      projectedAdpPick,
      originalRound,
      costRound,
      tenureYears,
      isEligible,
      ineligibilityReason: isIneligibleRound
        ? 'Rounds 1–2 Ineligible'
        : isOverTenure
        ? '2-Year Cap Reached'
        : null,
      rosValue,
      surplusEquity,
        keeperBreakdown,
      totalTradeValue,
    };
  });

  evaluatedRoster.sort((a, b) => b.totalTradeValue - a.totalTradeValue);

  const totalRosterRos = evaluatedRoster.reduce((acc, p) => acc + p.rosValue, 0);
  const totalRosterSurplus = evaluatedRoster.reduce((acc, p) => acc + p.surplusEquity, 0);
  const totalRosterTradeValue = totalRosterRos + totalRosterSurplus;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-3xl">🏈</span>
              <h1 className="text-3xl font-extrabold tracking-tight text-white">
                Keeper Central
              </h1>
              <span className="text-xs uppercase tracking-widest px-2.5 py-1 rounded bg-cyan-950 text-cyan-400 border border-cyan-800 font-semibold">
                Football Friends
              </span>
            </div>
            <p className="text-slate-400 text-sm mt-1">
              12-Team ESPN • 0.5 PPR • 1-QB Calibration • Year 1: Exact Cost • Year 2: +1 Rd Escalation
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <Link
              href="/waivers"
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md transition"
            >
              📋 Waivers
            </Link>
            <Link
              href="/radar"
              className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-md transition"
            >
              📡 Radar
            </Link>
              <SyncEspnButton />
            <Link
              href="/trade"
              className="px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md transition"
            >
              ⚖️ Trade Evaluator
            </Link>
            <Link
              href="/projections"
              className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition"
            >
              🔮 2027 ADP
            </Link>
          </div>
        </header>

        {/* Manager Selector Bar */}
        <section className="bg-slate-900/60 p-2 rounded-xl border border-slate-800">
          <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-thin">
            {teams?.map((t: TeamData) => {
              const isSelected =
                t.manager_name.toLowerCase() ===
                activeTeam?.manager_name.toLowerCase();
              return (
                <a
                  key={t.id}
                  href={`/?manager=${encodeURIComponent(t.manager_name)}`}
                  className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                    isSelected
                      ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/30 font-semibold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  {t.manager_name}
                </a>
              );
            })}
          </div>
        </section>

        {/* Team Snapshot Card */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">
              {activeTeam?.manager_name}'s Asset Valuation Board
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Ranked by Total Trade Value ($) • 1-QB market discount applied to QB surplus
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 font-mono text-xs">
            <div className="bg-slate-950 px-3 py-2 rounded-lg border border-slate-800">
              <span className="text-slate-400">Roster ROS Value: </span>
              <span className="text-cyan-400 font-bold">{formatCurrency(totalRosterRos)}</span>
            </div>
            <div className="bg-slate-950 px-3 py-2 rounded-lg border border-slate-800">
              <span className="text-slate-400">Total Keeper Surplus: </span>
              <span className="text-emerald-400 font-bold">{formatCurrency(totalRosterSurplus)}</span>
            </div>
            <div className="bg-cyan-950/60 px-3 py-2 rounded-lg border border-cyan-800">
              <span className="text-cyan-300">Total Asset Value: </span>
              <span className="text-white font-extrabold text-sm">{formatCurrency(totalRosterTradeValue)}</span>
            </div>
          </div>
        </div>

        {/* Master Valuation Table */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-800/90 uppercase text-[11px] tracking-wider text-slate-400 border-b border-slate-700/60">
                <tr>
                  <th className="py-3.5 px-4">Player</th>
                  <th className="py-3.5 px-4">Pos</th>
                  <th className="py-3.5 px-4">Tenure / Status</th>
                  <th className="py-3.5 px-4">2026 Acq</th>
                  <th className="py-3.5 px-4">2027 Cost</th>
                  <th className="py-3.5 px-4">ROS 2026 ($)</th>
                  <th className="py-3.5 px-4 text-center">PROJ ADP ('27 / '28)</th>
                  <th className="py-3.5 px-4">Keeper Surplus ($)</th>
                  <th className="py-3.5 px-4">Total Trade Value ($)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {evaluatedRoster.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-500 text-sm">
                      No rostered players mapped for this team yet.
                    </td>
                  </tr>
                ) : (
                  evaluatedRoster.map((row) => {
                    const hasPositiveSurplus = row.surplusEquity > 0;
                    return (
                      <tr key={row.id} className="transition-colors hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-semibold text-white">
                          {row.player?.full_name || 'Unknown Player'}
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
                        <td className="py-3 px-4 text-xs font-mono">
                          {row.tenureYears === 0 && (
                            <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                              Year 1 Option
                            </span>
                          )}
                          {row.tenureYears === 1 && (
                            <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 font-semibold">
                              Year 2 Final (+1 Rd)
                            </span>
                          )}
                          {row.tenureYears >= 2 && (
                            <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 font-bold">
                              Cap Reached (2y)
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-300">
                          {row.acquisition_type === 'FREE_AGENCY' ? (
                            <span className="text-slate-400">FA (Rd {row.originalRound})</span>
                          ) : (
                            `Round ${row.originalRound}`
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-amber-400">
                          {row.isEligible ? `Round ${row.costRound}` : '—'}
                        </td>
                        <td className="py-3 px-4 font-mono font-semibold text-slate-200">
                          {formatCurrency(row.rosValue)}
                        </td>

                        {/* PROJ ADP ('27 / '28) Column */}
                        <td className="py-2.5 px-4 font-mono text-xs">
                            <div className="flex flex-col gap-1 items-start">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-slate-500 font-sans uppercase font-bold">'27:</span>
                                <span className="text-cyan-400 font-bold">#{row.projectedAdpPick}</span>
                                <span className="text-[10px] text-slate-500">({getProjectedRound(row.projectedAdpPick)})</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-slate-500 font-sans uppercase font-bold">'28:</span>
                                {row.keeperBreakdown?.isEligible2028 ? (
                                  <>
                                    <span className="text-indigo-400 font-bold">
                                      #{row.keeperBreakdown.projectedAdp2028 || row.projectedAdpPick}
                                    </span>
                                    <span className="text-[10px] text-slate-500">
                                      ({getProjectedRound(row.keeperBreakdown.projectedAdp2028 || row.projectedAdpPick)})
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-slate-600 text-[10px] italic">
                                    {row.tenureYears >= 2 || row.is_kept_year_2 ? 'Cap Reached' : 'Tenure Cap'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>

                        <td className="py-3 px-4 font-mono font-bold">
                            {!row.isEligible ? (
                              <span className="text-rose-400 text-xs font-normal">
                                {row.ineligibilityReason}
                              </span>
                            ) : hasPositiveSurplus && row.keeperBreakdown ? (
                              <KeeperSurplusBadge breakdown={row.keeperBreakdown} />
                            ) : (
                              <span className="text-slate-500 font-normal text-xs"><td className="py-3 px-4 font-mono font-bold">
                          {row.isEligible ? (
                            hasPositiveSurplus ? (
                              <span className="text-emerald-400">
                                {formatCurrency(row.surplusEquity,
        keeperBreakdown, true)}
                              </span>
                            ) : (
                              <span className="text-slate-500 font-normal">$0</span>
                            )
                          ) : (
                            <span className="text-rose-400 text-xs font-normal">
                              {row.ineligibilityReason}
                            </span>
                          )}
                        </td></span>
                            )}
                          </td>
                        <td className="py-3 px-4 font-mono font-extrabold text-base text-cyan-400">
                          {formatCurrency(row.totalTradeValue)}
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











