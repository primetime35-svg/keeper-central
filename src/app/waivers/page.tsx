import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { calculatePickEquity, calculateRosTradeValue } from '@/lib/valuationEngine';
import { lookupDraftEntry } from '@/lib/draftBoard';

interface UnownedPlayer {
  id: string;
  full_name: string;
  position: string;
  team: string | null;
  injury_status: string;
  keeper_years_accumulated: number | null;
  is_kept_year_2: boolean | null;
  projections: {
    season_fppg: number;
    projected_adp: number;
  }[];
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

export default async function WaiverWirePage(props: {
  searchParams?: Promise<{ view?: string; pos?: string }>;
}) {
  const searchParams = await props.searchParams;
  const currentView = searchParams?.view || 'both';
  const currentPos = searchParams?.pos || 'ALL';

  // 1. Fetch currently rostered player IDs across the league
  const { data: rosteredRows } = await supabase
    .from('rosters')
    .select('player_id');

  const rosteredPlayerIds = new Set(
    (rosteredRows || []).map((r) => String(r.player_id).trim())
  );

  // 2. Fetch all players with projections and tenure markers
  const { data: allPlayers } = await supabase
    .from('players')
    .select(`
      id,
      full_name,
      position,
      team,
      injury_status,
      keeper_years_accumulated,
      is_kept_year_2,
      projections:player_projections (
        season_fppg,
        projected_adp
      )
    `);

  // 3. Filter for unowned players only
  const unownedRaw = (allPlayers as unknown as UnownedPlayer[]) || [];
  const unowned = unownedRaw.filter((p) => !rosteredPlayerIds.has(String(p.id).trim()));

  const evaluatedWaivers = unowned.map((p) => {
    const proj = p.projections?.[0] || { season_fppg: 0, projected_adp: 180 };

    // Direct lookup against the official 192-pick draft board
    const draftEntry = lookupDraftEntry(p.full_name);
    const wasDrafted = Boolean(draftEntry);
    const originalRound = wasDrafted ? draftEntry!.round : 12;
    const tenureYears = p.keeper_years_accumulated || 0;

    // Rules:
    // Year 1 keeps cost exact round; Year 2 keeps escalate 1 round
    const costRound = tenureYears === 1 ? Math.max(1, originalRound - 1) : originalRound;
    const isYear2Cap = tenureYears >= 2 || Boolean(p.is_kept_year_2);
    const isIneligibleRound = originalRound <= 2;
    const isEligible = !isIneligibleRound && !isYear2Cap;

    const rosValue = calculateRosTradeValue(
      p.position || 'WR',
      proj.season_fppg || 0,
      proj.projected_adp || 180,
      p.injury_status
    );

    const costEquity = calculatePickEquity(getCostPickNumber(costRound));
    const projEquity = calculatePickEquity(proj.projected_adp || 180);
    const rawSurplus = projEquity - costEquity;
    const surplusEquity = isEligible && rawSurplus > 0 ? Math.round(rawSurplus * 100) / 100 : 0;
    const totalTradeValue = Math.round((rosValue + surplusEquity) * 100) / 100;

    return {
      ...p,
      proj,
      wasDrafted,
      draftEntry,
      originalRound,
      costRound,
      tenureYears,
      isEligible,
      ineligibilityReason: isIneligibleRound
        ? 'Rounds 1–2 Ineligible'
        : isYear2Cap
        ? '2-Year Cap Reached'
        : null,
      rosValue,
      surplusEquity,
      totalTradeValue,
    };
  });

  const filteredList = evaluatedWaivers.filter((p) => {
    if (currentPos === 'ALL') return true;
    return (p.position || '').toUpperCase() === currentPos.toUpperCase();
  });

  const sortedByKeeper = [...filteredList]
    .filter((p) => p.isEligible && p.surplusEquity > 0)
    .sort((a, b) => b.surplusEquity - a.surplusEquity)
    .slice(0, 50);

  const sortedByTotal = [...filteredList]
    .sort((a, b) => b.totalTradeValue - a.totalTradeValue)
    .slice(0, 50);

  const positions = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'];

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Navigation & Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-3xl">📋</span>
              <h1 className="text-3xl font-extrabold tracking-tight text-white">Waiver Wire Valuations</h1>
              <span className="text-xs uppercase tracking-widest px-2.5 py-1 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-semibold">
                Available Free Agents
              </span>
            </div>
            <p className="text-slate-400 text-sm mt-1">
              Synchronized with 2026 Master Draft Board: dropped drafted players retain draft cost & ineligibility markers.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <Link
              href="/"
              className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 text-xs font-medium transition"
            >
              ← Keeper Central
            </Link>
            <Link
              href="/radar"
              className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-md transition"
            >
              📡 Radar
            </Link>
            <Link
              href="/trade"
              className="px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md transition"
            >
              ⚖️ Trade
            </Link>
            <Link href="/projections" className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition">🔮 2027 ADP</Link>
          </div>
        </header>

        {/* Filter Bar */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mr-2">Pos:</span>
            {positions.map((pos) => {
              const isActive = currentPos.toUpperCase() === pos;
              return (
                <Link
                  key={pos}
                  href={`/waivers?view=${currentView}&pos=${pos}`}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition ${
                    isActive
                      ? 'bg-cyan-600 text-white shadow'
                      : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-750'
                  }`}
                >
                  {pos}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 w-full sm:w-auto justify-center">
            <Link
              href={`/waivers?view=both&pos=${currentPos}`}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                currentView === 'both' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Side-by-Side View
            </Link>
            <Link
              href={`/waivers?view=keeper&pos=${currentPos}`}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                currentView === 'keeper' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Top Keeper Value
            </Link>
            <Link
              href={`/waivers?view=total&pos=${currentPos}`}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                currentView === 'total' ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Top Total Value
            </Link>
          </div>
        </section>

        {/* View: Keeper Value Full Table */}
        {currentView === 'keeper' && (
          <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-slate-800">
              <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                <span>💎</span> Best Free Agent Keeper Targets
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Eligible players ranked by 2027 keeper surplus (Draft board pedigree enforced)
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300"><thead className="bg-slate-800/90 uppercase text-[11px] tracking-wider text-slate-400 border-b border-slate-700/60"><tr><th className="py-3 px-4">Rank</th><th className="py-3 px-4">Player</th><th className="py-3 px-4">Pos</th><th className="py-3 px-4">Pedigree</th><th className="py-3 px-4">2027 Cost</th><th className="py-3 px-4">2027 Proj ADP</th><th className="py-3 px-4">ROS 2026 ($)</th><th className="py-3 px-4">Keeper Surplus ($)</th><th className="py-3 px-4">Total Value ($)</th></tr></thead><tbody className="divide-y divide-slate-800/80">{sortedByKeeper.length === 0 ? (<tr><td colSpan={9} className="py-8 text-center text-slate-500 text-sm">No available players with positive keeper surplus at this position.</td></tr>) : (sortedByKeeper.map((p, idx) => (<tr key={p.id} className="hover:bg-slate-800/40 transition"><td className="py-3 px-4 font-mono text-xs text-slate-500">#{idx + 1}</td><td className="py-3 px-4 font-semibold text-white">{p.full_name}{p.team && <span className="ml-2 text-xs font-normal text-slate-400">({p.team})</span>}</td><td className="py-3 px-4 font-mono text-xs">{p.position}</td><td className="py-3 px-4 text-xs font-mono">{p.wasDrafted ? (<span className="text-amber-400">Drafted (Rd {p.originalRound} by {p.draftEntry?.manager})</span>) : (<span className="text-slate-400">Undrafted FA</span>)}</td><td className="py-3 px-4 font-mono font-bold text-amber-400">Round {p.costRound}</td><td className="py-3 px-4 font-mono text-cyan-400">{p.proj.projected_adp}</td><td className="py-3 px-4 font-mono text-slate-300">{formatCurrency(p.rosValue)}</td><td className="py-3 px-4 font-mono font-bold text-emerald-400 text-base">{formatCurrency(p.surplusEquity, true)}</td><td className="py-3 px-4 font-mono font-bold text-slate-200">{formatCurrency(p.totalTradeValue)}</td></tr>)))}</tbody></table>
            </div>
          </section>
        )}

        {/* View: Total Value Full Table */}
        {currentView === 'total' && (
          <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-slate-800">
              <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                <span>🔥</span> Best Overall Free Agent Values
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Ranked by Total Value (ROS scoring + keeper surplus, respecting draft history)
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300"><thead className="bg-slate-800/90 uppercase text-[11px] tracking-wider text-slate-400 border-b border-slate-700/60"><tr><th className="py-3 px-4">Rank</th><th className="py-3 px-4">Player</th><th className="py-3 px-4">Pos</th><th className="py-3 px-4">Pedigree / Status</th><th className="py-3 px-4">2027 Cost</th><th className="py-3 px-4">ROS 2026 ($)</th><th className="py-3 px-4">Keeper Surplus ($)</th><th className="py-3 px-4">Total Value ($)</th></tr></thead><tbody className="divide-y divide-slate-800/80">{sortedByTotal.length === 0 ? (<tr><td colSpan={8} className="py-8 text-center text-slate-500 text-sm">No unowned players found.</td></tr>) : (sortedByTotal.map((p, idx) => (<tr key={p.id} className="hover:bg-slate-800/40 transition"><td className="py-3 px-4 font-mono text-xs text-slate-500">#{idx + 1}</td><td className="py-3 px-4 font-semibold text-white">{p.full_name}{p.team && <span className="ml-2 text-xs font-normal text-slate-400">({p.team})</span>}</td><td className="py-3 px-4 font-mono text-xs">{p.position}</td><td className="py-3 px-4 text-xs font-mono">{!p.isEligible ? (<span className="text-rose-400 font-semibold">{p.ineligibilityReason} (Rd {p.originalRound})</span>) : p.wasDrafted ? (<span className="text-amber-400">Drafted (Rd {p.originalRound})</span>) : (<span className="text-slate-400">Undrafted FA</span>)}</td><td className="py-3 px-4 font-mono font-bold text-amber-400">{p.isEligible ? `Round ${p.costRound}` : '—'}</td><td className="py-3 px-4 font-mono text-slate-300">{formatCurrency(p.rosValue)}</td><td className="py-3 px-4 font-mono font-bold">{p.isEligible && p.surplusEquity > 0 ? (<span className="text-emerald-400">{formatCurrency(p.surplusEquity, true)}</span>) : (<span className="text-slate-500 font-normal">$0</span>)}</td><td className="py-3 px-4 font-mono font-extrabold text-cyan-400 text-base">{formatCurrency(p.totalTradeValue)}</td></tr>)))}</tbody></table>
            </div>
          </section>
        )}

        {/* View: Side-by-Side Dual Lists */}
        {currentView === 'both' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            
            {/* Left: Top Keeper Values */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
              <div className="p-4 border-b border-slate-800 bg-emerald-950/20 flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-emerald-400 text-base flex items-center gap-2">
                    <span>💎</span> Top 25 Keeper Surplus Values
                  </h3>
                  <p className="text-[11px] text-slate-400">Draft pedigree verified: dropped round 1-2 picks are excluded</p>
                </div>
                <span className="text-xs font-mono text-emerald-400 font-semibold px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800">
                  Keeper Equity
                </span>
              </div>
              <div className="divide-y divide-slate-800/80">
                {sortedByKeeper.slice(0, 25).map((p, idx) => (
                  <div key={p.id} className="p-3.5 hover:bg-slate-800/40 transition flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-slate-500 w-5">#{idx + 1}</span>
                      <div>
                        <div className="text-sm font-semibold text-white">
                          {p.full_name} <span className="text-xs font-normal text-slate-400">({p.position} - {p.team || 'FA'})</span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          Cost: Rd {p.costRound} ({p.wasDrafted ? `Drafted Rd ${p.originalRound}` : 'Undrafted'}) • ADP {p.proj.projected_adp}
                        </div>
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      <div className="text-sm font-bold text-emerald-400">
                        {formatCurrency(p.surplusEquity, true)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Total {formatCurrency(p.totalTradeValue)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Top Total Values */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
              <div className="p-4 border-b border-slate-800 bg-cyan-950/20 flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-cyan-400 text-base flex items-center gap-2">
                    <span>🔥</span> Top 25 Total Trade Values
                  </h3>
                  <p className="text-[11px] text-slate-400">Immediate ROS points + eligible keeper surplus</p>
                </div>
                <span className="text-xs font-mono text-cyan-400 font-semibold px-2 py-0.5 rounded bg-cyan-950 border border-cyan-800">
                  Total Asset Worth
                </span>
              </div>
              <div className="divide-y divide-slate-800/80">
                {sortedByTotal.slice(0, 25).map((p, idx) => (
                  <div key={p.id} className="p-3.5 hover:bg-slate-800/40 transition flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-slate-500 w-5">#{idx + 1}</span>
                      <div>
                        <div className="text-sm font-semibold text-white">
                          {p.full_name} <span className="text-xs font-normal text-slate-400">({p.position} - {p.team || 'FA'})</span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          ROS {formatCurrency(p.rosValue)} • Keeper: {p.isEligible ? (p.surplusEquity > 0 ? formatCurrency(p.surplusEquity, true) : '$0') : <span className="text-rose-400">Ineligible (Rd {p.originalRound})</span>}
                        </div>
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      <div className="text-sm font-bold text-cyan-400">
                        {formatCurrency(p.totalTradeValue)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {p.injury_status && p.injury_status !== 'Healthy' ? p.injury_status : 'Available'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

      </div>
    </main>
  );
}

