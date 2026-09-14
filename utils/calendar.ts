// utils/calendar.ts - 牌运月历数据组装

import { GameRecord, CalendarDay } from './types';
import { formatDate, getDaysInMonth, getFirstDayOfMonth } from './date';

export interface CalendarData {
  year: number;
  month: number;
  cells: CalendarCell[];   // 6x7 = 42 个格子（含空白填充）
  stats: {
    totalGames: number;
    winDays: number;
    loseDays: number;
    evenDays: number;
    netScore: number;
  };
}

export interface CalendarCell {
  day: number | null;     // null 表示空白填充
  date: string | null;
  data: CalendarDay | null;
}

/**
 * 构建某年某月的日历数据
 *
 * @param selfPlayerId 「我」的玩家 ID。传入则按个人视角统计（月历是「我的牌运」，应该这样算）；
 *                     不传则退回全场总分视角 —— 注意记分是零和的，那样每天的净胜分恒为 0
 */
export function buildCalendar(
  records: GameRecord[],
  year: number,
  month: number,
  selfPlayerId?: string
): CalendarData {
  const cells: CalendarCell[] = [];

  // 当月第一天是星期几（0=周日）
  const firstDay = getFirstDayOfMonth(year, month);
  // 当月天数
  const daysInMonth = getDaysInMonth(year, month);

  // 按日期聚合战绩
  const dayMap = new Map<string, CalendarDay>();
  for (const record of records) {
    const dateKey = formatDate(record.playedAt);
    const isInThisMonth =
      new Date(record.playedAt).getFullYear() === year &&
      new Date(record.playedAt).getMonth() + 1 === month;

    if (!isInThisMonth) continue;

    let cell = dayMap.get(dateKey);
    if (!cell) {
      cell = {
        date: dateKey,
        gamesPlayed: 0,
        netScore: 0,
        result: 'none'
      };
      dayMap.set(dateKey, cell);
    }
    cell.gamesPlayed += 1;
    // 个人视角：只累加「我」的分数（月历是"我的牌运"）
    // 不传 selfPlayerId 时退回全场总分 —— 但记分零和，那样净胜分恒为 0
    if (selfPlayerId) {
      const mine = record.players.find(p => p.playerId === selfPlayerId);
      cell.netScore += mine ? mine.score : 0;
    } else {
      cell.netScore += record.players.reduce((sum, p) => sum + p.score, 0);
    }
  }

  // 计算每日结果
  for (const cell of dayMap.values()) {
    if (cell.netScore > 0) cell.result = 'win';
    else if (cell.netScore < 0) cell.result = 'lose';
    else if (cell.gamesPlayed > 0) cell.result = 'even';
  }

  // 填充日历单元格
  // 前导空白
  for (let i = 0; i < firstDay; i++) {
    cells.push({ day: null, date: null, data: null });
  }
  // 当月日期
  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const cell = dayMap.get(dateKey) || null;
    cells.push({ day: d, date: dateKey, data: cell });
  }
  // 尾部空白，补齐到 42 个（6 行 × 7 列）
  while (cells.length < 42) {
    cells.push({ day: null, date: null, data: null });
  }

  // 统计
  let totalGames = 0;
  let netScore = 0;
  let winDays = 0, loseDays = 0, evenDays = 0;
  for (const cell of dayMap.values()) {
    totalGames += cell.gamesPlayed;
    netScore += cell.netScore;
    if (cell.result === 'win') winDays++;
    else if (cell.result === 'lose') loseDays++;
    else if (cell.result === 'even') evenDays++;
  }

  return {
    year,
    month,
    cells,
    stats: { totalGames, winDays, loseDays, evenDays, netScore }
  };
}

/**
 * 切换月份
 */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  let newMonth = month + delta;
  let newYear = year;
  if (newMonth > 12) {
    newMonth = 1;
    newYear += 1;
  } else if (newMonth < 1) {
    newMonth = 12;
    newYear -= 1;
  }
  return { year: newYear, month: newMonth };
}