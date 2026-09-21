// pages/analysis/analysis.ts
// 分析页 - 福星克星 + 牌局月历
import { promptLoginIfNeeded } from '../../utils/auth';
import { getRecords, getPlayers, getMe } from '../../utils/storage';
import { analyzeFortune, formatWinRate, formatNetScore } from '../../utils/fortune';
import { buildCalendar, shiftMonth } from '../../utils/calendar';
import { MIN_GAMES_FOR_ANALYSIS } from '../../utils/constants';
import { formatDate } from '../../utils/date';
import { isPro } from '../../utils/tier';
import { showRewardedAd, grantAdUnlock, isAdUnlocked } from '../../utils/ads';
import { getFullLunarText } from '../../utils/lunar';
import { buildMonthAdvice } from '../../utils/advice';
/** 免费用户看广告解锁完整克星榜的 storage key（24 小时有效） */
const FORTUNE_UNLOCK_KEY = 'fortuneFull';
function decorate(list) {
    return (list || []).map(p => (Object.assign(Object.assign({}, p), { winRateText: formatWinRate(p.winRate), netScoreText: formatNetScore(p.netScore) })));
}
function formatTime(ts) {
    const d = new Date(ts);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return h + ':' + m;
}
Page({
    data: {
        activeTab: 'fortune',
        tabs: [
            { id: 'fortune', name: '福星克星', icon: '⭐' },
            { id: 'calendar', name: '牌局月历', icon: '📅' }
        ],
        // 福星克星
        players: [],
        selectedPlayerId: '',
        selectedPlayerIndex: 0,
        analysis: null,
        enoughData: false,
        totalGames: 0,
        relevantGames: 0,
        // 克星榜分层：免费只亮 TOP1，看广告 / Pro 解锁完整榜
        fortuneLocked: false,
        luckyList: [],
        evilList: [], // 已按等级裁剪 + 已格式化文本
        evilHiddenCount: 0,
        // 牌局月历
        currentYear: 0,
        currentMonth: 0,
        monthText: '',
        calendarCells: [],
        calendarStats: null,
        // 月历「宜忌」卡片：历史战绩统计摘要（非预测，见 utils/advice.ts 合规说明）
        advice: null,
        weekdays: ['日', '一', '二', '三', '四', '五', '六'],
        selectedDay: null,
        selectedDayRecords: [],
        /** 选中日的农历全称，如「八月十五 · 中秋节」 */
        selectedDayLunar: ''
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
        // 默认选中谁：优先「我」，其次档案列表第一个
        // （以前直接取 players[0]，默认看的是别人的视角 —— 同理不能假设我排第一）
        let selectedIdx = 0;
        if (this.data.selectedPlayerId) {
            const idx = players.findIndex(p => p.id === this.data.selectedPlayerId);
            if (idx >= 0)
                selectedIdx = idx;
        }
        else {
            const me = getMe();
            const meIdx = me ? players.findIndex(p => p.id === me.id) : -1;
            selectedIdx = meIdx >= 0 ? meIdx : 0;
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
        // 宜忌卡片（个人视角，只在选中玩家时才有意义）
        const advice = selectedPlayer
            ? buildMonthAdvice(records, selectedPlayer.id)
            : null;
        this.setData(Object.assign(Object.assign({ players, selectedPlayerId: (selectedPlayer === null || selectedPlayer === void 0 ? void 0 : selectedPlayer.id) || '', selectedPlayerIndex: selectedIdx, analysis, enoughData: records.length >= MIN_GAMES_FOR_ANALYSIS, totalGames,
            relevantGames, luckyList: decorate(analysis === null || analysis === void 0 ? void 0 : analysis.luckyPartners) }, this.evilView(analysis)), { advice, currentYear: year, currentMonth: month, monthText: `${year}年${month}月`, calendarCells: calendar.cells, calendarStats: calendar.stats }));
    },
    /**
     * 克星榜分层视图：Pro / 已看广告解锁 → 完整榜；
     * 免费未解锁 → 只亮 TOP1，其余计数隐藏（福星区不设墙，正反馈免费看）
     */
    evilView(analysis) {
        const evil = (analysis === null || analysis === void 0 ? void 0 : analysis.evilPartners) || [];
        if (isPro() || isAdUnlocked(FORTUNE_UNLOCK_KEY)) {
            return { fortuneLocked: false, evilList: decorate(evil), evilHiddenCount: 0 };
        }
        return {
            fortuneLocked: true,
            evilList: decorate(evil.slice(0, 1)),
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
    onTabChange(e) {
        const tab = e.currentTarget.dataset.tab;
        this.setData({ activeTab: tab });
    },
    onPlayerChange(e) {
        const idx = Number(e.detail.value);
        const records = getRecords();
        const selectedPlayer = this.data.players[idx];
        const analysis = analyzeFortune(records, selectedPlayer.id);
        const relevantGames = records.filter(r => r.players.some(p => p.playerId === selectedPlayer.id)).length;
        this.setData(Object.assign({ selectedPlayerId: selectedPlayer.id, selectedPlayerIndex: idx, analysis,
            relevantGames, luckyList: decorate(analysis === null || analysis === void 0 ? void 0 : analysis.luckyPartners), 
            // 宜忌是个人视角的，换人必须重算
            advice: buildMonthAdvice(records, selectedPlayer.id) }, this.evilView(analysis)));
    },
    onPrevMonth() {
        const { year, month } = shiftMonth(this.data.currentYear, this.data.currentMonth, -1);
        this.refreshCalendar(year, month);
    },
    onNextMonth() {
        const { year, month } = shiftMonth(this.data.currentYear, this.data.currentMonth, 1);
        this.refreshCalendar(year, month);
    },
    refreshCalendar(year, month) {
        const records = getRecords();
        const calendar = buildCalendar(records, year, month, this.data.selectedPlayerId);
        this.setData({
            currentYear: year,
            currentMonth: month,
            monthText: `${year}年${month}月`,
            calendarCells: calendar.cells,
            calendarStats: calendar.stats,
            selectedDay: null,
            selectedDayRecords: [],
            selectedDayLunar: ''
        });
    },
    onDaySelect(e) {
        const date = e.currentTarget.dataset.date;
        if (!date)
            return;
        const records = getRecords();
        const dayRecords = records
            .filter(r => formatDate(r.playedAt) === date)
            .map(r => (Object.assign(Object.assign({}, r), { timeText: formatTime(r.playedAt) })));
        const cell = this.data.calendarCells.find(c => c.date === date);
        // 农历全称：从 dateKey 还原 Date（用本地时间构造，与 buildCalendar 一致）
        const [yy, mm, dd] = date.split('-').map(Number);
        const lunarText = getFullLunarText(new Date(yy, mm - 1, dd));
        this.setData({
            selectedDay: cell,
            selectedDayRecords: dayRecords,
            selectedDayLunar: lunarText
        });
        // 宜忌卡在日历下方，详情在其之后 —— 渲染完把详情滚进视野，否则点了像没反应
        wx.nextTick(() => {
            if (!this.data.selectedDay)
                return;
            wx.pageScrollTo({ selector: '.day-detail', duration: 220, offsetTop: -24 });
        });
    },
    onCloseDayDetail() {
        this.setData({
            selectedDay: null,
            selectedDayRecords: [],
            selectedDayLunar: ''
        });
    },
    onPickerTap() {
        // 玩家选择器：弹 actionSheet 切换当前分析玩家
        const players = this.data.players;
        if (players.length === 0)
            return;
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
                const relevantGames = records.filter(r => r.players.some(p => p.playerId === selectedPlayer.id)).length;
                this.setData(Object.assign({ selectedPlayerId: selectedPlayer.id, selectedPlayerIndex: idx, analysis,
                    relevantGames, luckyList: decorate(analysis === null || analysis === void 0 ? void 0 : analysis.luckyPartners), 
                    // 宜忌是个人视角的，换人必须重算（与 onPlayerChange 保持一致）
                    advice: buildMonthAdvice(records, selectedPlayer.id) }, this.evilView(analysis)));
            }
        });
    }
});
