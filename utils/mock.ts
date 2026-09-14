// utils/mock.ts - 开发环境演示数据生成器
//
// 入口：「我的 → 开发者选项 → 生成演示数据」（release 包自动隐藏该分组）
//
// 数据遵守两条硬约束：
//   1. players[0] 固定是「我」—— index.ts 的胜率、analysis.ts 的默认分析对象都以它为准
//   2. 每局所有玩家分数之和 = 0 —— 后端 /api/records 会校验 SCORE_NOT_BALANCED
//
// 数据里刻意埋了两个清晰信号，用来演示「福星克星」：
//   · 老张 同桌时「我」长期赢钱  → 会出现在「福星」榜
//   · 阿强 同桌时「我」长期输钱  → 会出现在「克星」榜
//   · 两人同场概率只有 10%，保证信号不被互相抵消

import { GameRecord, Player, PlayerScore, RuleType, GameDuration, Mood } from './types';
import { RULE_LABELS, PLAYER_COLORS } from './types';
import { getPlayers, getRecords, setPlayers, setRecords, uuid } from './storage';

// ========== 可复现随机数 ==========

type Rng = () => number;

/** mulberry32：同一个 seed 永远生成同一份数据 */
function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 标准正态分布（Box-Muller） */
function gauss(rng: Rng): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function intBetween(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function shuffled<T>(rng: Rng, arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

/** 麻将分数一般取 5 的倍数 */
function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

// ========== 人设 ==========

const SELF = '我';
const LUCKY = { nickname: '老张', bias: 44 };   // 福星
const EVIL = { nickname: '阿强', bias: -48 };   // 克星
const FILLERS = ['王姐', '小李', '老陈', '阿珍', '大刘'];

const NOTES = [
  '三缺一，等了一个多钟头',
  '手气爆棚，连庄三把',
  '打到凌晨两点才散',
  '最后一把被自摸翻盘',
  '王姐带了水果',
  '换了个新牌桌，座位有点挤',
  '下午茶配麻将，舒服',
  '阿强今天又自摸了两把',
  '老张手太顺了，服气',
  '散场去吃了个宵夜'
];

/** 深圳牌桌的玩法分布 */
function weightedRule(rng: Rng): RuleType {
  const r = rng();
  if (r < 0.55) return 'tuidaohu';
  if (r < 0.90) return 'xuezhan';
  return 'qiaoma';
}

/** 组一桌：固定 3~4 人，「我」永远排在第 0 位 */
function pickTable(rng: Rng): string[] {
  const others: string[] = [];
  const r = rng();
  if (r < 0.36) {
    others.push(LUCKY.nickname);
  } else if (r < 0.68) {
    others.push(EVIL.nickname);
  } else if (r < 0.78) {
    others.push(LUCKY.nickname);
    others.push(EVIL.nickname);
  }

  const size = rng() < 0.15 ? 3 : 4;
  const fillers = shuffled(rng, FILLERS);
  for (const name of fillers) {
    if (others.length + 1 >= size) break;
    others.push(name);
  }

  return [SELF].concat(shuffled(rng, others));
}

/** 心情跟当场输赢走（用户也可能懒得选，留空） */
function moodFor(rng: Rng, mine: number): Mood | null {
  if (rng() < 0.18) return null;
  if (mine >= 120) return 'explosive';
  if (mine >= 45) return 'peak';
  if (mine > 0) return 'smooth';
  if (mine <= -60) return 'low';
  return rng() < 0.5 ? 'low' : null;
}

// ========== 单局分数 ==========

/**
 * 生成一局的分数：先定「我」的分（带人设偏移），再把负值分摊给其他人
 * 保证总和精确等于 0
 */
function buildScores(
  rng: Rng,
  table: string[],
  bias: number,
  idOf: (nickname: string) => string
): PlayerScore[] {
  let mine = round5(gauss(rng) * 30 + bias);
  if (mine === 0) mine = rng() < 0.5 ? 5 : -5;
  mine = Math.max(-350, Math.min(350, mine));

  const others = table.length - 1;
  const units = -mine / 5;   // 「我」是 5 的倍数，所以这里一定是整数
  const weights: number[] = [];
  for (let i = 0; i < others; i++) weights.push(0.35 + rng());
  const weightSum = weights.reduce((a, b) => a + b, 0);

  const shares: number[] = [];
  let assigned = 0;
  for (let i = 0; i < others - 1; i++) {
    const v = Math.round(units * (weights[i] / weightSum));
    shares.push(v);
    assigned += v;
  }
  shares.push(units - assigned);   // 余数给最后一位吸收

  // 打乱，避免"队尾玩家"总是拿到余数
  const finalShares = shuffled(rng, shares);

  const out: PlayerScore[] = [{
    playerId: idOf(table[0]),
    nickname: table[0],
    score: mine,
    isSubstitute: false,
    isObserver: false
  }];

  for (let i = 0; i < others; i++) {
    out.push({
      playerId: idOf(table[i + 1]),
      nickname: table[i + 1],
      score: finalShares[i] * 5,
      isSubstitute: false,
      isObserver: false
    });
  }

  return out;
}

// ========== 玩家档案统计 ==========

function scoreOf(record: GameRecord, playerId: string): number | null {
  const entry = record.players.find(p => p.playerId === playerId);
  return entry ? entry.score : null;
}

function applyPlayerStats(players: Player[], records: GameRecord[]): void {
  const asc = records.slice().sort((a, b) => a.playedAt - b.playedAt);

  for (const player of players) {
    const mine = asc.filter(r => r.players.some(p => p.playerId === player.id));

    let totalScore = 0;
    let wins = 0;
    let runWin = 0;
    let runLose = 0;
    let maxWin = 0;
    let maxLose = 0;
    let tail = 0;

    for (const r of mine) {
      const score = scoreOf(r, player.id);
      if (score === null) continue;
      totalScore += score;

      if (score > 0) {
        wins++;
        runWin++;
        runLose = 0;
        if (runWin > maxWin) maxWin = runWin;
        tail = tail > 0 ? tail + 1 : 1;
      } else if (score < 0) {
        runLose++;
        runWin = 0;
        if (runLose > maxLose) maxLose = runLose;
        tail = tail < 0 ? tail - 1 : -1;
      } else {
        runWin = 0;
        runLose = 0;
        tail = 0;
      }
    }

    player.totalGames = mine.length;
    player.totalScore = totalScore;
    player.winRate = mine.length > 0 ? wins / mine.length : 0;
    player.maxWinStreak = maxWin;
    player.maxLoseStreak = maxLose;
    player.currentStreak = tail;
  }
}

// ========== 主生成器 ==========

export interface MockSummary {
  records: number;
  players: number;
  firstDate: string;
  lastDate: string;
  myGames: number;
  myWins: number;
  myWinRate: number;
  myNetScore: number;
}

const DAYS_BACK = 165;   // 约 5.5 个月

export function generateMockData(seed = 20260913): { records: GameRecord[]; players: Player[] } {
  const rng = createRng(seed);
  const now = Date.now();

  // ---- 玩家档案（数组顺序即 players[0] = 我）----
  const roster = [SELF, LUCKY.nickname, EVIL.nickname].concat(FILLERS);
  const players: Player[] = roster.map((nickname, i) => ({
    id: uuid(),
    nickname,
    color: PLAYER_COLORS[i % PLAYER_COLORS.length],
    createdAt: now,
    totalGames: 0,
    totalScore: 0,
    winRate: 0,
    maxWinStreak: 0,
    maxLoseStreak: 0,
    currentStreak: 0
  }));

  const idOf = (nickname: string): string => {
    const found = players.find(p => p.nickname === nickname);
    return found ? found.id : players[0].id;
  };

  // ---- 逐日铺牌局 ----
  const records: GameRecord[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let back = DAYS_BACK; back >= 0; back--) {
    const day = new Date(today.getTime() - back * 86400000);
    const dow = day.getDay();
    const isWeekend = dow === 0 || dow === 5 || dow === 6;

    // 牌桌节奏：周末（五/六/日）多，工作日偶尔
    // 最近两周再密一点 —— 演示时默认打开的就是当月，太稀撑不起牌运月历
    const base = isWeekend ? 0.48 : 0.13;
    const chance = back <= 14 ? Math.min(0.70, base + 0.18) : base;
    if (rng() > chance) continue;

    // 一次牌局：玩法、时段固定，人数与心情每局独立
    const ruleType = weightedRule(rng);
    const roll = rng();
    const duration: GameDuration = roll < 0.22 ? 'afternoon' : roll < 0.85 ? 'evening' : 'overnight';
    const startHour = duration === 'afternoon' ? 14 : duration === 'evening' ? 19 : 22;

    let clock = day.getTime() + startHour * 3600000 + intBetween(rng, 0, 3) * 900000;
    const rounds = intBetween(rng, 2, 5);

    for (let k = 0; k < rounds; k++) {
      const playedAt = clock;
      clock += intBetween(rng, 35, 75) * 60000;

      if (playedAt > now) continue;   // 不生成未来时间

      const table = pickTable(rng);
      let bias = 0;
      if (table.indexOf(LUCKY.nickname) >= 0) bias += LUCKY.bias;
      if (table.indexOf(EVIL.nickname) >= 0) bias += EVIL.bias;

      const scores = buildScores(rng, table, bias, idOf);
      const myScore = scores[0].score;

      records.push({
        id: uuid(),
        createdAt: playedAt + 60000,
        playedAt,
        ruleType,
        ruleName: RULE_LABELS[ruleType],
        duration,
        players: scores,
        totalFee: 0,
        note: rng() < 0.12 ? pick(rng, NOTES) : '',
        mood: moodFor(rng, myScore)
      });
    }
  }

  // 新 → 旧（与 addRecord 的 unshift 语义一致）
  records.sort((a, b) => b.playedAt - a.playedAt);
  applyPlayerStats(players, records);

  return { records, players };
}

// ========== 环境判断 / 读写 ==========

/** 只有非 release 包才显示「开发者选项」 */
export function isDevEnv(): boolean {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion !== 'release';
  } catch (e) {
    return false;
  }
}

const SNAPSHOT_KEY = 'mahjong:preMockSnapshot';

function ymd(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => (`0${n}`).slice(-2);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 生成并写入演示数据；写入前先把当前数据存一份快照
 * 便于「恢复生成前数据」回滚
 */
export function loadMockData(seed = 20260913): MockSummary {
  try {
    wx.setStorageSync(SNAPSHOT_KEY, {
      records: getRecords(),
      players: getPlayers(),
      at: Date.now()
    });
  } catch (e) {
    // 快照失败不阻塞生成
  }

  const { records, players } = generateMockData(seed);
  setPlayers(players);
  setRecords(records);

  const me = players[0];
  const mine = records.filter(r => r.players.some(p => p.playerId === me.id));
  const wins = mine.filter(r => (scoreOf(r, me.id) || 0) > 0).length;

  return {
    records: records.length,
    players: players.length,
    firstDate: records.length > 0 ? ymd(records[records.length - 1].playedAt) : '',
    lastDate: records.length > 0 ? ymd(records[0].playedAt) : '',
    myGames: mine.length,
    myWins: wins,
    myWinRate: mine.length > 0 ? wins / mine.length : 0,
    myNetScore: me.totalScore
  };
}

/** 有没有可回滚的快照 */
export function hasSnapshot(): boolean {
  try {
    return !!wx.getStorageSync(SNAPSHOT_KEY);
  } catch (e) {
    return false;
  }
}

/** 回滚到生成演示数据之前 */
export function restoreSnapshot(): boolean {
  try {
    const snap = wx.getStorageSync(SNAPSHOT_KEY);
    if (!snap) return false;
    setRecords(snap.records || []);
    setPlayers(snap.players || []);
    return true;
  } catch (e) {
    return false;
  }
}
