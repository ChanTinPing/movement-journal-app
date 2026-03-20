import { useEffect, useMemo, useState } from "react";
import { loadRecords, saveRecords } from "./storage";
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

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
}).format(new Date());

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

  function addTodayRecord() {
    const existing = records.find((record) => record.date === today);
    if (existing) {
      setAddExerciseTarget((current) => (current === existing.id ? null : existing.id));
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
    setCollapsedDates((current) => ({ ...current, [recordId]: false }));
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
            }}
          >
            删除
          </button>
        </header>

        <main className="screen-body">
          {monthSections.length === 0 ? (
            <div className="history-card">
              <p className="muted">还没有记录</p>
            </div>
          ) : (
            monthSections.map((section) => (
              <section className="month-section" key={section.month}>
                <div className="month-heading">{formatMonthHeadline(section.month)}</div>
                <div className="history-list">
                  {section.records.map((record) => (
                    <article className="history-card" key={record.id}>
                      <div className="history-card__head">
                        <div className="date-cluster">
                          <strong className="date-title">{formatDateHeadline(record.date)}</strong>
                          <button
                            className={deleteMode ? "date-delete-button" : "date-add-button"}
                            onClick={() =>
                              deleteMode
                                ? removeDate(record.id)
                                : setAddExerciseTarget((current) =>
                                    current === record.id ? null : record.id,
                                  )
                            }
                          >
                            {deleteMode ? "−" : "+"}
                          </button>
                        </div>
                        <span className="record-count">{record.exercises.length} 个动作</span>
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
                                  <span className="row-meta-spacer" />
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
                                      <p className="muted">还没有记录</p>
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
                                                      [`edit-load-${group.id}`]:
                                                        event.target.value,
                                                    }))
                                                  }
                                                  onBlur={() =>
                                                    saveEditedLoad(
                                                      record.id,
                                                      exercise.id,
                                                      group.id,
                                                    )
                                                  }
                                                  onKeyDown={(event) => {
                                                    if (event.key === "Enter") {
                                                      event.preventDefault();
                                                      saveEditedLoad(
                                                        record.id,
                                                        exercise.id,
                                                        group.id,
                                                      );
                                                    }
                                                  }}
                                                  autoFocus
                                                />
                                                <div className="load-presets load-presets--inline">
                                                  <button
                                                    className="load-preset-button"
                                                    onMouseDown={(event) =>
                                                      event.preventDefault()
                                                    }
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
                                                  const isEditing =
                                                    editingEntryTarget === entryId;

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
                                                          className="entry-chip-button"
                                                          onClick={() =>
                                                            startEditingEntry(entryId, entry)
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
                                                              toggleInsertTarget(
                                                                group.id,
                                                                entryIndex + 1,
                                                              )
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

          <div className="today-add-wrap">
            <button className="today-add-button" onClick={addTodayRecord}>
              今天 +
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
