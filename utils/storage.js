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
