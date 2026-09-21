// pages/records/records.ts
// 战绩列表页

import { GameRecord, Player } from '../../utils/types';
import { promptLoginIfNeeded } from '../../utils/auth';
import { getRecords, getPlayers, deleteRecord, selfScoreIn } from '../../utils/storage';
import { RULE_LABELS, DURATION_LABELS, MOOD_EMOJI } from '../../utils/types';
import { ruleColor } from '../../utils/constants';
import { adEnabled, adUnitId } from '../../utils/ads';
import { isPro } from '../../utils/tier';
import { calcOverallStats, calcRuleStats, filterRecordsByRule, OverallStats, RuleStat } from '../../utils/stats';
import { formatDateShort, formatDateTime, relativeTime } from '../../utils/date';
import { enqueueDelete } from '../../utils/sync';

interface RecordItem {
  id: string;
  playedAtText: string;
  relativeText: string;
  ruleLabel: string;
  ruleType: string;
  ruleColor: string;
  durationLabel: string;
  playerCount: number;
  totalNet: number;        // 全场最高分
  winnerName: string;
  topPlayers: TopPlayer[];
  moodEmoji: string;
  note: string;
  bestResult: 'win' | 'lose' | 'even';
}

interface TopPlayer {
  nickname: string;
  score: number;
  rank: number;
  medal: string;
}

interface FilterOption {
  id: string;
  name: string;
}

