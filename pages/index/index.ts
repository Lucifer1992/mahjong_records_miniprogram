// pages/index/index.ts
// 首页 - 快速记分

import { promptLoginIfNeeded, requireLogin } from '../../utils/auth';
import {
  RuleType,
  GameDuration,
  Mood,
  GameRecord,
  PlayerScore,
  Player
} from '../../utils/types';
import {
  SUPPORTED_RULES,
  CUSTOM_RULE_ENTRY,
  CUSTOM_RULE_NAME_MAX,
  DURATIONS,
  MOODS,
  MIN_PLAYERS,
  MAX_PLAYERS,
  MIN_GAMES_FOR_ANALYSIS
} from '../../utils/constants';
import { addRecord, findOrCreatePlayer, getPlayers, getRecords, ensureMe, getMe, rememberLastRuleType, getLastOrDefaultRuleType, getSettings, rememberLastDuration, deletePlayer, getRecentLineups } from '../../utils/storage';
import { uuid } from '../../utils/storage';
import type { Lineup } from '../../utils/storage';
import { inferDurationByClock } from '../../utils/duration';
import { formatDateShort, formatDateTime } from '../../utils/date';
import { enqueuePush, tryAutoSync } from '../../utils/sync';
import { calcSelfWinRate } from '../../utils/stats';

interface DraftPlayer extends PlayerScore {
  color: string;
  avatarIdx: number;
  /** 输入框里的原始数字，只存绝对值（正负由 negative 决定） */
  scoreText: string;
  /** 是否负分（输家）。数字键盘打不出负号，所以用按钮切换 */
  negative: boolean;
}

/** 历史牌友抽屉条目：玩家档案 + 参战场次 + 勾选状态 */
interface RecentPlayer extends Player {
  /** 该昵称在历史战绩里出现的次数 */
  usage: number;
  /** 是否已经在本局名单里（已在本局的恒为勾选，不可取消） */
  inGame: boolean;
  /** 是否被勾选（多行一起提交，不再是点一个加一个） */
  checked: boolean;
}

