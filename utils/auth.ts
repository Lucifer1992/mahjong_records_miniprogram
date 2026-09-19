/**
 * 登录抽屉调度（登录页方案已废弃，改为半屏抽屉）
 *
 * 策略（对齐主流小程序）：
 * - 浏览不受限：未登录也正常加载本地数据
 * - 冷启动/切 tab：每个会话自动弹一次抽屉（用户关掉后不再自动弹）
 * - 功能操作：需要登录态的操作（如保存并同步本局）直接弹抽屉
 * - 云接口 401：api.ts 自动在当前页弹抽屉兜底
 */
import { hasToken } from './api';

/** 页面实例最小结构（能拿到 selectComponent 就够） */
interface PageLike {
  selectComponent?: (selector: string) => any;
}

function showDrawer(page: PageLike): void {
  const drawer = page.selectComponent ? page.selectComponent('#loginDrawer') : null;
  if (drawer) drawer.show();
}

/** 用户本次会话内主动关过抽屉 → 不再自动弹（功能操作/401 仍会弹） */
let dismissedThisSession = false;

export function markPromptDismissed(): void {
  dismissedThisSession = true;
}

/**
 * onShow 用：未登录且本会话还没被用户关过抽屉 → 弹抽屉。
 * 页面照常渲染本地数据（浏览不受限）。
 */
export function promptLoginIfNeeded(page: PageLike): boolean {
  if (hasToken()) return true;
  if (!dismissedThisSession) showDrawer(page);
  return false;
}

/** 功能操作用：未登录直接弹抽屉并返回 false（调用方 return 中断操作） */
export function requireLogin(page: PageLike): boolean {
  if (hasToken()) return true;
  showDrawer(page);
  return false;
}
