// pages/share/poster.ts
// 战绩分享：保存海报图（主）+ 转发好友（次）+ 右上角菜单（原生转发/朋友圈）
// 海报统一 2x 导出（1500×2400），所有人带「由雀战录生成」署名 + 右下角小程序码
// —— 海报是拉新主通道（合规：自愿分享 + 纯署名，不做"分享得 XX"的诱导），不按 Pro 分档

import { GameRecord } from '../../utils/types';
import { RULE_LABELS, DURATION_LABELS, MOOD_EMOJI } from '../../utils/types';
import { getRecordById, getRecords } from '../../utils/storage';
import { formatDateShort } from '../../utils/date';
import { isPro } from '../../utils/tier';
import { requireLogin } from '../../utils/auth';
import { runProUpgradeFlow } from '../../utils/upgrade';
import { API_BASE, getToken } from '../../utils/api';

interface RankedPlayer {
  nickname: string;
  score: number;
  color: string;
  rank: number;
  medal: string;
}

// 海报逻辑尺寸（ctx 按 scale(dpr) 后用逻辑坐标绘制）
const POSTER_W = 750;
// 海报总高随内容动态（layoutPoster 计算），1200 只是旧固定值留档
const POSTER_H_DEFAULT = 1200;
// 统一导出倍率：2x = 1500×2400（约 720P 宽度级，够群聊清晰度，体积适中）
const EXPORT_SCALE = 2;

