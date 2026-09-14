// app.ts
import { bootSync } from './utils/sync';
import { getRecords } from './utils/storage';
import { wxLogin, setToken } from './utils/api';
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
   * 云端启动：登录 + 触发同步
   * 失败完全静默，不影响本地使用
   */
  async bootstrapCloud() {
    // 1. 静默登录（拿 code → 后端换 token）
    try {
      const loginRes = await new Promise<WechatMiniprogram.LoginRes>((resolve, reject) => {
        wx.login({ success: resolve, fail: reject });
      });
      if (loginRes.code) {
        const result = await wxLogin(loginRes.code);
        setToken(result.token);
        // 登录响应直接带 tier，先写进缓存，避免首屏闪一下错误的等级文案
        if (result.user && result.user.tier) setTier(result.user.tier);
        this.globalData.loggedIn = true;
        console.log('[App] 云端登录成功');
      }
    } catch (e) {
      console.warn('[App] 云端登录失败（不影响本地使用）', e);
      return;
    }

    // 2. 触发同步
    const records = getRecords();
    await bootSync(records);
  },

  /**
   * 全局错误处理
   */
  onError(err: string) {
    console.error('[App Error]', err);
  }
});