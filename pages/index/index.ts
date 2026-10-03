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
  MAX_PLAYERS,
  UNDO_LIMIT
} from '../../utils/constants';

/** 预设卡通头像列表（assets/avatars/avatar-XX.png，1-20）*/
export const AVATAR_OPTIONS = Array.from({ length: 20 }, (_, i) =>
  `/assets/avatars/avatar-${String(i + 1).padStart(2, '0')}.png`
);
import {
  addRecord,
  findOrCreatePlayer,
  suggestAvatarIdx,
  updatePlayerAvatar,
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
  pickNextSeatFrom,
  uuid
} from '../../utils/storage';
import type { Lineup } from '../../utils/storage';
import { playerAvatarIdx, playerAvatarSrc, builtinAvatarSrc } from '../../utils/avatar';
import { updateProfile } from '../../utils/api';
import { inferDurationByClock } from '../../utils/duration';
import { formatDateShort, formatDateTime } from '../../utils/date';
import { enqueuePush, tryAutoSync } from '../../utils/sync';
import { calcSelfWinRate, calcDailySession } from '../../utils/stats';

interface DraftPlayer extends PlayerScore {
  color: string;
  avatarIdx: number;
  /** 自定义头像 URL（微信头像）；展示优先于 avatarIdx */
  avatarUrl?: string;
  /** 预计算的头像展示地址（WXML 不能调函数） */
  avatarSrc: string;
  /** 输入框里的原始数字，只存绝对值（正负由 negative 决定） */
  scoreText: string;
  /** 是否负分（输家）。数字键盘打不出负号，所以用按钮切换 */
  negative: boolean;
}

interface RecentPlayer extends Player {
  usage: number;
  inGame: boolean;
  checked: boolean;
  nextSeat: Seat | null;
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
  avatarIdx: number;
  /** 预计算头像地址（avatarUrl 优先，WXML 直接用） */
  avatarSrc: string;
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
    selectedAvatarIdx: 0,   // 用户显式选择的头像索引（0 = 未选择，跟随系统建议）
    suggestedAvatarIdx: 1,  // 系统建议的默认头像（自动避开已有牌友占用的）
    avatarOptions: AVATAR_OPTIONS,

    // ===== 更换头像弹层（长按历史牌友触发）=====
    showAvatarEditor: false,
    avatarEditorPlayerId: '',
    avatarEditorName: '',
    avatarEditorIdx: 1,     // 弹层内当前高亮的头像（打开时 = 该玩家现有头像）

    // ===== 历史牌友（保持原样）=====
    recentPlayers: [] as RecentPlayer[],
    showRecentPlayers: false,
    recentLineups: [] as Lineup[],
    recentCheckedCount: 0,
    recentCheckedOrder: [] as string[],   // 用户勾选顺序（用于入座时按东→南→西→北排）
    pendingFillSeat: null as Seat | null, // 点空白座位时记录目标座，点完历史牌友直接入座这里

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
    modalActiveSeat: null as Seat | null,   // 当前选中的座位（快捷分数生效在此人）
    activePlayerNickname: '',               // 弹窗标题里高亮的玩家昵称

    // ===== 拖拽换位：长按 0.5s 抬起 → 点其他位置互换 =====
    dragSource: null as Seat | null,
    dragTimer: 0,

    // ===== 换位撤销栈：保存最近 N 次 players 完整快照，选错位置可一键回退 =====
    swapHistory: [] as DraftPlayer[][],     // 二维数组：每次换位前的快照
    canUndoSwap: false,                      // 计算属性：swapHistory.length > 0