Page({
  data: {
    // 总览
    overall: {
      totalGames: 0,
      totalPlayers: 0,
      winDays: 0,
      maxWinStreak: 0
    } as OverallStats,

    // 玩法统计
    ruleStats: [] as RuleStat[],

    // 筛选
    ruleFilterOptions: [] as FilterOption[],
    selectedRuleFilter: 'all',
    selectedFilterIndex: 0,
    selectedFilterLabel: '全部玩法',

    // 列表
    records: [] as RecordItem[],
    filteredRecords: [] as RecordItem[],
    hasRecords: false,

    // 牌友过滤（首页"查看该牌友历史"入口携带 ?nickname=老张）
    nicknameFilter: '' as string,

    // 工具
    formatDateTime,
    relativeTime
  },

  onLoad(options?: { nickname?: string }) {
    // 接受 query 参数 ?nickname=老张 —— 从首页/记分页的"查看该牌友历史"入口进来
    // 解码后写入 data.nicknameFilter，applyFilter 会按它二次过滤
    const nickname = decodeURIComponent(options?.nickname || '').trim();
    if (nickname) {
      this.setData({ nicknameFilter: nickname });
    }
    this.loadData();
  },

  onShow() {
    promptLoginIfNeeded(this);
    this.loadData();
  },

  /** 登录抽屉登录成功回调：刷新战绩列表 */
  onLoggedIn() {
    this.loadData();
  },

  onPullDownRefresh() {
    this.loadData();
    wx.stopPullDownRefresh();
  },

  loadData() {
    const records = getRecords();
    const players = getPlayers();

    // 总览
    const overall = calcOverallStats(records, players);
    // 玩法统计
    const ruleStats = calcRuleStats(records);

    // 列表数据
    const list: RecordItem[] = records.map(r => {
      const sorted = [...r.players].sort((a, b) => b.score - a.score);
      const medals = ['🥇', '🥈', '🥉'];
      const topPlayers: TopPlayer[] = sorted.slice(0, 3).map((p, idx) => ({
        nickname: p.nickname,
        score: p.score,
        rank: idx + 1,
        medal: medals[idx] || ''
      }));
      const winner = sorted[0];
      // 卡片左侧色条代表「我这局的结果」，按「我」的分数判定。
      // 以前按全场最高分判 —— 记分零和、最高分恒为正，色条永远是"赢"，看着就像全胜
      const my = selfScoreIn(r);
      const bestResult: 'win' | 'lose' | 'even' =
        my === null ? 'even' : (my > 0 ? 'win' : (my < 0 ? 'lose' : 'even'));

      return {
        id: r.id,
        playedAtText: formatDateShort(r.playedAt),
        relativeText: relativeTime(r.playedAt),
        ruleLabel: RULE_LABELS[r.ruleType] || r.ruleName,
        ruleType: r.ruleType,
        ruleColor: ruleColor(r.ruleType, r.ruleName),
        durationLabel: DURATION_LABELS[r.duration],
        playerCount: r.players.length,
        totalNet: winner.score,
        winnerName: winner.nickname,
        topPlayers,
        moodEmoji: r.mood ? MOOD_EMOJI[r.mood] : '',
        note: r.note,
        bestResult
      };
    });

    // 玩法筛选选项
    const ruleFilterOptions: FilterOption[] = [
      { id: 'all', name: '全部玩法' },
      ...ruleStats.map(rs => ({ id: rs.ruleType, name: rs.ruleName }))
    ];

    // 玩法卡配色 + 预算胜率百分比
    const RULE_CARD_COLORS = ['#4A9D7E', '#1D9E75', '#D4537E', '#BA7517', '#378ADD'];
    const ruleStatsColored = ruleStats.map((rs, i) => ({
      ...rs,
      color: RULE_CARD_COLORS[i % RULE_CARD_COLORS.length],
      winRatePercent: Math.round((rs.winRate || 0) * 100)
    }));

    // 默认筛选索引（首项 "全部玩法"）
    const selectedFilterIndex = 0;
    const selectedFilterLabel = ruleFilterOptions[0]?.name || '全部玩法';

    this.setData({
      overall,
      ruleStats: ruleStatsColored,
      ruleFilterOptions,
      records: list,
      filteredRecords: list,
      hasRecords: list.length > 0,
      selectedRuleFilter: 'all',
      selectedFilterIndex,
      selectedFilterLabel,
      // 广告：仅免费用户展示；后台未配置广告位 ID 时不渲染
      showAd: adEnabled('recordsBanner', isPro()),
      adUnitId: adUnitId('recordsBanner')
    });
  },

  onRuleFilterChange(e: WechatMiniprogram.PickerChange) {
    const idx = Number(e.detail.value);
    const filter = this.data.ruleFilterOptions[idx];
    this.setData({
      selectedRuleFilter: filter.id,
      selectedFilterIndex: idx,
      selectedFilterLabel: filter.name
    });
    this.applyFilter();
  },

  applyFilter() {
    const ruleFilter = this.data.selectedRuleFilter;
    const nickname = this.data.nicknameFilter;

    let filtered = ruleFilter === 'all'
      ? this.data.records
      : filterRecordsByRule(this.data.records, ruleFilter);

    // 牌友过滤：只保留该 nickname 出现在 players[] 中的战绩
    if (nickname) {
      filtered = filtered.filter(r => r.players.some(p => p.nickname === nickname));
    }

    this.setData({ filteredRecords: filtered });
  },

  /** 清除 nickname 过滤（用户在过滤条点 × 退出牌友专属视图） */
  onClearNicknameFilter() {
    this.setData({ nicknameFilter: '' });
    this.applyFilter();
  },

  onRecordTap(e: WechatMiniprogram.TapEvent) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/share/poster?id=${id}` });
  },

  onRecordLongPress(e: WechatMiniprogram.TapEvent) {
    const id = e.currentTarget.dataset.id;
    const record = this.data.records.find(r => r.id === id);
    if (!record) return;

    wx.showActionSheet({
      itemList: ['删除这条战绩'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.showModal({
            title: '确认删除',
            content: `删除 ${record.playedAtText} 的战绩？此操作不可恢复`,
            success: (modal) => {
              if (modal.confirm) {
                deleteRecord(id);
                this.loadData();
                wx.showToast({ title: '已删除', icon: 'success' });
              }
            }
          });
        }
      }
    });
  },

  onGoHome() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});