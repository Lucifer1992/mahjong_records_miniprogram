/**
 * utils/refund.ts —— 用户自助退款申请流程
 *
 * 分层退款政策（与后端 REFUND_POLICY_VERSION = '2026-10-02' 一致）：
 *   1. 付款 7 天内未使用 Pro → 自动全额退款（原路退回）
 *   2. 功能故障 / 产品问题 → 48 小时人工核实（不受 30 天限制）
 *   3. 其他情况（7 天内已使用 / 7~30 天）→ 48 小时人工核实
 *   4. 付款超 30 天 → 按购买时同意的规则不支持退款（质量问题除外）
 *
 * 入口：profile 页「关于」→「售后与退款」。
 * 后端自动定位当前账号最近的已支付订单，前端不需要传单号。
 */
import { requestRefund } from './api';

/** 用户可选的退款原因（ActionSheet 顺序与 category 数组一一对应） */
const CATEGORY_LABELS: { label: string; category: 'unused' | 'quality' | 'other' }[] = [
  { label: '付款 7 天内，还没怎么用 Pro', category: 'unused' },
  { label: '功能故障 / 产品问题', category: 'quality' },
  { label: '其他原因', category: 'other' }
];

/**
 * 完整退款申请流程：选原因 → 提交 → 展示评估结果。
 * 未登录 / 无已支付订单等情况由后端统一给出提示文案。
 */
export async function runRefundRequestFlow(): Promise<void> {
  // 1. 选原因
  const category = await new Promise<'unused' | 'quality' | 'other' | null>(resolve => {
    wx.showActionSheet({
      itemList: CATEGORY_LABELS.map(c => c.label),
      success: r => resolve(CATEGORY_LABELS[r.tapIndex]?.category ?? null),
      fail: () => resolve(null)   // 用户取消
    });
  });
  if (!category) return;

  // 2. 提交申请（后端评估 + 留痕）
  wx.showLoading({ title: '提交中…', mask: true });
  let result: { decision: string; message: string };
  try {
    const resp = await requestRefund(category);
    result = resp;
  } catch (e: any) {
    wx.hideLoading();
    wx.showModal({
      title: '提交失败',
      content: (e?.message || '网络异常，请稍后重试') + '\n\n也可以通过「意见反馈」联系我们。',
      showCancel: false,
      confirmText: '知道了'
    });
    return;
  }
  wx.hideLoading();

  // 3. 展示结果（文案由服务端生成，保证与政策口径一致）
  const titleMap: Record<string, string> = {
    auto_refunded: '退款已受理 ✅',
    manual_review: '已提交人工核实',
    rejected: '暂不符合退款条件'
  };
  wx.showModal({
    title: titleMap[result.decision] || '申请结果',
    content: result.message,
    showCancel: false,
    confirmText: '知道了'
  });
}
