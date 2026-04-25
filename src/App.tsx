
import { useEffect, useMemo, useRef, useState } from "react";
import { createBackupPayload, loadRecords, parseBackupFile, saveRecords } from "./storage";
import { DayRecord, Exercise, LoadGroup } from "./types";
import {
  createId,
  formatDateHeadline,
  formatMonthHeadline,
  groupRecordsByMonth,
  sortDatesDesc,
} from "./utils";

type DraftMap = Record<string, string>;
type InsertTarget = { groupId: string; index: number } | null;
type CalendarMode = "copy" | "history" | null;

type CalendarCell = {
  date: string;
  day: number;
  inMonth: boolean;
};

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
}).format(new Date());

const weekLabels = ["一", "二", "三", "四", "五", "六", "日"];

function buildCalendarCells(monthKey: string): CalendarCell[] {
  const [year, month] = monthKey.split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const firstVisibleDay = new Date(year, month - 1, 1 - startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const current = new Date(firstVisibleDay);
    current.setDate(firstVisibleDay.getDate() + index);

    return {
      date: new Intl.DateTimeFormat("en-CA").format(current),
      day: current.getDate(),
      inMonth: current.getMonth() === month - 1,
    };
  });
}

function shiftMonth(monthKey: string, offset: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const next = new Date(year, month - 1 + offset, 1);
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
  }).format(next);
}

function cloneExercise(exercise: Exercise): Exercise {
  return {
    id: createId("exercise"),
    name: exercise.name,
    loadGroups: exercise.loadGroups.map((group) => ({
      id: createId("load"),
      label: group.label,
      entries: [...group.entries],
    })),
  };
}

