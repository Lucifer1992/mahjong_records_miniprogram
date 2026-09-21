/**
 * 登录抽屉调度（2026-09-20 改版：不再自动弹）
 *
 * 策略：
 * - **首次进入不再自动弹**：用户进来先看主界面，体验不被打断
 * - 功能操作拦截：保存本局、立即同步、从云端拉取 → 弹抽屉
 * - 云接口 401：api.ts 自动在当前页弹抽屉兜底
 * - 需要账号昵称/头像：登录成功后由抽屉自己再弹二级"完善资料"抽屉
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

/**
 * onShow 用：仅检测登录态，不再自动弹抽屉。
 * 保留函数签名以便将来若要改回策略时不影响页面调用点。
 */
export function promptLoginIfNeeded(_page: PageLike): boolean {
  return hasToken();
}

/** 功能操作用：未登录直接弹抽屉并返回 false（调用方 return 中断操作） */
export function requireLogin(page: PageLike): boolean {
  if (hasToken()) return true;
  showDrawer(page);
  return false;
}