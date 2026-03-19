import { useEffect, useMemo, useState } from "react";
import { loadRecords, saveRecords } from "./storage";
import { DayRecord, Exercise, LoadGroup } from "./types";
import { createId, formatDateHeadline, sortDatesDesc } from "./utils";

type DraftMap = Record<string, string>;

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
}).format(new Date());

function App() {
  const [records, setRecords] = useState<DayRecord[]>(() => ensureTodayRecord(loadRecords()));
  const [exerciseDrafts, setExerciseDrafts] = useState<DraftMap>({});
  const [loadDrafts, setLoadDrafts] = useState<DraftMap>({});
  const [entryDrafts, setEntryDrafts] = useState<DraftMap>({});
  const [addExerciseTarget, setAddExerciseTarget] = useState<string | null>(null);
  const [addLoadTarget, setAddLoadTarget] = useState<string | null>(null);
  const [quickAddTarget, setQuickAddTarget] = useState<string | null>(null);
  const [collapsedDates, setCollapsedDates] = useState<Record<string, boolean>>({});
  const [collapsedExercises, setCollapsedExercises] = useState<Record<string, boolean>>({});
  const [editingEntryTarget, setEditingEntryTarget] = useState<string | null>(null);
  const [deleteMode, setDeleteMode] = useState(false);

  useEffect(() => {
    saveRecords(records);
  }, [records]);

  const sortedRecords = useMemo(
    () => [...records].sort((left, right) => sortDatesDesc(left.date, right.date)),
    [records],
  );

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

        const labels = suggestionMap[exerciseName] ?? [];
        for (const group of exercise.loadGroups) {
          const label = group.label.trim();
          if (label && !labels.includes(label)) {
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

  function addExercise(recordId: string) {
    const fieldId = `exercise-${recordId}`;
    const name = exerciseDrafts[fieldId]?.trim();
    if (!name) {
      return;
    }

    const nextExercise: Exercise = {
      id: createId("exercise"),
      name,
      loadGroups: [
        {
          id: createId("load"),
          label: "",
          entries: [],
        },
      ],
    };

    updateRecord(recordId, (record) => ({
      ...record,
      exercises: [...record.exercises, nextExercise],
    }));

    setExerciseDrafts((current) => ({ ...current, [fieldId]: "" }));
    setAddExerciseTarget(null);
    setCollapsedDates((current) => ({ ...current, [recordId]: false }));
  }

  function addLoadGroup(recordId: string, exerciseId: string) {
    const fieldId = `load-${exerciseId}`;
    const label = loadDrafts[fieldId]?.trim();
    if (!label) {
      return;
    }

    const nextLoadGroup: LoadGroup = {
      id: createId("load"),
      label,
      entries: [],
    };

    updateRecord(recordId, (record) => ({
      ...record,
      exercises: record.exercises.map((exercise) =>
        exercise.id === exerciseId
          ? {
              ...exercise,
              loadGroups: [...exercise.loadGroups, nextLoadGroup],
            }
          : exercise,
      ),
    }));

    setLoadDrafts((current) => ({ ...current, [fieldId]: "" }));
    setAddLoadTarget(null);
    setCollapsedExercises((current) => ({ ...current, [exerciseId]: false }));
  }

  function addEntry(recordId: string, exerciseId: string, loadGroupId: string) {
    const fieldId = `entry-${loadGroupId}`;
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
                  ? { ...group, entries: [...group.entries, value] }
                  : group,
              ),
            }
          : exercise,
      ),
    }));

    setEntryDrafts((current) => ({ ...current, [fieldId]: "" }));
    setQuickAddTarget(null);
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
                      entries: group.entries.map((entry, index) =>
                        index === entryIndex ? nextValue : entry,
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

  function toggleDate(recordId: string) {
    setCollapsedDates((current) => ({
      ...current,
      [recordId]: !current[recordId],
    }));
  }

  function toggleExercise(exerciseId: string) {
    setCollapsedExercises((current) => ({
      ...current,
      [exerciseId]: !current[exerciseId],
    }));
  }

  function clearDateContent(recordId: string) {
    const record = records.find((item) => item.id === recordId);
    if (!record) {
      return;
    }

    if (!window.confirm(`确定删掉 ${record.date} 这一天的整张记录吗？`)) {
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

    if (!window.confirm(`确定删掉 ${record.date} 的动作“${exercise.name}”吗？`)) {
      return;
    }

    updateRecord(recordId, (record) => ({
      ...record,
      exercises: record.exercises.filter((exercise) => exercise.id !== exerciseId),
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
    if (!window.confirm(`确定删掉 ${record.date} 的“${exercise.name}”里负载“${label}”这一行吗？`)) {
      return;
    }

    updateRecord(recordId, (record) => ({
      ...record,
      exercises: record.exercises.map((exercise) =>
        exercise.id === exerciseId
          ? {
              ...exercise,
              loadGroups: exercise.loadGroups.filter((group) => group.id !== loadGroupId),
            }
          : exercise,
      ),
    }));
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
              setQuickAddTarget(null);
            }}
          >
            删除
          </button>
        </header>

        <main className="screen-body">
          <section className="history-list">
            {sortedRecords.map((record) => (
              <article className="history-card" key={record.id}>
                <div className="history-card__head">
                  <div className="date-cluster">
                    <strong className="date-title">{formatDateHeadline(record.date)}</strong>
                    <button
                      className={deleteMode ? "date-delete-button" : "date-add-button"}
                      onClick={() =>
                        deleteMode
                          ? clearDateContent(record.id)
                          : setAddExerciseTarget((current) =>
                              current === record.id ? null : record.id,
                            )
                      }
                      aria-label={deleteMode ? "删除日期内容" : "新增动作"}
                    >
                      {deleteMode ? "−" : "+"}
                    </button>
                  </div>

                  <div className="card-tools">
                    <span>{record.exercises.length} 个动作</span>
                    <button
                      className="collapse-button"
                      onClick={() => toggleDate(record.id)}
                      aria-label={collapsedDates[record.id] ? "展开日期内容" : "收起日期内容"}
                    >
                      {collapsedDates[record.id] ? "▾" : "▴"}
                    </button>
                  </div>
                </div>

                {addExerciseTarget === record.id && !deleteMode ? (
                  <div className="quick-add-row quick-add-row--card">
                    <input
                      type="text"
                      placeholder="动作名"
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
                  <p className="muted muted-block">这一天还没有动作</p>
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
                                  deleteMode ? "exercise-delete-button" : "exercise-add-button"
                                }
                                onClick={() =>
                                  deleteMode
                                    ? removeExercise(record.id, exercise.id)
                                    : setAddLoadTarget((current) =>
                                        current === exercise.id ? null : exercise.id,
                                      )
                                }
                                aria-label={deleteMode ? "删除动作" : "新增负载"}
                              >
                                {deleteMode ? "−" : "+"}
                              </button>
                            </div>

                            <button
                              className="exercise-collapse-button"
                              onClick={() => toggleExercise(exercise.id)}
                              aria-label={collapsedExercises[exercise.id] ? "展开动作内容" : "收起动作内容"}
                            >
                              {collapsedExercises[exercise.id] ? "▾" : "▴"}
                            </button>
                          </div>
                        </div>

                        {collapsedExercises[exercise.id] ? null : (
                          <>
                            {addLoadTarget === exercise.id && !deleteMode ? (
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
                            ) : null}

                            <div className="history-exercise__loads">
                              {exercise.loadGroups.length === 0 ? (
                                <p className="muted">这个动作还没有负载</p>
                              ) : (
                                exercise.loadGroups.map((group) => (
                                  <div className="history-load-block" key={group.id}>
                                    <div className="history-load-row">
                                      <div className="load-content">
                                        <span className="load-label">
                                          {group.label || "默认"}
                                        </span>
                                        <div className="entry-edit-row">
                                          {group.entries.map((entry, entryIndex) => {
                                            const entryId = `edit-${group.id}-${entryIndex}`;
                                            const isEditing = editingEntryTarget === entryId;

                                            return isEditing ? (
                                              <input
                                                key={entryId}
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
                                                key={entryId}
                                                className="entry-chip-button"
                                                onClick={() =>
                                                  startEditingEntry(entryId, entry)
                                                }
                                              >
                                                {entry}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>

                                      <button
                                        className={
                                          deleteMode
                                            ? "load-delete-button"
                                            : "entry-add-button"
                                        }
                                        onClick={() =>
                                          deleteMode
                                            ? removeLoadGroup(record.id, exercise.id, group.id)
                                            : setQuickAddTarget((current) =>
                                                current === group.id ? null : group.id,
                                              )
                                        }
                                        aria-label={deleteMode ? "删除负载行" : "补次数"}
                                      >
                                        {deleteMode ? "−" : "+"}
                                      </button>
                                    </div>

                                    {quickAddTarget === group.id && !deleteMode ? (
                                      <div className="quick-add-row">
                                        <input
                                          type="text"
                                          placeholder="数字"
                                          value={entryDrafts[`entry-${group.id}`] ?? ""}
                                          onChange={(event) =>
                                            setEntryDrafts((current) => ({
                                              ...current,
                                              [`entry-${group.id}`]: event.target.value,
                                            }))
                                          }
                                          onKeyDown={(event) => {
                                            if (event.key === "Enter") {
                                              event.preventDefault();
                                              addEntry(record.id, exercise.id, group.id);
                                            }
                                          }}
                                          autoFocus
                                        />
                                        <button
                                          onClick={() =>
                                            addEntry(record.id, exercise.id, group.id)
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
          </section>

          <datalist id="exercise-suggestions">
            {exerciseSuggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </main>
      </div>
    </div>
  );
}

function ensureTodayRecord(records: DayRecord[]) {
  if (records.some((record) => record.date === today)) {
    return records;
  }

  return [
    {
      id: createId("day"),
      date: today,
      exercises: [],
      updatedAt: new Date().toISOString(),
    },
    ...records,
  ];
}

export default App;
