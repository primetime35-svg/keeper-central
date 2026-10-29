import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

function normalizeName(str: string): string {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/gi, '')
    .replace(/\b(d\/st|dst)\b/gi, '')
    .replace(/[.'’]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

// Corrected Keeper Mapping:
// Light Blue (years_kept: 2) = Kept 2nd year in 2026 -> Cap Reached (Ineligible for 2027)
// Green (years_kept: 1) = Kept 1st year in 2026 -> Year 2 Final Option in 2027
const CONFIRMED_KEEPERS = [
  // --- Light Blue: 2nd Year Kept in 2026 (Cap Reached) ---
  { name: "Jaxon Smith-Njigba", manager: "Jim", years_kept: 2 },
  { name: "Brock Bowers", manager: "Sal", years_kept: 2 },
  { name: "Ladd McConkey", manager: "John", years_kept: 2 },
  { name: "Trey McBride", manager: "Ben", years_kept: 2 },
  { name: "Chase Brown", manager: "Jamie", years_kept: 2 },

  // --- Green: 1st Year Kept in 2026 (Eligible for Final Year 2) ---
  { name: "George Pickens", manager: "Jim", years_kept: 1 },
  { name: "Rashee Rice", manager: "Sal", years_kept: 1 },
  { name: "Justin Herbert", manager: "John", years_kept: 1 },
  { name: "Chris Olave", manager: "Gardner", years_kept: 1 },
  { name: "Javonte Williams", manager: "Gardner", years_kept: 1 },
  { name: "Rome Odunze", manager: "Fournier", years_kept: 1 },
  { name: "Colston Loveland", manager: "Fournier", years_kept: 1 },
  { name: "Rhamondre Stevenson", manager: "Foley", years_kept: 1 },
  { name: "Tetairoa McMillan", manager: "Ben", years_kept: 1 },
  { name: "Jaylen Waddle", manager: "Ray", years_kept: 1 },
  { name: "Cam Skattebo", manager: "Ray", years_kept: 1 },
  { name: "Emeka Egbuka", manager: "Alex", years_kept: 1 },
  { name: "Travis Etienne Jr", manager: "Alex", years_kept: 1 },
  { name: "Tucker Kraft", manager: "Matt", years_kept: 1 },
  { name: "Luther Burden III", manager: "Matt", years_kept: 1 },
  { name: "Jaxson Dart", manager: "Dan", years_kept: 1 },
  { name: "Bhayshul Tuten", manager: "Jamie", years_kept: 1 }
];

export async function GET() {
  try {
    const { data: dbPlayers } = await supabase
      .from('players')
      .select('id, full_name, normalized_name');

    const playerMap = new Map(dbPlayers?.map(p => [p.normalized_name, p.id]));
    const updated: string[] = [];
    const notFound: string[] = [];

    // Reset tenure for all league rosters first
    const { data: league } = await supabase
      .from('leagues')
      .select('id')
      .eq('name', 'Football Friends')
      .single();

    if (league) {
      await supabase
        .from('rosters')
        .update({ keeper_years_accumulated: 0, is_kept_year_2: false })
        .eq('league_id', league.id);
    }

    for (const item of CONFIRMED_KEEPERS) {
      const norm = normalizeName(item.name);
      const playerId = playerMap.get(norm);

      if (!playerId) {
        notFound.push(item.name);
        continue;
      }

      const isMaxCap = item.years_kept >= 2;

      const { error } = await supabase
        .from('rosters')
        .update({
          keeper_years_accumulated: item.years_kept,
          is_kept_year_2: isMaxCap
        })
        .eq('player_id', playerId);

      if (!error) {
        updated.push(`${item.name} (${item.manager} - ${item.years_kept === 2 ? 'Light Blue / Cap' : 'Green / Yr 1'})`);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Updated tenure across ${updated.length} retained keepers.`,
      updated,
      notFound
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
