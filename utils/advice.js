// utils/advice.ts - 月历「宜忌」卡片数据
//
// ⚠️ 合规边界（改动前必读）
// 微信《小程序平台常见拒绝情形》3.2.4 禁止「算命、抽签、星座运势」等测试类内容。
// 所以这里**只做历史战绩的统计摘要，绝不做任何预测/吉凶推算**：
//   ✅ 「与老张同桌：你对他胜率 78%」   ← 描述已发生的事实
//   ❌ 「今天宜打牌」                    ← 预测，禁止
// 渲染时必须同时显示「依据 N 局战绩统计 · 非预测」的免责说明。
//
// 借用黄历「宜/忌」的视觉语言，但内容 100% 来自用户自己的数据。
import { DURATIONS } from './constants';
import { analyzeFortune, formatWinRate, formatNetScore } from './fortune';
/** 单个维度至少要有这么多场才拿来做「宜/忌」结论，避免 1 场碰巧赢了就上榜 */
const MIN_SAMPLE = 3;
/**
 * 组装月历「宜忌」卡片
 *
 * 两个维度（先只上这两个，玩法维度数据量普遍不够）：
 *   1. 牌友 —— 复用 analyzeFortune，保证与「福星克星」页口径完全一致
 *   2. 时段 —— 按 record.duration 聚合个人净胜分（不会出现两套算法打架）
 *
 * @param records 全部战绩
 * @param selfPlayerId 「我」的玩家 ID（个人视角，否则零和记分下净胜分恒为 0）
 */
export function buildMonthAdvice(records, selfPlayerId) {
    const good = [];
    const bad = [];
    // 只统计「我」参与过的场次，且样本太少时整体不展示（避免误导）
    const mine = records.filter(r => r.players.some(p => p.playerId === selfPlayerId));
    if (mine.length < MIN_SAMPLE) {
        return { good, bad, sampleGames: mine.length };
    }
    // ---- 维度 1：牌友 ----
    const fortune = analyzeFortune(records, selfPlayerId);
    if (fortune) {
        const pick = (list) => list.find(p => p.gamesTogether >= MIN_SAMPLE);
        const lucky = pick(fortune.luckyPartners);
        const evil = pick(fortune.evilPartners);
        if (lucky) {
            good.push({
                label: `与${lucky.partnerNickname}同桌`,
                detail: `同桌 ${lucky.gamesTogether} 次 · 胜率 ${formatWinRate(lucky.winRate)}`
            });
        }
        if (evil) {
            bad.push({
                label: `与${evil.partnerNickname}同桌`,
                detail: `同桌 ${evil.gamesTogether} 次 · 胜率 ${formatWinRate(evil.winRate)}`
            });
        }
    }
    // ---- 维度 2：时段 ----
    const statMap = new Map();
    for (const r of mine) {
        const self = r.players.find(p => p.playerId === selfPlayerId);
        if (!self)
            continue;
        const cur = statMap.get(r.duration) || {
            id: r.duration,
            name: '',
            games: 0,
            wins: 0,
            net: 0
        };
        cur.games += 1;
        if (self.score > 0)
            cur.wins += 1;
        cur.net += self.score;
        statMap.set(r.duration, cur);
    }
    const qualified = DURATIONS
        .map(d => {
        const st = statMap.get(d.id);
        return {
            id: d.id,
            name: d.name,
            games: (st === null || st === void 0 ? void 0 : st.games) || 0,
            wins: (st === null || st === void 0 ? void 0 : st.wins) || 0,
            net: (st === null || st === void 0 ? void 0 : st.net) || 0
        };
    })
        .filter(d => d.games >= MIN_SAMPLE);
    // 至少两个时段才可比较——只有一个时段时"宜/忌"没有意义
    if (qualified.length >= 2) {
        const best = [...qualified].sort((a, b) => b.net - a.net)[0];
        const worst = [...qualified].sort((a, b) => a.net - b.net)[0];
        if (best.net > 0) {
            good.push({
                label: `${best.name}场`,
                detail: `${best.games} 场 · 净胜 ${formatNetScore(best.net)}`
            });
        }
        if (worst.net < 0) {
            bad.push({
                label: `${worst.name}场`,
                detail: `${worst.games} 场 · 净胜 ${formatNetScore(worst.net)}`
            });
        }
    }
    return {
        good: good.slice(0, 2),
        bad: bad.slice(0, 2),
        sampleGames: mine.length
    };
}
