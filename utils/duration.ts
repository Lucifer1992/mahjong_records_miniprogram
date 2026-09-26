/**
 * 时间段工具：根据本机时间自动判断所属时段
 *
 * 时段窗口（按小时判断 24h 制）：
 *   上午 morning      06:00 - 11:59  （退休大爷晨场 / 周末上午局）
 *   下午 afternoon    12:00 - 17:59  （白天通勤牌局 / 棋牌室下午场）
 *   晚上 evening      18:00 - 01:59  （晚餐后 / 黄金时段）
 *   通宵 overnight    02:00 - 05:59  （凌晨硬核局）
 */
export function inferDurationByClock(now: Date = new Date()): 'morning' | 'afternoon' | 'evening' | 'overnight' {
  const h = now.getHours();
  if (h >= 6 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  if (h >= 18 || h < 2) return 'evening';   // 18:00-23:59 + 00:00-01:59 都算晚上
  return 'overnight';                        // 02:00-05:59
}