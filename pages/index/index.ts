// pages/index/index.ts
// 首页 - 真实牌桌布局：4 方位头像 + 中央计分弹窗 + 当日累计

import { promptLoginIfNeeded, requireLogin } from '../../utils/auth';
import {
  RuleType,
  GameDuration,
  Mood,
  GameRecord,
  PlayerScore,
  Player,
  Seat,
  SEAT_ORDER,
  SEAT_LABELS
} from '../../utils/types';
import {
  SUPPORTED_RULES,
  CUSTOM_RULE_ENTRY,
  CUSTOM_RULE_NAME_MAX,
  DURATIONS,
  MOODS,
  MIN_PLAYERS,
  MAX_PLAYERS
} from '../../utils/constants';
import {
  addRecord,
  findOrCreatePlayer,
  getPlayers,
  getRecords,
  ensureMe,
  getMe,
  rememberLastRuleType,
  getLastOrDefaultRuleType,
  getSettings,
  rememberLastDuration,
  deletePlayer,
  getRecentLineups,
  pickNextSeat,
  uuid
} from '../../utils/storage';
import type { Lineup } from '../../utils/storage';
import { inferDurationByClock } from '../../utils/duration';
import { formatDateShort, formatDateTime } from '../../utils/date';
import { enqueuePush, tryAutoSync } from '../../utils/sync';
import { calcSelfWinRate, calcDailySession } from '../../utils/stats';

interface DraftPlayer extends PlayerScore {
  color: string;
  avatarIdx: number;
  /** 输入框里的原始数字，只存绝对值（正负由 negative 决定） */
  scoreText: string;
  /** 是否负分（输家）。数字键盘打不出负号，所以用按钮切换 */
  negative: boolean;
}

interface RecentPlayer extends Player {
  usage: number;
  inGame: boolean;
  checked: boolean;
}

/** 牌桌上某个座位的视图模型（按 seat 索引） */
interface SeatView {
  seat: Seat;
  seatLabel: string;
  playerId: string;
  nickname: string;
  score: number;
  scoreText: string;
  negative: boolean;
  isEvil: boolean;
}

/** 弹窗内的 4 行座位视图 */
interface ModalSeatView extends SeatView {}

