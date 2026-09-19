// utils/stats.ts - 战绩统计工具
import { formatDate, isInMonth } from './date';
/**
 * 取「我」在某局的分数
 *
 * 约定：一局里 players[0] 就是「我」——首页录战绩时按添加顺序排列，
 * 自己永远是第一个。index.ts 的胜率也是这么算的。
 */
function selfScore(record) {
    const me = record.players[0];
    return me ? me.score : null;
}
/**
 * 计算全局统计
 */
export function calcOverallStats(records, players) {
    const totalGames = records.length;
    let totalNetScore = 0;
    const winDays = new Set();
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
        if (score === null)
            continue;
        totalNetScore += score;
        if (score > 0) {
            currentStreak += 1;
            if (currentStreak > maxWinStreak)
                maxWinStreak = currentStreak;
        }
        else if (score < 0) {
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
export function calcRuleStats(records) {
    const map = new Map();
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
        if (score !== null && score > 0)
            stat.wins += 1;
        if (score !== null)
            stat.netScore += score;
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
export function filterRecordsByMonth(records, year, month) {
    return records.filter(r => isInMonth(r.playedAt, year, month));
}
/**
 * 按玩法筛选战绩
 */
export function filterRecordsByRule(records, ruleType) {
    if (!ruleType)
        return records;
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
export function filterRecordsByPlayer(records, playerId) {
    if (!playerId)
        return records;
    return records.filter(r => r.players.some(p => p.playerId === playerId));
}
