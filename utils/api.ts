/**
 * 后端 API 封装
 * 统一处理：baseURL、token 注入、错误归一
 */

// ⚠️ 部署时改为你的服务器域名
// 开发期可以填局域网 IP（如 http://192.168.1.10:3456）
// 生产期必须是 https:// 且在微信公众平台加白名单
// 后端默认端口 3456（避开常用 3000/8080），改端口要同步改 server/.env 的 PORT
export const API_BASE = 'https://mahjong.athenaquant.com.cn';

/**
 * 统一请求方法
 */
export interface ApiResponse<T = any> {
  code: number;
  data: T;
  message?: string;
}

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

function getToken(): string {
  return wx.getStorageSync('mahjong:token') || '';
}

export function setToken(token: string): void {
  wx.setStorageSync('mahjong:token', token);
}

export function clearToken(): void {
  wx.removeStorageSync('mahjong:token');
}

interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: any;
  auth?: boolean;        // 是否需要带 token（默认 true）
  showError?: boolean;   // 是否弹错误 toast（默认 true）
  silent?: boolean;      // 静默（不打印日志）
}

export async function request<T = any>(opts: RequestOptions): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.auth !== false) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: `${API_BASE}${opts.url}`,
      method: opts.method || 'GET',
      data: opts.data,
      header: headers,
      timeout: 15000,
      success: (res: any) => {
        const body = res.data as ApiResponse<T>;
        if (res.statusCode >= 200 && res.statusCode < 300 && body.code === 0) {
          resolve(body.data);
        } else if (res.statusCode === 401) {
          // token 失效 → 清掉，后续由业务跳登录
          clearToken();
          reject(new ApiError('UNAUTHORIZED', '登录已过期，请重新登录', 401));
        } else {
          const msg = body.message || `请求失败 (${res.statusCode})`;
          if (opts.showError !== false) {
            wx.showToast({ title: msg, icon: 'none', duration: 2000 });
          }
          reject(new ApiError(String(body.code ?? 'API_ERROR'), msg, res.statusCode));
        }
      },
      fail: (err: any) => {
        if (!opts.silent) {
          console.error('[API] request failed:', err);
        }
        if (opts.showError !== false) {
          wx.showToast({ title: '网络异常，请检查网络', icon: 'none' });
        }
        reject(new ApiError('NETWORK_ERROR', err.errMsg || '网络异常', 0));
      }
    });
  });
}

// ============ 业务 API ============

/** 微信登录 */
export function wxLogin(code: string, nickname?: string, avatar?: string) {
  return request<{
    token: string;
    user: { id: string; nickname: string; avatar: string; tier: 'free' | 'pro' };
  }>({
    url: '/api/auth/wx-login',
    method: 'POST',
    data: { code, nickname, avatar },
    auth: false
  });
}

/** 当前用户（含等级 + 当前生效额度） */
export function fetchMe() {
  return request<{
    id: string;
    nickname: string;
    avatar: string;
    tier: 'free' | 'pro';
    limits: { cloudWindowDates: number | null };
  }>({
    url: '/api/users/me',
    silent: true,
    showError: false
  });
}

/**
 * 兑换码升级 Pro
 *
 * 个人主体开不了微信支付，先用兑换码跑通「付费 → 解锁」闭环。
 * 将来接支付时，把这里换成支付回调即可，其余分层逻辑不用动。
 */
export function redeemPro(code: string) {
  return request<{ tier: 'free' | 'pro'; message: string }>({
    url: '/api/users/redeem',
    method: 'POST',
    data: { code },
    // 失败提示由页面自己弹（避免这里 toast 一次、页面再 toast 一次）
    showError: false
  });
}

/** 上传单条战绩 */
export function pushRecord(record: any) {
  return request<any>({ url: '/api/records', method: 'POST', data: record, silent: true });
}

/**
 * 批量同步
 * 响应里带 tier / trimmed —— 后端会顺手按用户等级修剪云端窗口，
 * 并把这次淘汰了多少条回传，前端据此给用户提示
 */
export function pushBatch(records: any[]) {
  return request<{
    success: number;
    failed: number;
    results: Array<{ id?: string; ok: boolean; error?: string }>;
    tier?: 'free' | 'pro';
    trimmed?: number;
  }>({
    url: '/api/records/batch',
    method: 'POST',
    data: { records },
    showError: false
  });
}

/** 拉取战绩列表 */
export function fetchRecords(params?: { limit?: number; offset?: number; ruleType?: string }) {
  const qs = new URLSearchParams(params as any).toString();
  return request<{ total: number; items: any[] }>({
    url: `/api/records${qs ? '?' + qs : ''}`,
    silent: true,
    // 失败由调用方（pullAndMerge）统一提示，这里再弹一次会 double toast
    showError: false
  });
}

/** 拉取福星克星 */
export function fetchFortune(playerId: string, topN = 5) {
  return request<any>({
    url: `/api/stats/fortune?playerId=${playerId}&topN=${topN}`,
    silent: true
  });
}

/** 拉取牌运月历 */
export function fetchCalendar(year: number, month: number, nickname?: string) {
  const qs = nickname ? `&nickname=${encodeURIComponent(nickname)}` : '';
  return request<any[]>({
    url: `/api/stats/calendar?year=${year}&month=${month}${qs}`,
    silent: true
  });
}

/** 拉取总览 */
export function fetchSummary(nickname?: string) {
  const qs = nickname ? `?nickname=${encodeURIComponent(nickname)}` : '';
  return request<any>({ url: `/api/stats/summary${qs}`, silent: true });
}

/** 健康检查（用于判断后端是否可达） */
export function healthCheck() {
  return request<{ status: string; env: string }>({
    url: '/api/health',
    auth: false,
    showError: false,
    silent: true
  });
}