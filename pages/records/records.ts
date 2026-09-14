// pages/records/records.ts
// 战绩列表页

import { GameRecord, Player } from '../../utils/types';
import { getRecords, getPlayers, deleteRecord } from '../../utils/storage';
import { RULE_LABELS, DURATION_LABELS, MOOD_EMOJI } from '../../utils/types';
import { calcOverallStats, calcRuleStats, OverallStats, RuleStat } from '../../utils/stats';
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

    // 工具
    formatDateTime,
    relativeTime
  },

  onLoad() {
    this.loadData();
  },

  onShow() {
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

    // 玩法颜色
    const RULE_COLORS: Record<string, string> = {
      blood: '#4A9D7E',
      qiaom: '#1D9E75',
      tuidaoh: '#D4537E',
      guobiao: '#BA7517'
    };

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
      const bestResult: 'win' | 'lose' | 'even' =
        winner.score > 0 ? 'win' : (winner.score < 0 ? 'lose' : 'even');

      return {
        id: r.id,
        playedAtText: formatDateShort(r.playedAt),
        relativeText: relativeTime(r.playedAt),
        ruleLabel: RULE_LABELS[r.ruleType] || r.ruleName,
        ruleType: r.ruleType,
        ruleColor: RULE_COLORS[r.ruleType] || '#4A9D7E',
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
      selectedFilterLabel
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
    const filter = this.data.selectedRuleFilter;
    const filtered = filter === 'all'
      ? this.data.records
      : this.data.records.filter(r => r.ruleType === filter);
    this.setData({ filteredRecords: filtered });
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