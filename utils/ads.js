/**
 * 流量主广告位配置（免费用户展示 / Pro 免广告）
 *
 * 使用方式：
 * 1. MP 后台 → 流量主 → 广告位管理 → 自主接入 → 创建广告位
 * 2. 把生成的 adunit-xxxx 复制到下面对应字段
 * 3. 留空 = 该广告位不渲染（上线前未配置也不会报错）
 *
 * 注意：
 * - 广告组件首次发布需过微信合规审核（约 1 个工作日）
 * - 按身份区分必须走代码接入（免开发智能接入无法识别 Pro）
 * - 判断在前端（tier 本地缓存）：被绕过最多"多看广告"，无权益泄露风险
 */
export const AD_UNITS = {
    /** 战绩页底部 Banner（原生模板广告 · 16:9 横版卡片 + 20:7 横幅卡片） */
    recordsBanner: 'adunit-370876400edd2ffb',
    /** 激励视频（用途：免费用户看一次视频，限时 24h 解锁完整克星榜） */
    rewardedVideo: 'adunit-1828cc213e7f1060'
};
export function adUnitId(slot) {
    return AD_UNITS[slot];
}
/**
 * 是否渲染广告位：Pro 不渲染；未配置 unit-id 不渲染
 */
export function adEnabled(slot, isProUser) {
    return !isProUser && !!AD_UNITS[slot];
}
// ========== 激励视频 ==========
let rewardedAd = null;
/** 激励视频广告单例（未配置 unit-id 或基础库不支持时返回 null） */
function getRewardedAd() {
    if (!AD_UNITS.rewardedVideo)
        return null;
    if (!wx.createRewardedVideoAd)
        return null;
    if (!rewardedAd) {
        rewardedAd = wx.createRewardedVideoAd({ adUnitId: AD_UNITS.rewardedVideo });
    }
    return rewardedAd;
}
/**
 * 拉起激励视频，用户**完整观看**后 resolve(true)
 * - 中途关闭 / 未配置广告位 / 拉起失败 → resolve(false)
 * 用法：const ok = await showRewardedAd(); if (ok) grantAdUnlock('fortuneFull');
 */
export function showRewardedAd() {
    return new Promise(resolve => {
        const ad = getRewardedAd();
        if (!ad) {
            resolve(false);
            return;
        }
        const onClose = (res) => {
            ad.offClose(onClose);
            resolve(!!(res && res.isEnded));
        };
        ad.onClose(onClose);
        ad.show().catch(() => {
            // 首次 show 失败（未加载完）→ 手动 load 后重试一次
            ad.load()
                .then(() => ad.show())
                .catch(() => {
                ad.offClose(onClose);
                resolve(false);
            });
        });
    });
}
// ========== 看广告 → 限时解锁 ==========
const AD_UNLOCK_KEY = 'mahjong:ad-unlock';
function readUnlocks() {
    try {
        return wx.getStorageSync(AD_UNLOCK_KEY) || {};
    }
    catch (e) {
        return {};
    }
}
/** 授予某项解锁（默认 24 小时有效） */
export function grantAdUnlock(key, durationMs = 24 * 3600 * 1000) {
    const map = readUnlocks();
    map[key] = Date.now() + durationMs;
    try {
        wx.setStorageSync(AD_UNLOCK_KEY, map);
    }
    catch (e) { /* 存储满：解锁失败，下次再看一次广告即可 */ }
}
/** 查询某项是否在解锁有效期内（Pro 恒 true 由调用方短路，不走这里） */
export function isAdUnlocked(key) {
    const expireAt = readUnlocks()[key];
    if (!expireAt)
        return false;
    if (Date.now() > expireAt)
        return false; // 过期视为未解锁
    return true;
}
