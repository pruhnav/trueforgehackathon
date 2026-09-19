import React, { useEffect, useState } from 'react';

export const roleLabels = {
  coordinator: 'Care-plan coordinator',
  summarizer: 'Discharge summarizer',
  questions: 'Questions and sources',
  reminders: 'Reminder assistant',
};

export function AgentTeamOverview({ api, status }) {
  const [team, setTeam] = useState(null);
  useEffect(() => {
    let active = true;
    api('/agent-team').then((data) => { if (active) setTeam(data); }).catch(() => {});
    return () => { active = false; };
  }, [api]);
  return (
    <details className="agent-team-overview">
      <summary>Your Homeward agent team</summary>
      <p>
        {status?.ready
          ? 'Live specialists use the configured TrueForge model. Saved-record guidance also works locally.'
          : 'Live model responses are not ready. Recorded summaries and next-step guidance still work.'}
      </p>
      {team ? (
        <ul>
          {team.roles.map((role) => (
            <li key={role.id}><strong>{role.label}</strong><p>{role.purpose}</p></li>
          ))}
        </ul>
      ) : <p>Specialists help with plan navigation, summaries, questions, and reminders.</p>}
      <small>One specialist handles each live request. Review and approval remain human actions.</small>
    </details>
  );
}

export default function PatientSummary({ patientId, refreshKey, api, onSource, onAsk }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    api(`/patients/${patientId}/summary`)
      .then((summary) => { if (active) setData(summary); })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [patientId, refreshKey, reload, api]);
  if (error) return (
    <section className="card summary-workspace">
      <p role="alert">Your recorded summary could not be loaded: {error}</p>
      <button className="button secondary" onClick={() => setReload((n) => n + 1)}>Retry summary</button>
    </section>
  );
  if (!data) return <p role="status">Loading your recorded discharge summary…</p>;
  return (
    <section className="summary-workspace" aria-label="Recorded discharge summary">
      <div className="page-heading">
        <div>
          <div className="eyebrow">UNDERSTAND YOUR PLAN</div>
          <h1>Your discharge, step by step.</h1>
          <p>{data.patientName} · scenario date {data.asOf} · synthetic records</p>
        </div>
        <button className="button secondary" onClick={onAsk}>Ask about your summary</button>
      </div>
      <div className="info-strip">
        <p>Recorded summary · built from saved sources without a model. {data.note}</p>
      </div>
      <section className="card summary-next" aria-label="Summary next step">
        <h2>{data.guidance.heading}</h2>
        <p>{data.guidance.summary}</p>
        {data.guidance.nextTask && <p>Recorded deadline: {data.guidance.nextTask.due} · {data.guidance.nextTask.dateLabel}</p>}
      </section>
      {data.sections.map((section) => (
        <details className="card summary-group" key={section.id} open={['ready', 'attention'].includes(section.id)}>
          <summary>{section.label} ({section.items.length})</summary>
          <p>{section.description}</p>
          {!section.items.length && <p>No items in this section.</p>}
          {section.items.map((item) => (
            <article className="summary-item" key={item.id} aria-label={item.title}>
              <div className="task-title-row">
                <h3>{item.title}</h3>
                <span className="badge">{item.status.replaceAll('_', ' ')}</span>
              </div>
              <p>{item.meaning}</p>
              {item.instruction ? <blockquote>{item.instruction}</blockquote> : <p>Exact source unavailable; ask the care team to review this item.</p>}
              <p><strong>{item.due ? `Recorded deadline: ${item.due}` : 'No actionable deadline shown'}</strong><br />{item.dateLabel}</p>
              {!!item.gaps.length && <ul className="summary-gaps">{item.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>}
              <div className="summary-source-actions">
                {item.source && <button className="text-button" onClick={() => onSource(item.source)}>View source: {item.source.heading}</button>}
                {item.dateSource && <button className="text-button" onClick={() => onSource(item.dateSource)}>View deadline evidence</button>}
                {item.originalSource && item.originalSource.documentId !== item.source?.documentId && (
                  <button className="text-button" onClick={() => onSource(item.originalSource)}>View original record</button>
                )}
              </div>
            </article>
          ))}
        </details>
      ))}
      {data.omittedSourcePassages > 0 && <p>{data.omittedSourcePassages} additional source passages remain available in My documents.</p>}
      <p className="summary-footer">This summary does not approve an instruction or create a reminder. Human review, approval, and exact sources stay in your plan.</p>
    </section>
  );
}
