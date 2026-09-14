/**
 * 云端同步策略
 *
 * 设计原则：
 * 1. **本地优先**：所有读写先落本地，保证离线可用、瞬时响应
 * 2. **后台静默同步**：本地写完后异步推后端，失败入重试队列
 * 3. **不阻塞 UI**：网络失败只入队列，下次启动或用户主动触发再传
 * 4. **去重**：用 record.id 做幂等，重试不会重复写入
 */

import type { GameRecord } from './types';
import { pushBatch, fetchRecords, fetchMe, healthCheck, request } from './api';
import { setRecords } from './storage';
import { getTier, setTier, setFreeWindowDates, type Tier } from './tier';

const PENDING_KEY = 'mahjong:sync:pending';     // 待上传的战绩 ID 列表
const DELETED_KEY = 'mahjong:sync:deleted';     // 待删除的战绩 ID 列表
const LAST_PULL_AT = 'mahjong:sync:lastPullAt';
const SYNC_STATUS = 'mahjong:sync:status';      // 'idle' | 'syncing' | 'error'

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'disabled';

function getList(key: string): string[] {
  try { return wx.getStorageSync(key) || []; } catch { return []; }
}
function setList(key: string, list: string[]): void {
  try { wx.setStorageSync(key, list); } catch {}
}

/**
 * 加入待上传队列（写入战绩后调用）
 */
export function enqueuePush(recordId: string): void {
  const list = getList(PENDING_KEY);
  if (!list.includes(recordId)) {
    list.unshift(recordId);
    setList(PENDING_KEY, list);
  }
}

/**
 * 加入待删除队列
 */
export function enqueueDelete(recordId: string): void {
  const list = getList(DELETED_KEY);
  if (!list.includes(recordId)) {
    list.push(recordId);
    setList(DELETED_KEY, list);
  }
}

/**
 * 同步状态（供 UI 展示）
 */
export function getSyncStatus(): SyncStatus {
  const pending = getList(PENDING_KEY).length + getList(DELETED_KEY).length;
  const status = wx.getStorageSync(SYNC_STATUS) as SyncStatus;
  if (pending > 0) return 'syncing';
  return status || 'idle';
}

/**
 * 待同步条数（待上传 + 待删除）
 */
export function getPendingCount(): number {
  return getList(PENDING_KEY).length + getList(DELETED_KEY).length;
}

/**
 * 触发同步（自动后台同步用）
 *
 * 只推「待上传队列」——队列由 enqueuePush 在保存战绩时写入。
 * 用户手动点「立即同步」请走 syncFull()。
 *
 * @param records 本地全部战绩（用于根据 ID 找出待上传内容）
 */
export async function syncNow(records: GameRecord[]): Promise<{
  pushed: number;
  deleted: number;
  failed: boolean;
  tier?: Tier;
  trimmed?: number;
}> {
  // 健康检查
  try {
    await healthCheck();
  } catch {
    wx.setStorageSync(SYNC_STATUS, 'error');
    return { pushed: 0, deleted: 0, failed: true };
  }

  wx.setStorageSync(SYNC_STATUS, 'syncing');

  const pendingIds = getList(PENDING_KEY);
  const deletedIds = getList(DELETED_KEY);
  let pushed = 0;
  let deleted = 0;
  let tier: Tier | undefined;
  let trimmed: number | undefined;

  // 1. 批量上传待同步战绩
  if (pendingIds.length > 0) {
    const recordsToPush = records.filter(r => pendingIds.includes(r.id));
    if (recordsToPush.length > 0) {
      try {
        const result = await pushBatch(recordsToPush);
        pushed = result.success;
        tier = result.tier;
        trimmed = result.trimmed;
        // 全部成功才清队列（部分失败保留）
        if (result.failed === 0) {
          setList(PENDING_KEY, []);
        } else {
          const failedIds = result.results.filter(r => !r.ok).map(r => r.id).filter(Boolean);
          setList(PENDING_KEY, failedIds as string[]);
        }
      } catch {
        wx.setStorageSync(SYNC_STATUS, 'error');
        return { pushed, deleted, failed: true };
      }
    } else {
      // 本地找不到对应记录（可能已被删除），清队列
      setList(PENDING_KEY, []);
    }
  }

  // 2. 上报待删除（软删除队列）
  if (deletedIds.length > 0) {
    for (const id of deletedIds) {
      try {
        await request({ url: `/api/records/${id}`, method: 'DELETE', silent: true, showError: false });
        deleted++;
      } catch {
        // 失败保留
      }
    }
    setList(DELETED_KEY, deletedIds.slice(deleted));
  }

  if (tier) setTier(tier);

  wx.setStorageSync(SYNC_STATUS, 'idle');
  wx.setStorageSync(LAST_PULL_AT, Date.now());
  return { pushed, deleted, failed: false, tier, trimmed };
}

