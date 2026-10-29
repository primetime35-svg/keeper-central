import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { mapPositionalRankToAdp } from '@/lib/valuationEngine';

const MANAGERS = [
  'Jim', 'Foley', 'Gardner', 'John', 'Jamie', 'Ben',
  'Alex', 'Fournier', 'Sal', 'Ray', 'Matt', 'Dan'
];

const PRESEASON_EXPERT_ADP_2026: Record<string, number> = {
  "jahmyr gibbs": 1, "bijan robinson": 2, "jamarr chase": 3, "puka nacua": 4,
  "christian mccaffrey": 5, "jonathan taylor": 6, "jaxon smith-njigba": 7, "amon-ra st brown": 8,
  "james cook": 9, "ceedee lamb": 10, "justin jefferson": 11, "devon achane": 12,
  "saquon barkley": 13, "kenneth walker": 14, "chase brown": 15, "ashton jeanty": 16,
  "derrick henry": 17, "drake london": 18, "omarion hampton": 19, "josh allen": 20,
  "aj brown": 21, "nico collins": 22, "brock bowers": 23, "george pickens": 24,
  "trey mcbride": 25, "chris olave": 26, "malik nabers": 27, "rashee rice": 28,
  "jeremiyah love": 29, "kyren williams": 30, "devonta smith": 31, "javonte williams": 32,
  "breece hall": 33, "zay flowers": 34, "tee higgins": 35, "travis etienne": 36,
  "garrett wilson": 37, "tetairoa mcmillan": 38, "lamar jackson": 39, "colston loveland": 40,
  "cam skattebo": 41, "jaylen waddle": 42, "emeka egbuka": 43, "ladd mcconkey": 44,
  "dandre swift": 45, "davante adams": 46, "bucky irving": 47, "drake maye": 48,
  "joe burrow": 49, "quinshon judkins": 50, "luther burden": 51, "terry mclaurin": 52,
  "david montgomery": 53, "tyler warren": 54, "dj moore": 55, "jameson williams": 56,
  "bhayshul tuten": 57, "christian watson": 58, "rome odunze": 59, "tucker kraft": 60,
  "jadarian price": 61, "treveyon henderson": 62, "jalen hurts": 63, "kyler murray": 64,
  "chuba hubbard": 65, "josh jacobs": 66, "jaylen warren": 67, "george kittle": 68,
  "carnell tate": 69, "parker washington": 70, "marvin harrison": 71, "alvin kamara": 72,
  "rhamondre stevenson": 73, "rico dowdle": 74, "sam laporta": 75, "mark andrews": 76,
  "jayden daniels": 77, "tony pollard": 78, "jordan mason": 79, "jk dobbins": 80,
  "harold fannin": 81, "kyle pitts": 82, "isaiah likely": 83, "dalton kincaid": 84,
  "travis kelce": 85, "tyler allgeier": 86, "tyrone tracy": 87, "patrick mahomes": 88,
  "jake ferguson": 89, "dallas goedert": 90, "courtland sutton": 91, "mike evans": 92,
  "chris godwin": 93, "dk metcalf": 94, "brian thomas": 95, "caleb williams": 96,
  "blake corum": 97, "rachaad white": 98, "michael wilson": 99, "marshawn lloyd": 100,
  "zach charbonnet": 102, "christian kirk": 115
};

const ELITE_HANDCUFF_NAMES = [
  'emmett johnson',
  'blake corum',
  'tyler allgeier',
  'braelon allen',
  'zach charbonnet',
  'ray davis',
  'keaton mitchell'
];

const PLAYER_NAME_ALIASES: Record<string, string> = {
  "bam knight": "zonovan knight",
  "travis hunter": "travis hunter",
  "jordyn tyson": "jordyn tyson"
};

const DEFENSE_MASCOTS: Record<string, string> = {
  "cardinals": "ARI", "falcons": "ATL", "ravens": "BAL", "bills": "BUF",
  "panthers": "CAR", "bears": "CHI", "bengals": "CIN", "browns": "CLE",
  "cowboys": "DAL", "broncos": "DEN", "lions": "DET", "packers": "GB",
  "texans": "HOU", "colts": "IND", "jaguars": "JAX", "chiefs": "KC",
  "raiders": "LV", "chargers": "LAC", "rams": "LAR", "dolphins": "MIA",
  "vikings": "MIN", "patriots": "NE", "saints": "NO", "giants": "NYG",
  "jets": "NYJ", "eagles": "PHI", "steelers": "PIT", "49ers": "SF",
  "seahawks": "SEA", "buccaneers": "TB", "titans": "TEN", "commanders": "WAS"
};

