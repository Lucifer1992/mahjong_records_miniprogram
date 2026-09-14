// utils/date.ts - 日期工具
/**
 * 格式化日期为 YYYY-MM-DD
 */
export function formatDate(timestamp) {
    const d = new Date(timestamp);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
/**
 * 格式化日期为 MM/DD 周X
 */
export function formatDateShort(timestamp) {
    const d = new Date(timestamp);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    return `${month}/${day} 周${weekdays[d.getDay()]}`;
}
/**
 * 格式化为 YYYY-MM-DD HH:mm
 */
export function formatDateTime(timestamp) {
    const d = new Date(timestamp);
    const date = formatDate(timestamp);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${date} ${h}:${m}`;
}
/**
 * 获取某月天数
 */
export function getDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
}
/**
 * 获取某月第一天是星期几（0=周日）
 */
export function getFirstDayOfMonth(year, month) {
    return new Date(year, month - 1, 1).getDay();
}
/**
 * 获取相对时间描述（如"3 天前"）
 */
export function relativeTime(timestamp) {
    const diff = Date.now() - timestamp;
    const day = 24 * 60 * 60 * 1000;
    const hour = 60 * 60 * 1000;
    const minute = 60 * 1000;
    if (diff < minute)
        return '刚刚';
    if (diff < hour)
        return `${Math.floor(diff / minute)} 分钟前`;
    if (diff < day)
        return `${Math.floor(diff / hour)} 小时前`;
    if (diff < 7 * day)
        return `${Math.floor(diff / day)} 天前`;
    return formatDate(timestamp);
}
/**
 * 判断两个时间戳是否同一天
 */
export function isSameDay(a, b) {
    return formatDate(a) === formatDate(b);
}
/**
 * 判断时间戳是否在指定月份内
 */
export function isInMonth(timestamp, year, month) {
    const d = new Date(timestamp);
    return d.getFullYear() === year && d.getMonth() + 1 === month;
}
