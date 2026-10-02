// utils/monthly-report.ts
// 月度战报计算（P0 升级版）：称号 / 黄金时段 / 方位手气 / 高光时刻 / 最扎心对手 / 环比
//
// ⚠️ 合规边界：所有内容都是**历史战绩的统计描述**，只描述过去、不做任何预测。
//    文案里禁止出现「运势 / 将会 / 预计 / 宜XX」等前瞻性措辞；
//    展示时统一挂 complianceText（依据本月 N 局战绩统计 · 非预测）。
//
// 所有文本字段在这里**预格式化成字符串** —— WXML 表达式不能调用函数，
// 直接 {{ xxx }} 渲染（本项目多次踩过这个坑，见 analysis.ts 顶部注释）。
import { DURATION_LABELS, SEAT_LABELS } from './types';
const signed = (n) => (n > 0 ? '+' : '') + n;
const DURATION_KEYS = ['morning', 'afternoon', 'evening', 'overnight'];
const SEAT_KEYS = ['east', 'south', 'west', 'north'];
/** 称号规则：按优先级命中第一个（全部描述已发生的战绩，不做预测） */
function pickTitle(games, winRate, net, maxWinStreak) {
    if (net > 0 && winRate >= 60 && games >= 4) {
        return { emoji: '🏆', name: '常胜将军', desc: `胜率 ${winRate}%，净胜 ${signed(net)} 分，牌桌定海神针` };
    }
    if (maxWinStreak >= 4) {
        return { emoji: '🔥', name: '连胜王', desc: `最长 ${maxWinStreak} 连胜，手感滚烫` };
    }
    if (net > 0 && winRate < 40) {
        return { emoji: '💥', name: '一把定乾坤', desc: `赢得局数不多，但赢得大，净胜 ${signed(net)} 分` };
    }
    if (net > 0) {
        return { emoji: '📈', name: '越战越勇', desc: `本月净胜 ${signed(net)} 分` };
    }
    if (net === 0) {
        return { emoji: '⚖️', name: '稳如泰山', desc: '输赢相抵，不多不少' };
    }
    if (winRate >= 45) {
        return { emoji: '😤', name: '差一口气', desc: `赢的局多但输得大，净负 ${Math.abs(net)} 分` };
    }
    return { emoji: '🀄', name: '再接再厉', desc: `本月净负 ${Math.abs(net)} 分` };
}
function fmtMonthDay(ts) {
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
}
/**
 * 计算某玩家某个月的完整战报。
 * @returns 无战绩时返回 null（调用方显示空态）
 */
