// utils/avatar.ts
// 玩家头像统一解析：自定义 URL（微信头像）优先，内置卡通图兜底
// 账户头像（我的页设置）会同步到「我」的牌友档案 —— 本人信息两处一套头像
/**
 * 统一取头像索引：优先用 stored avatarIdx，否则用昵称哈希，保证 1-20
 */
export function playerAvatarIdx(p) {
    if (p.avatarIdx && p.avatarIdx >= 1 && p.avatarIdx <= 20)
        return p.avatarIdx;
    const h = p.nickname.charCodeAt(0) + (p.nickname.charCodeAt(1) || 0);
    return (h % 20) + 1;
}
/** 内置头像索引 → 包内路径 */
export function builtinAvatarSrc(idx) {
    return `/assets/avatars/avatar-${String(idx).padStart(2, '0')}.png`;
}
/**
 * 玩家头像展示地址：avatarUrl 优先（微信头像/自定义），否则内置卡通图
 * WXML 不能调函数，调用方必须在 TS 里算好塞进视图模型
 */
export function playerAvatarSrc(p) {
    if (p.avatarUrl)
        return p.avatarUrl;
    return builtinAvatarSrc(playerAvatarIdx(p));
}
