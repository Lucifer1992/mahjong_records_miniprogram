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

export function hasToken(): boolean {
  return !!wx.getStorageSync('mahjong:token');
}

export function clearToken(): void {
  wx.removeStorageSync('mahjong:token');
}

/** 401 后在当前页弹出登录抽屉（组件由各 tab 页挂在 #loginDrawer 上） */
let redirectingToLogin = false;
function redirectLogin(): void {
  if (redirectingToLogin) return;
  redirectingToLogin = true;
  setTimeout(() => { redirectingToLogin = false; }, 1000);

  try {
    const pages = getCurrentPages();
    const cur = pages[pages.length - 1] as any;
    const drawer = cur && cur.selectComponent ? cur.selectComponent('#loginDrawer') : null;
    if (drawer) drawer.show();
  } catch (e) {
    // 找不到抽屉（如协议页）就静默，用户回到 tab 页后操作会再触发
  }
}

interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
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
          // token 失效 → 清掉并弹登录抽屉（半屏抽屉方案）
          clearToken();
          redirectLogin();
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

/**
 * 上传头像（wx.chooseAvatar 的临时文件 → 服务器，返回可直接访问的 URL）
 * 必须在登录（有 token）后调用
 */
export function uploadAvatar(filePath: string): Promise<{ url: string }> {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${API_BASE}/api/upload/avatar`,
      filePath,
      name: 'file',
      header: { Authorization: `Bearer ${getToken()}` },
      timeout: 15000,
      success: (res: any) => {
        try {
          const body = JSON.parse(res.data) as ApiResponse<{ url: string }>;
          if (res.statusCode >= 200 && res.statusCode < 300 && body.code === 0) {
            resolve(body.data);
          } else {
            reject(new ApiError('UPLOAD_FAILED', body.message || '头像上传失败', res.statusCode));
          }
        } catch {
          reject(new ApiError('UPLOAD_FAILED', '头像上传响应异常', res.statusCode));
        }
      },
      fail: (err: any) => {
        reject(new ApiError('NETWORK_ERROR', err.errMsg || '头像上传失败', 0));
      }
    });
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

/** 上传单条战绩 */
export function pushRecord(record: any) {
  return request<any>({ url: '/api/records', method: 'POST', data: record, silent: true });
}

/** 修改云端昵称（本地玩家档案由调用方更新；失败不阻断本地改名） */
export function updateNickname(nickname: string) {
  return request<{ nickname: string }>({
    url: '/api/users/me',
    method: 'PATCH',
    data: { nickname },
    silent: true,
    showError: false
  });
}

/** 更新账户资料（昵称 / 头像 URL，登录后头像上传完成时调用） */
export function updateProfile(patch: { nickname?: string; avatar?: string }) {
  return request<{ nickname?: string; avatar?: string }>({
    url: '/api/users/me',
    method: 'PATCH',
    data: patch,
    silent: true,
    showError: false
  });
}

/**
 * 创建 Pro 升级预付订单（双签名 + 道具 ID + 价格 + outTradeNo）
 * 前端拿到后直接调 wx.requestVirtualPayment
 */
export function createPrepay(product: 'lifetime') {
  return request<{
    signData: string;
    paySig: string;
    signature: string;
    outTradeNo: string;
    priceFen: number;
    label: string;
  }>({
    url: '/api/vpay/prepay',
    method: 'POST',
    data: { product },
    showError: false
  });
}

/** 查询订单状态（轮询等履约） */
export function getOrder(outTradeNo: string) {
  return request<{
    id: string;
    out_trade_no: string;
    product_id: string;
    price_fen: number;
    status: 'created' | 'paid';
    paid_at: number | null;
    created_at: number;
  }>({
    url: `/api/vpay/order/${outTradeNo}`,
    silent: true,
    showError: false
  });
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

/** 健康检查（用于判断后端是否可达） */
export function healthCheck() {
  return request<{ status: string; env: string }>({
    url: '/api/health',
    auth: false,
    showError: false,
    silent: true
  });
}

/**
 * 提交意见反馈（必须登录；后端只存文本 + user_id，不收集手机号等敏感信息）
 * - 内容 5-500 字
 * - 每天同用户最多 5 条
 */
export function submitFeedback(content: string) {
  return request<{ id: string; createdAt: number }>({
    url: '/api/feedback',
    method: 'POST',
    data: { content },
    showError: false   // 错误由调用方按业务码提示（避免一刀切 toast）
  });
}