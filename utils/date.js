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
/**
 * 获取「今日」起始时间戳（按 resetHour 划日；默认凌晨 4 点）。
 *
 * 麻将战绩场景：深夜打到凌晨 2 点也算同一「天」，凌晨 4 点才切到新一天。
 * - 如果 now >= 今天 resetHour，则今日起始 = 今天 resetHour
 * - 如果 now < 今天 resetHour（如凌晨 3 点），今日起始 = 昨天 resetHour
 *
 * @example
 *   now = 2026-09-26 12:00, resetHour = 4 → 2026-09-26 04:00
 *   now = 2026-09-26 03:00, resetHour = 4 → 2026-09-25 04:00
 */
export function getDayResetAt(timestamp, resetHour = 4) {
    const d = new Date(timestamp);
    const todayReset = new Date(d.getFullYear(), d.getMonth(), d.getDate(), resetHour, 0, 0, 0).getTime();
    // 现在还没到今天的 resetHour（凌晨时段），今日其实从昨天 resetHour 算起
    return timestamp >= todayReset
        ? todayReset
        : todayReset - 24 * 60 * 60 * 1000;
}
