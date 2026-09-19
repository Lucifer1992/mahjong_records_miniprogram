// pages/records/records.ts
// 战绩列表页
import { promptLoginIfNeeded } from '../../utils/auth';
import { getRecords, getPlayers, deleteRecord } from '../../utils/storage';
import { RULE_LABELS, DURATION_LABELS, MOOD_EMOJI } from '../../utils/types';
import { ruleColor } from '../../utils/constants';
import { adEnabled, adUnitId } from '../../utils/ads';
import { isPro } from '../../utils/tier';
import { calcOverallStats, calcRuleStats, filterRecordsByRule } from '../../utils/stats';
import { formatDateShort, formatDateTime, relativeTime } from '../../utils/date';
Page({
    data: {
        // 总览
        overall: {
            totalGames: 0,
            totalPlayers: 0,
            winDays: 0,
            maxWinStreak: 0
        },
        // 玩法统计
        ruleStats: [],
        // 筛选
        ruleFilterOptions: [],
        selectedRuleFilter: 'all',
        selectedFilterIndex: 0,
        selectedFilterLabel: '全部玩法',
        // 列表
        records: [],
        filteredRecords: [],
        hasRecords: false,
        // 工具
        formatDateTime,
        relativeTime
    },
    onLoad() {
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
        var _a;
        const records = getRecords();
        const players = getPlayers();
        // 总览
        const overall = calcOverallStats(records, players);
        // 玩法统计
        const ruleStats = calcRuleStats(records);
        // 列表数据
        const list = records.map(r => {
            const sorted = [...r.players].sort((a, b) => b.score - a.score);
            const medals = ['🥇', '🥈', '🥉'];
            const topPlayers = sorted.slice(0, 3).map((p, idx) => ({
                nickname: p.nickname,
                score: p.score,
                rank: idx + 1,
                medal: medals[idx] || ''
            }));
            const winner = sorted[0];
            const bestResult = winner.score > 0 ? 'win' : (winner.score < 0 ? 'lose' : 'even');
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
        const ruleFilterOptions = [
            { id: 'all', name: '全部玩法' },
            ...ruleStats.map(rs => ({ id: rs.ruleType, name: rs.ruleName }))
        ];
        // 玩法卡配色 + 预算胜率百分比
        const RULE_CARD_COLORS = ['#4A9D7E', '#1D9E75', '#D4537E', '#BA7517', '#378ADD'];
        const ruleStatsColored = ruleStats.map((rs, i) => (Object.assign(Object.assign({}, rs), { color: RULE_CARD_COLORS[i % RULE_CARD_COLORS.length], winRatePercent: Math.round((rs.winRate || 0) * 100) })));
        // 默认筛选索引（首项 "全部玩法"）
        const selectedFilterIndex = 0;
        const selectedFilterLabel = ((_a = ruleFilterOptions[0]) === null || _a === void 0 ? void 0 : _a.name) || '全部玩法';
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
    onRuleFilterChange(e) {
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
            : filterRecordsByRule(this.data.records, filter);
        this.setData({ filteredRecords: filtered });
    },
    onRecordTap(e) {
        const id = e.currentTarget.dataset.id;
        wx.navigateTo({ url: `/pages/share/poster?id=${id}` });
    },
    onRecordLongPress(e) {
        const id = e.currentTarget.dataset.id;
        const record = this.data.records.find(r => r.id === id);
        if (!record)
            return;
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