Page({
  data: {
    record: null as GameRecord | null,
    ruleLabel: '',
    durationLabel: '',
    playedAtText: '',
    rankedPlayers: [] as RankedPlayer[],
    highest: null as RankedPlayer | null,
    lowest: null as RankedPlayer | null,
    totalGames: 0,
    scoreGap: 0,

    isPro: false,

    // 转发卡片落地页：对方手机没有这条战绩 → 显示拉新引导而不是猜本地数据
    guestMode: false,

    // canvas / 保存状态
    canvasReady: false,
    saving: false
  },

  /**
   * canvas 节点引用（type="2d" 必须用 selectorQuery 拿 node）
   */
  canvasNode: null as WechatMiniprogram.Canvas | null,
  /**
   * type="2d" canvas 的绘制缓冲区必须 JS 手动设置（WXML 的 width/height 属性无效，
   * 默认只有 300×150 —— 不设置的话内容全画在缓冲区外，导出空白图，2026-10-01 根因）。
   * ctx.scale(dpr) 只能随缓冲区初始化做一次，重复调用会叠加，用此标志防重。
   */
  canvasInited: false,
  /** 当前缓冲区对应的逻辑高度（海报高度随内容动态，不够高时重设缓冲区） */
  canvasBufH: 0,
  /** 小程序码本地文件缓存（码全员相同，取一次即可） */
  qrPath: null as string | null,
  /**
   * 预生成的海报临时文件，用作转发卡片的 imageUrl（同步取值，必须提前生成）
   */
  sharePosterPath: '' as string,

  onLoad(options: Record<string, string>) {
    this.setData({ isPro: isPro() });

    const id = options.id;
    const record = id ? getRecordById(id) : null;
    if (record) {
      this.renderRecord(record);
      return;
    }

    if (id) {
      // 带了战绩 id 但本地没有 → 转发卡片在别人手机上打开。
      // ⚠️ 不能 fallback 到「本地最近一场」：对方会把自己最近的战绩当成发卡人分享的那场。
      // 显示拉新引导页。
      this.setData({ guestMode: true });
      return;
    }

    // 没传 id：展示最近一场（保持原行为）；一条都没有就引导
    const records = getRecords();
    if (records.length > 0) {
      this.renderRecord(records[0]);
    } else {
      this.setData({ guestMode: true });
    }
  },

  onReady() {
    // 拿 canvas 节点（提前准备好，避免首次点击卡顿）
    wx.createSelectorQuery()
      .select('#poster-canvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (res && res[0] && res[0].node) {
          this.canvasNode = res[0].node;
          this.setData({ canvasReady: true });
        }
      });

    // 静默预生成海报快照：转发卡片的 imageUrl 必须在用户点转发时同步可用
    setTimeout(() => this.pregenerateShareImage(), 800);
  },

  /** 静默生成一张海报临时文件，供 onShareAppMessage 的 imageUrl 使用；失败不影响主流程 */
  async pregenerateShareImage() {
    const record = this.data.record;
    if (!record || this.sharePosterPath) return;
    try {
      this.sharePosterPath = await this.renderPoster(record);
    } catch (e) {
      console.warn('[poster] pregenerate share image failed:', e);
    }
  },

  /** 拉新引导页：去记分页 */
  onStartUsing() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  renderRecord(record: GameRecord) {
    // 按分数降序排序
    const sorted = [...record.players].sort((a, b) => b.score - a.score);
    const medals = ['🥇', '🥈', '🥉'];
    const rankedPlayers: RankedPlayer[] = sorted.map((p, idx) => ({
      nickname: p.nickname,
      score: p.score,
      color: idx === 0 ? '#BA7517' : idx === 1 ? '#888780' : idx === 2 ? '#D85A30' : '#4A9D7E',
      rank: idx + 1,
      medal: medals[idx] || `${idx + 1}.`
    }));

    const highest = rankedPlayers[0];
    const lowest = rankedPlayers[rankedPlayers.length - 1];
    const scoreGap = highest && lowest ? highest.score - lowest.score : 0;

    this.setData({
      record,
      ruleLabel: RULE_LABELS[record.ruleType] || record.ruleName,
      durationLabel: DURATION_LABELS[record.duration],
      playedAtText: formatDateShort(record.playedAt),
      rankedPlayers,
      highest,
      lowest,
      scoreGap,
      totalGames: getRecords().length
    });
  },

  // ========== 分享 ==========

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const record = this.data.record;
    if (!record) {
      return {
        title: '雀战录 · 记录每一场牌局',
        path: '/pages/index/index',
        imageUrl: this.sharePosterPath || ''
      };
    }
    const winner = record.players.reduce((max, p) => p.score > max.score ? p : max);
    return {
      title: `${formatDateShort(record.playedAt)} ${winner.nickname} 大赢 ${winner.score} 分`,
      path: `/pages/share/poster?id=${record.id}`,
      // 海报快照（含小程序码）作卡片图；预生成失败时回退当前页截图
      imageUrl: this.sharePosterPath || ''
    };
  },

  onShareTimeline(): WechatMiniprogram.Page.ICustomTimelineContent {
    const record = this.data.record;
    if (!record) {
      return {
        title: '雀战录 · 记录每一场牌局'
      };
    }
    const winner = record.players.reduce((max, p) => p.score > max.score ? p : max);
    return {
      title: `${formatDateShort(record.playedAt)} · ${winner.nickname} 大赢 ${winner.score} 分 · 雀战录`,
      query: `id=${record.id}`,
      imageUrl: this.sharePosterPath || ''
    };
  },

  // ========== 操作 ==========

  onBack() {
    wx.navigateBack();
  },

  /**
   * 免费用户点 Pro 升级横幅 → 直接走付费流程（不跳转）
   */
  onTapProCta() {
    requireLogin(this);
    runProUpgradeFlow(() => {
      this.setData({ isPro: isPro() });
    });
  },

  /**
   * 拿到 canvas + ctx（如 onReady 还没初始化好，回退重新拿）。
   * 首次拿到节点（或内容高度超过当前缓冲区）时设置 2d canvas 的绘制缓冲区尺寸。
   * 注意：重设 canvas.width/height 会重置整个画布和 transform，所以 scale 重新调一次不会叠加。
   * @param needH 内容需要的逻辑高度
   */
  ensureCanvas(needH: number): Promise<{ canvas: WechatMiniprogram.Canvas; ctx: CanvasRenderingContext2D }> {
    const setup = (canvas: WechatMiniprogram.Canvas) => {
      if (!this.canvasInited || this.canvasBufH < needH) {
        const sys = (wx as any).getWindowInfo
          ? (wx as any).getWindowInfo()
          : (wx as any).getSystemInfoSync();
        const dpr = (sys && sys.pixelRatio) || 2;
        canvas.width = POSTER_W * dpr;
        canvas.height = needH * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        this.canvasInited = true;
        this.canvasBufH = needH;
      }
      return { canvas, ctx: canvas.getContext('2d') };
    };

    if (this.canvasNode) {
      return Promise.resolve(setup(this.canvasNode));
    }
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .select('#poster-canvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) {
            reject(new Error('canvas not ready'));
            return;
          }
          this.canvasNode = res[0].node;
          this.setData({ canvasReady: true });
          resolve(setup(res[0].node));
        });
    });
  },

  /**
   * 获取小程序码本地文件（后端 getwxacodeunlimit 落盘缓存，返回 PNG）。
   * 用 wx.request + responseType arraybuffer（走 request 合法域名）而不是
   * wx.downloadFile —— downloadFile 合法域名是 MP 后台独立配置项，没配就静默失败。
   * 失败返回 null，海报降级为纯文字引导，不阻断保存。
   */
  fetchWxacode(): Promise<string | null> {
    if (this.qrPath) return Promise.resolve(this.qrPath);
    return new Promise((resolve) => {
      wx.request({
        url: `${API_BASE}/api/wxacode`,
        method: 'GET',
        responseType: 'arraybuffer',
        header: { Authorization: `Bearer ${getToken()}` },
        success: (r) => {
          const buf = r.data as ArrayBuffer;
          if (r.statusCode === 200 && buf && buf.byteLength > 100) {
            const filePath = `${wx.env.USER_DATA_PATH}/wxacode-poster.png`;
            try {
              wx.getFileSystemManager().writeFileSync(filePath, buf, 'binary');
              this.qrPath = filePath;
              resolve(filePath);
            } catch {
              resolve(null);
            }
          } else {
            console.warn('[poster] wxacode fetch failed:', r.statusCode);
            resolve(null);
          }
        },
        fail: (e) => {
          console.warn('[poster] wxacode request fail:', e && e.errMsg);
          resolve(null);
        }
      });
    });
  },

  /**
   * 按内容计算海报布局高度（卡片高度自适应，解决玩家少时卡内大片空白）
   */
  layoutPoster(playerCount: number, hasHighlight: boolean, hasNote: boolean) {
    const cardY = 200;
    const listH = playerCount * 86 - 8;              // 玩家行 78 + 间距 8
    const hlH = hasHighlight ? 140 : 0;              // 亮点区 120 + 上边距 20
    const noteH = hasNote ? 82 : 0;                  // 备注 70 + 上边距 12
    const footerH = 110;                             // 分隔线 + 累计战绩 + 署名
    const cardH = 120 + listH + 20 + hlH + noteH + footerH;
    const cardBottom = cardY + cardH;
    const qrY = cardBottom + 30;                     // 底部扫码区
    const posterH = Math.round(qrY + 134 + 28);
    return { cardY, cardH, cardBottom, qrY, posterH };
  },

  /**
   * 渲染海报并导出临时文件（含小程序码）
   */
  async renderPoster(record: GameRecord): Promise<string> {
    const hasHighlight = !!(this.data.highest && this.data.lowest);
    const layout = this.layoutPoster(this.data.rankedPlayers.length, hasHighlight, !!record.note);
    const { canvas, ctx } = await this.ensureCanvas(layout.posterH);
    const qrPath = await this.fetchWxacode();
    await this.drawPoster(
      ctx, canvas, record,
      this.data.rankedPlayers, this.data.highest, this.data.lowest,
      this.data.scoreGap, this.data.totalGames, qrPath, layout
    );

    // 导出：统一 2x。注意 type=2d 的 x/y/width/height 是缓冲区坐标
    const tempPath = await new Promise<string>((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas,
        x: 0,
        y: 0,
        width: canvas.width,
        height: canvas.height,
        destWidth: POSTER_W * EXPORT_SCALE,
        destHeight: layout.posterH * EXPORT_SCALE,
        fileType: 'png',
        quality: 1,
        success: (r) => resolve(r.tempFilePath),
        fail: (e) => reject(e)
      });
    });
    return tempPath;
  },

  /**
   * 保存图片到相册：生成 → 保存 → 弹出图片预览（自带转发/保存菜单，所见即所得）
   */
  async onSaveImage() {
    if (this.data.saving) return; // 防重入
    const record = this.data.record;
    if (!record) {
      wx.showToast({ title: '暂无战绩可分享', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    try {
      const tempPath = await this.renderPoster(record);

      // 保存到相册
      await new Promise<void>((resolve, reject) => {
        wx.saveImageToPhotosAlbum({
          filePath: tempPath,
          success: () => resolve(),
          fail: (e) => reject(e)
        });
      });

      // 缓存为转发卡片图
      this.sharePosterPath = tempPath;

      // 弹出大图预览：用户立刻看到海报样式，长按可转发/再次保存
      wx.previewImage({ urls: [tempPath] });
    } catch (e: any) {
      const errMsg = (e && e.errMsg) || (e && e.message) || '';
      if (errMsg.includes('auth deny') || errMsg.includes('authorize') || errMsg.includes('scope.writePhotosAlbum')) {
        // 用户拒绝授权 → 引导去设置
        wx.showModal({
          title: '需要相册权限',
          content: '保存战绩海报需要您授权访问相册，是否前往设置开启？',
          confirmText: '去设置',
          cancelText: '取消',
          success: (m) => {
            if (m.confirm) wx.openSetting();
          }
        });
      } else {
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
        console.error('[poster] save image failed:', e);
      }
    } finally {
      this.setData({ saving: false });
    }
  },

  /**
   * 绘制海报（纯色块 + 文字 + 底部小程序码）
   * 卡片高度按内容自适应（layout 由 layoutPoster 计算）；底部布局：左侧扫码文案 + 右侧小程序码
   */
  async drawPoster(
    ctx: CanvasRenderingContext2D,
    canvas: WechatMiniprogram.Canvas,
    record: GameRecord,
    rankedPlayers: RankedPlayer[],
    highest: RankedPlayer | null,
    lowest: RankedPlayer | null,
    scoreGap: number,
    totalGames: number,
    qrPath: string | null,
    layout: { cardY: number; cardH: number; cardBottom: number; qrY: number; posterH: number }
  ): Promise<void> {
    const POSTER_H = layout.posterH;

    // 工具：圆角矩形
    const roundRect = (x: number, y: number, w: number, h: number, r: number, fill: string) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };

    const text = (str: string, x: number, y: number, color: string, size: number, align: 'left' | 'center' | 'right' = 'left', weight: 'normal' | 'bold' = 'normal') => {
      ctx.fillStyle = color;
      ctx.font = `${weight} ${size}px sans-serif`;
      ctx.textAlign = align;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(str, x, y);
    };

    // 自适应文字：超宽先缩字号（最低 15px），仍超则截断加省略号 —— 防长昵称溢出格子
    const fitText = (str: string, x: number, y: number, color: string, size: number, maxW: number, align: 'left' | 'center' | 'right' = 'left', weight: 'normal' | 'bold' = 'normal') => {
      let s = size;
      ctx.font = `${weight} ${s}px sans-serif`;
      while (s > 15 && ctx.measureText(str).width > maxW) {
        s -= 2;
        ctx.font = `${weight} ${s}px sans-serif`;
      }
      let out = str;
      if (ctx.measureText(out).width > maxW) {
        while (out.length > 1 && ctx.measureText(`${out}…`).width > maxW) {
          out = out.slice(0, -1);
        }
        out = `${out}…`;
      }
      text(out, x, y, color, s, align, weight);
    };

    // 1. 整张背景（暖米色）
    ctx.fillStyle = '#F7F5F0';
    ctx.fillRect(0, 0, POSTER_W, POSTER_H);

    // 2. 顶部 Hero：渐变绿
    const heroH = 240;
    const grad = ctx.createLinearGradient(0, 0, POSTER_W, heroH);
    grad.addColorStop(0, '#4A9D7E');
    grad.addColorStop(1, '#84C9AB');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, POSTER_W, heroH);

    // Hero 文字（玩法名 + 日期只在这里出现一次，卡片头部不重复）
    text('🀄 雀战录 · 战绩分享', 375, 70, 'rgba(255,255,255,0.85)', 22, 'center');
    text(record.ruleName, 375, 140, '#FFFFFF', 44, 'center', 'bold');
    text(
      `${formatDateShort(record.playedAt)} · ${DURATION_LABELS[record.duration]}` +
      (record.mood ? ` · ${MOOD_EMOJI[record.mood]}` : ''),
      375, 190, 'rgba(255,255,255,0.92)', 22, 'center'
    );

    // 3. 主卡片（高度自适应）
    const cardX = 40;
    const cardY = layout.cardY;
    const cardW = POSTER_W - cardX * 2;
    const cardH = layout.cardH;
    roundRect(cardX, cardY, cardW, cardH, 24, '#FFFFFF');

    // 4. 卡片头部：品牌 + 玩法 tag（紧跟品牌，measureText 前先设对 font）+ 右侧场次序号
    const brandStr = '🀄 雀战录';
    text(brandStr, cardX + 30, cardY + 50, '#4A9D7E', 26, 'left', 'bold');
    ctx.font = 'bold 26px sans-serif';
    const brandW = ctx.measureText(brandStr).width;

    const tagText = RULE_LABELS[record.ruleType] || record.ruleName;
    ctx.font = '18px sans-serif';
    const tagW = Math.min(ctx.measureText(tagText).width + 28, cardW - (cardX + 30 + brandW + 16 - cardX) - 60);
    roundRect(cardX + 30 + brandW + 16, cardY + 28, tagW, 32, 8, '#E8F2EC');
    text(tagText, cardX + 30 + brandW + 16 + tagW / 2, cardY + 49, '#4A9D7E', 18, 'center');

    text(`第 ${totalGames} 场`, cardX + cardW - 30, cardY + 50, '#9B9A93', 20, 'right');

    // 分隔线
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#E8E5DD';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cardX + 30, cardY + 80);
    ctx.lineTo(cardX + cardW - 30, cardY + 80);
    ctx.stroke();
    ctx.setLineDash([]);

    // 5. 玩家排名（每行 78px）
    let y = cardY + 120;
    const rowH = 78;
    const rowGap = 8;
    const listX = cardX + 20;
    const listW = cardW - 40;
    rankedPlayers.forEach((p, idx) => {
      const rowY = y + idx * (rowH + rowGap);
      const isTop3 = idx < 3;
      // 金银铜底
      if (isTop3) {
        if (idx === 0) {
          // 第一名用渐变
          const g = ctx.createLinearGradient(listX, rowY, listX + listW, rowY + rowH);
          g.addColorStop(0, '#FAEEDA');
          g.addColorStop(1, '#FFF3DA');
          ctx.fillStyle = g;
        } else {
          ctx.fillStyle = idx === 1 ? '#F2F2F0' : '#FDF1EA';
        }
        roundRect(listX, rowY, listW, rowH, 14, ctx.fillStyle as string);
      }

      // emoji
      text(p.medal, listX + 30, rowY + 50, '#222', 28, 'center');

      // 昵称（防溢出：最多占 分数区 之前的空间）
      fitText(p.nickname, listX + 80, rowY + 50, '#222', 26, listW - 80 - 110, 'left', 'bold');

      // 分数
      const sign = p.score > 0 ? '+' : '';
      const scoreColor = p.score > 0 ? '#1D9E75' : '#D4537E';
      text(`${sign}${p.score}`, listX + listW - 30, rowY + 50, scoreColor, 28, 'right', 'bold');
    });
    y += rankedPlayers.length * (rowH + rowGap);

    // 6. 高亮区（MVP / 最低 / 分差）
    if (highest && lowest) {
      y += 20;
      const hi = 120;
      const hx = cardX + 30;
      const hw = cardW - 60;
      const colW = (hw - 24) / 3;
      // 分隔线
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#E8E5DD';
      ctx.beginPath();
      ctx.moveTo(hx, y);
      ctx.lineTo(hx + hw, y);
      ctx.stroke();
      ctx.setLineDash([]);

      const cells = [
        { emoji: '🏆', label: 'MVP', value: `${highest.nickname} +${highest.score}` },
        { emoji: '💧', label: '最低', value: `${lowest.nickname} ${lowest.score}` },
        { emoji: '⚡', label: '分差', value: `${scoreGap}` }
      ];
      cells.forEach((c, i) => {
        const cx = hx + i * (colW + 12);
        roundRect(cx, y + 18, colW, hi - 36, 12, '#F7F5F0');
        text(c.emoji, cx + colW / 2, y + 50, '#222', 22, 'center');
        text(c.label, cx + colW / 2, y + 75, '#9B9A93', 18, 'center');
        fitText(c.value, cx + colW / 2, y + 103, '#222', 22, colW - 16, 'center', 'bold');
      });
      y += hi;
    }

    // 7. 备注（可选）
    if (record.note) {
      const noteY = y + 12;
      roundRect(cardX + 30, noteY, cardW - 60, 70, 10, '#FAEEDA');
      text('📝', cardX + 50, noteY + 42, '#BA7517', 22, 'left');
      fitText(record.note, cardX + 86, noteY + 42, '#7A6537', 22, cardW - 60 - 56 - 30, 'left');
    }

    // 8. 卡内 footer：累计战绩 + 署名（贴卡片底部）
    const footerY = cardY + cardH - 104;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#E8E5DD';
    ctx.beginPath();
    ctx.moveTo(cardX + 30, footerY);
    ctx.lineTo(cardX + cardW - 30, footerY);
    ctx.stroke();
    ctx.setLineDash([]);

    text('累计战绩', cardX + 30, footerY + 44, '#9B9A93', 22, 'left');
    text(`${totalGames} 场`, cardX + cardW - 30, footerY + 44, '#4A9D7E', 26, 'right', 'bold');
    text('由雀战录生成', cardX + 30, footerY + 74, '#9B9A93', 18, 'left');

    // 9. 海报底部：左侧扫码引导文案 + 右侧小程序码（拉新钩子，所有人可见）
    const qrSize = 110;
    const qrX = POSTER_W - 40 - qrSize; // 600
    const qrY = layout.qrY;

    text('扫码进入「雀战录」', 40, qrY + 42, '#444441', 30, 'left', 'bold');
    text('记录你的每一场牌局', 40, qrY + 82, '#888780', 22, 'left');

    // 码的白底卡片（米色背景上垫白更清晰）
    roundRect(qrX - 12, qrY - 12, qrSize + 24, qrSize + 24, 14, '#FFFFFF');

    await new Promise<void>((resolve) => {
      if (!qrPath || !canvas.createImage) {
        // 无码降级：文字引导
        text('微信搜「雀战录」', qrX + qrSize / 2, qrY + qrSize / 2 + 8, '#4A9D7E', 24, 'center', 'bold');
        resolve();
        return;
      }
      const img = canvas.createImage();
      img.onload = () => {
        ctx.drawImage(img, qrX, qrY, qrSize, qrSize);
        resolve();
      };
      img.onerror = () => {
        text('微信搜「雀战录」', qrX + qrSize / 2, qrY + qrSize / 2 + 8, '#4A9D7E', 24, 'center', 'bold');
        resolve();
      };
      img.src = qrPath;
    });
  }
});
