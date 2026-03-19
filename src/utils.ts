export function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function formatDateHeadline(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  const weekday = new Intl.DateTimeFormat("zh-CN", {
    weekday: "short",
  }).format(parsed);

  return `${date} ${weekday}`;
}

export function sortDatesDesc(a: string, b: string) {
  return b.localeCompare(a);
}
