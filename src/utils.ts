import { DayRecord } from "./types";

export function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function formatDateHeadline(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  const day = parsed.getDate();
  const weekday = new Intl.DateTimeFormat("zh-CN", {
    weekday: "short",
  }).format(parsed);

  return `${day} 号 ${weekday}`;
}

export function formatMonthHeadline(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return `${year % 100} 年 ${month} 月`;
}

export function sortDatesDesc(a: string, b: string) {
  return b.localeCompare(a);
}

export function groupRecordsByMonth(records: DayRecord[]) {
  const groups: { month: string; records: DayRecord[] }[] = [];

  for (const record of records) {
    const month = record.date.slice(0, 7);
    const lastGroup = groups[groups.length - 1];

    if (!lastGroup || lastGroup.month !== month) {
      groups.push({ month, records: [record] });
    } else {
      lastGroup.records.push(record);
    }
  }

  return groups;
}
