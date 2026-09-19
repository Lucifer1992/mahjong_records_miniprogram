// app.ts
import { bootSync } from './utils/sync';
import { getRecords } from './utils/storage';
import { hasToken } from './utils/api';
import { setTier } from './utils/tier';

App({
  globalData: {
    userInfo: undefined,
    version: '1.0.0',
    buildTime: '2026-09-11',
    loggedIn: false
  },

  onLaunch() {
    console.log('[App] 雀战录启动');
    this.initStorage();
    // 异步启动云端同步（不阻塞首屏）
    this.bootstrapCloud();
  },

  /**
   * 初始化本地存储
   */
  initStorage() {
    const records = wx.getStorageSync('mahjong:records');
    const players = wx.getStorageSync('mahjong:players');
    const settings = wx.getStorageSync('mahjong:settings');

    if (!Array.isArray(records)) {
      wx.setStorageSync('mahjong:records', []);
    }
    if (!Array.isArray(players)) {
      wx.setStorageSync('mahjong:players', []);
    }
    if (!settings) {
      wx.setStorageSync('mahjong:settings', {
        defaultRuleType: 'xuezhan',
        theme: 'light',
        firstLaunchAt: Date.now(),
        soundEnabled: true
      });
    }
  },

  /**
   * 云端启动：仅已登录用户触发同步
   *
   * 登录策略（2026-09-19）：半屏登录抽屉（components/login-drawer），
   * 浏览不受限，需要登录态的操作/401 时在当前页弹出抽屉；
   * 登录成功后由抽屉自行触发首次同步。
   */
  async bootstrapCloud() {
    if (!hasToken()) return;

    const records = getRecords();
    try {
      await bootSync(records);
    } catch (e) {
      console.warn('[App] 启动同步失败（不影响本地使用）', e);
    }
  },

  /**
   * 全局错误处理
   */
  onError(err: string) {
    console.error('[App Error]', err);
  }
});