function App() {
  const [records, setRecords] = useState<DayRecord[]>(() => loadRecords());
  const [exerciseDrafts, setExerciseDrafts] = useState<DraftMap>({});
  const [loadDrafts, setLoadDrafts] = useState<DraftMap>({});
  const [entryDrafts, setEntryDrafts] = useState<DraftMap>({});
  const [editingLoadTarget, setEditingLoadTarget] = useState<string | null>(null);
  const [addExerciseTarget, setAddExerciseTarget] = useState<string | null>(null);
  const [addLoadTarget, setAddLoadTarget] = useState<string | null>(null);
  const [insertTarget, setInsertTarget] = useState<InsertTarget>(null);
  const [collapsedDates, setCollapsedDates] = useState<Record<string, boolean>>({});
  const [collapsedExercises, setCollapsedExercises] = useState<Record<string, boolean>>({});
  const [editingEntryTarget, setEditingEntryTarget] = useState<string | null>(null);
  const [deleteMode, setDeleteMode] = useState(false);
  const [calendarMode, setCalendarMode] = useState<CalendarMode>(null);
  const [calendarMonth, setCalendarMonth] = useState(today.slice(0, 7));
  const datePickerRef = useRef<HTMLInputElement | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const recordRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    saveRecords(records);
  }, [records]);

  const sortedRecords = useMemo(
    () => [...records].sort((left, right) => sortDatesDesc(left.date, right.date)),
    [records],
  );

  const monthSections = useMemo(() => groupRecordsByMonth(sortedRecords), [sortedRecords]);

  const exerciseSuggestions = useMemo(
    () =>
      Array.from(
        new Set(
          records.flatMap((record) =>
            record.exercises.map((exercise) => exercise.name.trim()).filter(Boolean),
          ),
        ),
      ).sort((left, right) => left.localeCompare(right, "zh-CN")),
    [records],
  );

  const loadSuggestionsByExercise = useMemo(() => {
    const suggestionMap: Record<string, string[]> = {};

    for (const record of records) {
      for (const exercise of record.exercises) {
        const exerciseName = exercise.name.trim();
        if (!exerciseName) {
          continue;
        }

        const labels = suggestionMap[exerciseName] ?? ["默认"];
        for (const group of exercise.loadGroups) {
          const label = group.label.trim() || "默认";
          if (!labels.includes(label)) {
            labels.push(label);
          }
        }
        suggestionMap[exerciseName] = labels.sort((left, right) =>
          left.localeCompare(right, "zh-CN"),
        );
      }
    }

    return suggestionMap;
  }, [records]);

  const copyableRecords = useMemo(
    () => sortedRecords.filter((record) => record.date !== today && record.exercises.length > 0),
    [sortedRecords],
  );

  const copyableDateSet = useMemo(
    () => new Set(copyableRecords.map((record) => record.date)),
    [copyableRecords],
  );

  const workoutDateSet = useMemo(
    () =>
      new Set(
        records
          .filter((record) => record.exercises.some((exercise) => exercise.loadGroups.length > 0))
          .map((record) => record.date),
      ),
    [records],
  );

  const calendarCells = useMemo(() => buildCalendarCells(calendarMonth), [calendarMonth]);

  function touchRecord(record: DayRecord): DayRecord {
    return {
      ...record,
      updatedAt: new Date().toISOString(),
    };
  }

  function updateRecord(recordId: string, updater: (record: DayRecord) => DayRecord) {
    setRecords((current) =>
      current.map((record) =>
        record.id === recordId ? touchRecord(updater(record)) : record,
      ),
    );
  }

  function expandRecord(recordId: string) {
    setCollapsedDates((current) => ({ ...current, [recordId]: false }));
  }

  function openAddExercise(recordId: string) {
    setAddExerciseTarget((current) => (current === recordId ? null : recordId));
    expandRecord(recordId);
  }

  function addRecordForDate(date: string) {
    if (!date) {
      return;
    }

    const existing = records.find((record) => record.date === date);
    if (existing) {
      openAddExercise(existing.id);
      return;
    }

    const nextRecord: DayRecord = {
      id: createId("day"),
      date,
      exercises: [],
      updatedAt: new Date().toISOString(),
    };

    setRecords((current) => [nextRecord, ...current]);
    setAddExerciseTarget(nextRecord.id);
    expandRecord(nextRecord.id);
  }
  function addTodayRecord() {
    addRecordForDate(today);
  }

  function openDatePicker() {
    const input = datePickerRef.current;
    if (!input) {
      return;
    }

    input.value = today;
    const picker = input as HTMLInputElement & { showPicker?: () => void };
    if (typeof picker.showPicker === "function") {
      picker.showPicker();
      return;
    }

    input.click();
  }

  function openCopyCalendar() {
    if (copyableRecords.length === 0) {
      return;
    }

    setCalendarMonth(copyableRecords[0].date.slice(0, 7));
    setCalendarMode("copy");
  }

  function openHistoryCalendar() {
    setCalendarMonth((sortedRecords[0]?.date ?? today).slice(0, 7));
    setCalendarMode("history");
  }

  function closeCalendar() {
    setCalendarMode(null);
  }

  function copyRecordToToday(sourceDate: string) {
    const sourceRecord = records.find((record) => record.date === sourceDate);
    if (!sourceRecord || sourceDate === today) {
      return;
    }

    const copiedExercises = sourceRecord.exercises.map(cloneExercise);
    const existingToday = records.find((record) => record.date === today);

    if (existingToday) {
      updateRecord(existingToday.id, (record) => ({
        ...record,
        exercises: [...record.exercises, ...copiedExercises],
      }));
      expandRecord(existingToday.id);
    } else {
      const nextRecord: DayRecord = {
        id: createId("day"),
        date: today,
        exercises: copiedExercises,
        updatedAt: new Date().toISOString(),
      };

      setRecords((current) => [nextRecord, ...current]);
      expandRecord(nextRecord.id);
    }

    setAddExerciseTarget(null);
    closeCalendar();
  }

  function openRecordFromCalendar(date: string) {
    const record = records.find((item) => item.date === date);
    if (!record) {
      return;
    }

    expandRecord(record.id);
    closeCalendar();
    window.requestAnimationFrame(() => {
      recordRefs.current[date]?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }

  function exportBackup() {
    const payload = createBackupPayload(records);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `movement-journal-backup-${today}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function openImportFile() {
    importFileRef.current?.click();
  }

  async function importBackup(file: File | null) {
    if (!file) {
      return;
    }

    const recordsFromBackup = parseBackupFile(await file.text());
    if (!recordsFromBackup) {
      window.alert("备份文件无法读取。");
      return;
    }

    if (
      !window.confirm(
        `导入后会替换当前 ${records.length} 天记录，改为备份里的 ${recordsFromBackup.length} 天记录。继续吗？`,
      )
    ) {
      return;
    }

    setRecords(recordsFromBackup);
    setCollapsedDates({});
    setCollapsedExercises({});
    setAddExerciseTarget(null);
    setAddLoadTarget(null);
    setInsertTarget(null);
    setCalendarMode(null);
  }

  function addExercise(recordId: string) {
    const fieldId = `exercise-${recordId}`;
    const name = exerciseDrafts[fieldId]?.trim();
    if (!name) {
      return;
    }

    const nextExercise: Exercise = {
      id: createId("exercise"),
      name,
      loadGroups: [{ id: createId("load"), label: "", entries: [] }],
    };

    updateRecord(recordId, (record) => ({
      ...record,
      exercises: [...record.exercises, nextExercise],
    }));

    setExerciseDrafts((current) => ({ ...current, [fieldId]: "" }));
    setAddExerciseTarget(null);
    expandRecord(recordId);
  }

  function addLoadGroup(recordId: string, exerciseId: string, rawLabel?: string) {
    const fieldId = `load-${exerciseId}`;
    const label = (rawLabel ?? loadDrafts[fieldId] ?? "").trim();
    if (!label) {
      return;
    }

    const nextLoadGroup: LoadGroup = {
      id: createId("load"),
      label: label === "默认" ? "" : label,
      entries: [],
    };

    updateRecord(recordId, (record) => ({
      ...record,
      exercises: record.exercises.map((exercise) =>
        exercise.id === exerciseId
          ? { ...exercise, loadGroups: [...exercise.loadGroups, nextLoadGroup] }
          : exercise,
      ),
    }));

    setLoadDrafts((current) => ({ ...current, [fieldId]: "" }));
    setAddLoadTarget(null);
    setCollapsedExercises((current) => ({ ...current, [exerciseId]: false }));
  }

  function startEditingLoad(groupId: string, label: string) {
    setLoadDrafts((current) => ({ ...current, [`edit-load-${groupId}`]: label }));
    setEditingLoadTarget(groupId);
  }

  function saveEditedLoad(recordId: string, exerciseId: string, groupId: string) {
    const draftKey = `edit-load-${groupId}`;
    const nextValue = (loadDrafts[draftKey] ?? "").trim();

    updateRecord(recordId, (record) => ({
      ...record,
      exercises: record.exercises.map((exercise) =>
        exercise.id === exerciseId
          ? {
              ...exercise,
              loadGroups: exercise.loadGroups.map((group) =>
                group.id === groupId
                  ? { ...group, label: nextValue === "默认" ? "" : nextValue }
                  : group,
              ),
            }
          : exercise,
      ),
    }));

    setEditingLoadTarget(null);
  }

  function toggleInsertTarget(groupId: string, index: number) {
    setInsertTarget((current) =>
      current?.groupId === groupId && current.index === index ? null : { groupId, index },
    );
  }

  function insertEntry(
    recordId: string,
    exerciseId: string,
    loadGroupId: string,
    index: number,
  ) {
    const fieldId = `entry-${loadGroupId}-${index}`;
    const value = entryDrafts[fieldId]?.trim();
    if (!value) {
      return;
    }

    updateRecord(recordId, (record) => ({
      ...record,
      exercises: record.exercises.map((exercise) =>
        exercise.id === exerciseId
          ? {
              ...exercise,
              loadGroups: exercise.loadGroups.map((group) =>
                group.id === loadGroupId
                  ? {
                      ...group,
                      entries: [
                        ...group.entries.slice(0, index),
                        value,
                        ...group.entries.slice(index),
                      ],
                    }
                  : group,
              ),
            }
          : exercise,
      ),
    }));

    setEntryDrafts((current) => ({ ...current, [fieldId]: "" }));
    setInsertTarget(null);
  }
  function startEditingEntry(entryId: string, value: string) {
    setEntryDrafts((current) => ({ ...current, [entryId]: value }));
    setEditingEntryTarget(entryId);
  }

  function saveEditedEntry(
    recordId: string,
    exerciseId: string,
    loadGroupId: string,
    entryIndex: number,
  ) {
    const entryId = `edit-${loadGroupId}-${entryIndex}`;
    const nextValue = entryDrafts[entryId]?.trim() ?? "";

    updateRecord(recordId, (record) => ({
      ...record,
      exercises: record.exercises.map((exercise) =>
        exercise.id === exerciseId
          ? {
              ...exercise,
              loadGroups: exercise.loadGroups.map((group) =>
                group.id === loadGroupId
                  ? {
                      ...group,
                      entries: group.entries.map((entry, innerIndex) =>
                        innerIndex === entryIndex ? nextValue : entry,
                      ),
                    }
                  : group,
              ),
            }
          : exercise,
      ),
    }));

    setEditingEntryTarget(null);
  }

  function removeEntry(
    recordId: string,
    exerciseId: string,
    loadGroupId: string,
    entryIndex: number,
    entryValue: string,
  ) {
    const record = records.find((item) => item.id === recordId);
    const exercise = record?.exercises.find((item) => item.id === exerciseId);
    if (!record || !exercise) {
      return;
    }

    if (
      !window.confirm(
        `要删除 ${formatDateHeadline(record.date)} 的“${exercise.name}”里的“${entryValue}”吗？`,
      )
    ) {
      return;
    }

    updateRecord(recordId, (nextRecord) => ({
      ...nextRecord,
      exercises: nextRecord.exercises.map((item) =>
        item.id === exerciseId
          ? {
              ...item,
              loadGroups: item.loadGroups.map((group) =>
                group.id === loadGroupId
                  ? {
                      ...group,
                      entries: group.entries.filter((_, innerIndex) => innerIndex !== entryIndex),
                    }
                  : group,
              ),
            }
          : item,
      ),
    }));
  }

  function toggleDate(recordId: string) {
    setCollapsedDates((current) => ({ ...current, [recordId]: !current[recordId] }));
  }

  function toggleExercise(exerciseId: string) {
    setCollapsedExercises((current) => ({
      ...current,
      [exerciseId]: !current[exerciseId],
    }));
  }

  function removeDate(recordId: string) {
    const record = records.find((item) => item.id === recordId);
    if (!record) {
      return;
    }

    if (!window.confirm(`确定删掉 ${formatDateHeadline(record.date)} 的整张记录吗？`)) {
      return;
    }

    setRecords((current) => current.filter((item) => item.id !== recordId));
  }

  function removeExercise(recordId: string, exerciseId: string) {
    const record = records.find((item) => item.id === recordId);
    const exercise = record?.exercises.find((item) => item.id === exerciseId);
    if (!record || !exercise) {
      return;
    }

    if (!window.confirm(`确定删掉 ${formatDateHeadline(record.date)} 的“${exercise.name}”吗？`)) {
      return;
    }

    updateRecord(recordId, (nextRecord) => ({
      ...nextRecord,
      exercises: nextRecord.exercises.filter((item) => item.id !== exerciseId),
    }));
  }

  function removeLoadGroup(recordId: string, exerciseId: string, loadGroupId: string) {
    const record = records.find((item) => item.id === recordId);
    const exercise = record?.exercises.find((item) => item.id === exerciseId);
    const group = exercise?.loadGroups.find((item) => item.id === loadGroupId);
    if (!record || !exercise || !group) {
      return;
    }

    const label = group.label || "默认";
    if (
      !window.confirm(
        `确定删掉 ${formatDateHeadline(record.date)} 的“${exercise.name}”里“${label}”这一行吗？`,
      )
    ) {
      return;
    }

    updateRecord(recordId, (nextRecord) => ({
      ...nextRecord,
      exercises: nextRecord.exercises.map((item) =>
        item.id === exerciseId
          ? {
              ...item,
              loadGroups: item.loadGroups.filter((groupItem) => groupItem.id !== loadGroupId),
            }
          : item,
      ),
    }));
  }

  function renderInsertInput(
    recordId: string,
    exerciseId: string,
    groupId: string,
    index: number,
  ) {
    const isOpen = insertTarget?.groupId === groupId && insertTarget.index === index;
    if (!isOpen || deleteMode) {
      return null;
    }

    const draftKey = `entry-${groupId}-${index}`;
    return (
      <span className="inline-insert-wrap">
        <input
          className="entry-inline-input"
          value={entryDrafts[draftKey] ?? ""}
          onChange={(event) =>
            setEntryDrafts((current) => ({
              ...current,
              [draftKey]: event.target.value,
            }))
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              insertEntry(recordId, exerciseId, groupId, index);
            }
          }}
          onBlur={() => {
            if (!(entryDrafts[draftKey] ?? "").trim()) {
              setInsertTarget(null);
            }
          }}
          autoFocus
        />
      </span>
    );
  }
  return (
    <div className="app-shell">
      <div className="app-frame">
        <header className="app-header">
          <h1>运动日记</h1>
          <button
            className={deleteMode ? "delete-toggle delete-toggle--active" : "delete-toggle"}
            onClick={() => {
              setDeleteMode((current) => !current);
              setAddExerciseTarget(null);
              setAddLoadTarget(null);
              setInsertTarget(null);
              setCalendarMode(null);
            }}
          >
            删除
          </button>
        </header>

        <main className="screen-body">
          {monthSections.length === 0 ? (
            <div className="history-card">
              <p className="muted">无记录</p>
            </div>
          ) : (
            monthSections.map((section) => (
              <section className="month-section" key={section.month}>
                <div className="month-heading">{formatMonthHeadline(section.month)}</div>
                <div className="history-list">
                  {section.records.map((record) => (
                    <article
                      className="history-card"
                      key={record.id}
                      ref={(node) => {
                        recordRefs.current[record.date] = node;
                      }}
                    >
                      <div className="history-card__head">
                        <div className="date-cluster">
                          <strong className="date-title">{formatDateHeadline(record.date)}</strong>
                          <button
                            className={deleteMode ? "date-delete-button" : "date-add-button"}
                            onClick={() =>
                              deleteMode ? removeDate(record.id) : openAddExercise(record.id)
                            }
                          >
                            {deleteMode ? "−" : "+"}
                          </button>
                        </div>
                        <button
                          className={
                            collapsedDates[record.id]
                              ? "collapse-button is-collapsed"
                              : "collapse-button is-expanded"
                          }
                          onClick={() => toggleDate(record.id)}
                          aria-label={collapsedDates[record.id] ? "展开" : "收起"}
                        >
                          <span aria-hidden="true" />
                        </button>
                      </div>

                      {addExerciseTarget === record.id && !deleteMode ? (
                        <div className="quick-add-row quick-add-row--card">
                          <input
                            type="text"
                            placeholder="名称"
                            list="exercise-suggestions"
                            value={exerciseDrafts[`exercise-${record.id}`] ?? ""}
                            onChange={(event) =>
                              setExerciseDrafts((current) => ({
                                ...current,
                                [`exercise-${record.id}`]: event.target.value,
                              }))
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                addExercise(record.id);
                              }
                            }}
                            autoFocus
                          />
                          <button onClick={() => addExercise(record.id)}>加</button>
                        </div>
                      ) : null}

                      {collapsedDates[record.id] ? null : record.exercises.length === 0 ? (
                        <p className="muted muted-block">无记录</p>
                      ) : (
                        <div className="history-card__items">
                          {record.exercises.map((exercise) => (
                            <section className="history-exercise" key={exercise.id}>
                              <div className="history-exercise__header">
                                <div className="exercise-title-row">
                                  <div className="exercise-title-main">
                                    <div className="history-exercise__name">{exercise.name}</div>
                                    <button
                                      className={
                                        deleteMode
                                          ? "exercise-delete-button"
                                          : "exercise-add-button"
                                      }
                                      onClick={() =>
                                        deleteMode
                                          ? removeExercise(record.id, exercise.id)
                                          : setAddLoadTarget((current) =>
                                              current === exercise.id ? null : exercise.id,
                                            )
                                      }
                                    >
                                      {deleteMode ? "−" : "+"}
                                    </button>
                                  </div>
                                  <button
                                    className={
                                      collapsedExercises[exercise.id]
                                        ? "exercise-collapse-button is-collapsed"
                                        : "exercise-collapse-button is-expanded"
                                    }
                                    onClick={() => toggleExercise(exercise.id)}
                                    aria-label={collapsedExercises[exercise.id] ? "展开" : "收起"}
                                  >
                                    <span aria-hidden="true" />
                                  </button>
                                </div>
                              </div>

                              {collapsedExercises[exercise.id] ? null : (
                                <>
                                  {addLoadTarget === exercise.id && !deleteMode ? (
                                    <div className="quick-add-stack">
                                      <div className="quick-add-row">
                                        <input
                                          type="text"
                                          placeholder="负载"
                                          list={`load-suggestions-${exercise.id}`}
                                          value={loadDrafts[`load-${exercise.id}`] ?? ""}
                                          onChange={(event) =>
                                            setLoadDrafts((current) => ({
                                              ...current,
                                              [`load-${exercise.id}`]: event.target.value,
                                            }))
                                          }
                                          onKeyDown={(event) => {
                                            if (event.key === "Enter") {
                                              event.preventDefault();
                                              addLoadGroup(record.id, exercise.id);
                                            }
                                          }}
                                          autoFocus
                                        />
                                        <button onClick={() => addLoadGroup(record.id, exercise.id)}>
                                          加
                                        </button>
                                      </div>
                                      <div className="load-presets">
                                        {(loadSuggestionsByExercise[exercise.name.trim()] ?? ["默认"]).map(
                                          (label) => (
                                            <button
                                              className="load-preset-button"
                                              key={`${exercise.id}-${label}`}
                                              onClick={() => addLoadGroup(record.id, exercise.id, label)}
                                            >
                                              {label}
                                            </button>
                                          ),
                                        )}
                                      </div>
                                    </div>
                                  ) : null}

                                  <div className="history-exercise__loads">
                                    {exercise.loadGroups.length === 0 ? (
                                      <p className="muted">无记录</p>
                                    ) : (
                                      exercise.loadGroups.map((group) => (
                                        <div className="history-load-block" key={group.id}>
                                          <div className="history-load-row">
                                            {editingLoadTarget === group.id ? (
                                              <div className="load-edit-stack">
                                                <input
                                                  className="load-inline-input"
                                                  value={loadDrafts[`edit-load-${group.id}`] ?? ""}
                                                  onChange={(event) =>
                                                    setLoadDrafts((current) => ({
                                                      ...current,
                                                      [`edit-load-${group.id}`]: event.target.value,
                                                    }))
                                                  }
                                                  onBlur={() =>
                                                    saveEditedLoad(record.id, exercise.id, group.id)
                                                  }
                                                  onKeyDown={(event) => {
                                                    if (event.key === "Enter") {
                                                      event.preventDefault();
                                                      saveEditedLoad(record.id, exercise.id, group.id);
                                                    }
                                                  }}
                                                  autoFocus
                                                />
                                                <div className="load-presets load-presets--inline">
                                                  <button
                                                    className="load-preset-button"
                                                    onMouseDown={(event) => event.preventDefault()}
                                                    onClick={() => {
                                                      setLoadDrafts((current) => ({
                                                        ...current,
                                                        [`edit-load-${group.id}`]: "默认",
                                                      }));
                                                    }}
                                                  >
                                                    默认
                                                  </button>
                                                </div>
                                              </div>
                                            ) : (
                                              <button
                                                className="load-label-button"
                                                onClick={() =>
                                                  startEditingLoad(group.id, group.label || "默认")
                                                }
                                              >
                                                {group.label || "默认"}
                                              </button>
                                            )}

                                            <div className="load-inline-group">
                                              <button
                                                className="insert-anchor-button"
                                                onClick={() => toggleInsertTarget(group.id, 0)}
                                              >
                                                |
                                              </button>
                                              <div className="entry-edit-row">
                                                {renderInsertInput(record.id, exercise.id, group.id, 0)}
                                                {group.entries.map((entry, entryIndex) => {
                                                  const entryId = `edit-${group.id}-${entryIndex}`;
                                                  const isEditing = editingEntryTarget === entryId;

                                                  return (
                                                    <span className="entry-fragment" key={entryId}>
                                                      {isEditing ? (
                                                        <input
                                                          className="entry-inline-input"
                                                          value={entryDrafts[entryId] ?? ""}
                                                          onChange={(event) =>
                                                            setEntryDrafts((current) => ({
                                                              ...current,
                                                              [entryId]: event.target.value,
                                                            }))
                                                          }
                                                          onBlur={() =>
                                                            saveEditedEntry(
                                                              record.id,
                                                              exercise.id,
                                                              group.id,
                                                              entryIndex,
                                                            )
                                                          }
                                                          onKeyDown={(event) => {
                                                            if (event.key === "Enter") {
                                                              event.preventDefault();
                                                              saveEditedEntry(
                                                                record.id,
                                                                exercise.id,
                                                                group.id,
                                                                entryIndex,
                                                              );
                                                            }
                                                          }}
                                                          autoFocus
                                                        />
                                                      ) : (
                                                        <button
                                                          className={
                                                            deleteMode
                                                              ? "entry-chip-button entry-chip-button--delete"
                                                              : "entry-chip-button"
                                                          }
                                                          onClick={() =>
                                                            deleteMode
                                                              ? removeEntry(
                                                                  record.id,
                                                                  exercise.id,
                                                                  group.id,
                                                                  entryIndex,
                                                                  entry,
                                                                )
                                                              : startEditingEntry(entryId, entry)
                                                          }
                                                        >
                                                          {entry}
                                                        </button>
                                                      )}
                                                      {entryIndex < group.entries.length - 1 ? (
                                                        <>
                                                          <button
                                                            className="insert-slash-button"
                                                            onClick={() =>
                                                              toggleInsertTarget(group.id, entryIndex + 1)
                                                            }
                                                          >
                                                            /
                                                          </button>
                                                          {renderInsertInput(
                                                            record.id,
                                                            exercise.id,
                                                            group.id,
                                                            entryIndex + 1,
                                                          )}
                                                        </>
                                                      ) : null}
                                                    </span>
                                                  );
                                                })}
                                                <button
                                                  className={
                                                    deleteMode
                                                      ? "load-delete-button"
                                                      : "entry-add-button entry-add-button--tail"
                                                  }
                                                  onClick={() =>
                                                    deleteMode
                                                      ? removeLoadGroup(
                                                          record.id,
                                                          exercise.id,
                                                          group.id,
                                                        )
                                                      : toggleInsertTarget(
                                                          group.id,
                                                          group.entries.length,
                                                        )
                                                  }
                                                >
                                                  {deleteMode ? "−" : "+"}
                                                </button>
                                              </div>
                                            </div>
                                          </div>

                                          {group.entries.length > 0 &&
                                          insertTarget?.groupId === group.id &&
                                          insertTarget.index === group.entries.length ? (
                                            <div className="tail-insert-row">
                                              {renderInsertInput(
                                                record.id,
                                                exercise.id,
                                                group.id,
                                                group.entries.length,
                                              )}
                                              <button
                                                className="tail-insert-confirm"
                                                onClick={() =>
                                                  insertEntry(
                                                    record.id,
                                                    exercise.id,
                                                    group.id,
                                                    group.entries.length,
                                                  )
                                                }
                                              >
                                                加
                                              </button>
                                            </div>
                                          ) : null}
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </>
                              )}

                              <datalist id={`load-suggestions-${exercise.id}`}>
                                {(loadSuggestionsByExercise[exercise.name.trim()] ?? []).map(
                                  (label) => (
                                    <option key={label} value={label} />
                                  ),
                                )}
                              </datalist>
                            </section>
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            ))
          )}

          <datalist id="exercise-suggestions">
            {exerciseSuggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </main>

        <footer className="bottom-actions">
          <input
            ref={datePickerRef}
            className="hidden-date-picker"
            type="date"
            onChange={(event) => {
              addRecordForDate(event.target.value);
              event.target.value = "";
            }}
            aria-hidden="true"
            tabIndex={-1}
          />
          <input
            ref={importFileRef}
            className="hidden-file-picker"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              importBackup(event.target.files?.[0] ?? null);
              event.target.value = "";
            }}
            aria-hidden="true"
            tabIndex={-1}
          />
          <div className="today-add-wrap">
            <button
              className="today-add-button today-add-button--copy"
              onClick={openCopyCalendar}
              disabled={copyableRecords.length === 0}
            >
              今天（复制）+
            </button>
            <button className="today-add-button" onClick={addTodayRecord}>
              今天 +
            </button>
            <button
              className="today-add-button today-add-button--secondary"
              onClick={openDatePicker}
            >
              其它日期 +
            </button>
          </div>
          <div className="tool-actions">
            <button className="tool-button" onClick={openHistoryCalendar}>
              日历
            </button>
            <button className="tool-button" onClick={exportBackup}>
              导出
            </button>
            <button className="tool-button" onClick={openImportFile}>
              导入
            </button>
          </div>
        </footer>
      </div>

      {calendarMode ? (
        <div className="calendar-modal" role="dialog" aria-modal="true">
          <div className="calendar-backdrop" onClick={closeCalendar} />
          <div className="calendar-panel">
            <div className="calendar-panel__header">
              <strong>{calendarMode === "copy" ? "复制到今天" : "运动日历"}</strong>
              <button className="calendar-close" onClick={closeCalendar}>
                关闭
              </button>
            </div>
            <div className="calendar-nav">
              <button onClick={() => setCalendarMonth((current) => shiftMonth(current, -1))}>
                上月
              </button>
              <strong>{formatMonthHeadline(calendarMonth)}</strong>
              <button onClick={() => setCalendarMonth((current) => shiftMonth(current, 1))}>
                下月
              </button>
            </div>
            <div className="calendar-weekdays">
              {weekLabels.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className="calendar-grid">
              {calendarCells.map((cell) => {
                const selectable =
                  cell.inMonth &&
                  (calendarMode === "copy"
                    ? copyableDateSet.has(cell.date)
                    : workoutDateSet.has(cell.date));
                return (
                  <button
                    key={cell.date}
                    className={
                      selectable
                        ? "calendar-day calendar-day--active"
                        : cell.inMonth
                          ? "calendar-day"
                          : "calendar-day calendar-day--outside"
                    }
                    onClick={() =>
                      selectable &&
                      (calendarMode === "copy"
                        ? copyRecordToToday(cell.date)
                        : openRecordFromCalendar(cell.date))
                    }
                    disabled={!selectable}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>
            <p className="calendar-tip">
              {calendarMode === "copy"
                ? "绿色日期可复制到今天，其他日期不可选。"
                : "绿色日期有运动记录，点击可回到那天。"}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
