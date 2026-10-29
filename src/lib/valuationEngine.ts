export interface PlayerStats {
  id: string;
  name: string;
  pos: 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST' | 'DEF';
  age: number;
  fpts: number;
  gp: number;
  tradeFppg: number;
  preseasonAdp: number;
  targets?: number;
  touches?: number;
  injuryStatus?: string;
  injuryNotes?: string;
  status?: string;
}

export function formatCurrency(amount: number, showPlus: boolean = false): string {
  const rounded = Math.round(amount * 100) / 100;
  const isWhole = Number.isInteger(rounded);
  const formatted = isWhole ? rounded.toString() : rounded.toFixed(2);
  const prefix = showPlus && rounded > 0 ? '+$' : '$';
  return `${prefix}${formatted}`;
}

// Power curve pick equity function: 1.05 * 0.965^(pick - 1) * 75
export function calculatePickEquity(pick: number, pos: string = 'WR'): number {
  if (pick <= 0) return 0;
  const rawEquity = 1.05 * Math.pow(0.965, pick - 1) * 75;
  const upperPos = (pos || 'WR').toUpperCase().replace('DEF', 'DST');
  
  const posDiscount = upperPos === 'QB' ? 0.45 : (upperPos === 'K' || upperPos === 'DST') ? 0.0 : 1.0;
  return Math.round(rawEquity * posDiscount * 100) / 100;
}

// Sample dampening for players with < 3 GP
export function getDampenedFppg(fpts: number, gp: number, tradeFppg?: number, touchesOrTargets?: number): number {
  if (tradeFppg && tradeFppg > 0 && gp >= 3) return tradeFppg;
  if (!gp || gp <= 0) return 0;

  const rawFppg = fpts / gp;
  if (gp >= 3 || (touchesOrTargets && touchesOrTargets >= 20)) {
    return Math.round(rawFppg * 100) / 100;
  }

  const dampened = (fpts + (3 - gp) * 2.0) / 3;
  return Math.round(dampened * 100) / 100;
}

// Calculate 2026 Rest of Season Trade Value ($)
export function calculateRosTradeValue(
  pos: string,
  fppg: number,
  projectedAdp: number = 180,
  injuryStatus?: string,
  targetsPerGame?: number,
  gp: number = 6,
  statusNotes?: string
): number {
  const normStatus = (injuryStatus || '').toLowerCase();
  const normNotes = (statusNotes || '').toLowerCase();

  // 1. Definite Season-Ending or Practice Squad -> True $0
  const isSeasonEnding =
    (normNotes.includes('out for season') ||
    normNotes.includes('season-ending') ||
    normNotes.includes('torn acl') ||
    normNotes.includes('torn achilles') ||
    normNotes.includes('pup-r')) || ((normStatus === "ir" || normStatus.includes("ir")) && normNotes.includes("surgery"));

  const isPracticeSquad =
    normStatus.includes('practice squad') ||
    normStatus === 'ps' ||
    normNotes.includes('practice squad') ||
    normNotes.includes('ps-ir');

  if (isSeasonEnding || isPracticeSquad) {
    return 0;
  }

  // Fringe un-drafted players with <= 1 game played who are not on active rosters
  if (gp <= 1 && projectedAdp >= 165 && (normStatus === 'inactive' || isPracticeSquad)) {
    return 0;
  }

  const upperPos = (pos || 'WR').toUpperCase().replace('DEF', 'DST');

  // Hard cap streaming positions
  if (upperPos === 'DST' || upperPos === 'K') {
    const streamValue = Math.min(1.0, Math.max(0.0, (fppg - 5.0) * 0.15));
    return Math.round(streamValue * 100) / 100;
  }

  const baselines: Record<string, number> = {
    QB: 12.0,
    RB: 5.5,
    WR: 5.5,
    TE: 4.5
  };

  const baseline = baselines[upperPos] || 5.5;

  const scarcityMultiplier: Record<string, number> = {
    RB: 3.4,
    WR: 3.2,
    TE: 2.7,
    QB: 1.5
  };

  const mult = scarcityMultiplier[upperPos] || 2.5;
    // Dynamic Sample-Size Decay: regress early FPPG toward expected baseline
    const posExpectedCeiling: Record<string, number> = { QB: 22.0, RB: 17.0, WR: 16.0, TE: 12.5 };
    const ceiling = posExpectedCeiling[upperPos] || 15.0;
    const adpRatio = Math.max(0, (185 - projectedAdp) / 185);
    const expectedFppg = baseline + (ceiling - baseline) * Math.pow(adpRatio, 1.8);

    // Weight decays linearly from 30% down to 0% as GP moves from 0 to 10
    const regressWeight = Math.max(0, (10 - Math.min(gp, 10)) / 10) * 0.30;
    const blendedFppg = (1 - regressWeight) * fppg + regressWeight * expectedFppg;

    let perfValue = Math.max(0, blendedFppg - baseline) * mult;

  // Target volume adjustment
  if ((upperPos === 'WR' || upperPos === 'TE') && targetsPerGame !== undefined) {
    if (targetsPerGame >= 7.5) {
      perfValue += 3.5;
    } else if (targetsPerGame >= 5.0) {
      perfValue += 1.8;
    } else if (targetsPerGame < 2.5 && perfValue > 2.0) {
      perfValue *= 0.65;
    }
  }

  // ADP floor for rostered players
    // Decaying ADP floor: protects early rounds early, decays by week 12
    const floorDecay = Math.max(0, (12 - Math.min(gp, 12)) / 12);
    const adpFloor = projectedAdp < 165
      ? Math.max(0, Math.pow(Math.max(0, (185 - projectedAdp) / 185), 2.2) * 35 * (0.35 + 0.65 * floorDecay))
    : 0;

  let rosValue = Math.max(perfValue, adpFloor);

  // Active Backup RB Handcuff Floor
  if (upperPos === 'RB' && gp >= 3 && rosValue < 2.0) {
    const handcuffFloor = Math.min(2.5, Math.max(1.25, fppg * 0.6));
    rosValue = Math.max(rosValue, handcuffFloor);
  }

  // Returning from long-term injury ramp-up (e.g. Tank Dell)
  // If active on 53-man roster, low GP due to recent activation, but high pedigree (ADP < 100)
  if (gp <= 2 && projectedAdp < 100 && (normStatus === 'healthy' || normStatus === 'active' || !normStatus)) {
    // Ramp up value to 70% of projected floor while building full-game snaps
    rosValue = Math.max(rosValue, adpFloor * 0.70);
  }

  // 2. Short-Term IR Handling (e.g. Travis Etienne Jr.)
  // Eligible to return in weeks 8-10: incurs ~40% discount for missed games and 0-IR bench drag, NOT $0
  if (normStatus === 'ir' || normStatus === 'injured reserve') {
    rosValue *= 0.55; // 55% value retained for short-term IR return
  } else if (normStatus === 'out') {
    rosValue *= 0.45;
  } else if (normStatus === 'doubtful') {
    rosValue *= 0.70;
  } else if (normStatus === 'questionable') {
    rosValue *= 0.90;
  }

  return Math.round(Math.max(0.5, rosValue) * 100) / 100;
}

