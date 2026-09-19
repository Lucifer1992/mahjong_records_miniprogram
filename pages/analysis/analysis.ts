// pages/analysis/analysis.ts
// 分析页 - 福星克星 + 牌运月历

import { GameRecord, Player, FortuneAnalysis, CalendarDay, PartnerStat } from '../../utils/types';
import { promptLoginIfNeeded } from '../../utils/auth';
import { getRecords, getPlayers } from '../../utils/storage';
import { analyzeFortune, formatWinRate, formatNetScore } from '../../utils/fortune';
import { buildCalendar, shiftMonth, CalendarData, CalendarCell } from '../../utils/calendar';
import { MIN_GAMES_FOR_ANALYSIS } from '../../utils/constants';
import { formatDate } from '../../utils/date';
import { isPro } from '../../utils/tier';
import { showRewardedAd, grantAdUnlock, isAdUnlocked } from '../../utils/ads';

interface TabItem {
  id: 'fortune' | 'calendar';
  name: string;
  icon: string;
}

/** 免费用户看广告解锁完整克星榜的 storage key（24 小时有效） */
const FORTUNE_UNLOCK_KEY = 'fortuneFull';

Page({
  data: {
    activeTab: 'fortune' as 'fortune' | 'calendar',
    tabs: [
      { id: 'fortune', name: '福星克星', icon: '⭐' },
      { id: 'calendar', name: '牌运月历', icon: '📅' }
    ] as TabItem[],

    // 福星克星
    players: [] as Player[],
    selectedPlayerId: '',
    selectedPlayerIndex: 0,
    analysis: null as FortuneAnalysis | null,
    enoughData: false,
    totalGames: 0,
    relevantGames: 0,
    // 克星榜分层：免费只亮 TOP1，看广告 / Pro 解锁完整榜
    fortuneLocked: false,
    evilVisible: [] as PartnerStat[],
    evilHiddenCount: 0,
    formatWinRate,
    formatNetScore,

    // 牌运月历
    currentYear: 0,
    currentMonth: 0,
    monthText: '',
    calendarCells: [] as CalendarCell[],
    calendarStats: null as CalendarData['stats'] | null,
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    selectedDay: null as CalendarCell | null,
    selectedDayRecords: [] as GameRecord[],
    formatRecordTime(this: any, ts: number) {
      const d = new Date(ts);
      const h = d.getHours().toString().padStart(2, '0');
      const m = d.getMinutes().toString().padStart(2, '0');
      return h + ':' + m;
    }
  },

  onLoad() {
    this.loadData();
  },

  onShow() {
    promptLoginIfNeeded(this);
    this.loadData();
  },

  /** 登录抽屉登录成功回调：刷新分析数据 */
  onLoggedIn() {
    this.loadData();
  },

  loadData() {
    const records = getRecords();
    const players = getPlayers();
    const totalGames = records.length;

    // 默认选中第一个有战绩的玩家
    let selectedIdx = this.data.selectedPlayerIndex || 0;
    if (this.data.selectedPlayerId) {
      const idx = players.findIndex(p => p.id === this.data.selectedPlayerId);
      if (idx >= 0) selectedIdx = idx;
    }

    const selectedPlayer = players[selectedIdx];
    const analysis = selectedPlayer ? analyzeFortune(records, selectedPlayer.id) : null;
    const relevantGames = selectedPlayer
      ? records.filter(r => r.players.some(p => p.playerId === selectedPlayer.id)).length
      : 0;

    // 月历（按当前选中玩家的个人视角）
    const now = new Date();
    const year = this.data.currentYear || now.getFullYear();
    const month = this.data.currentMonth || now.getMonth() + 1;
    const calendar = buildCalendar(records, year, month, selectedPlayer ? selectedPlayer.id : undefined);

    this.setData({
      players,
      selectedPlayerId: selectedPlayer?.id || '',
      selectedPlayerIndex: selectedIdx,
      analysis,
      enoughData: records.length >= MIN_GAMES_FOR_ANALYSIS,
      totalGames,
      relevantGames,
      ...this.evilView(analysis),
      currentYear: year,
      currentMonth: month,
      monthText: `${year}年${month}月`,
      calendarCells: calendar.cells,
      calendarStats: calendar.stats
    });
  },

  /**
   * 克星榜分层视图：Pro / 已看广告解锁 → 完整榜；
   * 免费未解锁 → 只亮 TOP1，其余计数隐藏（福星区不设墙，正反馈免费看）
   */
  evilView(analysis: FortuneAnalysis | null): { fortuneLocked: boolean; evilVisible: PartnerStat[]; evilHiddenCount: number } {
    const evil = analysis?.evilPartners || [];
    if (isPro() || isAdUnlocked(FORTUNE_UNLOCK_KEY)) {
      return { fortuneLocked: false, evilVisible: evil, evilHiddenCount: 0 };
    }
    return {
      fortuneLocked: true,
      evilVisible: evil.slice(0, 1),
      evilHiddenCount: Math.max(0, evil.length - 1)
    };
  },

  /** 「看视频解锁完整克星榜（24 小时）」 */
  async onWatchUnlockAd() {
    const ok = await showRewardedAd();
    if (!ok) {
      wx.showToast({ title: '看完完整视频才能解锁哦', icon: 'none' });
      return;
    }
    grantAdUnlock(FORTUNE_UNLOCK_KEY);
    this.setData(this.evilView(this.data.analysis));
    wx.showToast({ title: '已解锁 24 小时', icon: 'success' });
    wx.vibrateShort({ type: 'light' });
  },

  /** 升级 Pro 永久解锁 → 跳「我的」页 */
  onGoUpgrade() {
    wx.switchTab({ url: '/pages/profile/profile' });
  },

  onTabChange(e: WechatMiniprogram.TapEvent) {
    const tab = e.currentTarget.dataset.tab as 'fortune' | 'calendar';
    this.setData({ activeTab: tab });
  },

  onPlayerChange(e: WechatMiniprogram.PickerChange) {
    const idx = Number(e.detail.value);
    const records = getRecords();
    const selectedPlayer = this.data.players[idx];
    const analysis = analyzeFortune(records, selectedPlayer.id);
    const relevantGames = records.filter(r =>
      r.players.some(p => p.playerId === selectedPlayer.id)
    ).length;

    this.setData({
      selectedPlayerId: selectedPlayer.id,
      selectedPlayerIndex: idx,
      analysis,
      relevantGames,
      ...this.evilView(analysis)
    });
  },

  onPrevMonth() {
    const { year, month } = shiftMonth(this.data.currentYear, this.data.currentMonth, -1);
    this.refreshCalendar(year, month);
  },

  onNextMonth() {
    const { year, month } = shiftMonth(this.data.currentYear, this.data.currentMonth, 1);
    this.refreshCalendar(year, month);
  },

  refreshCalendar(year: number, month: number) {
    const records = getRecords();
    const calendar = buildCalendar(records, year, month, this.data.selectedPlayerId);
    this.setData({
      currentYear: year,
      currentMonth: month,
      monthText: `${year}年${month}月`,
      calendarCells: calendar.cells,
      calendarStats: calendar.stats,
      selectedDay: null,
      selectedDayRecords: []
    });
  },

  onDaySelect(e: WechatMiniprogram.TapEvent) {
    const date = e.currentTarget.dataset.date as string;
    if (!date) return;

    const records = getRecords();
    const dayRecords = records.filter(r => formatDate(r.playedAt) === date);
    const cell = this.data.calendarCells.find(c => c.date === date);

    this.setData({
      selectedDay: cell,
      selectedDayRecords: dayRecords
    });
  },

  onCloseDayDetail() {
    this.setData({
      selectedDay: null,
      selectedDayRecords: []
    });
  },

  onPickerTap() {
    // 玩家选择器：弹 actionSheet 切换当前分析玩家
    const players = this.data.players;
    if (players.length === 0) return;
    // actionSheet 最多 6 项；超过时引导用 records 页切换
    if (players.length > 6) {
      wx.showToast({ title: '玩家较多，请到战绩页筛选', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: players.map(p => p.nickname),
      success: (res) => {
        const idx = res.tapIndex;
        const selectedPlayer = players[idx];
        const records = getRecords();
        const analysis = analyzeFortune(records, selectedPlayer.id);
        const relevantGames = records.filter(r =>
          r.players.some(p => p.playerId === selectedPlayer.id)
        ).length;
        this.setData({
          selectedPlayerId: selectedPlayer.id,
          selectedPlayerIndex: idx,
          analysis,
          relevantGames,
          ...this.evilView(analysis)
        });
      }
    });
  }
});