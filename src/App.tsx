import { useEffect, useMemo, useState } from "react";
import { loadRecords, saveRecords } from "./storage";
import { DayRecord, Exercise, LoadGroup } from "./types";
import { createId, formatDateHeadline, sortDatesDesc } from "./utils";

type DraftMap = Record<string, string>;

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
}).format(new Date());

function App() {
  const [records, setRecords] = useState<DayRecord[]>(() => loadRecords());
  const [exerciseDrafts, setExerciseDrafts] = useState<DraftMap>({});
  const [loadDrafts, setLoadDrafts] = useState<DraftMap>({});
  const [entryDrafts, setEntryDrafts] = useState<DraftMap>({});
  const [addExerciseTarget, setAddExerciseTarget] = useState<string | null>(null);
  const [addLoadTarget, setAddLoadTarget] = useState<string | null>(null);
  const [quickAddTarget, setQuickAddTarget] = useState<string | null>(null);
  const [collapsedRecords, setCollapsedRecords] = useState<Record<string, boolean>>({});
  const [editingEntryTarget, setEditingEntryTarget] = useState<string | null>(null);

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

  function ensureTodayRecord() {
    const existing = records.find((record) => record.date === today);
    if (existing) {
      setAddExerciseTarget(existing.id);
      setAddLoadTarget(null);
      setQuickAddTarget(null);
      return;
    }

    const nextRecord: DayRecord = {
      id: createId("day"),
      date: today,
      exercises: [],
      updatedAt: new Date().toISOString(),
    };

    setRecords((current) => [nextRecord, ...current]);
    setAddExerciseTarget(nextRecord.id);
    setAddLoadTarget(null);
    setQuickAddTarget(null);
  }

  function addExercise(recordId: string) {
    const fieldId = `exercise-${recordId}`;
    const name = exerciseDrafts[fieldId]?.trim();
    if (!name) {
      return;
    }

    const defaultLoadGroup: LoadGroup = {
      id: createId("load"),
      label: "",
      entries: [],
    };

    const nextExercise: Exercise = {
      id: createId("exercise"),
      name,
      loadGroups: [defaultLoadGroup],
    };

    updateRecord(recordId, (record) => ({
      ...record,
      exercises: [...record.exercises, nextExercise],
    }));

    setExerciseDrafts((current) => ({ ...current, [fieldId]: "" }));
    setAddExerciseTarget(null);
    setQuickAddTarget(defaultLoadGroup.id);
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
    setQuickAddTarget(nextLoadGroup.id);
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

  function toggleCollapsed(recordId: string) {
    setCollapsedRecords((current) => ({
      ...current,
      [recordId]: !current[recordId],
    }));
  }

  return (
    <div className="app-shell">
      <div className="app-frame">
        <header className="app-header">
          <h1>运动日记</h1>
        </header>

        <main className="screen-body">
          <section className="history-list">
            {sortedRecords.length === 0 ? (
              <div className="empty-card">
                <h2>还没有记录</h2>
                <p>点右下角的 +，开始写今天的训练。</p>
              </div>
            ) : (
              sortedRecords.map((record) => (
                <article className="history-card" key={record.id}>
                  <div className="history-card__head">
                    <div className="date-cluster">
                      <strong className="date-title">
                        {formatDateHeadline(record.date)}
                      </strong>
                      <button
                        className="date-add-button"
                        onClick={() =>
                          setAddExerciseTarget((current) =>
                            current === record.id ? null : record.id,
                          )
                        }
                        aria-label="新增动作"
                      >
                        +
                      </button>
                    </div>
                    <div className="card-tools">
                      <span>{record.exercises.length} 个动作</span>
                      <button
                        className="collapse-button"
                        onClick={() => toggleCollapsed(record.id)}
                        aria-label={collapsedRecords[record.id] ? "展开日期内容" : "收起日期内容"}
                      >
                        {collapsedRecords[record.id] ? "▾" : "▴"}
                      </button>
                    </div>
                  </div>

                  {addExerciseTarget === record.id ? (
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

                  {collapsedRecords[record.id] ? null : record.exercises.length === 0 ? (
                    <p className="muted muted-block">这一天还没有动作</p>
                  ) : (
                    <div className="history-card__items">
                      {record.exercises.map((exercise) => (
                        <section className="history-exercise" key={exercise.id}>
                          <div className="history-exercise__header">
                            <div className="exercise-title-row">
                              <div className="history-exercise__name">{exercise.name}</div>
                              <button
                                className="exercise-add-button"
                                onClick={() =>
                                  setAddLoadTarget((current) =>
                                    current === exercise.id ? null : exercise.id,
                                  )
                                }
                                aria-label={`为${exercise.name}新增负载`}
                              >
                                +
                              </button>
                            </div>
                          </div>

                          {addLoadTarget === exercise.id ? (
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
                            {exercise.loadGroups.map((group) => (
                              <div className="history-load-block" key={group.id}>
                                <div className="history-load-row">
                                  <div className="load-content">
                                    <span className="load-label spacer-label">
                                      {group.label || ""}
                                    </span>
                                    <div className="entry-edit-row">
                                      {group.entries.length > 0
                                        ? group.entries.map((entry, entryIndex) => {
                                            const entryId = `edit-${group.id}-${entryIndex}`;
                                            const isEditing =
                                              editingEntryTarget === entryId;

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
                                          })
                                        : null}
                                    </div>
                                  </div>
                                  <button
                                    className="entry-add-button"
                                    onClick={() =>
                                      setQuickAddTarget((current) =>
                                        current === group.id ? null : group.id,
                                      )
                                    }
                                    aria-label={`为${exercise.name}补次数`}
                                  >
                                    +
                                  </button>
                                </div>

                                {quickAddTarget === group.id ? (
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
                            ))}
                          </div>

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
              ))
            )}
          </section>

          <datalist id="exercise-suggestions">
            {exerciseSuggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>

          <button className="fab" onClick={ensureTodayRecord} aria-label="新增今天记录">
            +
          </button>
        </main>
      </div>
    </div>
  );
}

export default App;
