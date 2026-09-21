// pages/profile/profile.ts
// 个人中心

import type { GameRecord, Player, Settings } from '../../utils/types';
import { promptLoginIfNeeded, requireLogin } from '../../utils/auth';
import { getPlayers, getRecords, getSettings, updateSettings, exportAll, importAll, clearAll, getMe, renameMe } from '../../utils/storage';
import { getSyncStatus, getPendingCount, syncFull, pullAndMerge, refreshTier, type SyncStatus } from '../../utils/sync';
import { calcSelfWinRate } from '../../utils/stats';
import { getTier, isPro, setTier, getFreeWindowDates, type Tier } from '../../utils/tier';
import { API_BASE, updateNickname, fetchMe, hasToken, createPrepay, getOrder, clearToken } from '../../utils/api';
import { formatDate, formatDateTime } from '../../utils/date';
import { isDevEnv, loadMockData, hasSnapshot, restoreSnapshot } from '../../utils/mock';

/** 导出备份文件的命名前缀（同时用于识别并清理旧备份） */
const BACKUP_PREFIX = '雀战录备份_';

interface MenuItem {
  id: string;
  icon: string;
  iconType: 'cloud' | 'success' | 'warning' | 'moon' | 'bell' | 'info';
  title: string;
  desc: string;
  action: 'tap' | 'switch' | 'navigate';
  value?: boolean;
}

/**
 * 按用户等级生成菜单
 *
 * 「云端同步」这一组的描述必须随等级变化——免费用户点同步前就该知道
 * "云端只留最近几天"，而不是同步完才发现历史被淘汰了。
 */
function buildMenuSections(tier: Tier, windowDates: number, isLoggedIn: boolean): { title: string; items: MenuItem[] }[] {
  const pro = tier === 'pro';

  const accountSection = isLoggedIn
    ? {
        title: '账号',
        items: [
          { id: 'logout', icon: '🚪', iconType: 'warning' as const, title: '退出登录', desc: '清空本地 token，下次操作需重新登录', action: 'tap' as const }
        ]
      }
    : {
        title: '账号',
        items: [
          { id: 'login', icon: '🔑', iconType: 'cloud' as const, title: '登录账号', desc: '登录后可云端同步战绩、换机恢复', action: 'tap' as const }
        ]
      };

  return ([
    {
      title: '云端同步',
      items: [
        {
          id: 'sync',
          icon: '☁️',
          iconType: 'cloud' as const,
          title: '立即同步',
          desc: pro ? '全量推送到云端，永久保存' : `免费版云端只留最近 ${windowDates} 个有数据的日期`,
          action: 'tap' as const
        },
        {
          id: 'pull',
          icon: '⬇️',
          iconType: 'success' as const,
          title: '从云端拉取',
          desc: pro ? '换机恢复 / 多端合并' : `换机恢复（免费版仅最近 ${windowDates} 天）`,
          action: 'tap' as const
        }
      ]
    },
    {
      title: '数据管理',
      items: [
        { id: 'export', icon: '📤', iconType: 'cloud' as const, title: '导出战绩', desc: '转发到微信聊天，可长期保存', action: 'tap' as const },
        { id: 'clear', icon: '🗑️', iconType: 'warning' as const, title: '清空数据', desc: '删除所有战绩和玩家，不可恢复', action: 'tap' as const }
      ]
    },
    {
      title: '偏好设置',
      items: [
        { id: 'sound', icon: '🔊', iconType: 'bell' as const, title: '操作音效', desc: '保存战绩时震动反馈', action: 'switch' as const, value: true }
      ]
    },
    {
      title: '关于',
      items: [
        { id: 'about', icon: 'ℹ️', iconType: 'info' as const, title: '关于雀战录', desc: '版本 1.0.0 · 2026-09-11', action: 'navigate' as const },
        { id: 'privacy', icon: '🔒', iconType: 'cloud' as const, title: '隐私政策', desc: '了解我们如何保护你的数据', action: 'navigate' as const },
        { id: 'terms', icon: '📜', iconType: 'info' as const, title: '用户协议', desc: '使用条款与免责说明', action: 'navigate' as const },
        { id: 'feedback', icon: '💬', iconType: 'bell' as const, title: '意见反馈', desc: '通过微信客服反馈', action: 'tap' as const }
      ]
    },
    {
      title: '开发者选项',
      items: [
        { id: 'mockData', icon: '🧪', iconType: 'info' as const, title: '生成演示数据', desc: '铺一批历史战绩用于演示（仅本地）', action: 'tap' as const },
        { id: 'mockRestore', icon: '↩️', iconType: 'warning' as const, title: '恢复生成前数据', desc: '回滚到生成演示数据之前的状态', action: 'tap' as const }
      ]
    },
    accountSection
  ] as { title: string; items: MenuItem[] }[]).filter(s => s.title !== '开发者选项' || isDevEnv());
}

