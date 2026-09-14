// utils/constants.ts - 常量

/**
 * MVP 支持的玩法
 */
export const SUPPORTED_RULES = [
  { id: 'xuezhan', name: '血战到底', desc: '川麻主流，一家胡牌不结束' },
  { id: 'qiaoma', name: '上海敲麻', desc: '上海地区流行，有敲麻规则' },
  { id: 'tuidaohu', name: '广东推倒胡', desc: '广东主流，可吃可碰' }
] as const;

/**
 * 时段选项
 */
export const DURATIONS = [
  { id: 'afternoon', name: '下午', icon: '☀️' },
  { id: 'evening', name: '晚上', icon: '🌙' },
  { id: 'overnight', name: '通宵', icon: '🌃' }
] as const;

/**
 * 心情选项
 */
export const MOODS = [
  { id: 'smooth', name: '顺', icon: '🙂', color: '#BA7517' },
  { id: 'peak', name: '旺', icon: '🔥', color: '#1D9E75' },
  { id: 'low', name: '衰', icon: '😢', color: '#888780' },
  { id: 'explosive', name: '炸', icon: '💥', color: '#4A9D7E' }
] as const;

/**
 * Storage 键名（与 storage.ts 同步）
 */
export const STORAGE_KEYS = {
  RECORDS: 'mahjong:records',
  PLAYERS: 'mahjong:players',
  SETTINGS: 'mahjong:settings',
  STATS: 'mahjong:stats'
} as const;

/**
 * 最低战绩要求
 */
export const MIN_GAMES_FOR_ANALYSIS = 3;

/**
 * 最大同场玩家数
 */
export const MAX_PLAYERS = 8;

/**
 * 最小同场玩家数
 */
export const MIN_PLAYERS = 2;

/**
 * 分数上下限
 */
export const SCORE_MIN = -9999;
export const SCORE_MAX = 9999;