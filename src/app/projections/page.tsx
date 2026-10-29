import Link from 'next/link';
import { supabase } from '@/lib/supabase';

interface ProjectionRow {
  id: string;
  season_fppg: number;
  projected_adp: number;
  expert_adp: number | null;
  fpts: number | null;
  gp: number | null;
  trade_fppg: number | null;
  player: {
    id: string;
    full_name: string;
    position: string;
    team: string | null;
    age: number | null;
    injury_status: string | null;
    original_draft_round: number | null;
  };
}

export const instant = false;

function getProjectedRound(adp: number): string {
  if (adp <= 0 || adp > 192) return 'Undrafted (17+)';
  const round = Math.ceil(adp / 12);
  const pickInRound = ((adp - 1) % 12) + 1;
  return `Rd ${round}.${pickInRound.toString().padStart(2, '0')}`;
}

export default async function ProjectionsPage(props: {
  searchParams?: Promise<{ pos?: string; sort?: string }>;
}) {
  const searchParams = await props.searchParams;
  const currentPos = searchParams?.pos || 'ALL';
  const currentSort = searchParams?.sort || 'adp';

  const { data: rawData } = await supabase
    .from('player_projections')
    .select(`
      id,
      season_fppg,
      projected_adp,
      expert_adp,
      fpts,
      gp,
      trade_fppg,
      player:players (
        id,
        full_name,
        position,
        team,
        age,
        injury_status,
        original_draft_round
      )
    `);

  const list = (rawData as unknown as ProjectionRow[]) || [];

  const processed = list
    .filter((item) => item.player && item.player.full_name)
    .map((item) => {
      const p = item.player;
      const gp = item.gp || 0;
      const fpts = item.fpts || 0;
      const rawFppg = gp > 0 && fpts > 0 ? Math.round((fpts / gp) * 100) / 100 : item.season_fppg || 0;
      const preAdp = item.expert_adp && item.expert_adp > 0
        ? item.expert_adp
        : (p.original_draft_round ? Math.max(1, (p.original_draft_round - 1) * 12 + 6) : 180);
      
      const projAdp = item.projected_adp || 180;
      const adpDelta = preAdp - projAdp;

      const injury = (p.injury_status || '').toLowerCase();
      const isSeasonEnding = injury === 'ir' || injury.includes('season') || injury.includes('pup-r');
      const isBounceBack = isSeasonEnding && (p.age || 24) <= 26 && preAdp <= 48;

      // Adjustments tag
      const adjustments: string[] = [];
      if (isBounceBack) {
        adjustments.push('🌟 Young Bounce-Back');
      }
      if (p.position === 'RB' && (p.age || 0) >= 28) {
        adjustments.push('RB Age Cliff (-15%)');
      } else if ((p.position === 'WR' || p.position === 'TE') && (p.age || 0) >= 31) {
        adjustments.push('Receiver Cliff (-12%)');
      } else if (p.position === 'QB' && (p.age || 0) >= 35) {
        adjustments.push('QB Veteran (-8%)');
      }

      const inSeasonWeightPct = isBounceBack ? 85 : (gp >= 3 ? 75 : Math.round((gp / 3.0) * 75));
      const preWeightPct = 100 - inSeasonWeightPct;

      return {
        ...item,
        rawFppg,
        preAdp,
        projAdp,
        adpDelta,
        isBounceBack,
        adjustments: adjustments.length > 0 ? adjustments : ['None'],
        inSeasonWeightPct,
        preWeightPct,
      };
    });

  const filtered = processed.filter((item) => {
    if (currentPos === 'ALL') return true;
    return (item.player.position || '').toUpperCase() === currentPos.toUpperCase();
  });

  filtered.sort((a, b) => {
    if (currentSort === 'fppg') return b.rawFppg - a.rawFppg;
    if (currentSort === 'change') return b.adpDelta - a.adpDelta;
    return a.projAdp - b.projAdp;
  });

  const positions = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'];

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-3xl">🔮</span>
              <h1 className="text-3xl font-extrabold tracking-tight text-white">
                2027 Projected ADP Board
              </h1>
              <span className="text-xs uppercase tracking-widest px-2.5 py-1 rounded bg-indigo-950 text-indigo-400 border border-indigo-800 font-semibold">
                Bayesian Model + Rookie Slots
              </span>
            </div>
            <p className="text-slate-400 text-sm mt-1">
              75% In-Season Scoring • 25% Baseline Anchor • Age Cliffs • Young Stud Bounce-Back • Rookie Class Displacement
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
            <Link
              href="/trade"
              className="px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md transition"
            >
              ⚖️ Trade
            </Link>
          </div>
        </header>

        {/* Controls Bar */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mr-2">Pos:</span>
            {positions.map((pos) => {
              const isActive = currentPos.toUpperCase() === pos;
              return (
                <Link
                  key={pos}
                  href={`/projections?pos=${pos}&sort=${currentSort}`}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow'
                      : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-750'
                  }`}
                >
                  {pos}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800 w-full md:w-auto justify-center text-xs">
            <span className="text-slate-400 uppercase tracking-wider text-[11px] font-semibold mr-1">Sort:</span>
            <Link
              href={`/projections?pos=${currentPos}&sort=adp`}
              className={`px-3 py-1 rounded-lg transition font-medium ${
                currentSort === 'adp' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Projected ADP
            </Link>
            <Link
              href={`/projections?pos=${currentPos}&sort=fppg`}
              className={`px-3 py-1 rounded-lg transition font-medium ${
                currentSort === 'fppg' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Season FPPG
            </Link>
            <Link
              href={`/projections?pos=${currentPos}&sort=change`}
              className={`px-3 py-1 rounded-lg transition font-medium ${
                currentSort === 'change' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Biggest Risers
            </Link>
          </div>
        </section>

        {/* Master Projections Table */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-800/90 uppercase text-[11px] tracking-wider text-slate-400 border-b border-slate-700/60">
                <tr>
                  <th className="py-3.5 px-4">Rank</th>
                  <th className="py-3.5 px-4">Player</th>
                  <th className="py-3.5 px-4">Pos</th>
                  <th className="py-3.5 px-4">GP</th>
                  <th className="py-3.5 px-4">2026 FPPG</th>
                  <th className="py-3.5 px-4">Baseline ADP</th>
                  <th className="py-3.5 px-4">Blend Ratio</th>
                  <th className="py-3.5 px-4">Adjustments</th>
                  <th className="py-3.5 px-4">2027 Proj ADP</th>
                  <th className="py-3.5 px-4">Proj Round</th>
                  <th className="py-3.5 px-4">Movement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-8 text-center text-slate-500 text-sm">
                      No player projections found matching criteria.
                    </td>
                  </tr>
                ) : (
                  filtered.map((row, idx) => {
                    const isRiser = row.adpDelta > 0;
                    const isFaller = row.adpDelta < 0;

                    return (
                      <tr key={row.id} className="transition-colors hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-mono text-xs text-slate-500">
                          #{idx + 1}
                        </td>
                        <td className="py-3 px-4 font-semibold text-white">
                          {row.player.full_name}
                          {row.player.team && (
                            <span className="ml-2 text-xs font-normal text-slate-400">
                              ({row.player.team})
                            </span>
                          )}
                          {row.player.injury_status && row.player.injury_status !== 'Healthy' && (
                            <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-amber-950 text-amber-400 border border-amber-800 font-mono">
                              {row.player.injury_status}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-800 text-slate-300 font-mono">
                            {row.player.position}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-400">
                          {row.gp || 0}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-slate-200">
                          {row.rawFppg.toFixed(1)}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-400">
                          {row.preAdp}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-400">
                          <span className="text-indigo-400 font-semibold">{row.inSeasonWeightPct}%</span>
                          <span className="text-slate-600"> / </span>
                          <span>{row.preWeightPct}%</span>
                        </td>
                        <td className="py-3 px-4 text-xs font-mono">
                          {row.adjustments[0] !== 'None' ? (
                            <div className="flex flex-wrap gap-1">
                              {row.adjustments.map((adj, i) => (
                                <span
                                  key={i}
                                  className={`px-2 py-0.5 rounded border text-[11px] ${
                                    adj.includes('Bounce-Back')
                                      ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800'
                                      : 'bg-rose-950/60 text-rose-300 border-rose-900/60'
                                  }`}
                                >
                                  {adj}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono font-extrabold text-indigo-400 text-base">
                          {row.projAdp}
                        </td>
                        <td className="py-3 px-4 font-mono font-semibold text-amber-400 text-xs">
                          {getProjectedRound(row.projAdp)}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs font-semibold">
                          {isRiser && (
                            <span className="text-emerald-400">▲ +{row.adpDelta}</span>
                          )}
                          {isFaller && (
                            <span className="text-rose-400">▼ {row.adpDelta}</span>
                          )}
                          {!isRiser && !isFaller && (
                            <span className="text-slate-500">0</span>
                          )}
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
