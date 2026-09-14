// utils/storage.ts - 本地存储封装
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
        const { PLAYER_COLORS } = require('./types');
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
// ========== 设置 ==========
export function getSettings() {
    return get(KEYS.SETTINGS, {
        defaultRuleType: 'xuezhan',
        theme: 'light',
        firstLaunchAt: Date.now(),
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