/**
 * 免费用户「立即同步」的弹窗文案
 *
 * 以前只写「本地 N 条战绩推送到云端」，完全没说清云端到底留多少，
 * 用户看到 3 条就会以为是「近 3 天」还是「近 3 条」的歧义。
 * 现在按**日期维度**把账算清楚：哪几个日期会被保留、多少条会被云端淘汰。
 *
 * 口径与后端 trimFreeWindow 一致：按「有数据的日期」去重，倒序取前 N 个日期保留。
 */
function buildFreeSyncCopy(records: GameRecord[], allDates: string[], windowDates: number): string {
  // 日期倒序取前 N 个 = 云端实际会保留的日期
  const keepDates = new Set([...allDates].sort().reverse().slice(0, windowDates));
  const kept = records.filter(r => keepDates.has(formatDate(r.playedAt))).length;
  const dropped = records.length - kept;

  return dropped > 0
    ? `将把本地 ${records.length} 条战绩（分布在 ${allDates.length} 个日期）推送到云端。\n\n免费版云端只保留最近 ${windowDates} 个有数据的日期（约 ${kept} 条），更早的 ${dropped} 条不会上云。`
    : `将把本地 ${records.length} 条战绩推送到云端，全部保留。`;
}

/**
 * 立即同步 —— 全量推送本地战绩到云端
 *
 * 免费用户推完，后端会按「最近 N 个有数据的日期」修剪云端，并回传淘汰条数。
 * 我们在弹窗里把这件事说清楚，而不是偷偷删。
 */
