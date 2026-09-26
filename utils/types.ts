// utils/types.ts - 全局类型定义

/**
 * 玩法类型（预设）
 * 对齐腾讯欢乐麻将全集的主流玩法：
 * - xuezhan:    血战到底（川麻主流）
 * - xueliu:     血流成河（川麻，胡牌继续打）
 * - tuidaohu:   广东推倒胡
 * - guobiao:    国标麻将
 * - erren:      二人雀神（2 人对战）
 * - wuhanhua:   武汉花麻将（无番）
 * - changsha:   长沙麻将
 * - custom:     自定义玩法（ruleName 存用户输入的名字）
 */
export type RuleType =
  | 'xuezhan' | 'xueliu' | 'tuidaohu' | 'guobiao'
  | 'erren' | 'wuhanhua' | 'changsha'
  | 'custom';

/**
 * 时段
 */
export type GameDuration = 'morning' | 'afternoon' | 'evening' | 'overnight';

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
 * 牌局月历单日数据
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
  /** 「我」绑定的玩家档案 ID（昵称修改 / 首页快捷加我 都基于它） */
  myPlayerId?: string;
  /**
   * 上一次记分用的玩法（首页 onLoad 优先用这个作默认选中）
   * - 新用户没有 → 沿用 defaultRuleType（兼容老用户）
   * - 用户每次保存战绩后会更新
   */
  lastRuleType?: RuleType;
  /**
   * 上一次记分用的时段（morning / afternoon / evening / overnight）
   * - 新用户没有 → 按本机时间自动判断
   */
  lastDuration?: GameDuration;
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
 * 玩法标签（预设玩法；custom 的 ruleName 是用户输入，走各处 fallback）
 */
export const RULE_LABELS: Record<RuleType, string> = {
  xuezhan: '血战到底',
  xueliu: '血流成河',
  tuidaohu: '广东推倒胡',
  guobiao: '国标麻将',
  erren: '二人雀神',
  wuhanhua: '武汉花麻将',
  changsha: '长沙麻将',
  custom: '自定义玩法'
};

/**
 * 时段标签
 */
export const DURATION_LABELS: Record<GameDuration, string> = {
  morning: '上午',
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