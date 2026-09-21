// utils/storage.ts - 本地存储封装
import { PLAYER_COLORS } from './types';
/**
 * Storage 键名
 */
const KEYS = {
    RECORDS: 'mahjong:records',
    PLAYERS: 'mahjong:players',
    SETTINGS: 'mahjong:settings',
    STATS: 'mahjong:stats'
};
/**
 * 安全获取 Storage 数据
 */
function get(key, defaultValue) {
    try {
        const value = wx.getStorageSync(key);
        if (value === '' || value === undefined || value === null) {
            return defaultValue;
        }
        return value;
    }
    catch (e) {
        console.error(`[Storage] get ${key} failed:`, e);
        return defaultValue;
    }
}
/**
 * 安全设置 Storage 数据
 */
function set(key, value) {
    try {
        wx.setStorageSync(key, value);
        return true;
    }
    catch (e) {
        console.error(`[Storage] set ${key} failed:`, e);
        return false;
    }
}
/**
 * 生成 UUID
 */
export function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
// ========== 战绩记录 ==========
export function getRecords() {
    return get(KEYS.RECORDS, []);
}
export function setRecords(records) {
    return set(KEYS.RECORDS, records);
}
export function addRecord(record) {
    const records = getRecords();
    records.unshift(record); // 新战绩置顶
    setRecords(records);
    return records;
}
export function deleteRecord(id) {
    const records = getRecords().filter(r => r.id !== id);
    setRecords(records);
    return records;
}
export function getRecordById(id) {
    return getRecords().find(r => r.id === id);
}
// ========== 玩家档案 ==========
export function getPlayers() {
    return get(KEYS.PLAYERS, []);
}
export function setPlayers(players) {
    return set(KEYS.PLAYERS, players);
}
export function upsertPlayer(player) {
    const players = getPlayers();
    const idx = players.findIndex(p => p.id === player.id);
    if (idx >= 0) {
        players[idx] = player;
    }
    else {
        players.push(player);
    }
    setPlayers(players);
    return players;
}
/**
 * 删除一个牌友档案
 *
 * 只删档案，不动历史战绩——record.players[].nickname 是记录当时的快照，
 * 保留历史真相（后端 record_players.player_id 同样故意不设外键）。
 *
 * 保护：「我」不能删（否则 getMe() 会回退到 players[0]，身份漂移）。
 *
 * @returns ok=false 时 message 为失败原因（用于 toast）
 */
export function deletePlayer(id) {
    const players = getPlayers();
    const target = players.find(p => p.id === id);
    if (!target) {
        return { ok: false, message: '牌友不存在', players };
    }
    const me = getMe();
    if (me && me.id === id) {
        return { ok: false, message: '不能删除「我」', players };
    }
    const next = players.filter(p => p.id !== id);
    setPlayers(next);
    return { ok: true, message: target.nickname, players: next };
}
export function findOrCreatePlayer(nickname) {
    const players = getPlayers();
    let player = players.find(p => p.nickname === nickname);
    if (!player) {
        player = {
            id: uuid(),
            nickname,
            color: PLAYER_COLORS[players.length % PLAYER_COLORS.length],
            createdAt: Date.now(),
            totalGames: 0,
            totalScore: 0,
            winRate: 0,
            maxWinStreak: 0,
            maxLoseStreak: 0,
            currentStreak: 0
        };
        players.push(player);
        setPlayers(players);
    }
    return player;
}
// ========== 「我」的身份 ==========
// 约定：record.players[0] 是「我」（历史数据如此）。
// 新代码用 settings.myPlayerId 显式绑定；未绑定时回退 players[0] 兼容老用户。
/** 当前用户对应的玩家档案（未记录过牌局时可能为空） */
export function getMe() {
    const settings = getSettings();
    const players = getPlayers();
    if (settings.myPlayerId) {
        const bound = players.find(p => p.id === settings.myPlayerId);
        if (bound)
            return bound;
    }
    return players.length > 0 ? players[0] : undefined;
}
/**
 * 在一局战绩里定位「我」的那条记录 —— **全项目唯一入口，别再自己猜**
 *
 * 历史踩坑：各处都假设 `players[0] 就是「我」`，从 players[0].score 取个人分。
 * 但这个前提早已不成立：players 的顺序就是用户在记分页点牌友的先后
 * （"+ 我"完全可以最后才点），而且移出某个人后顺序会整体前移。
 * 只要「我」不排在首位，胜率 / 连胜 / 净胜分 / 月历算的全是**别人的分数**
 * ——表现为"我记的是负数，却显示连胜、胜率 100%"。
 *
 * 判定优先级（强 → 弱）：
 * 1. playerId === getMe().id   唯一可靠依据
 * 2. nickname === getMe().nickname   兼容「我」的档案被重建、id 变了但昵称一致的历史数据
 * 3. 都没有 → 返回 **null（我没参与这局）**，由调用方跳过，不要拿别人的分数充数
 *
 * 唯一例外：本机压根没有「我」的档案（老数据 / 从未登录过）时退回 players[0]，
 * 避免存量用户的统计集体归零。
 */
