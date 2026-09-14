// pages/index/index.ts
// 首页 - 快速记分
import { SUPPORTED_RULES, DURATIONS, MOODS, MIN_PLAYERS, MAX_PLAYERS } from '../../utils/constants';
import { addRecord, findOrCreatePlayer, getPlayers, getRecords } from '../../utils/storage';
import { uuid } from '../../utils/storage';
import { formatDateShort, formatDateTime } from '../../utils/date';
import { enqueuePush, tryAutoSync } from '../../utils/sync';
Page({
    data: {
        // 玩法选择
        rules: SUPPORTED_RULES,
        selectedRuleIndex: 0,
        selectedRule: SUPPORTED_RULES[0],
        // 时段选择
        durations: DURATIONS,
        selectedDurationIndex: 1, // 默认晚上
        selectedDuration: DURATIONS[1],
        // 心情
        moods: MOODS,
        selectedMood: null,
        // 玩家
        players: [],
        newPlayerName: '',
        showSubstitute: false,
        // 分数录入
        showSubstituteSection: false,
        totalScore: 0,
        scoreValid: false,
        saveEnabled: false,
        // 备注
        note: '',
        // 顶部 Hero
        greeting: '你好',
        todayText: '',
        totalGames: 0,
        totalPlayers: 0,
        winRate: 0,
        lastPlayText: '还没有战绩',
        // 工具方法
        formatDateShort,
        formatDateTime
    },
    onLoad() {
        this.loadStats();
    },
    onShow() {
        // ⚠️ 注意：这里不能再调 loadPlayers()。
        // players 是「本局参与者」，不是牌友档案列表。每切一次 tab 就把档案
        // 灌回来，会让用户删掉的牌友复活，而且 Player 上根本没有 score 字段
        // （求和变 NaN）。改牌友只能走 onAddPlayer / onRemovePlayer。
        this.loadStats();
    },
    // ========== 加载数据 ==========
    loadStats() {
        const records = getRecords();
        const totalGames = records.length;
        let lastPlayText = '还没有战绩';
        if (records.length > 0) {
            lastPlayText = formatDateShort(records[0].playedAt);
        }
        // 计算 Hero 数据
        const greeting = this.getGreeting();
        const todayText = this.getTodayText();
        const totalPlayers = getPlayers().length;
        let winRate = 0;
        if (records.length > 0) {
            const wins = records.filter(r => { var _a; return ((_a = r.players[0]) === null || _a === void 0 ? void 0 : _a.score) > 0; }).length;
            winRate = Math.round((wins / records.length) * 100);
        }
        this.setData({
            totalGames,
            lastPlayText,
            greeting,
            todayText,
            totalPlayers,
            winRate
        });
    },
    getGreeting() {
        const h = new Date().getHours();
        if (h < 5)
            return '夜深了';
        if (h < 9)
            return '早上好';
        if (h < 12)
            return '上午好';
        if (h < 14)
            return '中午好';
        if (h < 18)
            return '下午好';
        if (h < 22)
            return '晚上好';
        return '夜深了';
    },
    getTodayText() {
        const d = new Date();
        const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
        return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${week}`;
    },
    // ========== 玩法选择 ==========
    onRuleChange(e) {
        const idx = Number(e.detail.value);
        this.setData({
            selectedRuleIndex: idx,
            selectedRule: SUPPORTED_RULES[idx]
        });
    },
    // ========== 时段选择 ==========
    onDurationSelect(e) {
        const idx = Number(e.currentTarget.dataset.index);
        this.setData({
            selectedDurationIndex: idx,
            selectedDuration: DURATIONS[idx]
        });
    },
    // ========== 心情选择 ==========
    onMoodSelect(e) {
        const mood = e.currentTarget.dataset.mood;
        this.setData({ selectedMood: this.data.selectedMood === mood ? null : mood });
    },
    // ========== 玩家管理 ==========
    onPlayerInput(e) {
        this.setData({ newPlayerName: e.detail.value });
    },
    onAddPlayer() {
        const name = this.data.newPlayerName.trim();
        if (!name) {
            wx.showToast({ title: '请输入昵称', icon: 'none' });
            return;
        }
        if (name.length > 10) {
            wx.showToast({ title: '昵称不能超过 10 字', icon: 'none' });
            return;
        }
        if (this.data.players.find(p => p.nickname === name)) {
            wx.showToast({ title: '玩家已存在', icon: 'none' });
            return;
        }
        if (this.data.players.length >= MAX_PLAYERS) {
            wx.showToast({ title: `最多 ${MAX_PLAYERS} 人`, icon: 'none' });
            return;
        }
        const player = findOrCreatePlayer(name);
        const avatarIdx = (this.data.players.length % 8) + 1;
        const draft = {
            playerId: player.id,
            nickname: player.nickname,
            score: 0,
            isSubstitute: false,
            isObserver: false,
            color: player.color,
            avatarIdx,
            scoreText: '',
            negative: false
        };
        this.setData({
            players: [...this.data.players, draft],
            newPlayerName: ''
        });
    },
    onRemovePlayer(e) {
        const idx = Number(e.currentTarget.dataset.index);
        const target = this.data.players[idx];
        if (!target)
            return;
        // × 按钮很小又贴着牌友卡片，容易误触，所以加一道确认
        wx.showModal({
            title: '移出本局',
            content: `确定把「${target.nickname}」移出本局吗？\n\n（只是不参与这局记分，牌友档案会保留）`,
            confirmText: '移出',
            confirmColor: '#A32D2D',
            success: (res) => {
                if (!res.confirm)
                    return;
                const players = [...this.data.players];
                players.splice(idx, 1);
                this.setData({ players });
                this.validateScore();
            }
        });
    },
    // ========== 分数录入 ==========
    onScoreInput(e) {
        const idx = Number(e.currentTarget.dataset.index);
        const digits = String(e.detail.value).replace(/\D/g, '').slice(0, 4);
        const players = [...this.data.players];
        const p = players[idx];
        if (!p)
            return;
        p.scoreText = digits;
        p.score = digits ? (p.negative ? -1 : 1) * Number(digits) : 0;
        this.setData({ players });
        this.validateScore();
    },
    /**
     * 切换正负号
     *
     * 数字键盘（type="number"）在 iOS/Android 上都没有负号键，
     * 所以负分只能靠这个按钮切——不能再依赖用户在输入框里打 "-"
     */
    onToggleSign(e) {
        const idx = Number(e.currentTarget.dataset.index);
        const players = [...this.data.players];
        const p = players[idx];
        if (!p)
            return;
        p.negative = !p.negative;
        p.score = p.scoreText ? (p.negative ? -1 : 1) * Number(p.scoreText) : 0;
        this.setData({ players });
        this.validateScore();
    },
    validateScore() {
        const total = this.data.players.reduce((sum, p) => sum + p.score, 0);
        const valid = total === 0 && this.data.players.length >= MIN_PLAYERS;
        this.setData({
            totalScore: total,
            scoreValid: total === 0,
            saveEnabled: valid
        });
    },
    // ========== 替补/观战 ==========
    toggleSubstituteSection() {
        this.setData({ showSubstituteSection: !this.data.showSubstituteSection });
    },
    // ========== 备注 ==========
    onNoteInput(e) {
        this.setData({ note: e.detail.value });
    },
    // ========== 保存 ==========
    async onSave() {
        if (!this.data.saveEnabled) {
            if (this.data.totalScore !== 0) {
                wx.showToast({ title: '总分必须为 0', icon: 'none' });
            }
            else if (this.data.players.length < MIN_PLAYERS) {
                wx.showToast({ title: `至少 ${MIN_PLAYERS} 人`, icon: 'none' });
            }
            return;
        }
        const record = {
            id: uuid(),
            createdAt: Date.now(),
            playedAt: Date.now(),
            ruleType: this.data.selectedRule.id,
            ruleName: this.data.selectedRule.name,
            duration: this.data.selectedDuration.id,
            players: this.data.players.map(p => ({
                playerId: p.playerId,
                nickname: p.nickname,
                score: p.score,
                isSubstitute: p.isSubstitute,
                isObserver: p.isObserver
            })),
            totalFee: 0,
            note: this.data.note.trim(),
            mood: this.data.selectedMood
        };
        addRecord(record);
        // 后台异步推云端（不影响 UI；失败会入重试队列）
        enqueuePush(record.id);
        tryAutoSync(getRecords());
        wx.showToast({
            title: '已保存',
            icon: 'success',
            duration: 1500
        });
        // 重置表单
        this.resetForm();
        this.loadStats();
        // 震动反馈（牌友记用户提到的体验问题，我们优化）
        wx.vibrateShort({ type: 'light' });
    },
    resetForm() {
        const players = this.data.players.map(p => (Object.assign(Object.assign({}, p), { score: 0, scoreText: '', negative: false })));
        this.setData({
            players,
            note: '',
            selectedMood: null,
            totalScore: 0,
            scoreValid: false,
            saveEnabled: false
        });
    },
    // ========== 收盘 ==========
    onFinish() {
        if (this.data.players.length === 0) {
            wx.showToast({ title: '暂无数据', icon: 'none' });
            return;
        }
        wx.switchTab({ url: '/pages/records/records' });
    }
});