/**
 * 全量推送（用户主动点「立即同步」）
 *
 * 与 syncNow 的区别：syncNow 只推待上传队列，队列一旦因换机 / 清缓存丢失
 * 就会漏数据；syncFull 把本地**全部**战绩分批推上去，后端按 id 幂等 upsert，
 * 重复推不会产生脏数据。所以"补救式同步"永远能收敛到正确状态。
 *
 * 后端在写入后会按用户等级修剪云端窗口，并把本次淘汰条数回传（trimmed）。
 */
export async function syncFull(records: GameRecord[]): Promise<{
  pushed: number;
  failed: number;
  trimmed: number;
  tier: Tier;
  error?: string;
}> {
  const initialTier = getTier();
  if (records.length === 0) {
    return { pushed: 0, failed: 0, trimmed: 0, tier: initialTier };
  }

  try {
    await healthCheck();
  } catch {
    return { pushed: 0, failed: 0, trimmed: 0, tier: initialTier, error: '后端不可达' };
  }

  wx.setStorageSync(SYNC_STATUS, 'syncing');

  const CHUNK = 200;          // 与后端 zod 的 max(500) 留出余量
  let pushed = 0;
  let failed = 0;
  let trimmed = 0;
  let tier: Tier = initialTier;
  const failedIds: string[] = [];

  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    try {
      const res = await pushBatch(chunk);
      pushed += res.success;
      failed += res.failed;
      if (res.tier) tier = res.tier;
      if (typeof res.trimmed === 'number') trimmed += res.trimmed;

      res.results.filter(r => !r.ok && r.id).forEach(r => failedIds.push(r.id as string));
    } catch {
      // 整批失败：这些记录全部算失败，重新入队
      failed += chunk.length;
      chunk.forEach(r => failedIds.push(r.id));
    }
  }

  setTier(tier);

  // 队列处理：全成功 → 清空；有失败 → 只留失败的
  if (failed === 0) {
    setList(PENDING_KEY, []);
  } else if (failedIds.length > 0) {
    setList(PENDING_KEY, Array.from(new Set(failedIds)));
  }

  wx.setStorageSync(SYNC_STATUS, failed > 0 ? 'error' : 'idle');
  wx.setStorageSync(LAST_PULL_AT, Date.now());

  return { pushed, failed, trimmed, tier, error: undefined };
}

/**
 * 同 id 合并，按打牌时间倒序
 * 同一条记录冲突时以**云端为准**（云端是同步后的最新副本）
 */
function mergeById(local: GameRecord[], incoming: GameRecord[]): GameRecord[] {
  const map = new Map<string, GameRecord>();
  for (const r of local) map.set(r.id, r);
  for (const r of incoming) map.set(r.id, r);
  return Array.from(map.values()).sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0));
}

/**
 * 翻页拉全云端战绩
 *
 * 单次接口最多 200 条，Pro 用户的历史可能远超这个数。
 * 上限 2000 是防止后端异常时把客户端卡死；正常用户远达不到。
 */
async function fetchAllCloudRecords(): Promise<any[]> {
  const PAGE = 200;
  const MAX = 2000;
  const all: any[] = [];
  let offset = 0;

  while (all.length < MAX) {
    const page = await fetchRecords({ limit: PAGE, offset });
    if (!page || !Array.isArray(page.items) || page.items.length === 0) break;
    all.push(...page.items);
    if (all.length >= (page.total || 0)) break;
    offset += page.items.length;
  }

  return all;
}

