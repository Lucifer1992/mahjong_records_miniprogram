// pages/profile/profile.ts
// 个人中心

import { Player, Settings } from '../../utils/types';
import { getPlayers, getRecords, getSettings, updateSettings, exportAll, importAll, clearAll } from '../../utils/storage';
import { getSyncStatus, getPendingCount, syncFull, pullAndMerge, refreshTier } from '../../utils/sync';
import { getTier, isPro, getFreeWindowDates, type Tier } from '../../utils/tier';
import { API_BASE, redeemPro } from '../../utils/api';
import { formatDateTime } from '../../utils/date';
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
function buildMenuSections(tier: Tier, windowDates: number): { title: string; items: MenuItem[] }[] {
  const pro = tier === 'pro';

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
    }
  ] as { title: string; items: MenuItem[] }[]).filter(s => s.title !== '开发者选项' || isDevEnv());
}

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
    syncStatus: 'idle' as 'idle' | 'syncing' | 'error',
    apiBase: API_BASE,

    // 等级分层
    tier: 'free' as Tier,
    isPro: false,
    cloudWindowDates: 3,

    menuSections: buildMenuSections('free', 3),

    // 工具
    formatDateTime
  },

  onLoad() {
    this.loadData();
    this.refreshTierAsync();
  },

  onShow() {
    this.loadData();
    this.refreshSyncStatus();
    this.refreshTierAsync();
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
      cloudWindowDates: windowDates,
      menuSections: buildMenuSections(tier, windowDates)
    });
  },

  loadData() {
    const records = getRecords();
    const players = getPlayers();
    const settings = getSettings();

    // 胜率（按「我」= 每条战绩的第一位玩家）
    // 之前用"当场最高分"判定，等于"有人赢就算我赢"，永远 100%
    let winRate = 0;
    if (records.length > 0) {
      const wins = records.filter(r => (r.players[0] ? r.players[0].score : 0) > 0).length;
      winRate = Math.round((wins / records.length) * 100);
    }

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
        : '将生成约 5 个月的历史战绩 + 8 位玩家档案，用于演示「福星克星」和「牌运月历」。\n\n确定继续吗？',
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
    const records = getRecords();
    if (records.length === 0) {
      wx.showToast({ title: '还没有战绩可同步', icon: 'none' });
      return;
    }

    const pro = isPro();
    const windowDates = getFreeWindowDates();
    const content = pro
      ? `将把本地 ${records.length} 条战绩全量推送到云端，永久保存。`
      : `将把本地 ${records.length} 条战绩推送到云端。\n\n免费版云端只保留最近 ${windowDates} 个有数据的日期，更早的会被云端淘汰（本地数据不受影响，升级后可重新上传）。`;

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
   * 升级 Pro
   *
   * 个人主体开不了微信支付，所以 MVP 用兑换码跑通「付费 → 解锁」。
   * 将来接支付时替换 redeemPro 即可，分层逻辑不用动。
   */
  onUpgrade() {
    if (isPro()) {
      wx.showModal({
        title: 'Pro 权益',
        content: '你已经是 Pro 用户。\n\n· 云端永久保存全部战绩\n· 换机后完整恢复历史\n· 不限同步天数',
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }

    wx.showModal({
      title: '升级 Pro',
      content: '请输入兑换码',
      editable: true,
      placeholderText: '兑换码',
      confirmText: '升级',
      success: async (modal) => {
        if (!modal.confirm) return;

        const code = (modal.content || '').trim();
        if (!code) {
          wx.showToast({ title: '请输入兑换码', icon: 'none' });
          return;
        }

        wx.showLoading({ title: '验证中...', mask: true });
        try {
          await redeemPro(code);
          await refreshTier();
          wx.hideLoading();
          this.applyTier();
          wx.showModal({
            title: '升级成功',
            content: '已解锁 Pro：云端永久保存全部战绩，换机可完整恢复。',
            showCancel: false,
            confirmText: '太好了'
          });
        } catch (e: any) {
          wx.hideLoading();
          wx.showToast({ title: (e && e.message) || '兑换失败', icon: 'none' });
        }
      }
    });
  },

  // ========== 菜单点击 ==========

  onMenuTap(e: WechatMiniprogram.TapEvent) {
    const id = e.currentTarget.dataset.id as string;

    switch (id) {
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
      case 'about':
        wx.showModal({
          title: '雀战录 v1.0.0',
          content: '麻将战绩记录 + 数据分析工具\n\n主打功能：\n·• 福星克星分析\n·• 牌运月历\n·• 战绩分享卡\n\n📅 2026-09-11',
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