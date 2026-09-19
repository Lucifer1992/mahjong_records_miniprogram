// utils/constants.ts - 常量

/**
 * 预设玩法（按用户覆盖面挑选：川/粤/沪/鄂豫/黔 + 国标/日麻）
 */
export const SUPPORTED_RULES = [
  { id: 'xuezhan', name: '血战到底', desc: '川麻主流，一家胡牌不结束' },
  { id: 'xueliu', name: '血流成河', desc: '川麻，胡牌后继续打' },
  { id: 'tuidaohu', name: '广东推倒胡', desc: '广东主流，可吃可碰' },
  { id: 'qiaoma', name: '上海敲麻', desc: '上海地区流行玩法' },
  { id: 'hongzhong', name: '红中麻将', desc: '鄂/豫主流，红中赖子' },
  { id: 'zhuaji', name: '捉鸡麻将', desc: '贵州主流，捉鸡算分' },
  { id: 'guobiao', name: '国标麻将', desc: '官方竞赛规则 81 番' },
  { id: 'riichi', name: '日本麻将', desc: '立直麻将，番数计分' }
] as const;

/** 玩法选择器末尾的"自定义"入口（选中后弹输入框，ruleType 存 'custom'） */
export const CUSTOM_RULE_ENTRY = {
  id: 'custom',
  name: '自定义玩法…',
  desc: '输入你们的玩法名称'
} as const;

/** 自定义玩法名的长度上限（与后端 rule_name 上限对齐） */
export const CUSTOM_RULE_NAME_MAX = 12;

/**
 * 预设玩法配色（与 PLAYER_COLORS 同色系；custom 按 ruleName 哈希取色）
 */
export const RULE_COLORS: Record<string, string> = {
  xuezhan: '#4A9D7E',
  xueliu: '#0F6E56',
  tuidaohu: '#D4537E',
  qiaoma: '#378ADD',
  hongzhong: '#A32D2D',
  zhuaji: '#639922',
  guobiao: '#BA7517',
  riichi: '#993556'
};

/** custom 玩法取色池 */
const RULE_COLOR_PALETTE = ['#4A9D7E', '#378ADD', '#D4537E', '#BA7517', '#1D9E75', '#993556', '#639922', '#D85A30'];

/**
 * 玩法 → 颜色。预设查表；自定义（ruleType 为 'custom' 或带 'custom:' 前缀的
 * 复合 key）按 ruleName 哈希从色池取，同名玩法颜色稳定。
 */
export function ruleColor(ruleType: string, ruleName = ''): string {
  const direct = RULE_COLORS[ruleType];
  if (direct) return direct;
  const seed = ruleName || ruleType;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return RULE_COLOR_PALETTE[h % RULE_COLOR_PALETTE.length];
}

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