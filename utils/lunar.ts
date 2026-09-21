// utils/lunar.ts - 农历 / 节气 / 传统节日
//
// ⚠️ 合规边界（重要，改动前必读）
// 微信《小程序平台常见拒绝情形》3.2.4：页面不能存在「算命、抽签、星座运势」等测试类内容。
// 本模块只提供**客观历法数据**（农历日期、节气、传统节日），属于日历功能，不涉及任何
// 命理推算/吉凶判断，因此合规。**严禁**在此文件里加「宜忌、吉凶、运势、命理」类逻辑。
//
// 数据来源：农历用压缩表推演（1900-2100），节气用天文近似公式。

/** 农历年数据表（1900-2100），每年一个整数：
 *  bit 16-4 依次表示 12 个月的大小月（1=大月30天，0=小月29天）
 *  bit 3-0  闰月月份（0=无闰月）
 *  bit 19-17 闰月天数标志（配合 leapDays 使用）
 */
const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900-1909
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910-1919
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920-1929
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930-1939
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940-1949
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950-1959
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960-1969
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970-1979
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980-1989
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0, // 1990-1999
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000-2009
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010-2019
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020-2029
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040-2049
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050-2059
  0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060-2069
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070-2079
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080-2089
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, // 2090-2099
  0x0d520                                                                                    // 2100
];

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

/** 农历月名（索引 0 占位，1-12 对应正月…腊月） */
const LUNAR_MONTH_NAMES = [
  '', '正月', '二月', '三月', '四月', '五月', '六月',
  '七月', '八月', '九月', '十月', '冬月', '腊月'
];

/** 农历日名用字 */
const DAY_NUM_1 = ['日', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const DAY_NUM_2 = ['初', '十', '廿', '卅'];

/** 24 节气名，索引 0 = 小寒（1 月第一个节气），23 = 冬至 */
export const SOLAR_TERMS = [
  '小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨',
  '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑',
  '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'
];

/** 节气分钟偏移表（配合下方 getTermDay 的近似算法） */
const TERM_MINUTES = [
  0, 21208, 42467, 63836, 85337, 107014, 128867, 150921,
  173149, 195551, 218072, 240693, 263343, 285989, 308563, 331033,
  353350, 375494, 397447, 419210, 440795, 462224, 483532, 504758
];

/** 农历传统节日：key = '月-日'（月为绝对值，闰月不算节日） */
const LUNAR_FESTIVALS: Record<string, string> = {
  '1-1': '春节',
  '1-15': '元宵节',
  '2-2': '龙抬头',
  '5-5': '端午节',
  '7-7': '七夕',
  '8-15': '中秋节',
  '9-9': '重阳节',
  '12-8': '腊八节',
  '12-23': '小年'
};

export interface LunarDate {
  year: number;        // 农历年
  month: number;       // 农历月 1-12（闰月时仍为当月数字）
  day: number;         // 农历日 1-30
  isLeap: boolean;     // 是否闰月
  monthName: string;   // 正月 / 二月 / … / 腊月
  dayName: string;     // 初一 / 初二 / …
  text: string;        // 「正月初一」（闰月为「闰六月初一」）
}

// ========== 基础查询 ==========

/** 某农历年闰哪个月（0 = 无闰月） */
function leapMonth(y: number): number {
  return LUNAR_INFO[y - MIN_YEAR] & 0xf;
}

/** 某农历年闰月的天数（无闰月返回 0） */
function leapDays(y: number): number {
  if (leapMonth(y) === 0) return 0;
  return (LUNAR_INFO[y - MIN_YEAR] & 0x10000) ? 30 : 29;
}

/** 某农历年第 m 个月的天数（29 或 30） */
function monthDays(y: number, m: number): number {
  return (LUNAR_INFO[y - MIN_YEAR] & (0x10000 >> m)) ? 30 : 29;
}

/** 某农历年共多少天 */
function yearDays(y: number): number {
  let sum = 348; // 12 * 29
  for (let i = 0x8000; i > 0x8; i >>= 1) {
    sum += (LUNAR_INFO[y - MIN_YEAR] & i) ? 1 : 0;
  }
  return sum + leapDays(y);
}

/** 农历日名：1 → 初一，10 → 初十，21 → 廿一，30 → 三十 */
function lunarDayName(d: number): string {
  if (d === 10) return '初十';
  if (d === 20) return '二十';
  if (d === 30) return '三十';
  return DAY_NUM_2[Math.floor(d / 10)] + DAY_NUM_1[d % 10];
}

/** 某年第 n 个节气的公历「日」（n: 0=小寒 … 23=冬至） */
function termDay(y: number, n: number): number {
  const ms = 31556925974.7 * (y - 1900) + TERM_MINUTES[n] * 60000 + Date.UTC(1900, 0, 6, 2, 5);
  return new Date(ms).getUTCDate();
}

// ========== 对外接口 ==========

/** 公历 → 农历 */
export function toLunar(date: Date): LunarDate {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();

  if (y < MIN_YEAR || y > MAX_YEAR) {
    // 超出农历表范围：退化为公历显示，不抛错（避免整页崩）
    return {
      year: y, month: m, day: d, isLeap: false,
      monthName: `${m}月`, dayName: `${d}日`, text: `${m}月${d}日`
    };
  }

  // 距 1900-01-31（该年正月初一）的天数
  let offset = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(1900, 0, 31)) / 86400000);

  let lunarYear = MIN_YEAR;
  for (; lunarYear <= MAX_YEAR; lunarYear++) {
    const days = yearDays(lunarYear);
    if (offset < days) break;
    offset -= days;
  }

  const leap = leapMonth(lunarYear);

  // 构造该农历年的月份序列（按顺序插入闰月）。
  // ⚠️ 不要用 for 循环计数器 + 「命中闰月时 lunarMonth -= 1」的写法：
  //    for 的自增会让下一轮再次命中同一条件，导致闰月被算两次（有闰月的年份整年错位）。
  const months: { month: number; isLeap: boolean; days: number }[] = [];
  for (let m = 1; m <= 12; m++) {
    months.push({ month: m, isLeap: false, days: monthDays(lunarYear, m) });
    if (leap > 0 && m === leap) {
      months.push({ month: m, isLeap: true, days: leapDays(lunarYear) });
    }
  }

  let picked = months[months.length - 1];
  for (const mon of months) {
    if (offset < mon.days) {
      picked = mon;
      break;
    }
    offset -= mon.days;
  }

  const lunarMonth = picked.month;
  const isLeap = picked.isLeap;
  const lunarDay = offset + 1;
  const monthName = LUNAR_MONTH_NAMES[lunarMonth] || `${lunarMonth}月`;
  const dayName = lunarDayName(lunarDay);
  const text = `${isLeap ? '闰' : ''}${monthName}${dayName}`;

  return {
    year: lunarYear,
    month: lunarMonth,
    day: lunarDay,
    isLeap,
    monthName,
    dayName,
    text
  };
}