const ROOKIE_DRAFT_SLOTS = [
  11, 18, 23, 31, 39, 45, 54, 62, 70, 77, 85, 98, 105, 115, 122, 130, 137, 146, 153
];

export function applyRookieDisplacement(rawPick: number): number {
  let adjusted = rawPick;
  for (const rSlot of ROOKIE_DRAFT_SLOTS) {
    if (adjusted >= rSlot) {
      adjusted += 1;
    }
  }
  return Math.min(185, adjusted);
}

export function mapPositionalRankToAdp(pos: string, rank: number): number {
  const p = pos.toUpperCase().replace('DEF', 'DST');

  if (p === 'K') {
    return Math.min(185, 168 + Math.round((rank - 1) * 1.5));
  }

  if (p === 'DST') {
    return Math.min(180, 160 + Math.round((rank - 1) * 1.5));
  }

  let rawPick = 180;

  if (p === 'QB') {
    if (rank === 1) rawPick = 8;
    else if (rank === 2) rawPick = 16;
    else if (rank === 3) rawPick = 28;
    else if (rank <= 5) rawPick = 44 + (rank - 4) * 8;
    else if (rank <= 10) rawPick = 68 + (rank - 6) * 7;
    else if (rank <= 14) rawPick = 104 + (rank - 11) * 8;
    else rawPick = 138 + (rank - 15) * 6;
  } else if (p === 'TE') {
    if (rank === 1) rawPick = 20;
    else if (rank === 2) rawPick = 30;
    else if (rank <= 5) rawPick = 46 + (rank - 3) * 8;
    else if (rank <= 10) rawPick = 73 + (rank - 6) * 7;
    else if (rank <= 14) rawPick = 108 + (rank - 11) * 8;
    else rawPick = 140 + (rank - 15) * 6;
  } else if (p === 'RB') {
    if (rank <= 6) rawPick = Math.round(1 + (rank - 1) * 1.5);
    else if (rank <= 12) rawPick = Math.round(10 + (rank - 7) * 2.0);
    else if (rank <= 20) rawPick = Math.round(24 + (rank - 13) * 2.4);
    else if (rank <= 28) rawPick = Math.round(46 + (rank - 21) * 2.4);
    else if (rank <= 36) rawPick = Math.round(70 + (rank - 29) * 2.5);
    else if (rank <= 48) rawPick = Math.round(94 + (rank - 37) * 2.6);
    else rawPick = Math.round(128 + (rank - 49) * 2.3);
  } else {
    if (rank <= 6) rawPick = Math.round(2 + (rank - 1) * 1.6);
    else if (rank <= 12) rawPick = Math.round(12 + (rank - 7) * 1.8);
    else if (rank <= 20) rawPick = Math.round(25 + (rank - 13) * 2.3);
    else if (rank <= 30) rawPick = Math.round(48 + (rank - 21) * 2.0);
    else if (rank <= 40) rawPick = Math.round(71 + (rank - 31) * 2.0);
    else if (rank <= 52) rawPick = Math.round(94 + (rank - 41) * 2.5);
    else rawPick = Math.round(128 + (rank - 53) * 2.2);
  }

  return applyRookieDisplacement(rawPick);
}



