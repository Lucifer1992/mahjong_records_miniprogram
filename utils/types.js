// utils/types.ts - 全局类型定义
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
export const RULE_LABELS = {
    xuezhan: '血战到底',
    xueliu: '血流成河',
    tuidaohu: '广东推倒胡',
    qiaoma: '上海敲麻',
    hongzhong: '红中麻将',
    zhuaji: '捉鸡麻将',
    guobiao: '国标麻将',
    riichi: '日本麻将',
    custom: '自定义玩法'
};
/**
 * 时段标签
 */
export const DURATION_LABELS = {
    afternoon: '下午',
    evening: '晚上',
    overnight: '通宵'
};
/**
 * 心情标签
 */
export const MOOD_LABELS = {
    smooth: '顺',
    peak: '旺',
    low: '衰',
    explosive: '炸'
};
/**
 * 心情 emoji
 */
export const MOOD_EMOJI = {
    smooth: '🙂',
    peak: '🔥',
    low: '😢',
    explosive: '💥'
};
