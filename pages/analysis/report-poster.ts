// pages/analysis/report-poster.ts
// 月度战报海报（Pro 专属）：canvas 2d 绘制一图流
// —— 称号大字 + 核心战绩 + 手气洞察 + 高光时刻 + 小程序码
//
// 复用 pages/share/poster 踩平的坑：
//   1. type=2d canvas 的绘制缓冲区必须 JS 手动设 node.width/height（WXML 属性无效，
//      默认 300×150 → 内容画出界、导出空白图）
//   2. 统一 2x 导出（1500 宽度级，群聊清晰度够）
//   3. 小程序码走 wx.request arraybuffer（downloadFile 合法域名是独立配置项）
//   4. canvas.createImage() 加载本地图片（type=2d 不认 <image> 标签那套）
//
// 分层：入口在分析页月报 tab，非 Pro 点击直接走升级流程；本页再兜一层 isPro 校验。
// 海报内容全部来自 utils/monthly-report（历史战绩统计 · 非预测）。

import { buildMonthlyReport, MonthlyReport } from '../../utils/monthly-report';
import { getRecords, getPlayers, getMe } from '../../utils/storage';
import { isPro } from '../../utils/tier';
import { API_BASE, getToken } from '../../utils/api';

// 海报逻辑尺寸（ctx 按 dpr scale 后用逻辑坐标绘制），导出 2x
const POSTER_W = 750;
const EXPORT_SCALE = 2;

const CARD_X = 40;
const CARD_W = POSTER_W - CARD_X * 2;

interface Section {
  y: number;
  h: number;
}

