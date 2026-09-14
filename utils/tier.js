/**
 * 用户等级（free / pro）本地缓存
 *
 * 服务端是唯一权威，这里只是缓存：
 * UI 需要**同步、即时**地知道"我是不是 Pro"，不能每次渲染都挂一个网络请求。
 * 刷新时机：登录后 / 拉取云端后 / 全量同步后 / 兑换成功后。
 */
const TIER_KEY = 'mahjong:tier';
const WINDOW_KEY = 'mahjong:tier:windowDates';
/** 兜底值，必须与后端 FREE_WINDOW_DATES 默认值一致 */
const DEFAULT_WINDOW = 3;
export function getTier() {
    try {
        return wx.getStorageSync(TIER_KEY) === 'pro' ? 'pro' : 'free';
    }
    catch (_a) {
        return 'free';
    }
}
export function setTier(tier) {
    try {
        wx.setStorageSync(TIER_KEY, tier);
    }
    catch (_a) {
        // 缓存写失败不影响主流程，下次会从服务端再刷
    }
}
export function isPro() {
    return getTier() === 'pro';
}
/**
 * 免费用户云端保留「几个有数据的日期」
 * 用于文案渲染（如"最近 3 天"），避免前端硬编码 3
 */
export function getFreeWindowDates() {
    try {
        const n = Number(wx.getStorageSync(WINDOW_KEY));
        return Number.isFinite(n) && n > 0 ? n : DEFAULT_WINDOW;
    }
    catch (_a) {
        return DEFAULT_WINDOW;
    }
}
export function setFreeWindowDates(n) {
    try {
        const v = Number(n);
        if (Number.isFinite(v) && v > 0) {
            wx.setStorageSync(WINDOW_KEY, v);
        }
    }
    catch (_a) {
        // ignore
    }
}