export function selfIn(record) {
    const ps = record.players || [];
    if (ps.length === 0)
        return null;
    const me = getMe();
    if (!me)
        return ps[0];
    const byId = ps.find(p => p.playerId && p.playerId === me.id);
    if (byId)
        return byId;
    const byName = ps.find(p => p.nickname && p.nickname === me.nickname);
    if (byName)
        return byName;
    // 「我」不在这一局（纯给别人记分）：返回 null，统计侧要跳过，不能拿别人的分数当我的
    return null;
}
/** 「我」在这局的分数；误名或未参与的局返回 undefined，不该计入个人统计 */
export function selfScoreIn(record) {
    const me = selfIn(record);
    return me ? me.score : null;
}
/**
 * 从最近 recentGames 场战绩里统计阵容
 *
 * 口径（2026-09-21 与铁匠确认）：只看近期，反映"当下这个圈子谁在打"，
 * 不被半年前的老搭子干扰。
 *
 * @param recentGames 纳入统计的场次（默认最近 10 场）
 * @param maxMembers  一个阵容最多几个人（默认 4，麻将常见桌位）
 */
export function getRecentLineups(records, recentGames = 10, maxMembers = 4) {
    const recent = [...records]
        .sort((a, b) => b.playedAt - a.playedAt)
        .slice(0, recentGames);
    if (recent.length === 0)
        return [];
    const me = getMe();
    const meId = me ? me.id : '';
    // 逐局扫描：累计出现次数 + 记录昵称（无 playerId 的快照无法回加本局，跳过）
    const freq = new Map();
    const lastGameIds = [];
    const nameById = new Map();
    recent.forEach((r, i) => {
        for (const p of r.players) {
            if (!p.playerId)
                continue;
            if (meId && p.playerId === meId)
                continue; // 「我」不进组合
            nameById.set(p.playerId, p.nickname);
            if (i === 0 && !lastGameIds.includes(p.playerId))
                lastGameIds.push(p.playerId);
            const e = freq.get(p.playerId) || { nickname: p.nickname, count: 0, lastAt: 0 };
            e.count += 1;
            e.lastAt = Math.max(e.lastAt, r.playedAt);
            freq.set(p.playerId, e);
        }
    });
    const keyOf = (ids) => [...ids].sort().join(',');
    const textOf = (ids) => ids.map(id => nameById.get(id) || '?').join(' · ');
    // 阵容 1：最近这些场里出现 ≥ 2 次的（出现 1 次说明是临时来客，不算"常一起"）
    const usualIds = [...freq.entries()]
        .filter(([, v]) => v.count >= 2)
        .sort((a, b) => b[1].count - a[1].count || b[1].lastAt - a[1].lastAt)
        .slice(0, maxMembers)
        .map(([id]) => id);
    const lineups = [];
    if (usualIds.length >= 2) {
        lineups.push({
            id: keyOf(usualIds),
            label: '常一起打的',
            memberIds: usualIds,
            text: textOf(usualIds)
        });
    }
    // 阵容 2：上一局原班（原班再战很常见；与阵容 1 重复就不展示）
    const lastIds = lastGameIds.slice(0, maxMembers);
    if (lastIds.length >= 2 && keyOf(lastIds) !== keyOf(usualIds)) {
        lineups.push({
            id: keyOf(lastIds),
            label: '上一局原班',
            memberIds: lastIds,
            text: textOf(lastIds)
        });
    }
    return lineups;
}
/** 取「我」的档案；没有就创建一个（默认昵称「我」）并绑定 */
export function ensureMe() {
    const existing = getMe();
    if (existing) {
        bindMe(existing.id);
        return existing;
    }
    const player = findOrCreatePlayer('我');
    bindMe(player.id);
    return player;
}
function bindMe(playerId) {
    const settings = getSettings();
    if (settings.myPlayerId !== playerId) {
        updateSettings({ myPlayerId: playerId });
    }
}
/**
 * 修改「我」的昵称（本地玩家档案 + settings 绑定）
 *
 * 注意：历史战绩里的 players[].nickname 是当时快照，不回改——记录历史真相。
 * @returns ok=false 时 message 为失败原因
 */