Page({
  data: {
    // 玩法选择（预设 + 末尾"自定义玩法…"入口）
    rules: [...SUPPORTED_RULES, CUSTOM_RULE_ENTRY],
    selectedRuleIndex: 0,
    selectedRule: SUPPORTED_RULES[0] as { readonly id: string; readonly name: string; readonly desc: string },
    // 自定义玩法输入（独立 input 控件，不再用 showModal）
    customRuleDraft: '',
    customRuleNameMax: CUSTOM_RULE_NAME_MAX,
    // 自定义玩法取消输入时的回退目标
    prevRuleIndex: 0,
    prevRule: SUPPORTED_RULES[0] as { readonly id: string; readonly name: string; readonly desc: string },

    // 时段选择（onLoad 时根据本机时间 + 上次记录动态初始化）
    durations: DURATIONS,
    selectedDurationIndex: 1, // 占位值，onLoad 时覆盖
    selectedDuration: DURATIONS[1],

    // 心情
    moods: MOODS,
    selectedMood: null as Mood | null,

    // 玩家
    players: [] as DraftPlayer[],
    newPlayerName: '',
    showSubstitute: false,
    // 「+ 我」快捷按钮（本局还没加我时显示）
    showAddMe: false,

    // 历史牌友（多选；可勾选多行后一次性「加入本局」）
    recentPlayers: [] as RecentPlayer[],
    showRecentPlayers: false,
    // 顶部常用阵容（由最近 10 场自动统计：常一起打的 / 上一局原班）
    recentLineups: [] as Lineup[],
    // 已勾选（不含本局已在的人）数量，用于底部按钮文案
    recentCheckedCount: 0,

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
    // 首次进入：按"上次保存的玩法"或 settings.defaultRuleType 选中
    const lastRuleId = getLastOrDefaultRuleType();
    const idx = this.data.rules.findIndex(r => r.id === lastRuleId);
    if (idx >= 0) {
      this.setData({
        selectedRuleIndex: idx,
        selectedRule: this.data.rules[idx] as any
      });
    }

    // 时段优先级：上次记录 > 本机时间推断 > 默认晚上
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
    this.refreshMeButton();
  },

  onShow() {
    // 登录策略：浏览不受限；本会话自动弹一次登录抽屉（可关），核心操作另行拦截
    promptLoginIfNeeded(this);
    // ⚠️ 注意：这里不能再调 loadPlayers()。
    // players 是「本局参与者」，不是牌友档案列表。每切一次 tab 就把档案
    // 灌回来，会让用户删掉的牌友复活，而且 Player 上根本没有 score 字段
    // （求和变 NaN）。改牌友只能走 onAddPlayer / onRemovePlayer。
    this.loadStats();
    this.refreshMeButton();
    this.refreshRecentPlayers();
  },

  /** 登录抽屉登录成功回调：刷新首页统计 */
  onLoggedIn() {
    this.loadStats();
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

    // 计算 Hero 数据
    const greeting = this.getGreeting();
    const todayText = this.getTodayText();
    const totalPlayers = getPlayers().length;
    // Hero 胜率：判定统一走 calcSelfWinRate（按 playerId 认「我」，
    // 不再假设 players[0] 就是我 —— 点牌友的先后决定顺序，我可能在任何一位）
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

  // ========== 玩法选择 ==========

  onRuleChange(e: WechatMiniprogram.PickerChange) {
    const idx = Number(e.detail.value);
    const picked = this.data.rules[idx];

    // 自定义玩法：不再弹 showModal —— picker 下方独立 input 控件里直接编辑。
    // 灰色 placeholder（"如「办公室麻将」「四人血战」"）就是默认参考字，无需手动删除。
    if (picked.id === 'custom') {
      // 已在 custom 态保留 draft；首次进入时记下上一次的预设以便回退
      if (this.data.selectedRule.id !== 'custom') {
        this.setData({ prevRuleIndex: idx, prevRule: this.data.selectedRule });
      }
      this.setData({
        selectedRule: { id: 'custom', name: this.data.customRuleDraft, desc: '自定义玩法' },
        selectedRuleIndex: idx
      });
      // 切完 picker 后让 input 自动聚焦（nextTick 保证 setData 完成）
      setTimeout(() => {
        (this as any).selectComponent?.('#customRuleInput')?.focus?.();
      }, 0);
      return;
    }

    // 切回预设：
    // - 从 custom 切回且 draft 为空 → 回退到原 prevRule（避免误操作改了玩法）
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

  /** 自定义玩法输入实时同步：超长截断 + 同步到 selectedRule.name */
  onCustomRuleInput(e: { detail: { value: string } }) {
    const raw = e.detail.value || '';
    const trimmed = raw.trim();
    const safe = trimmed.length > CUSTOM_RULE_NAME_MAX
      ? trimmed.slice(0, CUSTOM_RULE_NAME_MAX)
      : trimmed;
    // 截断保护（防止粘贴溢出时 input 真实值仍是 raw）
    if (safe !== raw) {
      this.setData({ customRuleDraft: safe });
    } else {
      this.setData({ customRuleDraft: trimmed });
    }
    // 同步到 selectedRule.name（保存时直接用）
    this.setData({
      selectedRule: { id: 'custom', name: safe, desc: '自定义玩法' }
    });
  },

  // ========== 时段选择 ==========

  onDurationSelect(e: WechatMiniprogram.TapEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    this.setData({
      selectedDurationIndex: idx,
      selectedDuration: DURATIONS[idx]
    });
  },

  // ========== 心情选择 ==========

  onMoodSelect(e: WechatMiniprogram.TapEvent) {
    const mood = e.currentTarget.dataset.mood as Mood;
    this.setData({ selectedMood: this.data.selectedMood === mood ? null : mood });
  },

  // ========== 玩家管理 ==========

  /**
   * 刷新历史牌友列表（按"最近使用"倒序）
   * 使用频率 = 出现过的战绩数量（多者排前），同数按 createdAt 倒序
   * 计算来源：扫描 records，统计每个 nickname 出现次数
   */
  refreshRecentPlayers() {
    const records = getRecords();
    const allPlayers = getPlayers();

    // 统计每个 nickname 的战绩场次
    const usage = new Map<string, number>();
    for (const r of records) {
      for (const p of r.players) {
        const n = p.nickname.trim();
        if (n) usage.set(n, (usage.get(n) || 0) + 1);
      }
    }

    // 玩家档案（按 createdAt desc 兜底排序）
    const sorted = [...allPlayers].sort((a, b) => b.createdAt - a.createdAt);

    // 加 usage 字段后按 usage desc / createdAt desc 排序
    // 兜底规则：从未参战的档案只保留最近 20 个（按 createdAt desc），避免抽屉全是空档案
    const withUsage = sorted
      .map(p => ({ ...p, usage: usage.get(p.nickname) || 0, inGame: false, checked: false } as RecentPlayer))
      .filter((p, i) => p.usage > 0 || i < 20)
      .sort((a, b) => b.usage - a.usage || b.createdAt - a.createdAt)
      .slice(0, 30);  // 抽屉最多展示 30 个，避免太长

    // 多选状态：已在本局的人固定为勾选且不可取消（取消不会把他移出本局，反而更困惑）
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

  /**
   * 重写勾选状态
   * @param ids 需要勾选的牌友 id（已在本局的人恒为勾选，不受这个集合影响）
   */
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

  /** 当前还能再加几个人（受 MAX_PLAYERS 限制） */
  recentSlotsLeft(): number {
    return MAX_PLAYERS - this.data.players.length;
  },

  /** 打开「历史牌友选择」抽屉（点 + 按钮时如果输入框为空） */
  onShowRecentPlayers() {
    if (this.data.recentPlayers.length === 0) {
      wx.showToast({ title: '暂无历史牌友，先添加一位吧', icon: 'none' });
      return;
    }
    // 每次打开都重算：本局名单变了、勾选状态也该重置
    this.refreshRecentPlayers();
    this.setData({ showRecentPlayers: true });
  },

  /** 勾选 / 取消某个牌友（多选；加人走底部「加入本局」统一提交） */
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

  /** 点顶部常用阵容 → 帮你把那几个人勾上（仍可再单独增删） */
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

    // 再点一次 = 取消这个阵容（而不是无脑叠加，否则想换阵容时会越点越多）
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

  /** 底部「加入本局（N）」：把勾上的人一次性加进来 */
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
      players.push({
        playerId: p.id,
        nickname: p.nickname,
        score: 0,
        isSubstitute: false,
        isObserver: false,
        color: p.color,
        avatarIdx: (players.length % 8) + 1,
        scoreText: '',
        negative: false
      } as DraftPlayer);
    }

    this.setData({ players, showRecentPlayers: false });
    this.refreshMeButton();
    wx.vibrateShort({ type: 'light' });
    wx.showToast({ title: `已加入 ${picked.length} 位`, icon: 'success', duration: 1200 });
  },

  /** 关闭历史牌友抽屉 */
  onCloseRecentPlayers() {
    this.setData({ showRecentPlayers: false });
  },

  /**
   * 长按历史牌友 → 弹菜单支持删除档案
   *
   * 只删档案：历史战绩里的昵称是当时快照，不会被改动/删除。
   * 「我」不可删（避免 getMe() 回退到 players[0] 导致身份漂移）。
   */
  onLongPressRecentPlayer(e: WechatMiniprogram.TouchEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    const player = this.data.recentPlayers[idx];
    if (!player) return;

    const me = getMe();

    // 已在局中 / 是我 → 提示，不开删除菜单
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
            // 若该牌友正在本局，一并从本局移除（否则会留下无档案的幽灵玩家）
            if (inGame) {
              this.setData({
                players: this.data.players.filter(p => p.playerId !== player.id)
              });
            }
            this.refreshRecentPlayers();
            wx.showToast({ title: '已删除', icon: 'success' });
          }
        });
      }
    });
  },

  /**
   * 点击牌友卡片（已加入的）→ 弹操作菜单：移除 / 查看历史
   * 移除仍是 × 按钮（独立），本方法处理卡片其他区域点击
   */
  onTapPlayer(e: WechatMiniprogram.TapEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    const player = this.data.players[idx];
    if (!player) return;

    wx.showActionSheet({
      itemList: [
        `查看 ${player.nickname} 的历史战绩`,
        '移除本局',
        '取消'
      ],
      success: (res) => {
        switch (res.tapIndex) {
          case 0:
            // 跳战绩列表时按 nickname 过滤（records 页支持 query param）
            wx.navigateTo({ url: `/pages/records/records?nickname=${encodeURIComponent(player.nickname)}` });
            break;
          case 1:
            // 复用 onRemovePlayer 的逻辑
            const removeIdx = this.data.players.findIndex(p => p.playerId === player.playerId);
            if (removeIdx >= 0) {
              const target = this.data.players[removeIdx];
              wx.showModal({
                title: '移出本局',
                content: `把 ${target.nickname} 从本局移除？\n\n仅影响本局，已录入的历史战绩不受影响。`,
                confirmText: '移出',
                confirmColor: '#A32D2D',
                success: (r) => {
                  if (!r.confirm) return;
                  const next = [...this.data.players];
                  next.splice(removeIdx, 1);
                  this.setData({ players: next });
                  this.refreshMeButton();
                }
              });
            }
            break;
        }
      }
    });
  },

  onPlayerInput(e: WechatMiniprogram.Input) {
    this.setData({ newPlayerName: e.detail.value });
  },

  onAddPlayer() {
    const name = this.data.newPlayerName.trim();
    if (!name) {
      // 输入框为空 → 弹历史牌友抽屉（避免用户每次重新输入）
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
    const avatarIdx = (this.data.players.length % 8) + 1;
    const draft: DraftPlayer = {
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
    this.refreshMeButton();
  },

  // ========== 快捷加我 ==========

  /** 「+ 我」按钮可见性：本局还没把我加进去时显示 */
  refreshMeButton() {
    const me = getMe();
    const inGame = !!me && this.data.players.some(p => p.playerId === me.id);
    this.setData({ showAddMe: !inGame });
  },

  /** 一键把自己加入本局（取「我」的玩家档案，昵称在「我的页」维护） */
  onAddMe() {
    // 未登录弹抽屉拦截：避免本地创建"我"玩家但云端账号不存在，
    // 导致战绩上传时 playerId 在云端找不到同步失败
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

    const draft: DraftPlayer = {
      playerId: me.id,
      nickname: me.nickname,
      score: 0,
      isSubstitute: false,
      isObserver: false,
      color: me.color,
      avatarIdx: (this.data.players.length % 8) + 1,
      scoreText: '',
      negative: false
    };
    // 「我」固定排在首位：既符合"我是列表第一个"的直觉，也让 players[0] == 我 这条
    // 老约定继续成立。（历史数据里我可能不在首位，所以统计侧必须靠 selfIn() 按 id 认人）
    this.setData({ players: [draft, ...this.data.players] });
    this.refreshMeButton();
    wx.vibrateShort({ type: 'light' });
  },

  onRemovePlayer(e: WechatMiniprogram.TapEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    const target = this.data.players[idx];
    if (!target) return;

    // × 按钮很小又贴着牌友卡片，容易误触，所以加一道确认
    wx.showModal({
      title: '移出本局',
      content: `确定把「${target.nickname}」移出本局吗？\n\n（只是不参与这局记分，牌友档案会保留）`,
      confirmText: '移出',
      confirmColor: '#A32D2D',
      success: (res) => {
        if (!res.confirm) return;
        const players = [...this.data.players];
        players.splice(idx, 1);
        this.setData({ players });
        this.validateScore();
        this.refreshMeButton();
      }
    });
  },

  // ========== 分数录入 ==========

  onScoreInput(e: WechatMiniprogram.Input) {
    const idx = Number(e.currentTarget.dataset.index);
    const digits = String(e.detail.value).replace(/\D/g, '').slice(0, 4);
    const players = [...this.data.players];
    const p = players[idx];
    if (!p) return;

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
  onToggleSign(e: WechatMiniprogram.TapEvent) {
    const idx = Number(e.currentTarget.dataset.index);
    const players = [...this.data.players];
    const p = players[idx];
    if (!p) return;

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

  onNoteInput(e: WechatMiniprogram.Input) {
    this.setData({ note: e.detail.value });
  },

  // ========== 保存 ==========

  async onSave() {
    // 保存本局需要登录（云端身份 + 同步）；未登录弹抽屉并中断
    if (!requireLogin(this)) return;
    // 自定义玩法必须填了名字
    if (this.data.selectedRule.id === 'custom' && !this.data.customRuleDraft.trim()) {
      wx.showToast({ title: '请填写玩法名称', icon: 'none' });
      // 自动聚焦输入框
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
        isObserver: p.isObserver
      })),
      totalFee: 0,
      note: this.data.note.trim(),
      mood: this.data.selectedMood
    };

    addRecord(record);

    // 记住本次玩法，下次进首页时默认选中
    rememberLastRuleType(this.data.selectedRule.id as RuleType);
    // 记住本次时段，下次进首页时优先用它（无历史时仍按本机时间推断）
    rememberLastDuration(this.data.selectedDuration.id as 'morning' | 'afternoon' | 'evening' | 'overnight');

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

  // ========== 收盘 ==========

  onFinish() {
    if (this.data.players.length === 0) {
      wx.showToast({ title: '暂无数据', icon: 'none' });
      return;
    }
    wx.switchTab({ url: '/pages/records/records' });
  }
});