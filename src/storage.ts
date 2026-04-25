import { DayRecord } from "./types";

const STORAGE_KEY = "movement-journal-records";
const BACKUP_APP_NAME = "movement-journal";

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

export function createBackupPayload(records: DayRecord[]) {
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