Page({
  data: {
    totalGames: 0,
    totalPlayers: 0,
    winRate: 0,
    userLevel: 1,
    pendingCount: 0,
    settings: null as Settings | null,
    version: '1.0.0',
    buildTime: '2026-09-11',
    isLoggedIn: hasToken(),   // 顶栏文案 / 退出登录菜单 按登录态切换
    accountName: '',    // 云端账户昵称（登录后显示）
    accountAvatar: '',  // 云端头像完整 URL（空 = 显示默认 🀄）
    syncStatus: 'idle' as SyncStatus,
    apiBase: API_BASE,

    // 等级分层
    tier: 'free' as Tier,
    isPro: false,
    cloudWindowDates: 3,

    menuSections: buildMenuSections('free', 3, false),

    // 工具
    formatDateTime
  },

  onLoad() {
    this.loadData();
    this.refreshTierAsync();
  },

  onShow() {
    promptLoginIfNeeded(this);
    // 同步登录态：用户在其他地方点了退出后回到 profile 页要立刻反映
    this.setData({ isLoggedIn: hasToken() });
    this.loadData();
    this.refreshSyncStatus();
    this.refreshTierAsync();
    this.refreshAccountAsync();
  },

  /** 登录抽屉登录成功回调：刷新登录态相关展示 */
  onLoggedIn() {
    this.setData({ isLoggedIn: true });
    this.loadData();
    this.refreshSyncStatus();
    this.refreshTierAsync();
    this.refreshAccountAsync();
  },

  /**
   * 拉云端账户信息（昵称/头像）用于顶栏展示
   * 未登录直接置默认；拉不到沿用现值，不打扰用户
   */
  async refreshAccountAsync() {
    if (!hasToken()) {
      this.setData({ accountName: '', accountAvatar: '' });
      return;
    }
    try {
      const me = await fetchMe();
      const avatar = me.avatar
        ? (me.avatar.startsWith('http') ? me.avatar : API_BASE + me.avatar)
        : '';
      this.setData({ accountName: me.nickname || '', accountAvatar: avatar });
    } catch {
      // 静默：显示现有值
    }
  },

  /**
   * 从服务端对齐等级（本地缓存可能过期：比如在别的设备上升了 Pro）
   * 拉不到就沿用缓存，不打扰用户
   */
  async refreshTierAsync() {
    await refreshTier();
    this.applyTier();
  },

  /** 按当前等级刷新所有等级相关 UI */
  applyTier() {
    const tier = getTier();
    const windowDates = getFreeWindowDates();
    this.setData({
      tier,
      isPro: tier === 'pro',
      isLoggedIn: hasToken(),
      cloudWindowDates: windowDates,
      menuSections: buildMenuSections(tier, windowDates, hasToken())
    });
  },

  loadData() {
    const records = getRecords();
    const players = getPlayers();
    const settings = getSettings();

    // 胜率判定统一走 calcSelfWinRate → selfIn()（按 playerId 认「我」）
    // 之前：① 用"当场最高分"判定 → 有人赢就算我赢，永远 100%
    //       ② 后来改成 players[0]，但我未必排第一（顺序取决于点牌友先后）→ 照样算成别人的
    const winRate = Math.round(calcSelfWinRate(records) * 100);

    // 等级（每 10 场 +1，最高 99）
    const userLevel = Math.min(99, Math.floor(records.length / 10) + 1);

    this.setData({
      totalGames: records.length,
      totalPlayers: players.length,
      winRate,
      userLevel,
      settings
    });

    this.applyTier();
  },

  refreshSyncStatus() {
    this.setData({
      syncStatus: getSyncStatus(),
      pendingCount: getPendingCount()
    });
  },

  // ========== 数据导出 ==========

  onExport() {
    try {
      const data = exportAll();
      const json = JSON.stringify(data, null, 2);

      // 先清掉上一次的备份，避免沙盒堆积（USER_DATA_PATH 上限 10MB）
      this.cleanOldBackups();

      // 写入沙盒文件（仅为转发做准备；这个路径用户访问不到，不要展示给用户）
      const fs = wx.getFileSystemManager();
      const fileName = `${BACKUP_PREFIX}${this.exportStamp()}.json`;
      const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;

      fs.writeFile({
        filePath,
        data: json,
        encoding: 'utf8',
        success: () => this.shareBackupFile(filePath, fileName),
        fail: (err) => {
          console.error('[Export] write failed:', err);
          wx.showToast({ title: '导出失败', icon: 'none' });
        }
      });
    } catch (e) {
      console.error('[Export] error:', e);
      wx.showToast({ title: '导出失败', icon: 'none' });
    }
  },

  /**
   * 把备份文件转发到微信聊天
   * 沙盒文件用户访问不到，必须走微信转发通道才能真正拿到数据
   */
  shareBackupFile(filePath: string, fileName: string) {
    if (typeof wx.shareFileMessage !== 'function') {
      wx.showModal({
        title: '微信版本过低',
        content: '当前微信不支持转发文件，请升级微信后重试。\n\n换机恢复也可以直接用「从云端拉取」。',
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }

    wx.shareFileMessage({
      filePath,
      fileName,
      success: () => {
        wx.showToast({ title: '已发送到聊天', icon: 'success' });
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (/cancel/i.test(msg)) return; // 用户主动取消，不打扰
        console.error('[Export] share failed:', err);
        wx.showToast({ title: '转发失败', icon: 'none' });
      }
    });
  },

  /** 清理沙盒里旧的备份文件 */
  cleanOldBackups() {
    try {
      const fs = wx.getFileSystemManager();
      const dir = wx.env.USER_DATA_PATH;
      const files = fs.readdirSync(dir) as string[];
      files.forEach((name) => {
        if (name.indexOf(BACKUP_PREFIX) === 0 && /\.json$/.test(name)) {
          try {
            fs.unlinkSync(`${dir}/${name}`);
          } catch (e) {
            // 单个文件删除失败不影响后续
          }
        }
      });
    } catch (e) {
      // 清理失败不阻塞导出主流程
    }
  },

  /** 文件名时间戳，形如 20260913_2130 */
  exportStamp() {
    const d = new Date();
    const p = (n: number) => (`0${n}`).slice(-2);
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  },

  // ========== 数据导入（已从菜单移除，实现保留待「扫码导入」复用） ==========
  // 移除原因：① 让用户手贴沙盒路径，交互不可用
  //           ② importAll 是覆盖式写入，误操作会清空本地数据
  //           ③ 「从云端拉取」已覆盖换机恢复场景

  onImport() {
    wx.showModal({
      title: '导入战绩',
      content: '请将之前的备份 JSON 文件路径粘贴到下方',
      editable: true,
      placeholderText: '文件路径',
      success: (modal) => {
        if (modal.confirm && modal.content) {
          const path = modal.content.trim();
          this.importFromPath(path);
        }
      }
    });
  },

  importFromPath(path: string) {
    try {
      const fs = wx.getFileSystemManager();
      fs.readFile({
        filePath: path,
        encoding: 'utf8',
        success: (res) => {
          try {
            const data = JSON.parse(res.data as string);
            if (importAll(data)) {
              wx.showToast({ title: '导入成功', icon: 'success' });
              this.loadData();
            } else {
              wx.showToast({ title: '数据格式错误', icon: 'none' });
            }
          } catch (e) {
            wx.showToast({ title: 'JSON 解析失败', icon: 'none' });
          }
        },
        fail: () => {
          wx.showToast({ title: '文件读取失败', icon: 'none' });
        }
      });
    } catch (e) {
      wx.showToast({ title: '导入失败', icon: 'none' });
    }
  },

  // ========== 清空数据 ==========

  onClear() {
    wx.showModal({
      title: '⚠️ 清空所有数据',
      content: '此操作会删除所有战绩和玩家档案，且不可恢复。\n\n建议先导出备份。\n\n确认要清空吗？',
      confirmText: '确认清空',
      confirmColor: '#A32D2D',
      success: (res) => {
        if (res.confirm) {
          clearAll();
          wx.showToast({ title: '已清空', icon: 'success' });
          this.loadData();
        }
      }
    });
  },

  // ========== 切换设置 ==========

  onSwitchChange(e: WechatMiniprogram.SwitchChange) {
    const id = e.currentTarget.dataset.id;
    const value = e.detail.value;

    if (id === 'sound') {
      updateSettings({ soundEnabled: value });
      wx.showToast({
        title: value ? '已开启震动' : '已关闭震动',
        icon: 'none',
        duration: 1000
      });
    }
  },

  // ========== 开发者选项（release 包不显示该分组） ==========

  onMockData() {
    const existing = getRecords().length;
    wx.showModal({
      title: '生成演示数据',
      content: existing > 0
        ? `当前已有 ${existing} 条战绩，生成演示数据会覆盖它们。\n\n生成前会自动存一份快照，可以用「恢复生成前数据」回滚。\n\n确定继续吗？`
        : '将生成约 5 个月的历史战绩 + 8 位玩家档案，用于演示「福星克星」和「牌局月历」。\n\n确定继续吗？',
      confirmText: '生成',
      success: (res) => {
        if (!res.confirm) return;
        try {
          const s = loadMockData();
          this.loadData();
          wx.showModal({
            title: '演示数据已就绪',
            content: [
              `战绩：${s.records} 场（${s.firstDate} ~ ${s.lastDate}）`,
              `玩家：${s.players} 位`,
              `我的胜率：${Math.round(s.myWinRate * 100)}%（${s.myWins}/${s.myGames}）`,
              `我的净胜分：${s.myNetScore > 0 ? '+' : ''}${s.myNetScore}`,
              '',
              '⚠️ 仅存在本地，请勿点「立即同步」推送到云端'
            ].join('\n'),
            showCancel: false,
            confirmText: '看看效果'
          });
        } catch (e) {
          console.error('[Mock] generate failed:', e);
          wx.showToast({ title: '生成失败', icon: 'none' });
        }
      }
    });
  },

  onMockRestore() {
    if (!hasSnapshot()) {
      wx.showToast({ title: '没有可恢复的快照', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '恢复生成前数据',
      content: '会把当前数据回滚到上次生成演示数据之前的状态。\n\n确定继续吗？',
      confirmText: '恢复',
      success: (res) => {
        if (!res.confirm) return;
        if (restoreSnapshot()) {
          this.loadData();
          wx.showToast({ title: '已恢复', icon: 'success' });
        } else {
          wx.showToast({ title: '恢复失败', icon: 'none' });
        }
      }
    });
  },

  // ========== 云端同步（分层） ==========

  /**
   * 立即同步 —— 全量推送本地战绩到云端
   *
   * 免费用户推完，后端会按「最近 N 个有数据的日期」修剪云端，并回传淘汰条数。
   * 我们在弹窗里把这件事说清楚，而不是偷偷删。
   */
  onSync() {
    // 云端同步需要登录态（pushBatch 必须带 token）；未登录先弹抽屉
    if (!requireLogin(this)) return;

    const records = getRecords();
    if (records.length === 0) {
      wx.showToast({ title: '还没有战绩可同步', icon: 'none' });
      return;
    }

    const pro = isPro();
    const windowDates = getFreeWindowDates();
    const allDates = Array.from(new Set(records.map(r => formatDate(r.playedAt))));
    const content = pro
      ? `将把本地 ${records.length} 条战绩推送到云端，永久保存。`
      : buildFreeSyncCopy(records, allDates, windowDates);

    wx.showModal({
      title: '立即同步',
      content,
      confirmText: '开始同步',
      success: async (res) => {
        if (!res.confirm) return;

        wx.showLoading({ title: '同步中...', mask: true });
        const r = await syncFull(records);
        wx.hideLoading();

        if (r.error) {
          this.refreshSyncStatus();
          wx.showToast({ title: r.error, icon: 'none' });
          return;
        }

        this.applyTier();
        this.refreshSyncStatus();

        const lines = [`成功上传 ${r.pushed} 条`];
        if (r.failed > 0) lines.push(`失败 ${r.failed} 条（已加入重试队列）`);
        if (r.trimmed > 0) lines.push(`云端按免费额度淘汰了 ${r.trimmed} 条更早的战绩`);

        wx.showModal({
          title: r.failed > 0 ? '同步完成（有失败）' : '同步完成',
          content: lines.join('\n'),
          showCancel: false,
          confirmText: '好的'
        });
      }
    });
  },

  /**
   * 从云端拉取 —— 并集合并，绝不删本地
   *
   * 修复点：这个按钮以前压根没接上线，而且底层 pullAndMerge 也从不写回本地。
   */
  onPull() {
    // 拉取云端需要登录态；未登录先弹抽屉
    if (!requireLogin(this)) return;

    const records = getRecords();
    const pro = isPro();
    const windowDates = getFreeWindowDates();

    const content = pro
      ? '会把云端的战绩合并到本地，不会删除本地任何数据。'
      : `会把云端的战绩合并到本地，不会删除本地任何数据。\n\n免费版云端只存了最近 ${windowDates} 个有数据的日期，所以能拉回的也仅限这些。`;

    wx.showModal({
      title: '从云端拉取',
      content,
      confirmText: '开始拉取',
      success: async (res) => {
        if (!res.confirm) return;

        wx.showLoading({ title: '拉取中...', mask: true });
        const r = await pullAndMerge(records);
        wx.hideLoading();

        if (r.error) {
          wx.showToast({ title: r.error, icon: 'none' });
          return;
        }

        this.loadData();
        this.applyTier();

        wx.showModal({
          title: '拉取完成',
          content: [
            `云端新增 ${r.pulled} 条`,
            `本地补传 ${r.uploaded} 条`,
            `当前共 ${r.total} 条战绩`
          ].join('\n'),
          showCancel: false,
          confirmText: '好的'
        });
      }
    });
  },

  /**
   * 顶栏点击：未登录时触发登录抽屉；已登录时弹出昵称编辑弹窗
   * （复用 onEditNickname：本地改名 + 云端尽力同步）
   */
  onUserHeroTap() {
    if (!hasToken()) {
      this.promptLoginDrawer();
      return;
    }
    this.onEditNickname();
  },

  /** 拉起登录抽屉（用于"账号"菜单 / 顶栏"登录"提示） */
  promptLoginDrawer() {
    (this as any).selectComponent?.('#loginDrawer')?.show?.();
  },

  /**
   * 退出登录：清掉本地 token + tier 缓存，但不删本地战绩。
   * 云端数据保留（用户重新登录可恢复）。
   */
  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后将清空本地登录态。\n\n· 本地战绩不受影响，仍可记录\n· 下次操作需重新登录\n· 云端战绩保留，重新登录后可继续同步',
      confirmText: '退出',
      cancelText: '取消',
      confirmColor: '#A32D2D',
      success: (r) => {
        if (!r.confirm) return;
        clearToken();
        setTier('free');
        this.setData({ isLoggedIn: false });
        this.applyTier();
        this.refreshAccountAsync();
        wx.showToast({ title: '已退出', icon: 'success', duration: 1200 });
      }
    });
  },

  /**
   * 升级 Pro：弹确认 → 调 /prepay 拿双签名 → wx.requestVirtualPayment
   * → 轮询 /order/:outTradeNo 等 status='paid'（推送是异步的，1-3 秒）
   * → 升级成功刷新 tier
   */
  async onUpgrade() {
    if (isPro()) {
      wx.showModal({
        title: 'Pro 权益',
        content: '你已经是 Pro 用户。\n\n· 云端永久保存全部战绩\n· 换机后完整恢复历史\n· 不限同步天数',
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }

    if (!requireLogin(this)) return;

    const confirm = await new Promise<boolean>(resolve => {
      wx.showModal({
        title: '升级 Pro 终身版',
        content: '¥9.9 一次性付费，永久享\n\n· 云端永久保存全部战绩\n· 换机后完整恢复历史\n· 克星榜看全量\n\n付款由微信虚拟支付保障，本工具仅供娱乐记录。',
        confirmText: '¥9.9 升级',
        cancelText: '暂不',
        success: (r) => resolve(r.confirm)
      });
    });
    if (!confirm) return;

    let params;
    try {
      params = await createPrepay('lifetime');
    } catch (e: any) {
      console.warn('[upgrade] prepay failed', e);
      const code = e?.code || '';
      const msg = e?.message || '';
      // 网络不通和服务端报错要说清楚：前者换网络能救，后者只能重试
      if (code === 'NETWORK_ERROR' || msg.includes('request:fail') || msg.includes('timeout')) {
        wx.showModal({
          title: '连不上服务器',
          content: `请求超时或被中断，可以换个网络再试（4G ↔ Wi-Fi）。\n\n${msg}`,
          showCancel: false,
          confirmText: '知道了'
        });
        return;
      }
      if (msg.includes('SESSION_KEY_MISSING') || msg.includes('登录')) {
        wx.showToast({ title: '请重新登录后支付', icon: 'none' });
      } else {
        wx.showToast({ title: '创建订单失败，请稍后重试', icon: 'none' });
      }
      return;
    }

    // 唤起微信虚拟支付（双签名 + 道具 ID + 价格已由后端返回）
    const payRes = await new Promise<{ ok: boolean; err?: string }>(resolve => {
      // 参数对齐虚拟支付官方签名约定
      (wx as any).requestVirtualPayment({
        ...params,
        mode: 'short_series_goods',
        success: () => resolve({ ok: true }),
        fail: (err: any) => resolve({ ok: false, err: err?.errMsg || '支付失败' })
      });
    });

    if (!payRes.ok) {
      // 用户取消 / 系统错误：不弹错误，按钮可点重试
      console.warn('[upgrade] wx.requestVirtualPayment failed', payRes.err);
      return;
    }

    // 支付客户端成功 ≠ 履约完成，需要轮询等推送发货
    this.pollOrderUntilPaid(params.outTradeNo);
  },

  /**
   * 订单轮询：每 ~1.2s 查一次 /order/:outTradeNo，命中 status='paid' 即升级成功
   *
   * ⚠️ 必须按「墙钟时间」收口，不能只数轮数：
   * 网络不通时每一次 getOrder 会挂满 api.ts 的 15s timeout，
   * 原来的 30 轮 × 15s = 最长 7 分半被 loading 遮罩卡住，用户会以为点了个假按钮。
   */
  async pollOrderUntilPaid(outTradeNo: string) {
    const DEADLINE_MS = 20000;   // 整体上限（回调推送正常 1-3 秒，20 秒足够兜底）
    const INTERVAL_MS = 1200;    // 轮询间隔
    const CALL_CAP_MS = 3000;    // 单次查单上限，超时就丢掉这一轮再试

    const started = Date.now();
    let paid = false;
    wx.showLoading({ title: '等待支付确认…', mask: true });

    try {
      while (Date.now() - started < DEADLINE_MS) {
        await new Promise(r => setTimeout(r, INTERVAL_MS));
        try {
          const order = await this.getOrderCapped(outTradeNo, CALL_CAP_MS);
          if (order.status === 'paid') {
            paid = true;
            break;
          }
        } catch {
          // 单次失败不中断轮询
        }
      }
    } finally {
      wx.hideLoading();
    }

    if (paid) {
      setTier('pro');
      this.applyTier();
      this.refreshTierAsync();
      wx.showToast({ title: '升级成功 🎉', icon: 'success', duration: 1500 });
      return;
    }

    wx.showModal({
      title: '支付确认中',
      content: `订单 ${outTradeNo} 暂未到账，可能是支付回调延迟。\n如已扣款，刷新本页或稍后回来即可。`,
      showCancel: false,
      confirmText: '知道了'
    });
  },

  /** 单次查单 + 硬性时间上限（被 race 丢弃的请求仍会在后台跑，但不再拖住轮询） */
  getOrderCapped(outTradeNo: string, capMs: number): Promise<{ status: 'created' | 'paid' }> {
    return Promise.race([
      getOrder(outTradeNo),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('ORDER_QUERY_TIMEOUT')), capMs)
      )
    ]);
  },

  // ========== 我的昵称 ==========

  /**
   * 修改昵称：改本地「我」的玩家档案（历史战绩里的名字是当时快照，不回改），
   * 同时尽力同步到云端（失败不影响本地生效，下次同步时用户可再改）。
   */
  onEditNickname() {
    const current = getMe()?.nickname || '';
    wx.showModal({
      title: '修改昵称',
      // ⚠️ editable 模式下 content 是「输入框的初始值」，不是提示文字。
      //    所以只能放纯昵称——加"当前："这类前缀会被当成昵称一起存进去。
      content: current,
      editable: true,
      placeholderText: current || '如：铁匠',
      confirmText: '保存',
      success: (modal) => {
        if (!modal.confirm) return;
        const name = (modal.content || '').trim();
        if (!name) {
          wx.showToast({ title: '昵称不能为空', icon: 'none' });
          return;
        }

        const r = renameMe(name);
        if (!r.ok) {
          wx.showToast({ title: r.message, icon: 'none' });
          return;
        }

        // 云端尽力同步（静默失败）
        updateNickname(name).catch(() => {});

        wx.showToast({ title: '已更新', icon: 'success' });
        this.applyTier(); // 刷新菜单里的昵称描述
      }
    });
  },

  // ========== 菜单点击 ==========

  onMenuTap(e: WechatMiniprogram.TapEvent) {
    const id = e.currentTarget.dataset.id as string;

    switch (id) {
      case 'login':
        this.promptLoginDrawer();
        break;
      case 'logout':
        this.onLogout();
        break;
      // ⚠️ 这两个之前是"死按钮"：菜单里有，switch 里没有对应 case，
      //    点了完全没反应。补上。
      case 'sync':
        this.onSync();
        break;
      case 'pull':
        this.onPull();
        break;
      case 'export':
        this.onExport();
        break;
      case 'mockData':
        this.onMockData();
        break;
      case 'mockRestore':
        this.onMockRestore();
        break;
      case 'clear':
        this.onClear();
        break;
      case 'nickname':
        this.onEditNickname();
        break;
      case 'about':
        wx.showModal({
          title: '雀战录 v1.0.0',
          content: '麻将战绩记录 + 数据分析工具\n\n主打功能：\n·• 福星克星分析\n·• 牌局月历\n·• 战绩分享卡\n\n📅 2026-09-11',
          showCancel: false,
          confirmText: '好的'
        });
        break;
      case 'feedback':
        wx.showModal({
          title: '意见反馈',
          content: '请通过以下方式反馈：\n\n微信搜索公众号「雀战录」\n或添加作者微信：your-wechat-id\n\n你的反馈会让我们变得更好 🙏',
          showCancel: false,
          confirmText: '知道了'
        });
        break;
      case 'privacy':
        wx.navigateTo({ url: '/pages/agreement/privacy' });
        break;
      case 'terms':
        wx.navigateTo({ url: '/pages/agreement/terms' });
        break;
    }
  }
});