    // ===== 牌桌中央筹码环：开局前隐藏，只在有人开始计分时显示 =====
    hasAnyScore: false,

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
    // 上次保存的时段「超过 4 小时」视为新局，按钟表重新推断；
    // 否则视为同一局延续，沿用上次时段（避免凌晨局打完白班重开又跳回 morning 打断用户）
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    const lastDurAge = settings.lastDurationAt ? Date.now() - settings.lastDurationAt : Infinity;
    const isContinuation = !!(settings.lastDuration && lastDurAge < FOUR_HOURS_MS);
    const durId = isContinuation ? settings.lastDuration! : inferDurationByClock();
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
        isEvil: evilIds.has(p.playerId),
        avatarIdx: p.avatarIdx,
        avatarSrc: p.avatarSrc || playerAvatarSrc(p)
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
      .map(p => ({ ...p, usage: usage.get(p.nickname) || 0, inGame: false, checked: false, nextSeat: null } as RecentPlayer))
      .filter((p, i) => p.usage > 0 || i < 20)
      .sort((a, b) => b.usage - a.usage || b.createdAt - a.createdAt)
      .slice(0, 30);

    const inGameIds = new Set(this.data.players.map(p => p.playerId));
    const list = withUsage.map(p => ({
      ...p,
      avatarIdx: playerAvatarIdx(p),
      avatarSrc: playerAvatarSrc(p),
      inGame: inGameIds.has(p.id),
      checked: inGameIds.has(p.id)
    }));