export interface KeeperSurplusOptions {
  draftRound: number;
  keeperYearsAccumulated: number;
  isKeptYear2?: boolean;
  projectedAdp2027: number;
  pos: string;
  age?: number;
  weight2028?: number; // default 0.45
}

export interface KeeperSurplusBreakdown {
  surplus2027: number;
  surplus2028: number;
  totalSurplus: number;
  costRound2027: number;
  costRound2028: number | null;
  projectedAdp2027: number;
  projectedAdp2028: number | null;
  isEligible2027: boolean;
  isEligible2028: boolean;
}

export function project2028Adp(adp2027: number, pos: string, age: number = 25): number {
  if (!adp2027 || adp2027 >= 180) return 180;
  const upperPos = (pos || 'WR').toUpperCase().replace('DEF', 'DST');

  // Ascending talent (rookies / 2nd-year players)
  if (age <= 24) {
    return Math.max(1, Math.round(adp2027 * 0.95));
  }

  // Positional aging curves
  const isAging =
    (upperPos === 'RB' && age >= 27) ||
    ((upperPos === 'WR' || upperPos === 'TE') && age >= 29) ||
    (upperPos === 'QB' && age >= 33);

  if (isAging) {
    return Math.min(185, Math.round(adp2027 * 1.15 + 6));
  }

  // Prime baseline
  return Math.min(185, adp2027);
}

export function calculateKeeperSurplus({
  draftRound,
  keeperYearsAccumulated,
  isKeptYear2 = false,
  projectedAdp2027,
  pos,
  age = 25,
  weight2028 = 0.45,
}: KeeperSurplusOptions): KeeperSurplusBreakdown {
  const originalRound = draftRound || 12;
  const tenureYears = keeperYearsAccumulated || 0;

  // Round 1-2 ineligible or 2-year cap already reached
  const isIneligibleRound = originalRound <= 2;
  const isOverTenure = tenureYears >= 2 || isKeptYear2;

  if (isIneligibleRound || isOverTenure) {
    return {
      surplus2027: 0,
      surplus2028: 0,
      totalSurplus: 0,
      costRound2027: originalRound,
      costRound2028: null,
      projectedAdp2027: projectedAdp2027 || 180,
      projectedAdp2028: null,
      isEligible2027: false,
      isEligible2028: false,
    };
  }

  // 1. Calculate 2027
  const costRound2027 = tenureYears === 1 ? Math.max(1, originalRound - 1) : originalRound;
  const pickCost2027 = Math.max(1, (costRound2027 - 1) * 12 + 6);
  const costEquity2027 = calculatePickEquity(pickCost2027, pos);
  const projEquity2027 = calculatePickEquity(projectedAdp2027 || 180, pos);
  const surplus2027 = Math.max(0, projEquity2027 - costEquity2027);

  // 2. Calculate 2028 (Only eligible if 0 years accumulated and not already in year 2)
  let surplus2028 = 0;
  let costRound2028: number | null = null;
  let projAdp2028: number | null = null;
  const isEligible2028 = tenureYears === 0 && !isKeptYear2;

  if (isEligible2028) {
    // 2028 escalates 1 round from 2027
    costRound2028 = Math.max(1, costRound2027 - 1);
    const pickCost2028 = Math.max(1, (costRound2028 - 1) * 12 + 6);
    const costEquity2028 = calculatePickEquity(pickCost2028, pos);

    projAdp2028 = project2028Adp(projectedAdp2027, pos, age);
    const projEquity2028 = calculatePickEquity(projAdp2028, pos);

    const rawSurplus2028 = Math.max(0, projEquity2028 - costEquity2028);
    surplus2028 = Math.round(rawSurplus2028 * weight2028 * 100) / 100;
  }

  const totalSurplus = Math.round((surplus2027 + surplus2028) * 100) / 100;

  return {
    surplus2027: Math.round(surplus2027 * 100) / 100,
    surplus2028,
    totalSurplus,
    costRound2027,
    costRound2028,
    projectedAdp2027: projectedAdp2027 || 180,
    projectedAdp2028: projAdp2028,
    isEligible2027: true,
    isEligible2028,
  };
}

