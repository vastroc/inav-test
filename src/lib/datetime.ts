/**
 * 时间展示工具。
 *
 * 本项目数据库内**直接存储北京时间**（`YYYY-MM-DD HH:MM:SS`，由 worker 的 nowBeijing() 写入）。
 * 因此无时区标记的字符串按 +08:00 解析，再以 Asia/Shanghai 输出，二者一致、不受浏览器时区影响。
 * 兼容历史数据：带 `Z` 或 `+08:00` 等时区标记的 ISO 字符串按其自身时区解析。
 */

const TIME_ZONE = "Asia/Shanghai";
const BEIJING_OFFSET = "+08:00";

/** 把数据库时间解析为 Date。无时区标记的按北京时间处理。 */
export function parseDbTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  let text = String(value).trim();
  if (!text) return null;
  if (!text.includes("T")) text = text.replace(" ", "T");
  if (!/([zZ]|[+-]\d{2}:?\d{2})$/.test(text)) text += BEIJING_OFFSET;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 北京时间日期，如 2026/11/09。 */
export function formatDate(value: string | null | undefined): string {
  const date = parseDbTime(value);
  if (!date) return "—";
  return date.toLocaleDateString("zh-CN", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** 相对时间（时区无关，只要解析正确即可）。 */
export function timeAgo(value: string | null | undefined): string {
  const date = parseDbTime(value);
  if (!date) return "";
  const seconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + " 分钟前";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + " 小时前";
  const days = Math.floor(hours / 24);
  if (days < 30) return days + " 天前";
  const months = Math.floor(days / 30);
  if (months < 12) return months + " 个月前";
  return Math.floor(months / 12) + " 年前";
}