function normalizeName(str: string): string {
  if (!str) return '';
  let cleaned = str.toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/gi, '')
    .replace(/\b(d\/st|dst)\b/gi, '')
    .replace(/[^a-z0-9\s]/gi, '')
    .trim()
    .replace(/\s+/g, ' ');

  if (PLAYER_NAME_ALIASES[cleaned]) {
    cleaned = PLAYER_NAME_ALIASES[cleaned];
  }

  for (const [mascot, abbr] of Object.entries(DEFENSE_MASCOTS)) {
    if (cleaned.includes(mascot)) return `team_${abbr.toLowerCase()}`;
  }
  return cleaned;
}

export async function GET() {
  try {
    let { data: league } = await supabase
      .from('leagues')
      .select('id')
      .eq('name', 'Football Friends')
      .maybeSingle();

    if (!league) {
      const { data: newLeague } = await supabase
        .from('leagues')
        .insert({
          name: 'Football Friends',
          platform: 'ESPN',
          season: 2026,
          teams_count: 12
        })
        .select('id')
        .single();
      league = newLeague;

      await supabase.from('league_rules').insert({
        league_id: league!.id,
        scoring: 'HALF_PPR',
        roster_format: '1QB',
        max_keeper_years: 2,
        escalation_step: 1,
        escalation_starts_year: 2,
        ineligible_draft_rounds: [1, 2],
        waiver_cost_round: 12,
        freeze_deadline: '2026-12-08T00:00:00-05:00'
      });
    }

    for (const mgr of MANAGERS) {
      await supabase.from('teams').upsert(
        {
          league_id: league!.id,
          manager_name: mgr,
          team_name: `${mgr}'s Team`
        },
        { onConflict: 'league_id,manager_name' }
      );
    }

      const { data: consensusData } = await supabase.from('consensus_adp').select('normalized_name, consensus_adp');
      const consensusMap = new Map<string, number>(
        (consensusData || []).map((row: any) => [row.normalized_name, Number(row.consensus_adp)])
      );
      console.log('[SYNC] Loaded consensus ADP map successfully');

    const [playersRes, statsRes] = await Promise.all([
      fetch('https://api.sleeper.app/v1/players/nfl'),
      fetch('https://api.sleeper.app/v1/stats/nfl/regular/2026')
    ]);

    const playersData = await playersRes.json();
    const statsData = await statsRes.json();

    const allowedPositions = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
    const playerRows: any[] = [];
    const unrankedItems: any[] = [];

    for (const playerId in playersData) {
      const pInfo = playersData[playerId];
      const pos = (pInfo.position || '').toUpperCase();

      if (!allowedPositions.has(pos)) continue;

      const isDefense = pos === 'DEF';
      if (!isDefense && (!pInfo.active || !pInfo.team)) continue;

      const rawName = isDefense
        ? `${pInfo.first_name || ''} ${pInfo.last_name || ''}`.trim() || `${playerId} D/ST`
        : (pInfo.full_name || `${pInfo.first_name || ''} ${pInfo.last_name || ''}`).trim();

      const normKey = normalizeName(rawName);
      const pStats = statsData[playerId] || {};

      const pts = pStats.pts_half_ppr || pStats.pts_ppr || pStats.pts_std || 0;
      const gp = pStats.gp || pStats.games_played || (pts > 0 ? 6 : 0);
      const targets = pStats.rec_tgt || 0;
      const seasonFppg = gp > 0 ? pts / gp : 0;
      const age = Number(pInfo.age) || (isDefense ? 0 : 25);
      
      const injuryStatus = (pInfo.status === 'Practice Squad' || pInfo.practice_squad)
        ? 'Practice Squad'
        : (pInfo.injury_status || (pInfo.status === 'Inactive' ? 'Inactive' : 'Healthy'));
      const injuryNotes = pInfo.injury_notes || pInfo.injury_body_part || 'Active';
      const expertAdp = consensusMap.get(normKey) || PRESEASON_EXPERT_ADP_2026[normKey] || (isDefense || pos === 'K' ? 160 : 180);

      if (!isDefense && pos !== 'K' && pts === 0 && expertAdp >= 180 && !pInfo.team) continue;

      const standardPos = pos === 'DEF' ? 'DST' : pos;

      playerRows.push({
        id: playerId,
        full_name: rawName,
        normalized_name: normKey,
        position: standardPos,
        team: pInfo.team || (isDefense ? playerId : null),
        age: age,
        injury_status: injuryStatus,
        injury_notes: injuryNotes
      });

      const injury = injuryStatus.toLowerCase();
      const isSeasonEnding = injury === 'ir' || injury.includes('season') || injury.includes('pup-r');
      const isPracticeSquad = injury.includes('practice squad') || injury.includes('ps');
      let preScore = Math.max(10, 200 - expertAdp);
      let inSeasonScore = seasonFppg * 10;

      // WR / TE Target volume
      if ((standardPos === 'WR' || standardPos === 'TE') && gp > 0) {
        const targetsPerGame = targets / gp;
        if (targetsPerGame >= 7.5) inSeasonScore += 15;
        else if (targetsPerGame >= 5.0) inSeasonScore += 8;
        else if (targetsPerGame < 2.5 && inSeasonScore > 20) inSeasonScore *= 0.85;
      }

      // Handcuff Opportunity Floor: Anchors active direct backup RBs to the RB42-RB46 corridor
      const isEliteHandcuff = ELITE_HANDCUFF_NAMES.some(h => normKey.includes(h)) || (standardPos === 'RB' && gp >= 5 && pInfo.team && !isSeasonEnding && !isPracticeSquad && seasonFppg >= 3.0);
      if (isEliteHandcuff && !isSeasonEnding && !isPracticeSquad) {
        inSeasonScore = Math.max(inSeasonScore, 72);
        preScore = Math.max(preScore, 70);
      }

      // Young Stud Bounce-Back
      let isBounceBack = false;
      if (isSeasonEnding && age <= 26 && expertAdp <= 48) {
        inSeasonScore = preScore * 0.85;
        isBounceBack = true;
      }

      // Age Cliffs
      let ageMultiplier = 1.0;
      if (standardPos === 'RB' && age >= 28) ageMultiplier = 0.85;
      else if ((standardPos === 'WR' || standardPos === 'TE') && age >= 31) ageMultiplier = 0.88;
      else if (standardPos === 'QB' && age >= 35) ageMultiplier = 0.92;

      inSeasonScore *= ageMultiplier;

      let blendedEvaluation = 0;
      if (isBounceBack) {
        blendedEvaluation = inSeasonScore;
      } else {
        const inSeasonWeight = gp >= 3 ? 0.75 : (gp / 3.0) * 0.75;
        blendedEvaluation = (inSeasonScore * inSeasonWeight) + (preScore * (1 - inSeasonWeight));
      }

      unrankedItems.push({
        player_id: playerId,
        pos: standardPos,
        fpts: Math.round(pts * 10) / 10,
        gp: gp,
        season_fppg: Math.round(seasonFppg * 10) / 10,
        trade_fppg: Math.round(seasonFppg * 10) / 10,
        expert_adp: expertAdp,
        blendedEvaluation: blendedEvaluation
      });
    }

    // Special Additions
    const specialAdditions = [
      { name: "Travis Hunter", pos: "WR", team: "JAX", adp: 150 },
      { name: "Jordyn Tyson", pos: "WR", team: "FA", adp: 175 }
    ];

    for (const spec of specialAdditions) {
      const specNorm = normalizeName(spec.name);
      if (!playerRows.find(p => p.normalized_name === specNorm)) {
        const specId = `custom_${specNorm.replace(/\s+/g, '_')}`;
        playerRows.push({
          id: specId,
          full_name: spec.name,
          normalized_name: specNorm,
          position: spec.pos,
          team: spec.team,
          age: 21,
          injury_status: 'Healthy',
          injury_notes: 'Active'
        });
        unrankedItems.push({
          player_id: specId,
          pos: spec.pos,
          fpts: 0,
          gp: 0,
          season_fppg: 0,
          trade_fppg: 0,
          expert_adp: spec.adp,
          blendedEvaluation: Math.max(10, 200 - spec.adp)
        });
      }
    }

    // Dynamic Positional Ranking & Draft Slot Assignment
    const projectionRows: any[] = [];
    const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];

    for (const pos of positions) {
      const group = unrankedItems.filter(x => x.pos === pos).sort((a, b) => b.blendedEvaluation - a.blendedEvaluation);
      for (let i = 0; i < group.length; i++) {
        const rank = i + 1;
        const targetAdp = mapPositionalRankToAdp(pos, rank);

        projectionRows.push({
          player_id: group[i].player_id,
          season: 2026,
          fpts: group[i].fpts,
          gp: group[i].gp,
          season_fppg: group[i].season_fppg,
          trade_fppg: group[i].trade_fppg,
          expert_adp: group[i].expert_adp,
          projected_adp: targetAdp
        });
      }
    }

    if (playerRows.length > 0) {
      const CHUNK_SIZE = 400;
      for (let i = 0; i < playerRows.length; i += CHUNK_SIZE) {
        await supabase.from('players').upsert(playerRows.slice(i, i + CHUNK_SIZE), { onConflict: 'id' });
      }
      for (let i = 0; i < projectionRows.length; i += CHUNK_SIZE) {
        await supabase.from('player_projections').upsert(projectionRows.slice(i, i + CHUNK_SIZE), { onConflict: 'player_id,season' });
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Active NFL players, Stats, Targets, and 2027 Projections dynamically synced!',
      totalCached: playerRows.length
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
