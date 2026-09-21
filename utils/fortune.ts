// utils/fortune.ts - 福星克星分析算法

import { GameRecord, FortuneAnalysis, PartnerStat } from './types';
import { MIN_GAMES_FOR_ANALYSIS } from './constants';

/**
 * 计算福星克星分析
 * 算法：遍历所有对局，对每个其他玩家计算同桌胜率
 *
 * 注意：麻将里的"搭档"通常是同队（团队游戏），
 * 但大部分规则下每人独立计分，所以这里"同桌胜率"指在同一场中的胜率对比
 *
 * @param records 所有战绩
 * @param playerId 目标玩家 ID
 */
export function analyzeFortune(
  records: GameRecord[],
  playerId: string
): FortuneAnalysis | null {
  if (records.length < MIN_GAMES_FOR_ANALYSIS) {
    return null;
  }

  // 1. 收集与目标玩家同桌的所有场次
  const relevantRecords = records.filter(r =>
    r.players.some(p => p.playerId === playerId)
  );

  if (relevantRecords.length < MIN_GAMES_FOR_ANALYSIS) {
    return null;
  }

  // 2. 统计与每个其他玩家的同桌表现
  // 胜率口径：胜场数 / (同桌场数 - 平局数)；平局既不算赢也不算输，分母里剔除
  // 例：同桌 10 局，赢 6 平 2 输 2 → 6/(10-2) = 75%（不是 6/10 = 60%）
  const partnerMap = new Map<string, {
    games: number;
    wins: number;
    ties: number;
    netScore: number;
  }>();

  for (const record of relevantRecords) {
    const target = record.players.find(p => p.playerId === playerId);
    if (!target) continue;

    const won = target.score > 0;
    const tied = target.score === 0;

    for (const other of record.players) {
      if (other.playerId === playerId) continue;

      const stat = partnerMap.get(other.playerId) || {
        games: 0,
        wins: 0,
        ties: 0,
        netScore: 0
      };
      stat.games += 1;
      if (won) stat.wins += 1;
      else if (tied) stat.ties += 1;
      stat.netScore += target.score;
      partnerMap.set(other.playerId, stat);
    }
  }

  // 3. 转换为 PartnerStat 数组，按胜率排序
  const partners: PartnerStat[] = Array.from(partnerMap.entries())
    .map(([partnerId, stat]) => {
      const partnerRecord = relevantRecords
        .flatMap(r => r.players)
        .find(p => p.playerId === partnerId);
      const denom = stat.games - stat.ties;
      return {
        partnerId,
        partnerNickname: partnerRecord?.nickname || '未知',
        gamesTogether: stat.games,
        winsTogether: stat.wins,
        winRate: denom > 0 ? stat.wins / denom : 0,
        netScore: stat.netScore
      };
    })
    .filter(p => p.gamesTogether >= 1); // 至少同桌 1 次

  // 4. 分离旺友和克星
  // 旺友：胜率 >= 50% 的（净胜分正）
  // 克星：胜率 < 50% 的（净胜分负）
  const luckyPartners = [...partners]
    .filter(p => p.netScore > 0)
    .sort((a, b) => b.winRate - a.winRate || b.netScore - a.netScore)
    .slice(0, 5);

  const evilPartners = [...partners]
    .filter(p => p.netScore < 0)
    .sort((a, b) => a.winRate - b.winRate || a.netScore - b.netScore)
    .slice(0, 5);

  // 5. 简化：暂不计算座位，固定为 0（后续做麻将座位记录时再算）
  return {
    playerId,
    luckyPartners,
    evilPartners,
    bestPosition: 0,
    worstPosition: 0
  };
}

/**
 * 格式化胜率为百分比字符串
 */
export function formatWinRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/**
 * 格式化净胜分
 */
export function formatNetScore(score: number): string {
  if (score > 0) return `+${score}`;
  return String(score);
}