Page({
  data: {
    // ===== 玩法选择（保持原样）=====
    rules: [...SUPPORTED_RULES, CUSTOM_RULE_ENTRY],
    selectedRuleIndex: 0,
    selectedRule: SUPPORTED_RULES[0] as { readonly id: string; readonly name: string; readonly desc: string },
    customRuleDraft: '',
    customRuleNameMax: CUSTOM_RULE_NAME_MAX,
    prevRuleIndex: 0,
    prevRule: SUPPORTED_RULES[0] as { readonly id: string; readonly name: string; readonly desc: string },

    // ===== 时段（保持原样）=====
    durations: DURATIONS,
    selectedDurationIndex: 1,
    selectedDuration: DURATIONS[1],

    // ===== 心情（保持原样）=====
    moods: MOODS,
    selectedMood: null as Mood | null,

    // ===== 玩家（保留 DraftPlayer，加 seat 字段）=====
    players: [] as DraftPlayer[],
    newPlayerName: '',
    showAddMe: false,

    // ===== 历史牌友（保持原样）=====
    recentPlayers: [] as RecentPlayer[],
    showRecentPlayers: false,
    recentLineups: [] as Lineup[],
    recentCheckedCount: 0,

    // ===== 牌桌视图模型：4 方位按 seat 索引 =====
    seats: {
      east: null as SeatView | null,
      south: null as SeatView | null,
      west: null as SeatView | null,
      north: null as SeatView | null
    },

    // ===== 当日累计（按 2h 间隔切分会话）=====
    dailyStats: {
      games: 0,
      netScore: 0
    },

    // ===== 分数录入（顶部 badge）=====
    totalScore: 0,
    scoreValid: false,
    saveEnabled: false,

    // ===== 计分弹窗（C 方案：中央弹窗 + 背景蒙层）=====
    showScoreModal: false,
    modalSeats: [] as ModalSeatView[],

    // ===== 拖拽换位：长按 0.5s 抬起 → 点其他位置互换 =====
    dragSource: null as Seat | null,
    dragTimer: 0,

    // ===== 备注 =====
    note: '',

    // ===== 顶部 Hero =====
    greeting: '你好',
    todayText: '',
    totalGames: 0,
    totalPlayers: 0,
    winRate: 0,
    lastPlayText: '还没有战绩',

    // ===== 工具方法 =====
    formatDateShort,
    formatDateTime
  },

  onLoad() {
    const lastRuleId = getLastOrDefaultRuleType();
    const idx = this.data.rules.findIndex(r => r.id === lastRuleId);
    if (idx >= 0) {
      this.setData({
        selectedRuleIndex: idx,
        selectedRule: this.data.rules[idx] as any
      });
    }

    const settings = getSettings();
    const durId = settings.lastDuration || inferDurationByClock();
    const durIdx = this.data.durations.findIndex(d => d.id === durId);
    if (durIdx >= 0) {
      this.setData({
        selectedDurationIndex: durIdx,
        selectedDuration: this.data.durations[durIdx]
      });
    }

    this.loadStats();
    this.refreshSeats();
    this.refreshDailyStats();
    this.refreshMeButton();
  },

  onShow() {
    promptLoginIfNeeded(this);
    this.loadStats();
    this.refreshSeats();
    this.refreshDailyStats();
    this.refreshMeButton();
    this.refreshRecentPlayers();
  },

  onUnload() {
    // 清理长按定时器，避免内存泄漏
    if (this.data.dragTimer) {
      clearTimeout(this.data.dragTimer);
    }
  },

  onLoggedIn() {
    this.loadStats();
    this.refreshSeats();
    this.refreshDailyStats();
    this.refreshMeButton();
    this.refreshRecentPlayers();
  },

  // ========== 加载数据 ==========

  loadStats() {
    const records = getRecords();
    const totalGames = records.length;
    let lastPlayText = '还没有战绩';
    if (records.length > 0) {
      lastPlayText = formatDateShort(records[0].playedAt);
    }

    const greeting = this.getGreeting();
    const todayText = this.getTodayText();
    const totalPlayers = getPlayers().length;
    const winRate = Math.round(calcSelfWinRate(records) * 100);

    this.setData({
      totalGames,
      lastPlayText,
      greeting,
      todayText,
      totalPlayers,
      winRate
    });
  },

  getGreeting(): string {
    const h = new Date().getHours();
    if (h < 5) return '夜深了';
    if (h < 9) return '早上好';
    if (h < 12) return '上午好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    if (h < 22) return '晚上好';
    return '夜深了';
  },

  getTodayText(): string {
    const d = new Date();
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${week}`;
  },

  /**
   * 刷新牌桌视图：根据当前 players 数组按 seat 字段分组生成 seats 视图
   *
   * 重要：克星判断基于 playerId（旺友克星分析结果由 analysis 页传来，这里简化处理：
   * 默认没标记为克星的玩家，后续 P2 接 analysis 后会让克星高亮自动生效）。
   */
  refreshSeats() {
    const evilIds = this.computeEvilIds();
    const seats: Record<Seat, SeatView | null> = {
      east: null, south: null, west: null, north: null
    };

    for (const p of this.data.players) {
      if (!p.seat) continue;
      seats[p.seat] = {
        seat: p.seat,
        seatLabel: SEAT_LABELS[p.seat],
        playerId: p.playerId,
        nickname: p.nickname,
        score: p.score,
        scoreText: p.scoreText,
        negative: p.negative,
        isEvil: evilIds.has(p.playerId)
      };
    }

    this.setData({ seats });
  },

  /**
   * 计算当前每个玩家的克星标记位（playerId 集合）
   *
   * MVP 简化：从 records 里反向查找「自己输了、对方赢了」的对局胜率 < 35% 的对手。
   * 真正的克星算法在 analysis 页，这里只做轻量近似。
   */
  computeEvilIds(): Set<string> {
    const records = getRecords();
    const me = getMe();
    if (!me) return new Set();

    // 统计每个 playerId 在和我同场时的"我赢率"
    const stats = new Map<string, { games: number; myWins: number }>();
    for (const r of records) {
      const mySelf = r.players.find(p => p.playerId === me.id);
      if (!mySelf) continue;
      const iWon = mySelf.score > 0;
      for (const p of r.players) {
        if (p.playerId === me.id) continue;
        let s = stats.get(p.playerId);
        if (!s) { s = { games: 0, myWins: 0 }; stats.set(p.playerId, s); }
        s.games += 1;
        if (iWon) s.myWins += 1;
      }
    }

    // 胜率 < 35% 视为克星（至少打过 3 局）
    const evil = new Set<string>();
    stats.forEach((v, id) => {
      if (v.games >= 3 && v.myWins / v.games < 0.35) {
        evil.add(id);
      }
    });
    return evil;
  },

  refreshDailyStats() {
    const records = getRecords();
    const me = getMe();
    const session = calcDailySession(records, Date.now(), me?.id, 2 * 60 * 60 * 1000);
    this.setData({
      dailyStats: {
        games: session.games,
        netScore: session.netScore
      }
    });
  },

  refreshMeButton() {
    const me = getMe();
    const inGame = !!me && this.data.players.some(p => p.playerId === me.id);
    this.setData({ showAddMe: !inGame });
  },

  // ========== 玩法选择（保持原样） ==========

  onRuleChange(e: WechatMiniprogram.PickerChange) {
    const idx = Number(e.detail.value);
    const picked = this.data.rules[idx];

    if (picked.id === 'custom') {
      if (this.data.selectedRule.id !== 'custom') {
        this.setData({ prevRuleIndex: idx, prevRule: this.data.selectedRule });
      }
      this.setData({
        selectedRule: { id: 'custom', name: this.data.customRuleDraft, desc: '自定义玩法' },
        selectedRuleIndex: idx
      });
      setTimeout(() => {
        (this as any).selectComponent?.('#customRuleInput')?.focus?.();
      }, 0);
      return;
    }

    if (this.data.selectedRule.id === 'custom' && !this.data.customRuleDraft.trim()) {
      const prev = this.data.prevRule || SUPPORTED_RULES[0];
      this.setData({
        selectedRule: prev,
        selectedRuleIndex: this.data.rules.findIndex(r => r.id === (prev as any).id)
      });
      return;
    }

    this.setData({
      selectedRuleIndex: idx,
      selectedRule: picked as { readonly id: string; readonly name: string; readonly desc: string }
    });
  },

  onCustomRuleInput(e: { detail: { value: string } }) {
    const raw = e.detail.value || '';
    const trimmed = raw.trim();
    const safe = trimmed.length > CUSTOM_RULE_NAME_MAX
      ? trimmed.slice(0, CUSTOM_RULE_NAME_MAX)
      : trimmed;
    if (safe !== raw) {
      this.setData({ customRuleDraft: safe });
    } else {
      this.setData({ customRuleDraft: trimmed });
    }
    this.setData({
      selectedRule: { id: 'custom', name: safe, desc: '自定义玩法' }
    });
  },

  onDurationSelect(e: WechatMiniprogram.TapEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    this.setData({
      selectedDurationIndex: idx,
      selectedDuration: DURATIONS[idx]
    });
  },

  onMoodSelect(e: WechatMiniprogram.TapEvent) {
    const mood = e.currentTarget.dataset.mood as Mood;
    this.setData({ selectedMood: this.data.selectedMood === mood ? null : mood });
  },

  // ========== 玩家管理（改为按座位分配） ==========

  refreshRecentPlayers() {
    const records = getRecords();
    const allPlayers = getPlayers();
    const usage = new Map<string, number>();
    for (const r of records) {
      for (const p of r.players) {
        const n = p.nickname.trim();
        if (n) usage.set(n, (usage.get(n) || 0) + 1);
      }
    }

    const sorted = [...allPlayers].sort((a, b) => b.createdAt - a.createdAt);
    const withUsage = sorted
      .map(p => ({ ...p, usage: usage.get(p.nickname) || 0, inGame: false, checked: false } as RecentPlayer))
      .filter((p, i) => p.usage > 0 || i < 20)
      .sort((a, b) => b.usage - a.usage || b.createdAt - a.createdAt)
      .slice(0, 30);

    const inGameIds = new Set(this.data.players.map(p => p.playerId));
    const list = withUsage.map(p => ({
      ...p,
      inGame: inGameIds.has(p.id),
      checked: inGameIds.has(p.id)
    }));

    this.setData({
      recentPlayers: list,
      recentLineups: getRecentLineups(records),
      recentCheckedCount: 0
    });
  },

  setRecentChecked(ids: string[]) {
    const set = new Set(ids);
    const list = this.data.recentPlayers.map(p => ({
      ...p,
      checked: p.inGame || set.has(p.id)
    }));
    this.setData({
      recentPlayers: list,
      recentCheckedCount: list.filter(p => p.checked && !p.inGame).length
    });
  },

  recentSlotsLeft(): number {
    return MAX_PLAYERS - this.data.players.length;
  },

  onShowRecentPlayers() {
    if (this.data.recentPlayers.length === 0) {
      wx.showToast({ title: '暂无历史牌友，先添加一位吧', icon: 'none' });
      return;
    }
    this.refreshRecentPlayers();
    this.setData({ showRecentPlayers: true });
  },

  onToggleRecentPlayer(e: WechatMiniprogram.TapEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    const player = this.data.recentPlayers[idx];
    if (!player) return;

    if (player.inGame) {
      wx.showToast({ title: `${player.nickname} 已在本局`, icon: 'none' });
      return;
    }

    if (!player.checked && this.recentSlotsLeft() <= 0) {
      wx.showToast({ title: `最多 ${MAX_PLAYERS} 人`, icon: 'none' });
      return;
    }

    const next = this.data.recentPlayers
      .filter(p => p.checked && !p.inGame)
      .map(p => p.id);
    if (player.checked) {
      this.setRecentChecked(next.filter(id => id !== player.id));
    } else {
      this.setRecentChecked([...next, player.id]);
    }
  },

  onApplyLineup(e: WechatMiniprogram.TapEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    const lineup = this.data.recentLineups[idx];
    if (!lineup) return;

    const inGameIds = new Set(this.data.players.map(p => p.playerId));
    const targetIds = lineup.memberIds.filter(id => !inGameIds.has(id));
    const current = this.data.recentPlayers
      .filter(p => p.checked && !p.inGame)
      .map(p => p.id);
    const allOn = targetIds.length > 0 && targetIds.every(id => current.includes(id));

    const next = allOn
      ? current.filter(id => !targetIds.includes(id))
      : Array.from(new Set([...current, ...targetIds]));

    const slots = this.recentSlotsLeft();
    if (!allOn && next.length > slots) {
      const kept = next.slice(0, slots);
      this.setRecentChecked(kept);
      wx.showToast({ title: `最多 ${MAX_PLAYERS} 人，只加了前 ${slots} 位`, icon: 'none' });
      return;
    }
    this.setRecentChecked(next);
    wx.vibrateShort({ type: 'light' });
  },

  onConfirmAddRecent() {
    const picked = this.data.recentPlayers.filter(p => p.checked && !p.inGame);
    if (picked.length === 0) {
      wx.showToast({ title: '请先勾选要加入的牌友', icon: 'none' });
      return;
    }

    const players = [...this.data.players];
    for (const p of picked) {
      if (players.length >= MAX_PLAYERS) break;
      if (players.some(x => x.playerId === p.id)) continue;
      // 按东→南→西→北顺序分配座位
      const seat = pickNextSeat(players);
      players.push({
        playerId: p.id,
        nickname: p.nickname,
        score: 0,
        isSubstitute: false,
        isObserver: false,
        seat,
        color: p.color,
        avatarIdx: (players.length % 8) + 1,
        scoreText: '',
        negative: false
      } as DraftPlayer);
    }

    this.setData({ players, showRecentPlayers: false });
    this.refreshSeats();
    this.refreshMeButton();
    wx.vibrateShort({ type: 'light' });
    wx.showToast({ title: `已加入 ${picked.length} 位`, icon: 'success', duration: 1200 });
  },

  onCloseRecentPlayers() {
    this.setData({ showRecentPlayers: false });
  },

  onLongPressRecentPlayer(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    const player = this.data.recentPlayers[idx];
    if (!player) return;

    const me = getMe();
    if (me && me.id === player.id) {
      wx.showToast({ title: '「我」不能删除', icon: 'none' });
      return;
    }

    const inGame = this.data.players.some(p => p.playerId === player.id);
    const usageText = player.usage && player.usage > 0
      ? `TA 参与过 ${player.usage} 局战绩`
      : 'TA 还没有参战记录';

    wx.showActionSheet({
      itemList: [`删除牌友「${player.nickname}」`],
      itemColor: '#D85A30',
      success: () => {
        wx.showModal({
          title: '删除牌友档案',
          content: `确定删除「${player.nickname}」吗？\n\n${usageText}，删除档案后这些历史战绩会完整保留，只是不再出现在牌友列表里。`,
          confirmText: '删除',
          confirmColor: '#D85A30',
          success: (res) => {
            if (!res.confirm) return;
            const r = deletePlayer(player.id);
            if (!r.ok) {
              wx.showToast({ title: r.message, icon: 'none' });
              return;
            }
            if (inGame) {
              this.setData({
                players: this.data.players.filter(p => p.playerId !== player.id)
              });
              this.refreshSeats();
            }
            this.refreshRecentPlayers();
            wx.showToast({ title: '已删除', icon: 'success' });
          }
        });
      }
    });
  },

  onPlayerInput(e: WechatMiniprogram.Input) {
    this.setData({ newPlayerName: e.detail.value });
  },

  onAddPlayer() {
    const name = this.data.newPlayerName.trim();
    if (!name) {
      this.onShowRecentPlayers();
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
    const seat = pickNextSeat(this.data.players);
    const draft: DraftPlayer = {
      playerId: player.id,
      nickname: player.nickname,
      score: 0,
      isSubstitute: false,
      isObserver: false,
      seat,
      color: player.color,
      avatarIdx: (this.data.players.length % 8) + 1,
      scoreText: '',
      negative: false
    };

    this.setData({
      players: [...this.data.players, draft],
      newPlayerName: ''
    });
    this.refreshSeats();
    this.refreshMeButton();
  },

  onAddMe() {
    if (!requireLogin(this)) return;

    const me = ensureMe();
    if (this.data.players.some(p => p.playerId === me.id)) {
      this.setData({ showAddMe: false });
      return;
    }
    if (this.data.players.length >= MAX_PLAYERS) {
      wx.showToast({ title: `最多 ${MAX_PLAYERS} 人`, icon: 'none' });
      return;
    }

    const seat = pickNextSeat(this.data.players);
    const draft: DraftPlayer = {
      playerId: me.id,
      nickname: me.nickname,
      score: 0,
      isSubstitute: false,
      isObserver: false,
      seat,
      color: me.color,
      avatarIdx: (this.data.players.length % 8) + 1,
      scoreText: '',
      negative: false
    };
    // 「我」固定排在首位（直觉约定）
    this.setData({ players: [draft, ...this.data.players] });
    this.refreshSeats();
    this.refreshMeButton();
    wx.vibrateShort({ type: 'light' });
  },

  /**
   * 点空位（3 人局或未分配）→ 弹菜单让用户选：删某人就移到空位 / 或不做操作
   */
  onTapEmptySeat(e: WechatMiniprogram.TapEvent) {
    const seat = e.currentTarget.dataset.seat as Seat;
    if (this.data.players.length === 0) {
      wx.showToast({ title: '先添加牌友', icon: 'none' });
      return;
    }
    wx.showToast({
      title: '3 人局：拖拽玩家到空位',
      icon: 'none'
    });
  },

  /**
   * 长按座位 → 进入拖拽换位模式
   *
   * 简化方案：长按 0.5s 抬起 → 头像加 .seat-dragging 样式 → 点其他位置 → 自动对调
   * 真·拖拽实现成本高（movable-view + 碰撞检测），点选式拖拽用户体验接近
   */
  onLongPressSeat(e: WechatMiniprogram.TouchEvent) {
    const seat = e.currentTarget.dataset.seat as Seat;
    const seatInfo = this.data.seats[seat];
    if (!seatInfo) return;

    // 设置 0.5s 后进入拖拽模式（避免误触：手指轻按一下不会触发）
    if (this.data.dragTimer) clearTimeout(this.data.dragTimer);
    const timer = setTimeout(() => {
      this.setData({
        dragSource: seat,
        dragTimer: 0
      });
      wx.vibrateShort({ type: 'medium' });
      wx.showToast({
        title: `选择目标位置，与 ${seatInfo.nickname} 互换`,
        icon: 'none',
        duration: 1800
      });
    }, 500);
    this.setData({ dragTimer: timer });
  },

  /** 取消拖拽（点空白处） */
  onCancelDrag() {
    if (this.data.dragTimer) {
      clearTimeout(this.data.dragTimer);
    }
    this.setData({
      dragSource: null,
      dragTimer: 0
    });
  },

  /**
   * 点任一头像 → 拖拽模式 or 弹计分卡
   *
   * 行为分流：
   * - 已经在拖拽模式（dragSource 不为空）→ 与 dragSource 对调
   * - 否则 → 弹中央计分卡
   */
  onTapSeat(e: WechatMiniprogram.TapEvent) {
    // 取消未触发的长按定时器
    if (this.data.dragTimer) {
      clearTimeout(this.data.dragTimer);
      this.setData({ dragTimer: 0 });
    }

    const seat = e.currentTarget.dataset.seat as Seat;
    if (this.data.dragSource) {
      // 已经在拖拽模式
      if (this.data.dragSource === seat) {
        // 点自己 → 取消
        this.setData({ dragSource: null });
        return;
      }
      // 对调两个 seat 的玩家
      this.swapSeats(this.data.dragSource, seat);
      this.setData({ dragSource: null });
      wx.vibrateShort({ type: 'light' });
      return;
    }

    // 正常情况：弹计分卡
    this.openScoreModal();
  },

  /** 对调两个座位的玩家 */
  swapSeats(seatA: Seat, seatB: Seat) {
    const players = [...this.data.players];
    const a = players.find(p => p.seat === seatA);
    const b = players.find(p => p.seat === seatB);
    if (!a || !b) return;

    const tmp = a.seat;
    a.seat = b.seat;
    b.seat = tmp;

    this.setData({ players });
    this.refreshSeats();
    this.validateScore();
  },

  /**
   * 点 + 按钮 → 也弹计分卡（更直接入口）
   */
  onTapSeatPlus() {
    this.openScoreModal();
  },

  openScoreModal() {
    if (this.data.players.length < 2) {
      wx.showToast({ title: `至少 ${MIN_PLAYERS} 人才能开打`, icon: 'none' });
      return;
    }
    const modalSeats: ModalSeatView[] = SEAT_ORDER
      .map(seat => this.data.seats[seat])
      .filter((s): s is SeatView => !!s)
      .map(s => ({ ...s }));

    this.setData({
      showScoreModal: true,
      modalSeats
    });
  },

  onCloseScoreModal() {
    this.setData({ showScoreModal: false });
  },

  /**
   * 弹窗内输入分数
   */
  onModalScoreInput(e: WechatMiniprogram.Input) {
    const seat = e.currentTarget.dataset.seat as Seat;
    const digits = String(e.detail.value).replace(/\D/g, '').slice(0, 4);

    const players = [...this.data.players];
    const p = players.find(x => x.seat === seat);
    if (!p) return;
    p.scoreText = digits;
    p.score = digits ? (p.negative ? -1 : 1) * Number(digits) : 0;

    this.setData({ players });
    this.refreshSeats();
    this.updateModalSeats();
    this.validateScore();
  },

  /**
   * 弹窗内切换正负号
   */
  onModalToggleSign(e: WechatMiniprogram.TapEvent) {
    const seat = e.currentTarget.dataset.seat as Seat;
    const players = [...this.data.players];
    const p = players.find(x => x.seat === seat);
    if (!p) return;
    p.negative = !p.negative;
    p.score = p.scoreText ? (p.negative ? -1 : 1) * Number(p.scoreText) : 0;

    this.setData({ players });
    this.refreshSeats();
    this.updateModalSeats();
    this.validateScore();
  },

  /**
   * 弹窗内快捷分数：累加到当前玩家
   *
   * 注：当前 MVP 简化为「点谁加谁」—— 加到第一个玩家。后续可加"选中玩家"状态机。
   * 实际上用户先点头像或 + 按钮打开弹窗时，会把第一个焦点定在某玩家（这里默认第 1 个）。
   */
  onModalQuickScore(e: WechatMiniprogram.TapEvent) {
    const value = Number(e.currentTarget.dataset.value);
    if (!value) return;

    // 简化：累加到 modalSeats 第 1 个（按 SEAT_ORDER 顺序）
    const target = this.data.modalSeats[0];
    if (!target) return;

    const players = [...this.data.players];
    const p = players.find(x => x.seat === target.seat);
    if (!p) return;

    const current = p.scoreText ? Number(p.scoreText) : 0;
    const next = Math.max(0, current + Math.abs(value));
    const safe = Math.min(next, 9999).toString();
    p.scoreText = safe;
    p.score = p.negative ? -Number(safe) : Number(safe);

    this.setData({ players });
    this.refreshSeats();
    this.updateModalSeats();
    this.validateScore();
    wx.vibrateShort({ type: 'light' });
  },

  /** 同步更新弹窗内的 4 行数据 */
  updateModalSeats() {
    const modalSeats: ModalSeatView[] = SEAT_ORDER
      .map(seat => this.data.seats[seat])
      .filter((s): s is SeatView => !!s)
      .map(s => ({ ...s }));
    this.setData({ modalSeats });
  },

  /** 弹窗底部保存按钮：和底部 action-bar 的保存等价 */
  onModalSave() {
    this.onSave();
  },

  // ========== 备注 ==========

  onNoteInput(e: WechatMiniprogram.Input) {
    this.setData({ note: e.detail.value });
  },

  // ========== 分数校验 ==========

  validateScore() {
    const total = this.data.players.reduce((sum, p) => sum + p.score, 0);
    const valid = total === 0 && this.data.players.length >= MIN_PLAYERS;
    this.setData({
      totalScore: total,
      scoreValid: total === 0,
      saveEnabled: valid
    });
  },

  // ========== 保存 ==========

  async onSave() {
    if (!requireLogin(this)) return;
    if (this.data.selectedRule.id === 'custom' && !this.data.customRuleDraft.trim()) {
      wx.showToast({ title: '请填写玩法名称', icon: 'none' });
      setTimeout(() => (this as any).selectComponent?.('#customRuleInput')?.focus?.(), 0);
      return;
    }
    if (!this.data.saveEnabled) {
      if (this.data.totalScore !== 0) {
        wx.showToast({ title: '总分必须为 0', icon: 'none' });
      } else if (this.data.players.length < MIN_PLAYERS) {
        wx.showToast({ title: `至少 ${MIN_PLAYERS} 人`, icon: 'none' });
      }
      return;
    }

    const record: GameRecord = {
      id: uuid(),
      createdAt: Date.now(),
      playedAt: Date.now(),
      ruleType: this.data.selectedRule.id as RuleType,
      ruleName: this.data.selectedRule.name,
      duration: this.data.selectedDuration.id as GameDuration,
      players: this.data.players.map(p => ({
        playerId: p.playerId,
        nickname: p.nickname,
        score: p.score,
        isSubstitute: p.isSubstitute,
        isObserver: p.isObserver,
        seat: p.seat
      })),
      totalFee: 0,
      note: this.data.note.trim(),
      mood: this.data.selectedMood
    };

    addRecord(record);

    rememberLastRuleType(this.data.selectedRule.id as RuleType);
    rememberLastDuration(this.data.selectedDuration.id as 'morning' | 'afternoon' | 'evening' | 'overnight');

    enqueuePush(record.id);
    tryAutoSync(getRecords());

    wx.showToast({
      title: '已保存',
      icon: 'success',
      duration: 1500
    });

    this.resetForm();
    this.loadStats();
    this.refreshSeats();
    this.refreshDailyStats();

    wx.vibrateShort({ type: 'light' });

    // 关闭弹窗
    this.setData({ showScoreModal: false });
  },

  resetForm() {
    const players = this.data.players.map(p => ({
      ...p,
      score: 0,
      scoreText: '',
      negative: false
    }));
    this.setData({
      players,
      note: '',
      selectedMood: null,
      totalScore: 0,
      scoreValid: false,
      saveEnabled: false
    });
  },

  onFinish() {
    if (this.data.players.length === 0) {
      wx.showToast({ title: '暂无数据', icon: 'none' });
      return;
    }
    wx.switchTab({ url: '/pages/records/records' });
  }
});