    this.setData({
      recentPlayers: list,
      recentLineups: getRecentLineups(records),
      recentCheckedCount: 0
    });
    // 根据初始状态（无勾选）计算 nextSeat 预告
    this.computeNextSeats();
  },

  /** 根据当前 checked 状态，为每个玩家计算 nextSeat 预告（不修改 checked） */
  computeNextSeats() {
    const list = this.data.recentPlayers;
    let totalNew = 0; // 已勾选（不在游戏中）的玩家数量
    for (const p of list) {
      if (p.inGame) {
        (p as RecentPlayer).nextSeat = null;
      } else {
        if (p.checked) {
          (p as RecentPlayer).nextSeat = SEAT_ORDER[totalNew] ?? null;
          totalNew++;
        } else {
          (p as RecentPlayer).nextSeat = SEAT_ORDER[totalNew] ?? null;
        }
      }
    }
    this.setData({ recentPlayers: list });
  },

  setRecentChecked(ids: string[], anchorSeat?: Seat) {
    const set = new Set(ids);
    // 先算 checked 状态
    const list = this.data.recentPlayers.map(p => ({
      ...p,
      checked: p.inGame || set.has(p.id)
    }));
    // 同步维护勾选顺序：
    //   入座时按「先勾的坐东、后勾的坐南…」而非按牌友列表排序
    //   ids 由调用方按用户点选的顺序传入；inGame 玩家排除（不参与入座）
    const inGameIds = new Set(this.data.recentPlayers.filter(p => p.inGame).map(p => p.id));
    const order = ids.filter(id => !inGameIds.has(id));
    this.setData({ recentCheckedOrder: order });

    // 顺时针俯视序列（北→东→南→西）即 SEAT_ORDER 本身，从 anchorSeat 起循环取。
    //   默认从东起（=SEAT_ORDER 顺序）；点空白座位打开时从 anchorSeat 起（如 south→west→north→east）。
    const baseIdx = anchorSeat ? SEAT_ORDER.indexOf(anchorSeat) : 0;
    const cwOrder: Seat[] = anchorSeat
      ? [0, 1, 2, 3].map(off => SEAT_ORDER[(baseIdx + off) % 4])
      : SEAT_ORDER;

    // 再为每个玩家计算 nextSeat：
    //   按 cwOrder 顺次走，已 inGame 的占固定方位，其余方位按 recentCheckedOrder 顺次填
    const inGameSeats = new Set(list.filter(p => p.inGame).map(p => p.seat));
    const orderIndex = new Map<string, number>();
    this.data.recentCheckedOrder.forEach((id, i) => orderIndex.set(id, i));

    // 按 cwOrder 把 inGame 玩家放回各自座位，再按勾选顺序把 checked 的顺次填剩下的空位
    const seatFill: (RecentPlayer | null)[] = new Array(4).fill(null);
    // 第一遍：放 inGame
    list.filter(p => p.inGame).forEach(p => {
      if (p.seat) seatFill[cwOrder.indexOf(p.seat)] = p;
    });
    // 第二遍：按勾选顺序填剩下的空位
    const slots = list.filter(p => !p.inGame && p.checked)
      .sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));
    let slotIdx = 0;
    for (let i = 0; i < 4; i++) {
      if (!seatFill[i]) {
        seatFill[i] = slots[slotIdx++] ?? null;
      }
    }
    // 现在 seatFill[0..3] 是该方位"占位的玩家"；对每个 recent player，找它占的方位
    const seatOfPlayer = new Map<string, Seat>();
    seatFill.forEach((p, i) => {
      if (p) seatOfPlayer.set(p.id, cwOrder[i]);
    });

    for (const p of list) {
      if (p.inGame) {
        (p as any).nextSeat = null; // 已在牌桌上不显示预告
      } else {
        (p as any).nextSeat = seatOfPlayer.get(p.id) ?? null;
      }
    }
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
    // 顶部"历史牌友"按钮打开：清空目标座，按东→南→西→北顺次入座
    this.setData({ showRecentPlayers: true, pendingFillSeat: null });
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
    const anchor = this.data.pendingFillSeat ?? undefined;
    if (player.checked) {
      this.setRecentChecked(next.filter(id => id !== player.id), anchor);
    } else {
      this.setRecentChecked([...next, player.id], anchor);
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
    const anchor = this.data.pendingFillSeat ?? undefined;
    if (!allOn && next.length > slots) {
      const kept = next.slice(0, slots);
      this.setRecentChecked(kept, anchor);
      wx.showToast({ title: `最多 ${MAX_PLAYERS} 人，只加了前 ${slots} 位`, icon: 'none' });
      return;
    }
    this.setRecentChecked(next, anchor);
    wx.vibrateShort({ type: 'light' });
  },

  onConfirmAddRecent() {
    // 按用户勾选顺序入座（先勾的坐东、后勾的坐南…），而非按牌友列表排序
    const recentMap = new Map<string, RecentPlayer>(
      this.data.recentPlayers.map(p => [p.id, p] as [string, RecentPlayer])
    );
    const picked: RecentPlayer[] = [];
    for (const id of this.data.recentCheckedOrder) {
      const p = recentMap.get(id);
      if (!p) continue;
      if (p.inGame || !p.checked) continue;
      picked.push(p);
      if (picked.length >= MAX_PLAYERS) break;
    }
    if (picked.length === 0) {
      wx.showToast({ title: '请先勾选要加入的牌友', icon: 'none' });
      return;
    }

    const players = [...this.data.players];
    const anchorSeat = this.data.pendingFillSeat;  // 点空白座位触发的"目标座"
    for (const p of picked) {
      if (players.length >= MAX_PLAYERS) break;
      if (players.some(x => x.playerId === p.id)) continue;
      // 有点空白座位的锚点：第一位坐 anchor，后续顺时针延展（pickNextSeatFrom）
      // 否则按 pickNextSeat（按 SEAT_ORDER 找第一个空位）
      const seat = anchorSeat
        ? pickNextSeatFrom(players, anchorSeat)
        : pickNextSeat(players);
      players.push({
        playerId: p.id,
        nickname: p.nickname,
        score: 0,
        isSubstitute: false,
        isObserver: false,
        seat,
        color: p.color,
        avatarIdx: playerAvatarIdx(p),
        avatarUrl: p.avatarUrl,
        avatarSrc: playerAvatarSrc(p),
        scoreText: '',
        negative: false
      } as DraftPlayer);
    }

    this.setData({
      players,
      showRecentPlayers: false,
      recentCheckedOrder: [],
      pendingFillSeat: null
    });
    this.refreshSeats();
    this.refreshMeButton();
    this.validateScore();
    wx.vibrateShort({ type: 'light' });
    wx.showToast({
      title: picked.length === 1 ? `已加入 ${picked[0].nickname}` : `已加入 ${picked.length} 位`,
      icon: 'success',
      duration: 1200
    });
  },

  onCloseRecentPlayers() {
    this.setData({ showRecentPlayers: false, pendingFillSeat: null });
  },

  onLongPressRecentPlayer(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    const player = this.data.recentPlayers[idx];
    if (!player) return;

    // 「我」= 本局牌桌里被绑定的那个；本局里没人时所有人可删
    const settings = wx.getStorageSync('mahjong:settings') || {};
    const myPlayerId: string | undefined = settings.myPlayerId;
    const meInThisGame = myPlayerId && this.data.players.some(p => p.playerId === myPlayerId);
    const isMe = !!(meInThisGame && myPlayerId === player.id);

    const inGame = this.data.players.some(p => p.playerId === player.id);
    const usageText = player.usage && player.usage > 0
      ? `TA 参与过 ${player.usage} 局战绩`
      : 'TA 还没有参战记录';

    // 长按 = 管理牌友：换头像（所有人可用）/ 删除档案（「我」不可删）
    const items: string[] = ['更换头像'];
    if (!isMe) items.push(`删除牌友「${player.nickname}」`);

    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        if (res.tapIndex === 0) {
          // 打开头像编辑弹层，高亮当前头像
          this.setData({
            showAvatarEditor: true,
            avatarEditorPlayerId: player.id,
            avatarEditorName: player.nickname,
            avatarEditorIdx: player.avatarIdx || 1
          });
          return;
        }
        if (res.tapIndex === 1) {
          wx.showModal({
            title: '删除牌友档案',
            content: `确定删除「${player.nickname}」吗？\n\n${usageText}，删除档案后这些历史战绩会完整保留，只是不再出现在牌友列表里。`,
            confirmText: '删除',
            confirmColor: '#D85A30',
            success: (m) => {
              if (!m.confirm) return;
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
                this.validateScore();
              }
              this.refreshRecentPlayers();
              wx.showToast({ title: '已删除', icon: 'success' });
            }
          });
        }
      }
    });
  },

  onCloseAvatarEditor() {
    this.setData({ showAvatarEditor: false });
  },

  /** 头像编辑弹层：点选即保存生效 */
  onAvatarEditorPick(e: WechatMiniprogram.TapEvent) {
    const idx = Number(e.currentTarget.dataset.idx);
    const id = this.data.avatarEditorPlayerId;
    if (!id) return;

    const updated = updatePlayerAvatar(id, idx);
    if (!updated) {
      wx.showToast({ title: '牌友不存在', icon: 'none' });
      return;
    }

    // 同步本局中的 draft（若该牌友正在牌桌上）：显式选内置图 → 清自定义 URL
    const players = this.data.players.map(p =>
      p.playerId === id ? { ...p, avatarIdx: idx, avatarUrl: undefined, avatarSrc: builtinAvatarSrc(idx) } : p
    );

    // 反向同步：改的是「我」的头像 → 账户头像一并更新（local:N 标记，不传图）
    if (getMe()?.id === id) {
      updateProfile({ avatar: `local:${idx}` }).catch(() => { /* 静默：本地已生效 */ });
    }

    this.setData({
      players,
      avatarEditorIdx: idx,
      showAvatarEditor: false
    });
    this.refreshSeats();
    this.updateModalSeats();
    this.refreshRecentPlayers();
    wx.vibrateShort({ type: 'light' });
    wx.showToast({ title: '头像已更换', icon: 'success', duration: 1000 });
  },

  onPlayerInput(e: WechatMiniprogram.Input) {
    const name = e.detail.value;
    // 输入昵称后给出系统建议头像（避开已有牌友占用的），用户仍可手动改选
    this.setData({
      newPlayerName: name,
      suggestedAvatarIdx: name.trim() ? suggestAvatarIdx(getPlayers()) : this.data.suggestedAvatarIdx
    });
  },

  onSelectAvatar(e: WechatMiniprogram.TapEvent) {
    this.setData({ selectedAvatarIdx: Number(e.currentTarget.dataset.idx) });
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
    // 用户显式选的优先；否则用档案自带头像（findOrCreatePlayer 已避开现有牌友占用的）
    const pickedIdx = this.data.selectedAvatarIdx
      || (player.avatarIdx && player.avatarIdx >= 1 && player.avatarIdx <= 20 ? player.avatarIdx : 0);
    const draft: DraftPlayer = {
      playerId: player.id,
      nickname: player.nickname,
      score: 0,
      isSubstitute: false,
      isObserver: false,
      seat,
      color: player.color,
      avatarIdx: pickedIdx || playerAvatarIdx(player),
      avatarUrl: pickedIdx ? undefined : player.avatarUrl,
      avatarSrc: pickedIdx ? builtinAvatarSrc(pickedIdx) : playerAvatarSrc(player),
      scoreText: '',
      negative: false
    };

    this.setData({
      players: [...this.data.players, draft],
      newPlayerName: '',
      selectedAvatarIdx: 0   // 重置显式选择，下一位新牌友继续跟随系统建议
    });
    this.refreshSeats();
    this.refreshMeButton();
    this.validateScore();
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
      avatarIdx: playerAvatarIdx(me),
      avatarUrl: me.avatarUrl,
      avatarSrc: playerAvatarSrc(me),
      scoreText: '',
      negative: false
    };
    // 「我」固定排在首位（直觉约定）
    this.setData({
      players: [draft, ...this.data.players],
      showRecentPlayers: false   // 关闭抽屉
    });
    this.refreshSeats();
    this.refreshMeButton();
    this.validateScore();
    wx.vibrateShort({ type: 'light' });
  },

  /**
   * 点空位（3 人局或未分配）→ 弹菜单让用户选：删某人就移到空位 / 或不做操作
   */
  onTapEmptySeat(e: WechatMiniprogram.TapEvent) {
    const seat = e.currentTarget.dataset.seat as Seat;
    // 记录"目标座位"，勾选历史牌友后入座这里；
    // 开局前（players=0）也允许开抽屉——历史牌友里有就直接入座，不拦用户
    this.refreshRecentPlayers();
    if (this.data.recentPlayers.length === 0) {
      wx.showToast({ title: '暂无历史牌友，先添加一位吧', icon: 'none' });
      return;
    }
    this.setData({
      pendingFillSeat: seat,
      showRecentPlayers: true
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

    // 正常情况：弹计分卡，选中跳到被点的玩家
    this.openScoreModal(seat);
  },

  /**
   * 对调两个座位的玩家
   * - swap 前 push 一次完整快照到 swapHistory（上限 5）
   * - 撤销栈 + 撤销按钮同步刷新
   */
  swapSeats(seatA: Seat, seatB: Seat) {
    if (seatA === seatB) return;
    const players = [...this.data.players];
    const a = players.find(p => p.seat === seatA);
    const b = players.find(p => p.seat === seatB);
    if (!a || !b) return;

    // 1. 推快照（保存 swap 前的完整状态）
    const snapshot = players.map(p => ({ ...p }));   // 深拷贝一层即可（结构无嵌套）
    const newHistory = [...this.data.swapHistory, snapshot].slice(-UNDO_LIMIT);

    // 2. 互换 seat
    const tmp = a.seat;
    a.seat = b.seat;
    b.seat = tmp;

    this.setData({
      players,
      swapHistory: newHistory,
      canUndoSwap: true
    });
    this.refreshSeats();
    this.validateScore();
  },

  /**
   * 撤销上一次换位
   * - 弹出 swapHistory 最后一个快照，覆盖当前 players
   * - swapHistory 缩短 1；快照耗尽后 canUndoSwap=false（按钮自动隐藏）
   */
  onUndoSwap() {
    if (this.data.swapHistory.length === 0) {
      wx.showToast({ title: '没有可撤销的操作', icon: 'none' });
      return;
    }
    const newHistory = this.data.swapHistory.slice(0, -1);
    const restored = this.data.swapHistory[this.data.swapHistory.length - 1];

    this.setData({
      players: restored,
      swapHistory: newHistory,
      canUndoSwap: newHistory.length > 0
    });
    this.refreshSeats();
    this.validateScore();
    wx.vibrateShort({ type: 'light' });
    wx.showToast({ title: '已撤销上一步换位', icon: 'success', duration: 1200 });
  },

  /**
   * 点 + 按钮 → 也弹计分卡（更直接入口）
   */
  onTapSeatPlus() {
    this.openScoreModal();
  },

  openScoreModal(activeSeat?: Seat) {
    if (this.data.players.length < 2) {
      wx.showToast({ title: `至少 ${MIN_PLAYERS} 人才能开打`, icon: 'none' });
      return;
    }
    const modalSeats: ModalSeatView[] = SEAT_ORDER
      .map(seat => this.data.seats[seat])
      .filter((s): s is SeatView => !!s)
      .map(s => ({ ...s }));

    // 默认选中：优先用传入的 activeSeat，其次第一个
    const defaultSeat = (activeSeat && modalSeats.some(s => s.seat === activeSeat))
      ? activeSeat
      : modalSeats[0]?.seat ?? null;
    const defaultView = modalSeats.find(s => s.seat === defaultSeat);

    this.setData({
      showScoreModal: true,
      modalSeats,
      modalActiveSeat: defaultSeat,
      activePlayerNickname: defaultView?.nickname ?? ''
    });
  },

  onCloseScoreModal() {
    this.setData({ showScoreModal: false });
  },

  /** 内部：把带符号 value 累加到指定座位（计分弹窗内的快捷分数按钮复用此逻辑） */
  applyQuickScore(seat: Seat, value: number) {
    const players = [...this.data.players];
    const p = players.find(x => x.seat === seat);
    if (!p) return;

    const currentAbs = p.scoreText ? Number(p.scoreText) : 0;
    const currentSigned = p.negative ? -currentAbs : currentAbs;
    const nextSigned = Math.max(-9999, Math.min(9999, currentSigned + value));

    p.negative = nextSigned < 0;
    p.scoreText = Math.abs(nextSigned).toString();
    p.score = nextSigned;

    this.setData({ players });
    this.refreshSeats();
    this.validateScore();
    wx.vibrateShort({ type: 'light' });
  },

  /** 点某行玩家 → 设为快捷分数生效目标 */
  onModalSelectSeat(e: WechatMiniprogram.TapEvent) {
    const seat = e.currentTarget.dataset.seat as Seat;
    const target = this.data.players.find(p => p.seat === seat);
    this.setData({
      modalActiveSeat: seat,
      activePlayerNickname: target?.nickname ?? ''
    });
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
   * 弹窗内快捷分数：累加到当前选中玩家
   */
  onModalQuickScore(e: WechatMiniprogram.TapEvent) {
    const value = Number(e.currentTarget.dataset.value);
    if (!value) return;

    const activeSeat = this.data.modalActiveSeat;
    if (!activeSeat) return;

    const target = this.data.modalSeats.find(s => s.seat === activeSeat);
    if (!target) return;

    const players = [...this.data.players];
    const p = players.find(x => x.seat === target.seat);
    if (!p) return;

    const currentAbs = p.scoreText ? Number(p.scoreText) : 0;
    const currentSigned = p.negative ? -currentAbs : currentAbs;

    // value 直接带符号（如 -10 / +10），不再 Math.abs
    const nextSigned = Math.max(-9999, Math.min(9999, currentSigned + value));

    p.negative = nextSigned < 0;
    const abs = Math.abs(nextSigned);
    p.scoreText = abs.toString();
    p.score = nextSigned;

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
    const hasAnyScore = this.data.players.some(p => p.scoreText && p.scoreText !== '0' && p.scoreText !== '');
    this.setData({
      totalScore: total,
      scoreValid: total === 0,
      saveEnabled: valid,
      hasAnyScore
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
    this.setData({
      showScoreModal: false,
      // 战绩落库后清空撤销栈：避免下次开局回溯历史战绩被回溯改动
      swapHistory: [],
      canUndoSwap: false
    });
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