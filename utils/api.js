/**
 * 后端 API 封装
 * 统一处理：baseURL、token 注入、错误归一
 */
// ⚠️ 部署时改为你的服务器域名
// 开发期可以填局域网 IP（如 http://192.168.1.10:3456）
// 生产期必须是 https:// 且在微信公众平台加白名单
// 后端默认端口 3456（避开常用 3000/8080），改端口要同步改 server/.env 的 PORT
export const API_BASE = 'https://mahjong.athenaquant.com.cn';
export class ApiError extends Error {
    constructor(code, message, status) {
        super(message);
        this.code = code;
        this.status = status;
    }
}
function getToken() {
    return wx.getStorageSync('mahjong:token') || '';
}
export function setToken(token) {
    wx.setStorageSync('mahjong:token', token);
}
export function hasToken() {
    return !!wx.getStorageSync('mahjong:token');
}
export function clearToken() {
    wx.removeStorageSync('mahjong:token');
}
/** 401 后在当前页弹出登录抽屉（组件由各 tab 页挂在 #loginDrawer 上） */
let redirectingToLogin = false;
function redirectLogin() {
    if (redirectingToLogin)
        return;
    redirectingToLogin = true;
    setTimeout(() => { redirectingToLogin = false; }, 1000);
    try {
        const pages = getCurrentPages();
        const cur = pages[pages.length - 1];
        const drawer = cur && cur.selectComponent ? cur.selectComponent('#loginDrawer') : null;
        if (drawer)
            drawer.show();
    }
    catch (e) {
        // 找不到抽屉（如协议页）就静默，用户回到 tab 页后操作会再触发
    }
}
export async function request(opts) {
    const headers = { 'Content-Type': 'application/json' };
    if (opts.auth !== false) {
        const token = getToken();
        if (token)
            headers['Authorization'] = `Bearer ${token}`;
    }
    return new Promise((resolve, reject) => {
        wx.request({
            url: `${API_BASE}${opts.url}`,
            method: opts.method || 'GET',
            data: opts.data,
            header: headers,
            timeout: 15000,
            success: (res) => {
                var _a;
                const body = res.data;
                if (res.statusCode >= 200 && res.statusCode < 300 && body.code === 0) {
                    resolve(body.data);
                }
                else if (res.statusCode === 401) {
                    // token 失效 → 清掉并弹登录抽屉（半屏抽屉方案）
                    clearToken();
                    redirectLogin();
                    reject(new ApiError('UNAUTHORIZED', '登录已过期，请重新登录', 401));
                }
                else {
                    const msg = body.message || `请求失败 (${res.statusCode})`;
                    if (opts.showError !== false) {
                        wx.showToast({ title: msg, icon: 'none', duration: 2000 });
                    }
                    reject(new ApiError(String((_a = body.code) !== null && _a !== void 0 ? _a : 'API_ERROR'), msg, res.statusCode));
                }
            },
            fail: (err) => {
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
export function wxLogin(code, nickname, avatar) {
    return request({
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
export function uploadAvatar(filePath) {
    return new Promise((resolve, reject) => {
        wx.uploadFile({
            url: `${API_BASE}/api/upload/avatar`,
            filePath,
            name: 'file',
            header: { Authorization: `Bearer ${getToken()}` },
            timeout: 15000,
            success: (res) => {
                try {
                    const body = JSON.parse(res.data);
                    if (res.statusCode >= 200 && res.statusCode < 300 && body.code === 0) {
                        resolve(body.data);
                    }
                    else {
                        reject(new ApiError('UPLOAD_FAILED', body.message || '头像上传失败', res.statusCode));
                    }
                }
                catch (_a) {
                    reject(new ApiError('UPLOAD_FAILED', '头像上传响应异常', res.statusCode));
                }
            },
            fail: (err) => {
                reject(new ApiError('NETWORK_ERROR', err.errMsg || '头像上传失败', 0));
            }
        });
    });
}
/** 当前用户（含等级 + 当前生效额度） */
export function fetchMe() {
    return request({
        url: '/api/users/me',
        silent: true,
        showError: false
    });
}
/** 上传单条战绩 */
export function pushRecord(record) {
    return request({ url: '/api/records', method: 'POST', data: record, silent: true });
}
/** 修改云端昵称（本地玩家档案由调用方更新；失败不阻断本地改名） */
export function updateNickname(nickname) {
    return request({
        url: '/api/users/me',
        method: 'PATCH',
        data: { nickname },
        silent: true,
        showError: false
    });
}
/** 更新账户资料（昵称 / 头像 URL，登录后头像上传完成时调用） */
export function updateProfile(patch) {
    return request({
        url: '/api/users/me',
        method: 'PATCH',
        data: patch,
        silent: true,
        showError: false
    });
}
/**
 * 批量同步
 * 响应里带 tier / trimmed —— 后端会顺手按用户等级修剪云端窗口，
 * 并把这次淘汰了多少条回传，前端据此给用户提示
 */
export function pushBatch(records) {
    return request({
        url: '/api/records/batch',
        method: 'POST',
        data: { records },
        showError: false
    });
}
/** 拉取战绩列表 */
export function fetchRecords(params) {
    const qs = new URLSearchParams(params).toString();
    return request({
        url: `/api/records${qs ? '?' + qs : ''}`,
        silent: true,
        // 失败由调用方（pullAndMerge）统一提示，这里再弹一次会 double toast
        showError: false
    });
}
/** 健康检查（用于判断后端是否可达） */
export function healthCheck() {
    return request({
        url: '/api/health',
        auth: false,
        showError: false,
        silent: true
    });
}