/**
 * 拉取云端战绩并合并到本地（换机 / 多端场景）
 *
 * 策略：并集合并，绝不删本地。
 * - 云端有、本地无 → 拉下来
 * - 本地有、云端无 → 推上去（换机前的旧数据补进云端）
 * - 两边都有     → 以云端为准
 *
 * ⚠️ 这里曾经是死代码：函数体算完 toPull 就 return 了，**从来没调过 setRecords**，
 *    所以「从云端拉取」即使接上线也是空操作。现在真的写回本地了。
 */
export async function pullAndMerge(localRecords: GameRecord[]): Promise<{
  pulled: number;
  uploaded: number;
  total: number;
  tier: Tier;
  error?: string;
}> {
  const fallback: Tier = getTier();

  try {
    const cloudList = await fetchAllCloudRecords();
    const cloudMap = new Map(cloudList.map(r => [r.id, r]));
    const localMap = new Map(localRecords.map(r => [r.id, r]));

    const toPull: GameRecord[] = [];
    const toUpload: GameRecord[] = [];

    for (const [id, cloud] of cloudMap) {
      if (!localMap.has(id)) toPull.push(normalizeRecord(cloud));
    }
    for (const [id, local] of localMap) {
      if (!cloudMap.has(id)) toUpload.push(local);
    }

    // 上传本地独有：分批，单批失败不阻塞拉取
    let uploaded = 0;
    let tier: Tier = fallback;
    for (let i = 0; i < toUpload.length; i += 200) {
      try {
        const res = await pushBatch(toUpload.slice(i, i + 200));
        uploaded += res.success;
        if (res.tier) tier = res.tier;
      } catch {
        // 忽略，下次同步再补
      }
    }

    // ★ 关键一步：把云端独有的记录真正落回本地
    const merged = mergeById(localRecords, toPull);
    if (toPull.length > 0) {
      setRecords(merged);
    }

    setTier(tier);
    wx.setStorageSync(LAST_PULL_AT, Date.now());

    return { pulled: toPull.length, uploaded, total: merged.length, tier };
  } catch (e) {
    return { pulled: 0, uploaded: 0, total: localRecords.length, tier: fallback, error: '拉取失败' };
  }
}

function normalizeRecord(raw: any): GameRecord {
  return {
    id: raw.id,
    createdAt: raw.createdAt,
    playedAt: raw.playedAt,
    ruleType: raw.ruleType,
    ruleName: raw.ruleName,
    duration: raw.duration,
    players: raw.players,
    totalFee: raw.totalFee,
    note: raw.note,
    mood: raw.mood
  };
}

/**
 * 在网络可用时尝试触发同步（自动后台）
 * 用户无感；失败也不打扰
 */
export function tryAutoSync(records: GameRecord[]): void {
  // 延迟 2 秒，避开页面刚加载的请求高峰
  setTimeout(() => {
    syncNow(records).catch(() => { /* ignore */ });
  }, 2000);
}

/**
 * 从服务端刷新等级缓存
 * 时机：登录成功后 / 进入「我的」页 / 升级成功后
 * 失败就沿用本地缓存，不打扰用户
 */
export async function refreshTier(): Promise<Tier> {
  try {
    const me = await fetchMe();
    setTier(me.tier);
    setFreeWindowDates(me.limits ? me.limits.cloudWindowDates : undefined);
    return me.tier;
  } catch {
    return getTier();
  }
}

/**
 * 启动时调用（app.onLaunch）
 * - 检查后端健康
 * - 如果有 token，刷新等级 + 触发一次后台同步
 * - 否则静默
 */
export async function bootSync(localRecords: GameRecord[]): Promise<void> {
  const token = wx.getStorageSync('mahjong:token');
  if (!token) return;

  try {
    await healthCheck();
  } catch {
    return; // 后端不可达，跳过
  }

  // 等级缓存可能过期（比如在别的设备上升了 Pro），启动时对齐一次
  refreshTier().catch(() => { /* ignore */ });

  // 有 token + 网络通 → 尝试同步
  tryAutoSync(localRecords);
}