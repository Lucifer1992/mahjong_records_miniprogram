/**
 * utils/upgrade.ts —— 通用 Pro 升级流程
 *
 * 为什么独立出来：
 *   原来逻辑在 profile 页 onUpgrade 里；分析页 / 战绩分享页想引导用户升级，
 *   跳转 profile 中转体验差（用户期望「点升级按钮 → 直接弹付费界面」）。
 *
 * 把付费全流程抽成 `runProUpgradeFlow()`，所有页面 onGoUpgrade 直接调用。
 *
 * 流程（与原 profile.onUpgrade 完全一致）：
 *   1. 已 Pro → 弹「Pro 权益」提示
 *   2. 未登录 → 弹登录抽屉
 *   3. iOS 微信 < 8.0.68 → 弹「请更新微信」
 *   4. 弹「¥9.9 永久解锁」确认框
 *   5. 调 /api/vpay/prepay 创建订单
 *   6. 调 wx.requestVirtualPayment 拉起支付
 *   7. 轮询 /api/vpay/order/:outTradeNo 等履约（最多 20 秒）
 *   8. 成功 → setTier('pro') + 成功 toast
 *   9. 超时 → 「支付确认中」提示
 */
import { isPro, setTier } from './tier';
import { createPrepay, getOrder } from './api';
const DEADLINE_MS = 20000; // 轮询总上限
const INTERVAL_MS = 1200; // 轮询间隔
const CALL_CAP_MS = 3000; // 单次查单上限
/**
 * iOS 微信版本检查：必须 ≥ 8.0.68 才能调起 wx.requestVirtualPayment
 * 不满足则弹窗引导更新并 return false
 */
function checkIosWechat() {
    const sys = wx.getSystemInfoSync();
    if (sys.platform !== 'ios')
        return true;
    const cur = (sys.version || '').split('.').map(n => Number(n) || 0);
    const base = [8, 0, 68];
    let blocked = false;
    for (let i = 0; i < 3; i++) {
        if (cur[i] > base[i])
            break;
        if (cur[i] < base[i]) {
            blocked = true;
            break;
        }
    }
    if (blocked) {
        wx.showModal({
            title: '请更新微信',
            content: 'iOS 端虚拟支付需要微信 8.0.68 及以上版本，请更新后再试。',
            showCancel: false,
            confirmText: '知道了'
        });
        return false;
    }
    return true;
}
/** 单次查单 + 硬性时间上限（被 race 丢弃的请求仍会在后台跑，但不再拖住轮询） */
function getOrderCapped(outTradeNo, capMs) {
    return Promise.race([
        getOrder(outTradeNo),
        new Promise((_, reject) => setTimeout(() => reject(new Error('GET_ORDER_TIMEOUT')), capMs))
    ]);
}
/**
 * 完整的 Pro 升级流程。从点击「升级」按钮处调用即可。
 *
 * @param onSuccess 支付成功后回调（页面用于 setData + Toast）
 */
