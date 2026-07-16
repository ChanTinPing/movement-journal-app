
import { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type {
  AnimationEvent as ReactAnimationEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
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
type DraggingExercise = { recordId: string; exerciseId: string } | null;
type CalendarSwipeSession = {
  clientX: number;
  clientY: number;
  isHorizontal: boolean | null;
};
type CalendarMotion = "from-left" | "from-right" | null;

type CalendarCell = {
  date: string;
  day: number;
  inMonth: boolean;
};

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
}).format(new Date());

const weekLabels = ["一", "二", "三", "四", "五", "六", "日"];
const CALENDAR_SWIPE_THRESHOLD = 52;

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

function cloneExerciseShape(exercise: Exercise): Exercise {
  return {
    id: createId("exercise"),
    name: exercise.name,
    loadGroups: exercise.loadGroups.map((group) => ({
      id: createId("load"),
      label: group.label,
      entries: [],
    })),
  };
}

function App() {
  const [records, setRecords] = useState<DayRecord[]>(() => loadRecords());
  const [exerciseDrafts, setExerciseDrafts] = useState<DraftMap>({});
  const [titleDrafts, setTitleDrafts] = useState<DraftMap>({});
  const [loadDrafts, setLoadDrafts] = useState<DraftMap>({});
  const [entryDrafts, setEntryDrafts] = useState<DraftMap>({});
  const [editingTitleTarget, setEditingTitleTarget] = useState<string | null>(null);
  const [editingExerciseTarget, setEditingExerciseTarget] = useState<string | null>(null);
  const [editingLoadTarget, setEditingLoadTarget] = useState<string | null>(null);
  const [addExerciseTarget, setAddExerciseTarget] = useState<string | null>(null);
  const [addLoadTarget, setAddLoadTarget] = useState<string | null>(null);
  const [insertTarget, setInsertTarget] = useState<InsertTarget>(null);
  const [collapsedDates, setCollapsedDates] = useState<Record<string, boolean>>({});
  const [editingEntryTarget, setEditingEntryTarget] = useState<string | null>(null);
  const [deleteMode, setDeleteMode] = useState(false);
  const [exerciseHistoryMode, setExerciseHistoryMode] = useState(false);
  const [selectedExerciseHistory, setSelectedExerciseHistory] = useState<string | null>(null);
  const [calendarMode, setCalendarMode] = useState<CalendarMode>(null);
  const [calendarMonth, setCalendarMonth] = useState(today.slice(0, 7));
  const [calendarMotion, setCalendarMotion] = useState<CalendarMotion>(null);
  const [draggingExercise, setDraggingExercise] = useState<DraggingExercise>(null);
  const [exporting, setExporting] = useState(false);
  const datePickerRef = useRef<HTMLInputElement | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const recordRefs = useRef<Record<string, HTMLElement | null>>({});
  const dragExerciseRef = useRef<DraggingExercise>(null);
  const calendarSwipeRef = useRef<CalendarSwipeSession | null>(null);
  const suppressCalendarClickRef = useRef(false);

  useEffect(() => {
    saveRecords(records);
  }, [records]);

  useEffect(() => {
    if (!addExerciseTarget && !addLoadTarget && !insertTarget) {
      return;
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      if (
        target.closest(
          [
            ".quick-add-row",
            ".quick-add-stack",
            ".inline-insert-wrap",
            ".tail-insert-row",
            ".title-edit-stack",
            ".exercise-edit-stack",
            ".date-subtitle-input",
            ".date-subtitle-button",
            ".date-add-button",
            ".exercise-add-button",
            ".exercise-history-button",
            ".entry-add-button",
            ".insert-anchor-button",
            ".insert-slash-button",
          ].join(","),
        )
      ) {
        return;
      }

      closeTransientInputs();
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [addExerciseTarget, addLoadTarget, insertTarget]);

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

  const titleSuggestions = useMemo(
    () =>
      Array.from(new Set(records.map((record) => record.title?.trim()).filter(Boolean) as string[]))
        .sort((left, right) => left.localeCompare(right, "zh-CN")),
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

  const calendarDateSet = useMemo(() => new Set(records.map((record) => record.date)), [records]);

  const recordsByDate = useMemo(() => {
    const map = new Map<string, DayRecord>();
    for (const record of records) {
      map.set(record.date, record);
    }
    return map;
  }, [records]);

  const exerciseHistoryRecords = useMemo(() => {
    const selectedName = selectedExerciseHistory?.trim();
    if (!selectedName) {
      return [];
    }

    return sortedRecords
      .map((record) => ({
        ...record,
        exercises: record.exercises.filter((exercise) => exercise.name.trim() === selectedName),
      }))
      .filter((record) => record.exercises.length > 0);
  }, [selectedExerciseHistory, sortedRecords]);

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

  function closeTransientInputs() {
    setAddExerciseTarget(null);
    setAddLoadTarget(null);
    setInsertTarget(null);
  }

  function moveExerciseWithinRecord(
    recordId: string,
    draggedExerciseId: string,
    targetExerciseId: string,
  ) {
    if (draggedExerciseId === targetExerciseId) {
      return;
    }

    updateRecord(recordId, (record) => {
      const fromIndex = record.exercises.findIndex((exercise) => exercise.id === draggedExerciseId);
      const toIndex = record.exercises.findIndex((exercise) => exercise.id === targetExerciseId);
      if (fromIndex < 0 || toIndex < 0) {
        return record;
      }

      const exercises = [...record.exercises];
      const [movedExercise] = exercises.splice(fromIndex, 1);
      exercises.splice(toIndex, 0, movedExercise);
      return { ...record, exercises };
    });
  }

  function startExerciseDrag(recordId: string, exerciseId: string) {
    if (deleteMode) {
      return;
    }

    const nextDragging = { recordId, exerciseId };
    dragExerciseRef.current = nextDragging;
    setDraggingExercise(nextDragging);
    closeTransientInputs();
  }

  function finishExerciseDrag() {
    dragExerciseRef.current = null;
    setDraggingExercise(null);
  }

  function dragExerciseOver(recordId: string, targetExerciseId: string) {
    const currentDragging = dragExerciseRef.current;
    if (!currentDragging || currentDragging.recordId !== recordId) {
      return;
    }

    moveExerciseWithinRecord(recordId, currentDragging.exerciseId, targetExerciseId);
  }

  function dragExerciseOverPoint(clientX: number, clientY: number) {
    const currentDragging = dragExerciseRef.current;
    if (!currentDragging) {
      return;
    }

    const element = document.elementFromPoint(clientX, clientY);
    const target = element?.closest("[data-record-id][data-exercise-id]") as HTMLElement | null;
    const recordId = target?.dataset.recordId;
    const exerciseId = target?.dataset.exerciseId;
    if (!recordId || !exerciseId) {
      return;
    }

    dragExerciseOver(recordId, exerciseId);
  }

  function expandRecord(recordId: string) {
    setCollapsedDates((current) => ({ ...current, [recordId]: false }));
  }

  function openAddExercise(recordId: string) {
    if (exerciseHistoryMode) {
      return;
    }

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

  function changeCalendarMonth(offset: number) {
    setCalendarMonth((current) => shiftMonth(current, offset));
    setCalendarMotion(offset < 0 ? "from-left" : "from-right");
  }

  function startCalendarSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    calendarSwipeRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      isHorizontal: null,
    };
  }

  function moveCalendarSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    const start = calendarSwipeRef.current;
    if (!start) {
      return;
    }

    const deltaX = event.clientX - start.clientX;
    const deltaY = event.clientY - start.clientY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (start.isHorizontal === null) {
      if (absX < 8 && absY < 8) {
        return;
      }
      start.isHorizontal = absX > absY * 1.1;
    }

    if (!start.isHorizontal) {
      return;
    }

    if (absX >= CALENDAR_SWIPE_THRESHOLD) {
      event.preventDefault();
    }
  }

  function finishCalendarSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    const start = calendarSwipeRef.current;
    calendarSwipeRef.current = null;
    if (!start) {
      return;
    }

    const deltaX = event.clientX - start.clientX;
    const deltaY = event.clientY - start.clientY;
    if (Math.abs(deltaX) < CALENDAR_SWIPE_THRESHOLD || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) {
      return;
    }

    suppressCalendarClickRef.current = true;
    window.setTimeout(() => {
      suppressCalendarClickRef.current = false;
    }, 0);
    changeCalendarMonth(deltaX < 0 ? 1 : -1);
  }

  function cancelCalendarSwipe() {
    calendarSwipeRef.current = null;
  }

  function finishCalendarGridAnimation(event: ReactAnimationEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) {
      return;
    }

    setCalendarMotion(null);
  }

  function selectCalendarDate(date: string, selectable: boolean) {
    if (suppressCalendarClickRef.current) {
      suppressCalendarClickRef.current = false;
      return;
    }

    if (!selectable) {
      return;
    }

    if (calendarMode === "copy") {
      copyRecordToToday(date);
    } else {
      openRecordFromCalendar(date);
    }
  }

  function renderCalendarGrid(monthKey: string) {
    return buildCalendarCells(monthKey).map((cell) => {
      const record = recordsByDate.get(cell.date);
      const selectable =
        cell.inMonth &&
        (calendarMode === "copy" ? copyableDateSet.has(cell.date) : calendarDateSet.has(cell.date));

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
          onClick={() => selectCalendarDate(cell.date, selectable)}
          disabled={!selectable}
        >
          <span className="calendar-day__number">{cell.day}</span>
          <span className="calendar-day__title">
            {cell.inMonth && record?.title ? record.title : ""}
          </span>
        </button>
      );
    });
  }

  function copyRecordToToday(sourceDate: string) {
    const sourceRecord = records.find((record) => record.date === sourceDate);
    if (!sourceRecord || sourceDate === today) {
      return;
    }

    const copiedExercises = sourceRecord.exercises.map(cloneExerciseShape);
    const existingToday = records.find((record) => record.date === today);

    if (existingToday) {
      updateRecord(existingToday.id, (record) => ({
        ...record,
        title: sourceRecord.title || record.title,
        exercises: [...record.exercises, ...copiedExercises],
      }));
      expandRecord(existingToday.id);
    } else {
      const nextRecord: DayRecord = {
        id: createId("day"),
        date: today,
        title: sourceRecord.title,
        exercises: copiedExercises,
        updatedAt: new Date().toISOString(),
      };

      setRecords((current) => [nextRecord, ...current]);
      expandRecord(nextRecord.id);
    }

    setAddExerciseTarget(null);
    closeCalendar();
  }

  function startEditingTitle(record: DayRecord) {
    setTitleDrafts((current) => ({
      ...current,
      [`title-${record.id}`]: record.title ?? "",
    }));
    setEditingTitleTarget(record.id);
  }

  function saveEditedTitle(recordId: string, rawTitle?: string) {
    const draftKey = `title-${recordId}`;
    const nextTitle = (rawTitle ?? titleDrafts[draftKey] ?? "").trim();

    updateRecord(recordId, (record) => ({
      ...record,
      title: nextTitle || undefined,
    }));

    setEditingTitleTarget(null);
  }

  function startEditingExercise(exercise: Exercise) {
    if (deleteMode || exerciseHistoryMode) {
      return;
    }

    setExerciseDrafts((current) => ({
      ...current,
      [`edit-exercise-${exercise.id}`]: exercise.name,
    }));
    setEditingExerciseTarget(exercise.id);
  }

  function saveEditedExercise(recordId: string, exerciseId: string, rawName?: string) {
    const draftKey = `edit-exercise-${exerciseId}`;
    const nextName = (rawName ?? exerciseDrafts[draftKey] ?? "").trim();
    if (!nextName) {
      setEditingExerciseTarget(null);
      return;
    }

    updateRecord(recordId, (record) => ({
      ...record,
      exercises: record.exercises.map((exercise) =>
        exercise.id === exerciseId ? { ...exercise, name: nextName } : exercise,
      ),
    }));

    setEditingExerciseTarget(null);
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

  async function exportBackup() {
    if (exporting) {
      return;
    }

    const payload = createBackupPayload(records);
    const fileName = `movement-journal-backup-${today}.txt`;

    if (Capacitor.isNativePlatform()) {
      setExporting(true);
      try {
        const file = await Filesystem.writeFile({
          path: fileName,
          data: payload,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
        });
        await Share.share({
          title: "运动日记备份",
          files: [file.uri],
          dialogTitle: "导出运动日记备份",
        });
      } catch (error) {
        console.error("Failed to export backup", error);
        window.alert("导出失败，请重试。");
      } finally {
        setExporting(false);
      }
      return;
    }

    const blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
    setAddExerciseTarget(null);
    setAddLoadTarget(null);
    setInsertTarget(null);
    setCalendarMode(null);
    setExerciseHistoryMode(false);
    setSelectedExerciseHistory(null);
  }

  function addExercise(recordId: string) {
    if (exerciseHistoryMode) {
      return;
    }

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
    if (exerciseHistoryMode) {
      return;
    }

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
  }

  function startEditingLoad(groupId: string, label: string) {
    setLoadDrafts((current) => ({ ...current, [`edit-load-${groupId}`]: label }));
    setEditingLoadTarget(groupId);
  }

  function saveEditedLoad(
    recordId: string,
    exerciseId: string,
    groupId: string,
    rawLabel?: string,
  ) {
    const draftKey = `edit-load-${groupId}`;
    const nextValue = (rawLabel ?? loadDrafts[draftKey] ?? "").trim();

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
    if (exerciseHistoryMode) {
      return;
    }

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
    if (exerciseHistoryMode) {
      return;
    }

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

  function toggleExerciseHistoryMode() {
    setExerciseHistoryMode((current) => {
      const next = !current;
      if (next) {
        setDeleteMode(false);
        setAddExerciseTarget(null);
        setAddLoadTarget(null);
        setInsertTarget(null);
        setEditingTitleTarget(null);
        setEditingExerciseTarget(null);
        setEditingLoadTarget(null);
        setEditingEntryTarget(null);
        setCalendarMode(null);
      } else {
        setSelectedExerciseHistory(null);
      }
      return next;
    });
  }

  function showExerciseHistory(exerciseName: string) {
    setSelectedExerciseHistory(exerciseName.trim());
    setAddExerciseTarget(null);
    setAddLoadTarget(null);
    setInsertTarget(null);
    setEditingExerciseTarget(null);
    setEditingLoadTarget(null);
    setEditingEntryTarget(null);
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
          <div className="mode-actions">
            <button
              className={deleteMode ? "delete-toggle delete-toggle--active" : "delete-toggle"}
              onClick={() => {
                setDeleteMode((current) => !current);
                setExerciseHistoryMode(false);
                setSelectedExerciseHistory(null);
                setAddExerciseTarget(null);
                setAddLoadTarget(null);
                setInsertTarget(null);
                setCalendarMode(null);
                finishExerciseDrag();
              }}
            >
              删除
            </button>
            <button
              className={
                exerciseHistoryMode ? "history-toggle history-toggle--active" : "history-toggle"
              }
              onClick={toggleExerciseHistoryMode}
            >
              历史
            </button>
          </div>
        </header>

        <main className="screen-body">
          {exerciseHistoryMode && selectedExerciseHistory ? (
            <section className="history-focus">
              <div className="history-focus__head">
                <strong>{selectedExerciseHistory}</strong>
                <span>{exerciseHistoryRecords.length} 天</span>
              </div>
              <div className="history-list">
                {exerciseHistoryRecords.map((record) => (
                  <article className="history-card" key={`history-${record.id}`}>
                    <div className="history-card__head history-card__head--plain">
                      <div className="date-cluster">
                        <strong className="date-title">{formatDateHeadline(record.date)}</strong>
                        {record.title ? (
                          <span className="date-subtitle-static">{record.title}</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="history-card__items">
                      {record.exercises.map((exercise) => (
                        <section className="history-exercise" key={exercise.id}>
                          <div className="history-exercise__loads">
                            {exercise.loadGroups.map((group) => (
                              <div className="history-load-block" key={group.id}>
                                <div className="history-load-row">
                                  <span className="load-label-static">{group.label || "默认"}</span>
                                  <div className="load-inline-group">
                                    <div className="entry-edit-row">
                                      {group.entries.length > 0 ? (
                                        group.entries.map((entry, entryIndex) => (
                                          <span className="entry-chip-static" key={`${group.id}-${entryIndex}`}>
                                            {entry}
                                          </span>
                                        ))
                                      ) : (
                                        <span className="muted">无数字</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : monthSections.length === 0 ? (
            <div className="history-card">
              <p className="muted">{exerciseHistoryMode ? "先添加记录，再点运动旁边的历史符号。" : "无记录"}</p>
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
                          {editingTitleTarget === record.id ? (
                            <div className="title-edit-stack">
                              <input
                                className="date-subtitle-input"
                                value={titleDrafts[`title-${record.id}`] ?? ""}
                                onChange={(event) =>
                                  setTitleDrafts((current) => ({
                                    ...current,
                                    [`title-${record.id}`]: event.target.value,
                                  }))
                                }
                                onBlur={() => saveEditedTitle(record.id)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    saveEditedTitle(record.id);
                                  }
                                }}
                                placeholder="标题"
                                aria-label={`${formatDateHeadline(record.date)} 小标题`}
                                autoFocus
                              />
                              {titleSuggestions.length > 0 ? (
                                <div className="title-presets">
                                  {titleSuggestions.map((title) => (
                                    <button
                                      className="title-preset-button"
                                      key={`${record.id}-${title}`}
                                      onMouseDown={(event) => event.preventDefault()}
                                      onClick={() => saveEditedTitle(record.id, title)}
                                    >
                                      {title}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <button
                              className={
                                record.title ? "date-subtitle-button" : "date-subtitle-button is-empty"
                              }
                              onClick={() => startEditingTitle(record)}
                              aria-label={`${formatDateHeadline(record.date)} 小标题`}
                            >
                              {record.title || "标题"}
                            </button>
                          )}
                          {exerciseHistoryMode ? null : (
                            <button
                              className={deleteMode ? "date-delete-button" : "date-add-button"}
                              onClick={() =>
                                deleteMode ? removeDate(record.id) : openAddExercise(record.id)
                              }
                            >
                              {deleteMode ? "−" : "+"}
                            </button>
                          )}
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
                            <section
                              className={
                                draggingExercise?.exerciseId === exercise.id
                                  ? "history-exercise history-exercise--dragging"
                                  : "history-exercise"
                              }
                              key={exercise.id}
                              data-record-id={record.id}
                              data-exercise-id={exercise.id}
                              onDragOver={(event) => {
                                if (!deleteMode) {
                                  event.preventDefault();
                                  dragExerciseOver(record.id, exercise.id);
                                }
                              }}
                              onDrop={(event) => {
                                event.preventDefault();
                                finishExerciseDrag();
                              }}
                            >
                              <div className="history-exercise__header">
                                <div className="exercise-title-row">
                                  <div className="exercise-title-main">
                                    {editingExerciseTarget === exercise.id ? (
                                      <div className="exercise-edit-stack">
                                        <input
                                          className="exercise-inline-input"
                                          value={exerciseDrafts[`edit-exercise-${exercise.id}`] ?? ""}
                                          onChange={(event) =>
                                            setExerciseDrafts((current) => ({
                                              ...current,
                                              [`edit-exercise-${exercise.id}`]: event.target.value,
                                            }))
                                          }
                                          onBlur={() => saveEditedExercise(record.id, exercise.id)}
                                          onKeyDown={(event) => {
                                            if (event.key === "Enter") {
                                              event.preventDefault();
                                              saveEditedExercise(record.id, exercise.id);
                                            }
                                          }}
                                          aria-label="运动类型"
                                          autoFocus
                                        />
                                        {exerciseSuggestions.length > 0 ? (
                                          <div className="exercise-presets">
                                            {exerciseSuggestions.map((name) => (
                                              <button
                                                className="exercise-preset-button"
                                                key={`${exercise.id}-${name}`}
                                                onMouseDown={(event) => event.preventDefault()}
                                                onClick={() =>
                                                  saveEditedExercise(record.id, exercise.id, name)
                                                }
                                              >
                                                {name}
                                              </button>
                                            ))}
                                          </div>
                                        ) : null}
                                      </div>
                                    ) : (
                                      <button
                                        className="history-exercise__name"
                                        onClick={() => startEditingExercise(exercise)}
                                      >
                                        {exercise.name}
                                      </button>
                                    )}
                                    <button
                                      className={
                                        deleteMode
                                          ? "exercise-delete-button"
                                          : exerciseHistoryMode
                                            ? "exercise-history-button"
                                          : "exercise-add-button"
                                      }
                                      onClick={() =>
                                        deleteMode
                                          ? removeExercise(record.id, exercise.id)
                                          : exerciseHistoryMode
                                            ? showExerciseHistory(exercise.name)
                                            : setAddLoadTarget((current) =>
                                                current === exercise.id ? null : exercise.id,
                                              )
                                      }
                                      aria-label={
                                        exerciseHistoryMode ? `查看${exercise.name}历史` : undefined
                                      }
                                    >
                                      {deleteMode ? "−" : exerciseHistoryMode ? "★" : "+"}
                                    </button>
                                  </div>
                                  <button
                                    className="exercise-drag-handle"
                                    draggable={!deleteMode && !exerciseHistoryMode}
                                    onDragStart={(event) => {
                                      startExerciseDrag(record.id, exercise.id);
                                      event.dataTransfer.effectAllowed = "move";
                                      event.dataTransfer.setData("text/plain", exercise.id);
                                    }}
                                    onDragEnd={finishExerciseDrag}
                                    onPointerDown={(event) => {
                                      if (deleteMode || exerciseHistoryMode) {
                                        return;
                                      }

                                      event.currentTarget.setPointerCapture(event.pointerId);
                                      startExerciseDrag(record.id, exercise.id);
                                    }}
                                    onPointerMove={(event) =>
                                      dragExerciseOverPoint(event.clientX, event.clientY)
                                    }
                                    onPointerUp={finishExerciseDrag}
                                    onPointerCancel={finishExerciseDrag}
                                    aria-label="拖动排序"
                                  >
                                    <span aria-hidden="true" />
                                    <span aria-hidden="true" />
                                    <span aria-hidden="true" />
                                  </button>
                                </div>
                              </div>

                              <>
                                  {addLoadTarget === exercise.id && !deleteMode && !exerciseHistoryMode ? (
                                    <div className="quick-add-stack">
                                      <div className="quick-add-row">
                                        <input
                                          className="load-type-input"
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
                                                  className="load-inline-input load-type-input"
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
                                                  {(loadSuggestionsByExercise[exercise.name.trim()] ?? ["默认"]).map(
                                                    (label) => (
                                                      <button
                                                        className="load-preset-button"
                                                        key={`${group.id}-${label}`}
                                                        onMouseDown={(event) => event.preventDefault()}
                                                        onClick={() =>
                                                          saveEditedLoad(
                                                            record.id,
                                                            exercise.id,
                                                            group.id,
                                                            label,
                                                          )
                                                        }
                                                      >
                                                        {label}
                                                      </button>
                                                    ),
                                                  )}
                                                </div>
                                              </div>
                                            ) : (
                                              <button
                                                className="load-label-button"
                                                onClick={() =>
                                                  !exerciseHistoryMode &&
                                                  startEditingLoad(group.id, group.label || "默认")
                                                }
                                              >
                                                {group.label || "默认"}
                                              </button>
                                            )}

                                            <div className="load-inline-group">
                                              {exerciseHistoryMode ? null : (
                                                <button
                                                  className="insert-anchor-button"
                                                  onClick={() => toggleInsertTarget(group.id, 0)}
                                                >
                                                  |
                                                </button>
                                              )}
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
                                                              : !exerciseHistoryMode &&
                                                                startEditingEntry(entryId, entry)
                                                          }
                                                        >
                                                          {entry}
                                                        </button>
                                                      )}
                                                      {entryIndex < group.entries.length - 1 &&
                                                      !exerciseHistoryMode ? (
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
                                                {exerciseHistoryMode ? null : (
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
                                                )}
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
            accept="text/plain,.txt,application/json,.json"
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
            <button className="tool-button" onClick={exportBackup} disabled={exporting}>
              {exporting ? "正在导出…" : "导出"}
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
          <div
            className="calendar-panel"
            onPointerDown={startCalendarSwipe}
            onPointerMove={moveCalendarSwipe}
            onPointerUp={finishCalendarSwipe}
            onPointerCancel={cancelCalendarSwipe}
          >
            <div className="calendar-panel__header">
              <strong>{calendarMode === "copy" ? "复制到今天" : "运动日历"}</strong>
              <button className="calendar-close" onClick={closeCalendar}>
                关闭
              </button>
            </div>
            <div className="calendar-nav">
              <button onClick={() => changeCalendarMonth(-1)}>
                上月
              </button>
              <strong>{formatMonthHeadline(calendarMonth)}</strong>
              <button onClick={() => changeCalendarMonth(1)}>
                下月
              </button>
            </div>
            <div className="calendar-weekdays">
              {weekLabels.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className="calendar-viewport">
              <div
                className={
                  calendarMotion
                    ? `calendar-grid-shell calendar-grid-shell--${calendarMotion}`
                    : "calendar-grid-shell"
                }
                data-calendar-motion={calendarMotion ?? "idle"}
                onAnimationEnd={finishCalendarGridAnimation}
              >
                <div className="calendar-grid">{renderCalendarGrid(calendarMonth)}</div>
              </div>
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
