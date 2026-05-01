import { DayRecord } from "./types";
import { createId } from "./utils";

const STORAGE_KEY = "movement-journal-records";
const BACKUP_APP_NAME = "movement-journal";
const TEXT_BACKUP_HEADER = [
  "# 运动日记 TXT v1",
  "# 每行一条记录：日期 | 动作 | 类型 | 数字",
  "# 示例：2026-04-18 | 深蹲 | 2*1.25kg | 9 / 9 / 8",
].join("\n");

type BackupFile = {
  app: string;
  version: number;
  exportedAt: string;
  records: DayRecord[];
};

function isLoadGroup(value: unknown) {
  if (!value || typeof value !== "object") {
    return false;
  }

  const group = value as { id?: unknown; label?: unknown; entries?: unknown };
  return (
    typeof group.id === "string" &&
    typeof group.label === "string" &&
    Array.isArray(group.entries) &&
    group.entries.every((entry) => typeof entry === "string")
  );
}

function isExercise(value: unknown) {
  if (!value || typeof value !== "object") {
    return false;
  }

  const exercise = value as { id?: unknown; name?: unknown; loadGroups?: unknown };
  return (
    typeof exercise.id === "string" &&
    typeof exercise.name === "string" &&
    Array.isArray(exercise.loadGroups) &&
    exercise.loadGroups.every(isLoadGroup)
  );
}

export function isDayRecord(value: unknown): value is DayRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as { id?: unknown; date?: unknown; exercises?: unknown; updatedAt?: unknown };
  return (
    typeof record.id === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(record.date as string) &&
    typeof record.updatedAt === "string" &&
    Array.isArray(record.exercises) &&
    record.exercises.every(isExercise)
  );
}

export function parseBackupFile(raw: string): DayRecord[] | null {
  const textRecords = parseTextBackupFile(raw);
  if (textRecords) {
    return textRecords;
  }

  try {
    const parsed = JSON.parse(raw) as BackupFile | DayRecord[];
    const records = Array.isArray(parsed) ? parsed : parsed.records;
    if (!Array.isArray(records) || !records.every(isDayRecord)) {
      return null;
    }

    return records;
  } catch {
    return null;
  }
}

function parseTextBackupFile(raw: string): DayRecord[] | null {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (lines.length === 0) {
    return null;
  }

  const recordsByDate = new Map<string, DayRecord>();
  const updatedAt = new Date().toISOString();
  let parsedLineCount = 0;

  for (const line of lines) {
    const columns = line.split("|").map((part) => part.trim());
    if (columns[0] === "日期" && columns[1] === "动作") {
      continue;
    }

    if (columns.length !== 4) {
      return null;
    }

    const [date, exerciseName, rawLabel, rawEntries] = columns;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !exerciseName) {
      return null;
    }

    const label = rawLabel === "默认" ? "" : rawLabel;
    const entries = rawEntries
      .split("/")
      .map((entry) => entry.trim())
      .filter(Boolean);

    let record = recordsByDate.get(date);
    if (!record) {
      record = {
        id: createId("day"),
        date,
        exercises: [],
        updatedAt,
      };
      recordsByDate.set(date, record);
    }

    let exercise = record.exercises.find((item) => item.name === exerciseName);
    if (!exercise) {
      exercise = {
        id: createId("exercise"),
        name: exerciseName,
        loadGroups: [],
      };
      record.exercises.push(exercise);
    }

    exercise.loadGroups.push({
      id: createId("load"),
      label,
      entries,
    });
    parsedLineCount += 1;
  }

  if (parsedLineCount === 0) {
    return null;
  }

  return Array.from(recordsByDate.values()).sort((left, right) =>
    right.date.localeCompare(left.date),
  );
}

export function createBackupPayload(records: DayRecord[]) {
  const rows = [...records]
    .sort((left, right) => right.date.localeCompare(left.date))
    .flatMap((record) =>
      record.exercises.flatMap((exercise) =>
        exercise.loadGroups.map((group) =>
          [
            record.date,
            exercise.name,
            group.label || "默认",
            group.entries.join(" / "),
          ].join(" | "),
        ),
      ),
    );

  return `${TEXT_BACKUP_HEADER}\n${rows.join("\n")}\n`;
}

export function createJsonBackupPayload(records: DayRecord[]) {
  const backup: BackupFile = {
    app: BACKUP_APP_NAME,
    version: 1,
    exportedAt: new Date().toISOString(),
    records,
  };

  return JSON.stringify(backup, null, 2);
}

export function loadRecords(): DayRecord[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.every(isDayRecord) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRecords(records: DayRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}
