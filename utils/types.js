// utils/types.ts - 全局类型定义
/** 4 个方位的固定顺序（东→南→西→北，逆时针）。批量添加牌友时按这个顺序勾选 */
export const SEAT_ORDER = ['east', 'south', 'west', 'north'];
/** 方位中文显示 */
export const SEAT_LABELS = {
    east: '东',
    south: '南',
    west: '西',
    north: '北'
};
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
    guobiao: '国标麻将',
    erren: '二人雀神',
    wuhanhua: '武汉花麻将',
    changsha: '长沙麻将',
    custom: '自定义玩法'
};
/**
 * 时段标签
 */
export const DURATION_LABELS = {
    morning: '上午',
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
