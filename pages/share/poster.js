// pages/share/poster.ts
// 战绩分享卡（带 canvas 海报生成）
import { RULE_LABELS, DURATION_LABELS, MOOD_EMOJI } from '../../utils/types';
import { getRecordById, getRecords } from '../../utils/storage';
import { formatDate, formatDateShort } from '../../utils/date';
// 海报尺寸（与 WXML canvas width/height 保持一致）
const POSTER_W = 750;
const POSTER_H = 1200;
Page({
    data: {
        record: null,
        ruleLabel: '',
        durationLabel: '',
        playedAtText: '',
        rankedPlayers: [],
        highest: null,
        lowest: null,
        totalGames: 0,
        scoreGap: 0,
        // canvas / 保存状态
        canvasReady: false,
        saving: false,
        // 工具方法
        formatDate,
        formatDateShort
    },
    onLoad(options) {
        const id = options.id;
        if (id) {
            const record = getRecordById(id);
            if (record) {
                this.renderRecord(record);
                return;
            }
        }
        // 没有传入 ID，展示最近一场
        const records = getRecords();
        if (records.length > 0) {
            this.renderRecord(records[0]);
        }
    },
    /**
     * canvas 节点引用（type="2d" 必须用 selectorQuery 拿 node）
     */
    canvasNode: null,
    onReady() {
        // 拿 canvas 节点（绘制前不必初始化，但提前准备好避免首次点击卡顿）
        wx.createSelectorQuery()
            .select('#poster-canvas')
            .fields({ node: true, size: true })
            .exec((res) => {
            if (res && res[0] && res[0].node) {
                this.canvasNode = res[0].node;
                this.setData({ canvasReady: true });
            }
        });
    },
    renderRecord(record) {
        // 按分数降序排序
        const sorted = [...record.players].sort((a, b) => b.score - a.score);
        const medals = ['🥇', '🥈', '🥉'];
        const rankedPlayers = sorted.map((p, idx) => ({
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
    onShareAppMessage() {
        const record = this.data.record;
        if (!record) {
            return {
                title: '雀战录 · 记录每一场牌局',
                path: '/pages/index/index'
            };
        }
        const winner = record.players.reduce((max, p) => p.score > max.score ? p : max);
        return {
            title: `${formatDateShort(record.playedAt)} ${winner.nickname} 大赢 ${winner.score} 分`,
            path: `/pages/share/poster?id=${record.id}`,
            imageUrl: '' // 海报生成时通过 canvas 导出临时文件
        };
    },
    onShareTimeline() {
        const record = this.data.record;
        if (!record) {
            return {
                title: '雀战录 · 记录每一场牌局'
            };
        }
        const winner = record.players.reduce((max, p) => p.score > max.score ? p : max);
        return {
            title: `${formatDateShort(record.playedAt)} · ${winner.nickname} 大赢 ${winner.score} 分 · 雀战录`
        };
    },
    // ========== 操作 ==========
    onCopyLink() {
        wx.setClipboardData({
            data: `我用「雀战录」记录麻将战绩，你也来试试 → 微信搜索「雀战录」`,
            success: () => {
                wx.showToast({ title: '已复制', icon: 'success' });
            }
        });
    },
    onBack() {
        wx.navigateBack();
    },
    /**
     * 拿到 canvas + ctx（如 onReady 还没初始化好，回退重新拿）
     */
    ensureCanvas() {
        if (this.canvasNode) {
            const ctx = this.canvasNode.getContext('2d');
            return Promise.resolve({ canvas: this.canvasNode, ctx });
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
                resolve({ canvas: res[0].node, ctx: res[0].node.getContext('2d') });
            });
        });
    },
    /**
     * 保存图片到相册
     */
    async onSaveImage() {
        if (this.data.saving)
            return; // 防重入
        const record = this.data.record;
        if (!record) {
            wx.showToast({ title: '暂无战绩可分享', icon: 'none' });
            return;
        }
        this.setData({ saving: true });
        try {
            const { canvas, ctx } = await this.ensureCanvas();
            this.drawPoster(ctx, record, this.data.rankedPlayers, this.data.highest, this.data.lowest, this.data.scoreGap, this.data.totalGames);
            // 导出 PNG
            const tempPath = await new Promise((resolve, reject) => {
                wx.canvasToTempFilePath({
                    canvas,
                    x: 0,
                    y: 0,
                    width: POSTER_W,
                    height: POSTER_H,
                    destWidth: POSTER_W * 2, // 2x 像素密度更清晰
                    destHeight: POSTER_H * 2,
                    fileType: 'png',
                    quality: 1,
                    success: (r) => resolve(r.tempFilePath),
                    fail: (e) => reject(e)
                });
            });
            // 保存到相册
            await new Promise((resolve, reject) => {
                wx.saveImageToPhotosAlbum({
                    filePath: tempPath,
                    success: () => resolve(),
                    fail: (e) => reject(e)
                });
            });
            wx.showToast({ title: '已保存到相册', icon: 'success' });
        }
        catch (e) {
            const errMsg = (e && e.errMsg) || (e && e.message) || '';
            if (errMsg.includes('auth deny') || errMsg.includes('authorize') || errMsg.includes('scope.writePhotosAlbum')) {
                // 用户拒绝授权 → 引导去设置
                wx.showModal({
                    title: '需要相册权限',
                    content: '保存战绩海报需要您授权访问相册，是否前往设置开启？',
                    confirmText: '去设置',
                    cancelText: '取消',
                    success: (m) => {
                        if (m.confirm)
                            wx.openSetting();
                    }
                });
            }
            else {
                wx.showToast({ title: '保存失败，请重试', icon: 'none' });
                console.error('[poster] save image failed:', e);
            }
        }
        finally {
            this.setData({ saving: false });
        }
    },
    /**
     * 绘制海报（纯色块 + 文字，无外部图片依赖）
     */
    drawPoster(ctx, record, rankedPlayers, highest, lowest, scoreGap, totalGames) {
        // 工具：圆角矩形
        const roundRect = (x, y, w, h, r, fill) => {
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
        const text = (str, x, y, color, size, align = 'left', weight = 'normal') => {
            ctx.fillStyle = color;
            ctx.font = `${weight} ${size}px sans-serif`;
            ctx.textAlign = align;
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(str, x, y);
        };
        // 1. 整张背景（暖米色）
        ctx.fillStyle = '#F7F5F0';
        ctx.fillRect(0, 0, POSTER_W, POSTER_H);
        // 2. 顶部 Hero：渐变绿（用两条横向条带模拟）
        const heroH = 240;
        const grad = ctx.createLinearGradient(0, 0, POSTER_W, heroH);
        grad.addColorStop(0, '#4A9D7E');
        grad.addColorStop(1, '#84C9AB');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, POSTER_W, heroH);
        // Hero 文字
        text('🀄 雀战录 · 战绩分享', 375, 70, 'rgba(255,255,255,0.85)', 22, 'center');
        text(record.ruleName, 375, 140, '#FFFFFF', 44, 'center', 'bold');
        text(`${this.formatDateShort(record.playedAt)} · ${DURATION_LABELS[record.duration]}` +
            (record.mood ? ` · ${MOOD_EMOJI[record.mood]}` : ''), 375, 190, 'rgba(255,255,255,0.92)', 22, 'center');
        // 3. 主卡片
        const cardX = 40;
        const cardY = 200;
        const cardW = POSTER_W - cardX * 2;
        const cardH = 880;
        roundRect(cardX, cardY, cardW, cardH, 24, '#FFFFFF');
        // 4. 卡片头部：品牌 + 日期
        text('🀄 雀战录', cardX + 30, cardY + 50, '#4A9D7E', 26, 'left', 'bold');
        text(this.formatDateShort(record.playedAt), cardX + cardW - 30, cardY + 50, '#9B9A93', 20, 'right');
        // 玩法标签
        const tagText = RULE_LABELS[record.ruleType] || record.ruleName;
        const tagW = ctx.measureText(tagText).width + 28;
        roundRect(cardX + 130, cardY + 32, tagW, 32, 8, '#E8F2EC');
        text(tagText, cardX + 130 + tagW / 2, cardY + 53, '#4A9D7E', 18, 'center');
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
                const bg = idx === 0 ? 'linear-gradient' : idx === 1 ? '#F2F2F0' : '#FDF1EA';
                if (idx === 0) {
                    // 第一名用渐变
                    const g = ctx.createLinearGradient(listX, rowY, listX + listW, rowY + rowH);
                    g.addColorStop(0, '#FAEEDA');
                    g.addColorStop(1, '#FFF3DA');
                    ctx.fillStyle = g;
                }
                else {
                    ctx.fillStyle = bg;
                }
                roundRect(listX, rowY, listW, rowH, 14, ctx.fillStyle);
            }
            // emoji
            text(p.medal, listX + 30, rowY + 50, '#222', 28, 'center');
            // 昵称
            text(p.nickname, listX + 80, rowY + 50, '#222', 26, 'left', 'bold');
            // 分数
            const sign = p.score > 0 ? '+' : '';
            const scoreColor = p.score > 0 ? '#1D9E75' : '#D4537E';
            text(`${sign}${p.score}`, listX + listW - 30, rowY + 50, scoreColor, 28, 'right', 'bold');
        });
        // 6. 高亮区（MVP / 最低 / 分差）
        y += rankedPlayers.length * (rowH + rowGap) + 20;
        if (highest && lowest) {
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
                text(c.value, cx + colW / 2, y + 105, '#222', 22, 'center', 'bold');
            });
            y += hi;
        }
        // 7. 备注（可选）
        if (record.note) {
            const noteY = y + 12;
            roundRect(cardX + 30, noteY, cardW - 60, 70, 10, '#FAEEDA');
            text('📝', cardX + 50, noteY + 42, '#BA7517', 22, 'left');
            text(record.note, cardX + 86, noteY + 42, '#7A6537', 22, 'left');
            y += 70;
        }
        // 8. 底部：累计战绩
        const footerY = cardY + cardH - 100;
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#E8E5DD';
        ctx.beginPath();
        ctx.moveTo(cardX + 30, footerY);
        ctx.lineTo(cardX + cardW - 30, footerY);
        ctx.stroke();
        ctx.setLineDash([]);
        text('累计战绩', cardX + 30, footerY + 50, '#9B9A93', 22, 'left');
        text(`${totalGames} 场`, cardX + cardW - 30, footerY + 50, '#4A9D7E', 26, 'right', 'bold');
        text('由雀战录生成 · 扫码看战绩', 375, footerY + 88, '#9B9A93', 18, 'center');
        // 9. 海报底部外的小尾巴
        const tailY = cardY + cardH + 40;
        text('🀄 雀战录 · 记录每一场牌局', 375, tailY, '#9B9A93', 20, 'center');
    }
});
