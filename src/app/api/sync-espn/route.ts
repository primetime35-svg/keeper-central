import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const LEAGUE_ID = process.env.ESPN_LEAGUE_ID;
const SWID = process.env.ESPN_SWID;
const ESPN_S2 = process.env.ESPN_S2;
const SEASON = 2026;

const OWNER_ID_TO_MANAGER: Record<string, string> = {
  '{30AC86EF-8066-4CCD-BA10-63BCCBB4191A}': 'Jim',
  '{179C7965-B17A-4A99-8405-F318BE76D908}': 'John',
  '{7931DFF1-3086-41C7-B1DF-F1308631C7B0}': 'Gardner',
  '{A9C560E3-29AA-4E9E-BF8F-785B9FC656B8}': 'Jamie',
  '{D23C5FF9-4686-4382-93AF-2FB2C4495EE9}': 'Ben',
  '{AD96660C-16D7-43BB-B816-8AABC622FE7F}': 'Ben',
  '{5F1F2F27-1670-4DDA-9F2F-271670FDDA95}': 'Alex',
  '{950DEC5A-A406-461A-B1DC-CA809D8BD785}': 'Fournier',
  '{5B0E6904-D893-4416-A45D-3AA002032952}': 'Sal',
  '{B5503D47-8ACD-4666-903D-478ACD4666F7}': 'Ray',
  '{76900FD2-D84B-42F9-86FF-B1AB38E71C87}': 'Ray',
  '{8ECD5148-D7F6-42DD-8D51-48D7F612DD18}': 'Matt',
  '{383960A2-6516-4DA5-B960-A265162DA52F}': 'Dan',
  '{10A75D19-FACE-4062-8550-B7B32004C018}': 'Dan',
  '{7E67ED3A-01EF-4D8A-8F24-A6FB913BFED4}': 'Foley'
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

const PLAYER_NAME_ALIASES: Record<string, string> = {
  "bam knight": "zonovan knight"
};

function normalizeName(str: string): string {
  if (!str) return '';
  let cleaned = str.toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/gi, '')
    .replace(/\b(d\/st|dst)\b/gi, '')
    .replace(/[.'’]/g, '')
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

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isSameOrigin = request.headers.get('sec-fetch-site') === 'same-origin' || !cronSecret;

  // Reject unauthorized external requests if CRON_SECRET is configured
  if (!isSameOrigin && !isVercelCron) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  if (!LEAGUE_ID) {
    return NextResponse.json({ success: false, error: 'ESPN_LEAGUE_ID missing' }, { status: 400 });
  }

  try {
    const { data: league } = await supabase
      .from('leagues')
      .select('id')
      .eq('name', 'Football Friends')
      .single();

    if (!league) {
      return NextResponse.json({ success: false, error: 'League not found in Supabase' }, { status: 404 });
    }

    const espnUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}?view=mTeam&view=mRoster&view=mDraftDetail`;

    const headers: Record<string, string> = {};
    if (SWID && ESPN_S2) {
      headers['Cookie'] = `SWID=${SWID}; espn_s2=${ESPN_S2};`;
    }

    const espnRes = await fetch(espnUrl, { headers });
    const espnData = await espnRes.json();

    const { data: dbTeams } = await supabase
      .from('teams')
      .select('id, manager_name')
      .eq('league_id', league.id);

    const managerToTeamId = new Map(dbTeams?.map(t => [t.manager_name, t.id]));

    const draftPickRoundMap = new Map<number, number>();
    if (espnData.draftDetail?.picks) {
      for (const pick of espnData.draftDetail.picks) {
        draftPickRoundMap.set(pick.playerId, pick.roundId);
      }
    }

    const { data: dbPlayers } = await supabase
      .from('players')
      .select('id, full_name, normalized_name');

    const playerMapByNorm = new Map(dbPlayers?.map(p => [p.normalized_name, p.id]));

    // Fetch existing rosters so keeper tenure and draft costs persist
    const { data: existingRosters } = await supabase
      .from('rosters')
      .select('player_id, draft_round, keeper_years_accumulated, is_kept_year_2, acquisition_type')
      .eq('league_id', league.id);

    const existingRosterMap = new Map(existingRosters?.map(r => [r.player_id, r]));

    const rosterEntries: any[] = [];
    const missingPlayers: string[] = [];

    for (const espnTeam of espnData.teams || []) {
      const managerName = OWNER_ID_TO_MANAGER[espnTeam.primaryOwner];
      const supaTeamId = managerName ? managerToTeamId.get(managerName) : null;
      if (!supaTeamId) continue;

      for (const entry of espnTeam.roster?.entries || []) {
        const pPool = entry.playerPoolEntry?.player;
        if (!pPool) continue;

        const fullName = pPool.fullName || `${pPool.firstName} ${pPool.lastName}`;
        const norm = normalizeName(fullName);
        const resolvedPlayerId = playerMapByNorm.get(norm);

        if (!resolvedPlayerId) {
          missingPlayers.push(fullName);
          continue;
        }

        const existing = existingRosterMap.get(resolvedPlayerId);

        let draftRound = 12;
        let acqType = 'FREE_AGENCY';
        let keeperYears = 0;
        let isKeptYear2 = false;

        if (existing) {
          // Rule: Retain historical draft round and keeper tenure across drops, waivers, and trades
          draftRound = existing.draft_round;
          acqType = existing.acquisition_type;
          keeperYears = existing.keeper_years_accumulated;
          isKeptYear2 = existing.is_kept_year_2;
        } else if (draftPickRoundMap.has(pPool.id)) {
          draftRound = draftPickRoundMap.get(pPool.id)!;
          acqType = 'DRAFT';
          keeperYears = 0;
          isKeptYear2 = false;
        }

        rosterEntries.push({
          league_id: league.id,
          team_id: supaTeamId,
          player_id: resolvedPlayerId,
          acquisition_type: acqType,
          draft_round: draftRound,
          keeper_years_accumulated: keeperYears,
          is_kept_year_2: isKeptYear2
        });
      }
    }

    await supabase.from('rosters').delete().eq('league_id', league.id);

    if (rosterEntries.length > 0) {
      const CHUNK_SIZE = 100;
      for (let i = 0; i < rosterEntries.length; i += CHUNK_SIZE) {
        await supabase.from('rosters').insert(rosterEntries.slice(i, i + CHUNK_SIZE));
      }
    }

    return NextResponse.json({
      success: true,
      message: `Successfully synced ${rosterEntries.length} rostered players while preserving keeper costs and tenure!`,
      rostersCount: rosterEntries.length,
      unmatchedCount: missingPlayers.length,
      unmatchedSample: missingPlayers
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