export function renameMe(newName) {
    const name = newName.trim();
    if (!name)
        return { ok: false, message: '昵称不能为空' };
    if (name.length > 10)
        return { ok: false, message: '昵称不能超过 10 字' };
    const me = ensureMe();
    const players = getPlayers();
    if (players.some(p => p.id !== me.id && p.nickname === name)) {
        return { ok: false, message: '与已有牌友昵称重复' };
    }
    me.nickname = name;
    upsertPlayer(me);
    bindMe(me.id);
    return { ok: true, message: name };
}
// ========== 设置 ==========
/**
 * 模块加载时刻即锁定首次启动时间。
 * 之前用 `Date.now()` 作为默认值是 bug —— wx.getStorageSync 拿不到值时
 * 会用“调用 getSettings() 的那一刻”作为 firstLaunchAt，等用户调一次
 * 再 setSettings 就会把真值刷成 Date.now()，首次启动时间丢失。
 */
const FIRST_LAUNCH_AT_FALLBACK = Date.now();
export function getSettings() {
    return get(KEYS.SETTINGS, {
        defaultRuleType: 'xuezhan',
        theme: 'light',
        firstLaunchAt: FIRST_LAUNCH_AT_FALLBACK,
        soundEnabled: true
    });
}
export function setSettings(settings) {
    return set(KEYS.SETTINGS, settings);
}
export function updateSettings(partial) {
    const current = getSettings();
    const updated = Object.assign(Object.assign({}, current), partial);
    setSettings(updated);
    return updated;
}
/**
 * 记录用户本次保存的玩法（首页 onLoad 时优先用它作默认选中）
 */
export function rememberLastRuleType(ruleType) {
    updateSettings({ lastRuleType: ruleType });
}
/**
 * 记录用户本次保存的时段（首页 onLoad 优先用它作默认选中）
 */
export function rememberLastDuration(duration) {
    updateSettings({ lastDuration: duration });
}
/**
 * 取首页要用的默认玩法：上次 > settings.defaultRuleType
 */
export function getLastOrDefaultRuleType() {
    const s = getSettings();
    return s.lastRuleType || s.defaultRuleType;
}
// ========== 数据导出/导入 ==========
export function exportAll() {
    return {
        records: getRecords(),
        players: getPlayers(),
        settings: getSettings(),
        exportedAt: Date.now(),
        version: '1.0.0'
    };
}
export function importAll(data) {
    try {
        if (data.records)
            setRecords(data.records);
        if (data.players)
            setPlayers(data.players);
        if (data.settings)
            setSettings(data.settings);
        return true;
    }
    catch (e) {
        console.error('[Storage] importAll failed:', e);
        return false;
    }
}
/**
 * 清空所有数据（带确认）
 */
export function clearAll() {
    wx.removeStorageSync(KEYS.RECORDS);
    wx.removeStorageSync(KEYS.PLAYERS);
    wx.removeStorageSync(KEYS.SETTINGS);
    wx.removeStorageSync(KEYS.STATS);
}