export async function runProUpgradeFlow(onSuccess) {
    console.log('[upgrade] runProUpgradeFlow ENTRY v2 isPro=', isPro());
    // 1. 已 Pro
    if (isPro()) {
        console.log('[upgrade] already Pro');
        wx.showModal({
            title: 'Pro 权益',
            content: '你已解锁全部 Pro 权益：\n\n· 克星榜全量 + 战绩复盘\n· 月度报表随时看\n· 云端全量保留，不限天数\n· AI 复盘点评（即将上线）\n· 一次性付费，永久使用',
            showCancel: false,
            confirmText: '知道了'
        });
        return;
    }
    console.log('[upgrade] not Pro, checking iOS');
    // 2. 未登录 → 让页面自己用 requireLogin 拦；这里只做付费流程
    //    （调用方应在 onGoUpgrade 入口处先 requireLogin）
    // 3. iOS 版本检查
    if (!checkIosWechat()) {
        console.log('[upgrade] iOS blocked');
        return;
    }
    console.log('[upgrade] iOS ok, showing modal');
    // 4. 弹确认框
    //    ⚠️ wx.showModal 的 confirmText/cancelText 官方限制最多 4 个字符，
    //    超限会导致 API 直接 fail（弹窗完全不出现且无提示）——历史上传
    //    '¥9.9 立即解锁'（9 字符）就静默失败过。价格只能放 title/content。
    //
    //    ⚠️ 退款规则必须在支付前显著展示（消法第 26 条格式条款提示义务）：
    //    这段文字 = 用户点「立即解锁」时同意的分层退款政策（版本由后端记录在订单上），
    //    是「30 天后拒退」在平台仲裁/投诉时的核心证据。改文案要同步升级后端 REFUND_POLICY_VERSION。
    const confirm = await new Promise(resolve => {
        wx.showModal({
            title: '¥9.9 永久解锁 Pro',
            content: '一次性付费 · 永久使用 · 不订阅\n\n· 克星榜全量 + 战绩复盘解锁\n· 月度报表随时看\n· 云端全量保留，不限天数\n· AI 复盘点评（即将上线）\n\n战绩分享海报对所有用户免费。\n\n【退款规则】\n· 付款 7 天内未使用 Pro：全额退款\n· 功能故障：48 小时内人工处理\n· 付款超 30 天：不支持退款\n\n确认支付即表示同意上述规则。',
            confirmText: '立即解锁',
            cancelText: '暂不',
            success: (r) => resolve(r.confirm),
            fail: (err) => { console.error('[upgrade] showModal fail', err); resolve(false); }
        });
    });
    if (!confirm)
        return;
    // 5. 支付前重新 wx.login 换新 code → 后端刷新 session_key 再签名
    //    （signature = HMAC(session_key, signData)，库里的旧 session_key 过期会报 SIGNATURE_INVALID）
    //    ⚠️ wx.login 在某些环境下 success/fail 都不回调（hang 死），必须加超时兜底，
    //    否则 await 链断在这里 → createPrepay 永远到不了（2026-10-01 真机实测：Network 看不到 prepay）
    let loginCode = '';
    try {
        loginCode = await new Promise(resolve => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled)
                    return;
                settled = true;
                console.warn('[upgrade] wx.login timeout, fallback empty code');
                resolve('');
            }, 3000);
            wx.login({
                success: r => { if (settled)
                    return; settled = true; clearTimeout(timer); resolve(r.code || ''); },
                fail: (e) => { if (settled)
                    return; settled = true; clearTimeout(timer); console.warn('[upgrade] wx.login fail', e); resolve(''); }
            });
        });
    }
    catch (e) {
        console.warn('[upgrade] wx.login exception', e);
        loginCode = '';
    }
    console.log('[upgrade] loginCode obtained:', loginCode ? `${loginCode.slice(0, 8)}...` : '(empty)');
    console.log('[upgrade] >>> about to call createPrepay');
    // 6. 创建订单
    let params;
    try {
        console.log('[upgrade] calling createPrepay with code:', loginCode ? 'yes' : 'no');
        // agreePolicy: 上面弹窗展示了退款规则，用户点「立即解锁」即同意 → 服务端留痕
        params = await createPrepay('lifetime', loginCode || undefined, true);
        console.log('[upgrade] createPrepay success, signData.env =', JSON.parse(params.signData).env, 'paySig len =', params.paySig.length);
    }
    catch (e) {
        console.warn('[upgrade] prepay failed', e);
        const code = (e === null || e === void 0 ? void 0 : e.code) || '';
        const msg = (e === null || e === void 0 ? void 0 : e.message) || '';
        if (code === 'NETWORK_ERROR' || msg.includes('request:fail') || msg.includes('timeout')) {
            wx.showModal({
                title: '连不上服务器',
                content: `请求超时或被中断，可以换个网络再试（4G ↔ Wi-Fi）。\n\n${msg}`,
                showCancel: false,
                confirmText: '知道了'
            });
            return;
        }
        if (msg.includes('SESSION_KEY_MISSING') || msg.includes('登录')) {
            wx.showToast({ title: '请重新登录后支付', icon: 'none' });
        }
        else {
            wx.showToast({ title: '创建订单失败，请稍后重试', icon: 'none' });
        }
        return;
    }
    // 7. 唤起支付（只传文档要求的字段，剔除 outTradeNo/priceFen/label 等多余项）
    const payRes = await new Promise(resolve => {
        wx.requestVirtualPayment({
            signData: params.signData,
            paySig: params.paySig,
            signature: params.signature,
            mode: 'short_series_goods',
            success: () => resolve({ ok: true }),
            fail: (err) => resolve({ ok: false, err: `${(err === null || err === void 0 ? void 0 : err.errMsg) || '支付失败'} errCode=${err === null || err === void 0 ? void 0 : err.errCode}` })
        });
    });
    if (!payRes.ok) {
        console.warn('[upgrade] wx.requestVirtualPayment failed', payRes.err);
        wx.showToast({ title: '支付未完成', icon: 'none' });
        return;
    }
    // 8. 轮询等履约
    await pollOrderUntilPaid(params.outTradeNo, onSuccess);
}
/**
 * 订单轮询：每 ~1.2s 查一次 /order/:outTradeNo，命中 status='paid' 即升级成功
 * 必须按「墙钟时间」收口，不能只数轮数（每次 GET 都会挂满 api.ts 的 15s timeout）
 */
async function pollOrderUntilPaid(outTradeNo, onSuccess) {
    const started = Date.now();
    let paid = false;
    wx.showLoading({ title: '等待支付确认…', mask: true });
    try {
        while (Date.now() - started < DEADLINE_MS) {
            await new Promise(r => setTimeout(r, INTERVAL_MS));
            try {
                const order = await getOrderCapped(outTradeNo, CALL_CAP_MS);
                if (order.status === 'paid') {
                    paid = true;
                    break;
                }
            }
            catch (_a) {
                // 单次失败不中断轮询
            }
        }
    }
    finally {
        wx.hideLoading();
    }
    if (paid) {
        setTier('pro');
        onSuccess === null || onSuccess === void 0 ? void 0 : onSuccess();
        wx.showToast({ title: '升级成功 🎉', icon: 'success', duration: 1500 });
        return;
    }
    wx.showModal({
        title: '支付确认中',
        content: `订单 ${outTradeNo} 暂未到账，可能是支付回调延迟。\n如已扣款，刷新本页或稍后回来即可。`,
        showCancel: false,
        confirmText: '知道了'
    });
}
