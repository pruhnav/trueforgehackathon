import React, { useEffect, useRef, useState } from 'react';

const stamp = (value) => (value ? new Date(value).toLocaleString() : 'Time not recorded');
const statusLabel = (value) => value.replaceAll('_', ' ');
export function DateEvidence({ task }) {
  const evidence = task.dateEvidence;
  return (
    <p className="review-date">
      <strong>Deadline: {task.due || 'Not established'}</strong>
      <br />
      {evidence?.kind === 'human_clarification'
        ? `Human-entered clarification: ${evidence.explanation}`
        : evidence?.kind === 'source'
          ? `Source-supported date · ${evidence.source.sectionId}`
          : evidence?.kind === 'legacy'
            ? 'Legacy date — review evidence was not captured.'
            : 'No deadline evidence recorded.'}
    </p>
  );
}
function SourcePassage({ reference, documents, label }) {
  const doc = documents.find((d) => d.id === reference?.documentId);
  const section = doc?.sections.find((s) => s.id === reference?.sectionId);
  return (
    <section className="review-source" aria-label={label}>
      <h4>{label}</h4>
      <p>
        {doc?.title || 'Source unavailable'} · {section?.heading || reference?.sectionId}
      </p>
      <blockquote>{reference?.quote || 'No passage available.'}</blockquote>
      {doc?.kind === 'synthea' && (
        <p>
          Historical Synthea context. Separate discharge instructions are required for confirmation.
        </p>
      )}
    </section>
  );
}
function History({ history }) {
  return (
    <details className="review-history">
      <summary>Activity history ({history.length})</summary>
      {!history.length && <p>No decisions recorded yet.</p>}
      <ol>
        {history.map((entry) => (
          <li key={entry.id}>
            <strong>{statusLabel(entry.event)}</strong> ·{' '}
            <time dateTime={entry.at}>{stamp(entry.at)}</time>
            <p>{entry.response || entry.note}</p>
            <small>
              {entry.actor?.kind === 'local_demo_patient'
                ? 'Local demo patient'
                : 'Local demo operator'}{' '}
              · identity not authenticated
            </small>
          </li>
        ))}
      </ol>
    </details>
  );
}
export function TaskHistory({ task, api }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    api(`/patients/${task.patientId}/tasks/${task.id}/history`)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [task.id, task.revision, reload]);
  if (error)
    return (
      <div className="task-response">
        <p role="alert">Response history unavailable: {error}</p>
        <button className="text-button" onClick={() => setReload((n) => n + 1)}>
          Retry history
        </button>
      </div>
    );
  if (!data) return <p role="status">Loading response history…</p>;
  const response = [...data.history].reverse().find((h) => h.response);
  return (
    <div className="task-response">
      {response && (
        <>
          <strong>Care-team demo response</strong>
          <p>{response.response}</p>
          <small>{stamp(response.at)} · Saved locally</small>
          <p>
            {response.event === 'help_resolved'
              ? 'This help request was resolved by the demo operator.'
              : 'A response was saved; it did not resolve the request.'}
          </p>
          {task.status === 'needs_clarification' && (
            <p>The instruction still needs review before completion.</p>
          )}
        </>
      )}
      <History history={data.history} />
    </div>
  );
}
export function CareQueue({ api, refreshKey, onOpen }) {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('attention');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    (async () => {
      const patients = await api('/patients');
      const plans = await Promise.all(patients.map((p) => api(`/patients/${p.id}/plan`)));
      const result = await Promise.all(
        plans.flatMap((plan) =>
          plan.tasks.map(async (task) => {
            const { history } = await api(`/patients/${plan.patient.id}/tasks/${task.id}/history`);
            const doc = plan.documents.find((d) => d.id === task.source.documentId);
            return {
              patient: plan.patient,
              task,
              doc,
              at: history.at(-1)?.at || (doc?.kind === 'imported' ? doc.importedAt : null),
            };
          }),
        ),
      );
      if (active) setRows(result);
    })()
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey, reload]);
  const visible = rows.filter(
    ({ task }) =>
      filter === 'all' ||
      (filter === 'help'
        ? task.helpRequestedAt
        : filter === 'review'
          ? task.status === 'needs_clarification'
          : task.helpRequestedAt || task.status === 'needs_clarification'),
  );
  return (
    <section className="card care-queue" aria-label="Care-team review queue" aria-busy={loading}>
      <div className="section-heading">
        <div>
          <h2>Review & respond</h2>
          <p>Local demo workflow · listed by patient, not clinical priority.</p>
        </div>
        <button
          className="button secondary"
          disabled={loading}
          onClick={() => setReload((n) => n + 1)}
        >
          Refresh queue
        </button>
      </div>
      <div className="queue-controls">
        <label>
          Show requests
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="attention">Needs attention</option>
            <option value="help">Open help requests</option>
            <option value="review">Instructions to review</option>
            <option value="all">All tasks & history</option>
          </select>
        </label>
      </div>
      {loading ? (
        <p className="queue-state" role="status">
          Loading review queue…
        </p>
      ) : error ? (
        <p className="queue-state inline-error" role="alert">
          Could not load the queue. {error} Use Refresh queue to retry.
        </p>
      ) : !visible.length ? (
        <p className="queue-state" role="status">
          No tasks match this view. Nothing needs attention here.
        </p>
      ) : (
        <div className="queue-list">
          {visible.map(({ patient, task, doc, at }) => (
            <article className="queue-item" key={task.id}>
              <div>
                <span className="eyebrow">{patient.name}</span>
                <h3>{task.title}</h3>
                <p>
                  {[
                    task.helpRequestedAt && 'Open patient help request',
                    task.status === 'needs_clarification' &&
                      (doc?.kind === 'imported'
                        ? 'Imported instruction awaiting review'
                        : 'Unresolved clarification'),
                  ]
                    .filter(Boolean)
                    .join(' · ') || statusLabel(task.status)}
                </p>
                <small>
                  {at ? `Latest recorded activity: ${stamp(at)}` : 'Activity time not recorded'}
                </small>
              </div>
              <div className="queue-actions">
                <button
                  className="text-button"
                  aria-label={`View source: ${task.title} for ${patient.name}`}
                  onClick={() => onOpen({ patient, task, sourceOnly: true })}
                >
                  View exact source
                </button>
                <button
                  className="button secondary"
                  aria-label={`Review task: ${task.title} for ${patient.name}`}
                  onClick={() => onOpen({ patient, task })}
                >
                  Review task
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
export function ReviewPanel({ selection, api, post, onSaved, onBusy }) {
  const pid = selection.patient.id,
    tid = selection.task.id;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [decision, setDecision] = useState('clarify');
  const [note, setNote] = useState('');
  const [response, setResponse] = useState('');
  const [helpDecision, setHelpDecision] = useState('respond');
  const [dateKind, setDateKind] = useState('none');
  const [due, setDue] = useState('');
  const [explanation, setExplanation] = useState('');
  const [instructionKey, setInstructionKey] = useState('current');
  const [dateKey, setDateKey] = useState('current');
  const command = useRef(null);
  const saving = useRef(false);
  const sourceRef = useRef(null);
  const alive = useRef(true);
  async function load() {
    setLoading(true);
    setError('');
    try {
      const [record, plan] = await Promise.all([
        api(`/patients/${pid}/tasks/${tid}/history`),
        api(`/patients/${pid}/plan`),
      ]);
      if (!alive.current) return;
      setData({ ...record, documents: plan.documents });
      setConflict(false);
      command.current = null;
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [pid, tid]);
  useEffect(() => {
    if (selection.sourceOnly && data) sourceRef.current?.focus();
  }, [!!data]);
  async function submit(operation, fields) {
    if (saving.current) return;
    const payload = { expectedRevision: data.task.revision, ...fields };
    const fingerprint = JSON.stringify({ operation, payload });
    if (command.current?.fingerprint !== fingerprint)
      command.current = { fingerprint, body: { requestId: crypto.randomUUID(), ...payload } };
    saving.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    setNotice('');
    let committed = false;
    try {
      await post(`/patients/${pid}/tasks/${tid}/${operation}`, command.current.body);
      committed = true;
      // Always refetch: an idempotent replay can return a historical task snapshot.
      const [record, plan] = await Promise.all([
        api(`/patients/${pid}/tasks/${tid}/history`),
        api(`/patients/${pid}/plan`),
      ]);
      if (!alive.current) return;
      setData({ ...record, documents: plan.documents });
      command.current = null;
      if (operation === 'reviews') setNote('');
      else setResponse('');
      setNotice(
        operation === 'reviews'
          ? 'Review saved locally. Reminder approval remains separate.'
          : fields.decision === 'resolve'
            ? 'Response saved and help request resolved locally. Instruction review status is unchanged.'
            : 'Response saved locally. Help request remains open. No message was sent.',
      );
      await onSaved();
    } catch (e) {
      if (!alive.current) return;
      setError(
        committed ? `Saved, but the latest data could not be refreshed. ${e.message}` : e.message,
      );
      if (committed || e.status === 409) setConflict(true);
    } finally {
      saving.current = false;
      if (alive.current) setBusy(false);
      onBusy(false);
    }
  }
  if (!data)
    return (
      <div className="queue-state">
        {loading ? (
          <p role="status">Loading task and original sources…</p>
        ) : (
          <>
            <p role="alert">{error}</p>
            <button className="button secondary" onClick={load}>
              Retry loading task
            </button>
          </>
        )}
      </div>
    );
  const task = data.task;
  const current = task.instruction || task.source;
  const passages = data.documents
    .filter(
      (d) =>
        ['imported', 'synthetic'].includes(d.kind) &&
        (!d.trustClass || d.trustClass === 'patient_instruction'),
    )
    .flatMap((d) =>
      d.sections
        .filter(
          (s) =>
            s.text.length >= 10 &&
            s.text.length <= 1800 &&
            (!s.trustClass || s.trustClass === 'patient_instruction'),
        )
        .map((s) => ({
          key: JSON.stringify([d.id, s.id]),
          label: `${d.title} · ${s.heading}`,
          source: { documentId: d.id, sectionId: s.id, quote: s.text },
        })),
    );
  const selected = (key) =>
    key === 'current' ? current : passages.find((p) => p.key === key)?.source;
  const instruction = selected(instructionKey);
  const instructionDoc = data.documents.find((d) => d.id === instruction?.documentId);
  const instructionSection = instructionDoc?.sections.find((s) => s.id === instruction?.sectionId);
  const historical =
    !['synthetic', 'imported'].includes(instructionDoc?.kind) ||
    [instructionDoc?.trustClass, instructionSection?.trustClass].some(
      (value) => value && value !== 'patient_instruction',
    );
  const blocked = busy || loading || conflict;
  return (
    <div className="review-panel">
      <p className="review-context">
        {selection.patient.name} · Local demo operator · identity not authenticated
      </p>
      <h3>{task.title}</h3>
      <p>
        Status: <strong>{statusLabel(task.status)}</strong> · Revision {task.revision}
      </p>
      <p>{task.instruction?.quote ?? task.detail}</p>
      <DateEvidence task={task} />
      {task.dateEvidence?.kind === 'source' && (
        <SourcePassage
          reference={task.dateEvidence.source}
          documents={data.documents}
          label="Current deadline source"
        />
      )}
      <div ref={sourceRef} tabIndex={-1}>
        <SourcePassage
          reference={task.source}
          documents={data.documents}
          label="Original passage"
        />
      </div>
      {task.instruction && (
        <SourcePassage
          reference={task.instruction}
          documents={data.documents}
          label="Current effective instruction"
        />
      )}
      {error && (
        <div className="inline-error" role="alert">
          <p>{error}</p>
          {conflict && (
            <p>
              Reload the latest task before submitting again. Your notes will be kept; compare them
              with the updated record.
            </p>
          )}
          <button className="button secondary" disabled={busy || loading} onClick={load}>
            Reload latest task
          </button>
        </div>
      )}
      {notice && (
        <p className="review-notice" role="status">
          {notice}
        </p>
      )}
      {loading && <p role="status">Refreshing task…</p>}
      {task.helpRequestedAt && (
        <form
          className="review-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit('help/responses', {
              helpRequestId: task.helpRequestId,
              decision: helpDecision,
              response,
            });
          }}
        >
          <h3>Respond to the help request</h3>
          <p>
            Requested {stamp(task.helpRequestedAt)}. Resolving help does not verify the instruction.
          </p>
          <fieldset disabled={blocked}>
            <label>
              Care-team response
              <textarea
                required
                maxLength={2000}
                value={response}
                onChange={(e) => setResponse(e.target.value)}
              />
            </label>
            <label>
              Help decision
              <select value={helpDecision} onChange={(e) => setHelpDecision(e.target.value)}>
                <option value="respond">Respond and leave open</option>
                <option value="resolve">Respond and resolve help request</option>
              </select>
            </label>
            <button className="button primary" type="submit">
              {busy ? 'Saving…' : 'Save help response'}
            </button>
          </fieldset>
        </form>
      )}
      <form
        className="review-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit('reviews', {
            decision,
            note,
            ...(decision === 'confirm'
              ? {
                  instructionSource: instruction,
                  due: dateKind === 'none' ? null : due,
                  dateEvidence:
                    dateKind === 'none'
                      ? null
                      : dateKind === 'human_clarification'
                        ? { kind: dateKind, explanation }
                        : { kind: 'source', source: selected(dateKey) },
                }
              : {}),
          });
        }}
      >
        <h3>Review the instruction</h3>
        <p>
          Original passages stay unchanged. Human review is recorded separately from reminder
          approval.
        </p>
        {task.status === 'completed' && (
          <p>Reopen this task in the patient's plan before reviewing it.</p>
        )}
        <fieldset disabled={blocked || task.status === 'completed'}>
          <label>
            Review decision
            <select value={decision} onChange={(e) => setDecision(e.target.value)}>
              <option value="clarify">Keep awaiting clarification</option>
              <option value="confirm">Confirm as an actionable task</option>
              <option value="reject">Reject proposed task</option>
            </select>
          </label>
          {decision === 'confirm' && (
            <>
              <label>
                Instruction source
                <select value={instructionKey} onChange={(e) => setInstructionKey(e.target.value)}>
                  <option value="current">Current instruction / original passage</option>
                  {passages.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <SourcePassage
                reference={instruction}
                documents={data.documents}
                label="Instruction selected for confirmation"
              />
              {historical && (
                <p className="inline-error">
                  Select separately documented discharge instructions. Historical context cannot be
                  confirmed as an instruction.
                </p>
              )}
              <label>
                Deadline evidence
                <select value={dateKind} onChange={(e) => setDateKind(e.target.value)}>
                  <option value="none">No deadline established</option>
                  <option value="source">Explicit date in a source passage</option>
                  <option value="human_clarification">Human-entered clarification</option>
                </select>
              </label>
              {dateKind !== 'none' && (
                <label>
                  Confirmed deadline
                  <input
                    type="date"
                    required
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
                  />
                </label>
              )}
              {dateKind === 'human_clarification' && (
                <label>
                  Human clarification explanation
                  <textarea
                    required
                    maxLength={2000}
                    aria-label="Human clarification explanation"
                    aria-describedby="clarification-origin"
                    value={explanation}
                    onChange={(e) => setExplanation(e.target.value)}
                  />
                  <small id="clarification-origin">
                    This explanation is attributed to human clarification, not the original
                    document.
                  </small>
                </label>
              )}
              {dateKind === 'source' && (
                <>
                  <label>
                    Deadline source
                    <select value={dateKey} onChange={(e) => setDateKey(e.target.value)}>
                      <option value="current">Current instruction / original passage</option>
                      {passages.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <SourcePassage
                    reference={selected(dateKey)}
                    documents={data.documents}
                    label="Selected deadline passage"
                  />
                  <p>
                    The passage must explicitly contain the selected date. Relative dates require
                    human clarification.
                  </p>
                </>
              )}
            </>
          )}
          <label>
            Review note
            <textarea
              required
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            className="button primary"
            type="submit"
            disabled={decision === 'confirm' && (historical || !instruction)}
          >
            {' '}
            {busy ? 'Saving…' : 'Save instruction review'}
          </button>
        </fieldset>
      </form>
      <History history={data.history} />
    </div>
  );
}
