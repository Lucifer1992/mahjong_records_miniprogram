// utils/types.ts - 全局类型定义

/**
 * 玩法类型
 * xuezhan: 血战到底（川麻主流）
 * qiaoma: 上海敲麻
 * tuidaohu: 推倒胡（广东主流）
 */
export type RuleType = 'xuezhan' | 'qiaoma' | 'tuidaohu';

/**
 * 时段
 */
export type GameDuration = 'afternoon' | 'evening' | 'overnight';

/**
 * 心情
 */
export type Mood = 'smooth' | 'peak' | 'low' | 'explosive';

/**
 * 单场战绩
 */
export interface GameRecord {
  id: string;
  createdAt: number;
  playedAt: number;
  ruleType: RuleType;
  ruleName: string;
  duration: GameDuration;
  players: PlayerScore[];
  totalFee: number;
  note: string;
  mood: Mood | null;
}

/**
 * 玩家分数
 */
export interface PlayerScore {
  playerId: string;
  nickname: string;
  score: number;
  isSubstitute: boolean;
  isObserver: boolean;
}

/**
 * 玩家档案
 */
export interface Player {
  id: string;
  nickname: string;
  color: string;
  createdAt: number;
  totalGames: number;
  totalScore: number;
  winRate: number;
  maxWinStreak: number;
  maxLoseStreak: number;
  currentStreak: number;
}

/**
 * 福星克星分析结果
 */
export interface FortuneAnalysis {
  playerId: string;
  luckyPartners: PartnerStat[];
  evilPartners: PartnerStat[];
  bestPosition: number;
  worstPosition: number;
}

/**
 * 搭档统计
 */
export interface PartnerStat {
  partnerId: string;
  partnerNickname: string;
  gamesTogether: number;
  winsTogether: number;
  winRate: number;
  netScore: number;
}

/**
 * 牌运月历单日数据
 */
export interface CalendarDay {
  date: string;          // YYYY-MM-DD
  gamesPlayed: number;
  netScore: number;
  result: 'win' | 'lose' | 'even' | 'none';
}

/**
 * 设置
 */
export interface Settings {
  defaultRuleType: RuleType;
  theme: 'light' | 'dark';
  firstLaunchAt: number;
  soundEnabled: boolean;
}

/**
 * 玩家颜色池（用于头像）
 */
export const PLAYER_COLORS = [
  '#4A9D7E', '#1D9E75', '#D85A30', '#378ADD',
  '#BA7517', '#993556', '#0F6E56', '#A32D2D',
  '#3B6D11', '#185FA5'
];

/**
 * 玩法标签
 */
export const RULE_LABELS: Record<RuleType, string> = {
  xuezhan: '血战到底',
  qiaoma: '上海敲麻',
  tuidaohu: '广东推倒胡'
};

/**
 * 时段标签
 */
export const DURATION_LABELS: Record<GameDuration, string> = {
  afternoon: '下午',
  evening: '晚上',
  overnight: '通宵'
};

/**
 * 心情标签
 */
export const MOOD_LABELS: Record<Mood, string> = {
  smooth: '顺',
  peak: '旺',
  low: '衰',
  explosive: '炸'
};

/**
 * 心情 emoji
 */
export const MOOD_EMOJI: Record<Mood, string> = {
  smooth: '🙂',
  peak: '🔥',
  low: '😢',
  explosive: '💥'
};