export function buildMonthlyReport(records, playerId, year, month) {
    const inMonth = (r, y, m) => {
        const d = new Date(r.playedAt);
        return d.getFullYear() === y && (d.getMonth() + 1) === m &&
            r.players.some(p => p.playerId === playerId);
    };
    const monthRecords = records.filter(r => inMonth(r, year, month));
    if (monthRecords.length === 0)
        return null;
    let wins = 0;
    let netScore = 0;
    let bestWinScore = 0;
    let bestWinRec = null;
    const mvpMap = new Map();
    const ruleMap = new Map();
    const oppMap = new Map();
    const durMap = new Map();
    const seatMap = new Map();
    for (const r of monthRecords) {
        const me = r.players.find(p => p.playerId === playerId);
        if (!me)
            continue;
        if (me.score > 0)
            wins++;
        netScore += me.score;
        if (r.ruleName)
            ruleMap.set(r.ruleName, (ruleMap.get(r.ruleName) || 0) + 1);
        for (const p of r.players) {
            if (p.playerId === playerId)
                continue;
            mvpMap.set(p.nickname, (mvpMap.get(p.nickname) || 0) + 1);
            const o = oppMap.get(p.nickname) || { net: 0, games: 0 };
            o.net += me.score;
            o.games += 1;
            oppMap.set(p.nickname, o);
        }
        const dStat = durMap.get(r.duration) || { games: 0, wins: 0, net: 0 };
        dStat.games += 1;
        dStat.net += me.score;
        if (me.score > 0)
            dStat.wins += 1;
        durMap.set(r.duration, dStat);
        if (me.seat) {
            const s = seatMap.get(me.seat) || { games: 0, net: 0 };
            s.games += 1;
            s.net += me.score;
            seatMap.set(me.seat, s);
        }
        if (me.score > bestWinScore) {
            bestWinScore = me.score;
            bestWinRec = r;
        }
    }
    // MVP：同桌次数最多
    let mvpNickname = '-';
    let mvpGames = 0;
    mvpMap.forEach((v, k) => { if (v > mvpGames) {
        mvpGames = v;
        mvpNickname = k;
    } });
    // 最常玩法
    let topRuleName = '-';
    let topRuleCount = 0;
    ruleMap.forEach((v, k) => { if (v > topRuleCount) {
        topRuleCount = v;
        topRuleName = k;
    } });
    const winRate = Math.round((wins / monthRecords.length) * 100);
    // 最长连胜（按时间升序；输或平都断连胜）
    const sorted = [...monthRecords].sort((a, b) => a.playedAt - b.playedAt);
    let curWin = 0;
    let maxWinStreak = 0;
    for (const r of sorted) {
        const me = r.players.find(p => p.playerId === playerId);
        if (!me)
            continue;
        if (me.score > 0) {
            curWin++;
            if (curWin > maxWinStreak)
                maxWinStreak = curWin;
        }
        else {
            curWin = 0;
        }
    }
    // 时段：四个全量，isBest = 有数据的时段里净胜分最高者
    let bestDurNet = -Infinity;
    let bestDurKey = null;
    DURATION_KEYS.forEach(k => {
        const s = durMap.get(k);
        if (s && s.games > 0 && s.net > bestDurNet) {
            bestDurNet = s.net;
            bestDurKey = k;
        }
    });
    const durations = DURATION_KEYS.map(k => {
        const s = durMap.get(k);
        const has = s && s.games > 0;
        const net = has ? s.net : 0;
        return {
            key: k,
            label: DURATION_LABELS[k],
            games: s ? s.games : 0,
            winRateText: has ? `${Math.round((s.wins / s.games) * 100)}%` : '-',
            netScoreText: has ? signed(net) : '-',
            tone: !has ? 'flat' : net > 0 ? 'pos' : net < 0 ? 'neg' : 'flat',
            isBest: k === bestDurKey
        };
    });
    // 方位：isBest = 坐过且净胜分最高
    let bestSeatNet = -Infinity;
    let bestSeatKey = null;
    SEAT_KEYS.forEach(k => {
        const s = seatMap.get(k);
        if (s && s.games > 0 && s.net > bestSeatNet) {
            bestSeatNet = s.net;
            bestSeatKey = k;
        }
    });
    const seats = SEAT_KEYS.map(k => {
        const s = seatMap.get(k);
        const has = s && s.games > 0;
        const net = has ? s.net : 0;
        return {
            key: k,
            label: SEAT_LABELS[k],
            games: s ? s.games : 0,
            netScoreText: has ? signed(net) : '-',
            tone: !has ? 'flat' : net > 0 ? 'pos' : net < 0 ? 'neg' : 'flat',
            isBest: k === bestSeatKey
        };
    });
    // 最大单局
    let bestWin = null;
    if (bestWinRec) {
        const partners = bestWinRec.players
            .filter(p => p.playerId !== playerId)
            .map(p => p.nickname)
            .join('、');
        bestWin = {
            scoreText: signed(bestWinScore),
            dateText: fmtMonthDay(bestWinRec.playedAt),
            partnersText: partners || '-'
        };
    }
    // 最扎心对手：同桌净分（我的视角）最低且 < 0
    let pain = null;
    let painNet = 0;
    oppMap.forEach((v, k) => {
        if (v.net < painNet) {
            painNet = v.net;
            pain = { nickname: k, netScoreText: signed(v.net), games: v.games };
        }
    });
    // 环比上月（上月没打过就不显示环比）
    const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
    const lastRecords = records.filter(r => inMonth(r, prev.y, prev.m));
    let mom = null;
    if (lastRecords.length > 0) {
        let lastWins = 0;
        let lastNet = 0;
        for (const r of lastRecords) {
            const me = r.players.find(p => p.playerId === playerId);
            if (!me)
                continue;
            lastNet += me.score;
            if (me.score > 0)
                lastWins++;
        }
        const lastWinRate = Math.round((lastWins / lastRecords.length) * 100);
        const netDelta = netScore - lastNet;
        const wrDelta = winRate - lastWinRate;
        // 净胜分环比带 +/− 号；胜率环比单位是百分点（差值直接拼 %）
        const arrow = (n, fmt) => n > 0 ? { t: `↑ ${fmt(n)}`, c: 'up' } :
            n < 0 ? { t: `↓ ${fmt(Math.abs(n))}`, c: 'down' } :
                { t: '→ 持平', c: 'flat' };
        const nd = arrow(netDelta, signed);
        const wd = arrow(wrDelta, v => `${v}%`);
        mom = {
            netDeltaText: nd.t, netDeltaClass: nd.c,
            winRateDeltaText: wd.t, winRateDeltaClass: wd.c
        };
    }
    return {
        year, month,
        totalGames: monthRecords.length,
        winRate,
        winRateText: `${winRate}%`,
        netScore,
        netScoreText: signed(netScore),
        mvpNickname, mvpGames,
        topRuleName, topRuleCount,
        title: pickTitle(monthRecords.length, winRate, netScore, maxWinStreak),
        durations, seats,
        bestWin,
        streakText: maxWinStreak >= 3 ? `最长 ${maxWinStreak} 连胜` : '',
        pain,
        mom,
        complianceText: `依据本月 ${monthRecords.length} 局战绩统计 · 非预测`
    };
}