/** 当日节气名（不是节气日则返回空串） */
export function getSolarTerm(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if (y < 1900 || y > 2100) return '';

  // 该月的两个节气索引
  const first = (m - 1) * 2;
  if (termDay(y, first) === d) return SOLAR_TERMS[first];
  if (termDay(y, first + 1) === d) return SOLAR_TERMS[first + 1];
  return '';
}

/** 当日传统节日名（不是节日则返回空串） */
export function getFestival(lunar: LunarDate): string {
  if (lunar.isLeap) return ''; // 闰月不算节日
  return LUNAR_FESTIVALS[`${lunar.month}-${lunar.day}`] || '';
}

export interface DayLabel {
  /** 日历格子里显示的文字 */
  label: string;
  /** 是否有节日/节气（用于高亮） */
  highlight: boolean;
  /** 类型：festival 优先于 solarTerm */
  kind: 'festival' | 'solarTerm' | 'lunar';
  lunar: LunarDate;
}

/**
 * 日历格子用的农历文案
 *
 * 优先级（与主流万年历一致）：传统节日 > 节气 > 农历日名
 * 初一显示月名（如「八月」），其余显示日名（如「十五」）
 */
export function getDayLabel(date: Date): DayLabel {
  const lunar = toLunar(date);
  const festival = getFestival(lunar);
  if (festival) {
    return { label: festival, highlight: true, kind: 'festival', lunar };
  }

  const term = getSolarTerm(date);
  if (term) {
    return { label: term, highlight: true, kind: 'solarTerm', lunar };
  }

  // 初一显示「X月」，其余显示日名
  const label = lunar.day === 1 ? lunar.monthName : lunar.dayName;
  return { label, highlight: false, kind: 'lunar', lunar };
}

/** 今天/选中日的完整农历描述，如「八月十五 中秋节」或「九月初五 秋分」 */
export function getFullLunarText(date: Date): string {
  const lunar = toLunar(date);
  const festival = getFestival(lunar);
  const term = getSolarTerm(date);
  const suffix = festival || term;
  return suffix ? `${lunar.text} · ${suffix}` : lunar.text;
}