Page({
  data: {
    report: null as MonthlyReport | null,
    nickname: '',
    saving: false
  },

  canvasNode: null as WechatMiniprogram.Canvas | null,
  canvasInited: false,
  canvasBufH: 0,
  qrPath: null as string | null,
  /** 预生成的海报临时文件（转发卡片 imageUrl 必须同步可用） */
  sharePosterPath: '' as string,

  onLoad(options: Record<string, string>) {
    // 双保险：本页仅 Pro 可达（正常入口已在分析页拦截）
    if (!isPro()) {
      wx.showToast({ title: '月报海报为 Pro 专享', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }

    const now = new Date();
    const year = Number(options.year) || now.getFullYear();
    const month = Number(options.month) || now.getMonth() + 1;

    const records = getRecords();
    const players = getPlayers();
    // 玩家定位：query playerId 优先 → 我 → 第一个（与分析页选中视角保持一致）
    let player = options.playerId ? players.find(p => p.id === options.playerId) : undefined;
    if (!player) {
      const me = getMe();
      const meIdx = me ? players.findIndex(p => p.id === me.id) : -1;
      player = players[meIdx >= 0 ? meIdx : 0];
    }
    if (!player) {
      wx.showToast({ title: '还没有玩家档案', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }

    const report = buildMonthlyReport(records, player.id, year, month);
    if (!report) {
      wx.showToast({ title: '本月还没有战绩', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }

    this.setData({ report, nickname: player.nickname });
  },

  onReady() {
    if (!this.data.report) return;
    // 提前拿 canvas 节点 + 静默预生成（转发卡片图要同步可用）
    wx.createSelectorQuery()
      .select('#report-canvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (res && res[0] && res[0].node) {
          this.canvasNode = res[0].node;
        }
      });
    setTimeout(() => this.pregenerateShareImage(), 800);
  },

  async pregenerateShareImage() {
    if (!this.data.report || this.sharePosterPath) return;
    try {
      this.sharePosterPath = await this.renderPoster();
    } catch (e) {
      console.warn('[report-poster] pregenerate failed:', e);
    }
  },

  /** 拿 canvas + ctx，必要时重设缓冲区（重设会清空画布和 transform，scale 重新调） */
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
    if (this.canvasNode) return Promise.resolve(setup(this.canvasNode));
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .select('#report-canvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) {
            reject(new Error('canvas not ready'));
            return;
          }
          this.canvasNode = res[0].node;
          resolve(setup(res[0].node));
        });
    });
  },

  /** 小程序码：与战绩海报同一套路（request arraybuffer + 落盘缓存） */
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
            const filePath = `${wx.env.USER_DATA_PATH}/wxacode-report.png`;
            try {
              wx.getFileSystemManager().writeFileSync(filePath, buf, 'binary');
              this.qrPath = filePath;
              resolve(filePath);
            } catch {
              resolve(null);
            }
          } else {
            resolve(null);
          }
        },
        fail: () => resolve(null)
      });
    });
  },

  /** 逐段累加布局高度 */
  computeLayout(report: MonthlyReport): { sections: Section[]; qrY: number; posterH: number } {
    let y = 300;                       // hero 高 260 + 间距
    const sections: Section[] = [];
    const push = (h: number) => { sections.push({ y, h }); y += h + 24; };

    push(170);                         // 称号卡
    push(180);                         // 三格战绩
    push(60 + (report.mom ? 3 : 2) * 46 + 24);   // MVP/玩法/环比行
    push(190);                         // 手气洞察（表头 + 时段 + 方位）
    const hlRows = (report.bestWin ? 1 : 0) + (report.streakText ? 1 : 0) + (report.pain ? 1 : 0);
    if (hlRows > 0) push(60 + hlRows * 56 + 16); // 高光时刻
    const qrY = y + 6;
    const posterH = Math.round(qrY + 130 + 64);
    return { sections, qrY, posterH };
  },

  async renderPoster(): Promise<string> {
    const report = this.data.report;
    if (!report) throw new Error('no report');
    const layout = this.computeLayout(report);
    const { canvas, ctx } = await this.ensureCanvas(layout.posterH);
    const qrPath = await this.fetchWxacode();
    await this.drawPoster(ctx, canvas, report, this.data.nickname, qrPath, layout);

    return new Promise<string>((resolve, reject) => {
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
  },

  async onSaveImage() {
    if (this.data.saving) return;
    if (!this.data.report) return;
    this.setData({ saving: true });
    try {
      const tempPath = await this.renderPoster();
      await new Promise<void>((resolve, reject) => {
        wx.saveImageToPhotosAlbum({
          filePath: tempPath,
          success: () => resolve(),
          fail: (e) => reject(e)
        });
      });
      this.sharePosterPath = tempPath;
      wx.previewImage({ urls: [tempPath] });
    } catch (e: any) {
      const errMsg = (e && e.errMsg) || (e && e.message) || '';
      if (errMsg.includes('auth deny') || errMsg.includes('authorize') || errMsg.includes('scope.writePhotosAlbum')) {
        wx.showModal({
          title: '需要相册权限',
          content: '保存月报海报需要您授权访问相册，是否前往设置开启？',
          confirmText: '去设置',
          cancelText: '取消',
          success: (m) => { if (m.confirm) wx.openSetting(); }
        });
      } else {
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
        console.error('[report-poster] save failed:', e);
      }
    } finally {
      this.setData({ saving: false });
    }
  },

  onBack() {
    wx.navigateBack();
  },

  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const r = this.data.report;
    return {
      title: r
        ? `${this.data.nickname}的${r.month}月战报：${r.title.name}，净胜 ${r.netScoreText} 分`
        : '雀战录 · 记录每一场牌局',
      path: '/pages/index/index',
      imageUrl: this.sharePosterPath || ''
    };
  },

  onShareTimeline(): WechatMiniprogram.Page.ICustomTimelineContent {
    const r = this.data.report;
    return {
      title: r
        ? `${this.data.nickname}的${r.month}月战报 · ${r.title.name} · 雀战录`
        : '雀战录 · 记录每一场牌局',
      imageUrl: this.sharePosterPath || ''
    };
  },

  /** 绘制海报主体 */
  async drawPoster(
    ctx: CanvasRenderingContext2D,
    canvas: WechatMiniprogram.Canvas,
    report: MonthlyReport,
    nickname: string,
    qrPath: string | null,
    layout: { sections: Section[]; qrY: number; posterH: number }
  ): Promise<void> {
    const [titleS, statsS, metaS, insightS, hlS] = layout.sections;

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
    const text = (str: string, x: number, y: number, color: string, size: number,
                  align: 'left' | 'center' | 'right' = 'left', weight: 'normal' | 'bold' = 'normal') => {
      ctx.fillStyle = color;
      ctx.font = `${weight} ${size}px sans-serif`;
      ctx.textAlign = align;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(str, x, y);
    };
    /** 超宽缩字号 → 截断加省略号（防长昵称/多牌友溢出卡片） */
    const fitText = (str: string, x: number, y: number, color: string, size: number, maxW: number,
                     align: 'left' | 'center' | 'right' = 'left', weight: 'normal' | 'bold' = 'normal') => {
      let s = size;
      ctx.font = `${weight} ${s}px sans-serif`;
      while (s > 15 && ctx.measureText(str).width > maxW) {
        s -= 2;
        ctx.font = `${weight} ${s}px sans-serif`;
      }
      let out = str;
      if (ctx.measureText(out).width > maxW) {
        while (out.length > 1 && ctx.measureText(`${out}…`).width > maxW) out = out.slice(0, -1);
        out = `${out}…`;
      }
      text(out, x, y, color, s, align, weight);
    };
    const cardTitle = (t: string, y: number) => {
      text(t, CARD_X + 28, y + 42, '#4A9D7E', 26, 'left', 'bold');
    };

    // 1. 背景
    ctx.fillStyle = '#F7F5F0';
    ctx.fillRect(0, 0, POSTER_W, layout.posterH);

    // 2. Hero
    const heroH = 260;
    const grad = ctx.createLinearGradient(0, 0, POSTER_W, heroH);
    grad.addColorStop(0, '#4A9D7E');
    grad.addColorStop(1, '#84C9AB');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, POSTER_W, heroH);
    text('🀄 雀战录 · 月度战报', 375, 66, 'rgba(255,255,255,0.85)', 22, 'center');
    text(`${report.year}年${report.month}月`, 375, 136, '#FFFFFF', 46, 'center', 'bold');
    fitText(nickname, 375, 186, 'rgba(255,255,255,0.95)', 30, 500, 'center', 'bold');
    text(`净胜 ${report.netScoreText} · 胜率 ${report.winRateText} · ${report.totalGames} 场`, 375, 228, 'rgba(255,255,255,0.92)', 22, 'center');

    // 3. 称号卡
    roundRect(CARD_X, titleS.y, CARD_W, titleS.h, 24, '#FFFDF6');
    roundRect(CARD_X + 24, titleS.y + 24, CARD_W - 48, titleS.h - 48, 16, '#FFF6E0');
    text(`${report.title.emoji}  ${report.title.name}`, 375, titleS.y + 84, '#8A6410', 44, 'center', 'bold');
    fitText(report.title.desc, 375, titleS.y + 128, '#B08F3E', 22, CARD_W - 120, 'center');

    // 4. 三格战绩
    roundRect(CARD_X, statsS.y, CARD_W, statsS.h, 24, '#FFFFFF');
    const cells: Array<{ v: string; label: string; color: string }> = [
      { v: `${report.totalGames}`, label: '参战场次', color: '#3B3A36' },
      { v: report.netScoreText, label: '净胜分', color: report.netScore >= 0 ? '#C0392B' : '#1E8449' },
      { v: report.winRateText, label: '胜率', color: report.winRate >= 50 ? '#C0392B' : '#1E8449' }
    ];
    cells.forEach((c, i) => {
      const cx = CARD_X + (CARD_W / 3) * (i + 0.5);
      text(c.v, cx, statsS.y + 88, c.color, 44, 'center', 'bold');
      text(c.label, cx, statsS.y + 132, '#9B9A93', 20, 'center');
      if (i > 0) {
        ctx.strokeStyle = '#EFEDE6';
        ctx.beginPath();
        ctx.moveTo(CARD_X + (CARD_W / 3) * i, statsS.y + 34);
        ctx.lineTo(CARD_X + (CARD_W / 3) * i, statsS.y + statsS.h - 34);
        ctx.stroke();
      }
    });

    // 5. MVP / 玩法 / 环比
    roundRect(CARD_X, metaS.y, CARD_W, metaS.h, 24, '#FFFFFF');
    const rows: Array<{ k: string; v: string }> = [
      { k: '本月 MVP 牌友', v: `${report.mvpNickname}（同桌 ${report.mvpGames} 次）` },
      { k: '最常玩法', v: `${report.topRuleName}（${report.topRuleCount} 局）` }
    ];
    if (report.mom) rows.push({ k: '较上月', v: `净胜 ${report.mom.netDeltaText} · 胜率 ${report.mom.winRateDeltaText}` });
    rows.forEach((row, i) => {
      const ry = metaS.y + 52 + i * 46;
      text(row.k, CARD_X + 28, ry, '#9B9A93', 22);
      fitText(row.v, CARD_X + CARD_W - 28, ry, '#3B3A36', 22, CARD_W - 260, 'right');
    });

    // 6. 手气洞察
    roundRect(CARD_X, insightS.y, CARD_W, insightS.h, 24, '#FFFFFF');
    cardTitle('🔍 手气洞察', insightS.y);
    const bestDur = report.durations.find(d => d.isBest);
    const bestSeat = report.seats.find(s => s.isBest);
    fitText(
      bestDur ? `黄金时段：${bestDur.label}（${bestDur.games} 场，胜率 ${bestDur.winRateText}，${bestDur.netScoreText} 分）` : '黄金时段：数据不足',
      CARD_X + 28, insightS.y + 92, '#3B3A36', 24, CARD_W - 56
    );
    fitText(
      bestSeat ? `最旺方位：坐${bestSeat.label}（${bestSeat.games} 场，${bestSeat.netScoreText} 分）` : '最旺方位：数据不足',
      CARD_X + 28, insightS.y + 140, '#3B3A36', 24, CARD_W - 56
    );

    // 7. 高光时刻（有内容才画）
    if (hlS) {
      roundRect(CARD_X, hlS.y, CARD_W, hlS.h, 24, '#FFFFFF');
      cardTitle('⚡ 高光时刻', hlS.y);
      let ry = hlS.y + 86;
      if (report.bestWin) {
        fitText(`💥 最大单局 ${report.bestWin.scoreText} 分`, CARD_X + 28, ry, '#3B3A36', 24, CARD_W - 56);
        fitText(`   ${report.bestWin.dateText} · 同桌 ${report.bestWin.partnersText}`, CARD_X + 28, ry + 34, '#9B9A93', 20, CARD_W - 56);
        ry += 76;
      }
      if (report.streakText) {
        text(`🔥 ${report.streakText}`, CARD_X + 28, ry, '#3B3A36', 24);
        text('   连续赢下最多的纪录', CARD_X + 28, ry + 34, '#9B9A93', 20);
        ry += 56;
      }
      if (report.pain) {
        text(`🥶 最扎心对手：${report.pain.nickname}（${report.pain.netScoreText} 分，同桌 ${report.pain.games} 次）`, CARD_X + 28, ry, '#3B3A36', 24);
        ry += 56;
      }
    }

    // 8. 底部：合规声明 + 小程序码
    text(report.complianceText, 375, layout.qrY - 8, '#9B9A93', 20, 'center');
    const qrSize = 110;
    const qrX = POSTER_W - CARD_X - qrSize - 6;
    // 左侧文案
    text('长按识别小程序码', CARD_X + 6, layout.qrY + 40, '#4A9D7E', 26, 'left', 'bold');
    text('记录你的每一场牌局', CARD_X + 6, layout.qrY + 76, '#9B9A93', 20);
    // 分隔线
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#E8E5DD';
    ctx.beginPath();
    ctx.moveTo(CARD_X, layout.qrY - 26);
    ctx.lineTo(POSTER_W - CARD_X, layout.qrY - 26);
    ctx.stroke();
    ctx.setLineDash([]);

    await new Promise<void>((resolve) => {
      if (!qrPath || !canvas.createImage) {
        text('微信搜「雀战录」', qrX + qrSize / 2, layout.qrY + qrSize / 2 + 8, '#4A9D7E', 24, 'center', 'bold');
        resolve();
        return;
      }
      const img = canvas.createImage();
      img.onload = () => {
        ctx.drawImage(img, qrX, layout.qrY, qrSize, qrSize);
        resolve();
      };
      img.onerror = () => {
        text('微信搜「雀战录」', qrX + qrSize / 2, layout.qrY + qrSize / 2 + 8, '#4A9D7E', 24, 'center', 'bold');
        resolve();
      };
      img.src = qrPath;
    });
  }
});
