// utils/stats.ts - 战绩统计工具

import { GameRecord, Player } from './types';
import { selfScoreIn } from './storage';
import { formatDate, formatDateShort, isInMonth } from './date';

export interface OverallStats {
  totalGames: number;
  totalRecords: number;
  totalPlayers: number;
  totalNetScore: number;
  winDays: number;
  currentStreak: number;
  maxWinStreak: number;
}

export interface RuleStat {
  ruleType: string;
  ruleName: string;
  games: number;
  wins: number;
  winRate: number;
  netScore: number;
}

/**
 * 取「我」在某局的分数
 *
 * ⚠️ 不要在这里用 players[0]：players 的顺序取决于用户点牌友的先后，
 * 「我」完全可能不在首位，那样所有个人视角统计都会算成别人的。
 * 唯一判定入口见 storage.ts 的 selfIn / selfScoreIn。
 */
function selfScore(record: GameRecord): number | null {
  return selfScoreIn(record);
}

/** 「我」的总胜率（0~1）；一局都没参与返回 0 */
export function calcSelfWinRate(records: GameRecord[]): number {
  let played = 0;
  let wins = 0;
  for (const r of records) {
    const score = selfScoreIn(r);
    if (score === null) continue;
    played += 1;
    if (score > 0) wins += 1;
  }
  return played > 0 ? wins / played : 0;
}

/**
 * 计算全局统计
 */
export function calcOverallStats(records: GameRecord[], players: Player[]): OverallStats {
  const totalGames = records.length;
  let totalNetScore = 0;
  const winDays = new Set<string>();

  // 收集有战绩的日期
  for (const r of records) {
    winDays.add(formatDate(r.playedAt));
  }

  // 连胜 / 净胜分都按「我」的视角算
  // （之前用"当场最高分玩家"判定，等于"有人赢就算我赢"，连胜会等于总局数）
  let currentStreak = 0;
  let maxWinStreak = 0;

  const sorted = [...records].sort((a, b) => a.playedAt - b.playedAt);
  for (const r of sorted) {
    const score = selfScore(r);
    if (score === null) continue;
    totalNetScore += score;

    if (score > 0) {
      currentStreak += 1;
      if (currentStreak > maxWinStreak) maxWinStreak = currentStreak;
    } else if (score < 0) {
      currentStreak = 0;
    }
    // score === 0：不打断也不累加
  }

  return {
    totalGames,
    totalRecords: records.length,
    totalPlayers: players.length,
    totalNetScore,
    winDays: winDays.size,
    currentStreak,
    maxWinStreak
  };
}

/**
 * 按玩法聚合统计
 */
export function calcRuleStats(records: GameRecord[]): RuleStat[] {
  const map = new Map<string, RuleStat>();

  for (const r of records) {
    // 自定义玩法按名字区分（不同自定义玩法是不同分组），预设按 ruleType
    const key = r.ruleType === 'custom' ? `custom:${r.ruleName}` : r.ruleType;
    const score = selfScore(r);

    let stat = map.get(key);
    if (!stat) {
      stat = {
        ruleType: key,
        ruleName: r.ruleName,
        games: 0,
        wins: 0,
        winRate: 0,
        netScore: 0
      };
      map.set(key, stat);
    }
    stat.games += 1;
    if (score !== null && score > 0) stat.wins += 1;
    if (score !== null) stat.netScore += score;
  }

  // 计算胜率
  const result = Array.from(map.values());
  for (const stat of result) {
    stat.winRate = stat.games > 0 ? stat.wins / stat.games : 0;
  }

  return result.sort((a, b) => b.games - a.games);
}

/**
 * 按月份筛选战绩
 */
export function filterRecordsByMonth(
  records: GameRecord[],
  year: number,
  month: number
): GameRecord[] {
  return records.filter(r => isInMonth(r.playedAt, year, month));
}

/**
 * 按玩法筛选战绩
 */
export function filterRecordsByRule(
  records: GameRecord[],
  ruleType: string | null
): GameRecord[] {
  if (!ruleType) return records;
  // 自定义玩法的筛选 key 是 'custom:名字' 复合形式
  if (ruleType.startsWith('custom:')) {
    const name = ruleType.slice('custom:'.length);
    return records.filter(r => r.ruleType === 'custom' && r.ruleName === name);
  }
  return records.filter(r => r.ruleType === ruleType);
}

/**
 * 按玩家筛选战绩
 */
export function filterRecordsByPlayer(
  records: GameRecord[],
  playerId: string | null
): GameRecord[] {
  if (!playerId) return records;
  return records.filter(r => r.players.some(p => p.playerId === playerId));
}

/**
 * 当日会话：按 2 小时间隔切分，返回「当前会话」的统计
 *
 * 「当前会话」的判定（2026-09-26 与铁匠确认）：
 * - 把所有战绩按 playedAt 倒序
 * - 找最新一局作为起点
 * - 后续每一局必须距离上一局 ≤ intervalMs 才算同一会话
 * - 遇到间隔 > intervalMs 的局 → 新会话开始，停止累加
 *
 * 边界场景：
 * - 14:00 → 15:30 → 同一会话（间隔 1.5h）
 * - 14:00 → 16:30 → 切分（间隔 2.5h > 2h 阈值）
 * - 跨夜：22:00 → 02:00 → 同一会话（间隔 4h，但只要没断 2h+ 就算同一会话）
 *   等下，4h > 2h 阈值，会切分。修：用户持续打牌时，应该**用"上一局"作锚点**，
 *   间隔计算的是「上一局和当前局」之间，不是「本局和会话起点」之间。
 *
 * 算法：倒序遍历，相邻两局间隔 ≤ intervalMs 算同会话；遇到 > intervalMs 的停止。
 *
 * @param records 全部战绩（内部排序）
 * @param now 当前时间戳（毫秒）
 * @param myPlayerId 「我」的 playerId；不传则 netScore 恒为 0
 * @param intervalMs 会话间隔阈值（默认 2 小时）
 */
export interface DailySession {
  /** 当前会话内的局数 */
  games: number;
  /** 当前会话内「我」的净胜分之和 */
  netScore: number;
  /** 当前会话第一局的 playedAt（用于展示「今日开始时间」） */
  startAt: number;
}

export function calcDailySession(
  records: GameRecord[],
  now: number,
  myPlayerId?: string,
  intervalMs: number = 2 * 60 * 60 * 1000
): DailySession {
  const sorted = [...records].sort((a, b) => b.playedAt - a.playedAt);
  if (sorted.length === 0) {
    return { games: 0, netScore: 0, startAt: now };
  }

  let games = 0;
  let netScore = 0;
  let startAt = sorted[0].playedAt;
  let prevAt = sorted[0].playedAt;

  for (const r of sorted) {
    if (games > 0) {
      const interval = prevAt - r.playedAt;  // 倒序：prev 更新，prev - r = 间隔
      if (interval > intervalMs) break;       // 切分，停止
    }
    games += 1;
    if (myPlayerId) {
      const me = r.players.find(p => p.playerId === myPlayerId);
      if (me) netScore += me.score;
    }
    startAt = r.playedAt;
    prevAt = r.playedAt;
  }

  return { games, netScore, startAt };
}