import React, { useEffect, useRef, useState } from 'react';
import {
  House,
  HeartPulse,
  LayoutDashboard,
  Users,
  Activity,
  BookOpen,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Check,
  CheckCheck,
  ChevronRight,
  CalendarDays,
  FileText,
  Bell,
  ShieldCheck,
  Sparkles,
  X,
  Send,
  ExternalLink,
  Upload,
  CircleHelp,
  Clock3,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Link2,
  Zap,
  Download,
  PanelRightClose,
  LoaderCircle,
} from 'lucide-react';

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
const post = (path, body = {}) => api(path, { method: 'POST', body: JSON.stringify(body) });
const prettyDate = (value) =>
  value
    ? new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : 'Needs clarification';
const categoryIcons = {
  appointment: CalendarDays,
  preparation: FileText,
  'check-in': HeartPulse,
  clarification: CircleHelp,
};
function IconButton({ label, children, ...props }) {
  return (
    <button className="icon-button" aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}
function Badge({ children, tone = '' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.focus();
    const key = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const elements = [
          ...ref.current.querySelectorAll(
            'button, input, textarea, select, a[href], [tabindex="0"]',
          ),
        ].filter((el) => !el.disabled);
        const first = elements[0];
        const last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      prev?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section
        ref={ref}
        tabIndex={-1}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        {children}
      </section>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState('plan');
  const [patientId, setPatientId] = useState('demo-001');
  const activePatientId = useRef(patientId);
  activePatientId.current = patientId;
  const [patients, setPatients] = useState([]);
  const [plan, setPlan] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [source, setSource] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [action, setAction] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  async function refresh(id = patientId) {
    const [next, all] = await Promise.all([api(`/patients/${id}/plan`), api('/patients')]);
    if (activePatientId.current === id) setPlan(next);
    setPatients(all);
  }
  useEffect(() => {
    setPlan(null);
    refresh(patientId).catch((e) => setError(e.message));
    setSource(null);
    setAction(null);
  }, [patientId]);
  useEffect(() => {
    const check = () =>
      api('/status')
        .then(setStatus)
        .catch(() => setStatus({ connected: false, ready: false }));
    check();
    const timer = setInterval(check, 20000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  async function perform(fn, message) {
    setBusy(true);
    setError('');
    try {
      const result = await fn();
      await refresh();
      if (message) setToast(message);
      return result;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function remind(task) {
    const result = await perform(() =>
      post(`/patients/${patientId}/reminders`, { taskId: task.id }),
    );
    if (result) setAction(result);
  }
  function showSource(task) {
    const document = plan.documents.find((d) => d.id === task.source.documentId);
    setSource({ document, sectionId: task.source.sectionId });
  }
  const done = plan?.tasks.filter((t) => t.status === 'completed').length || 0;
  const pendingApprovals = plan?.actions.filter((a) => a.status === 'proposed').length || 0;
  const nextTask = plan?.tasks
    .filter((task) => task.status === 'pending' && task.due)
    .sort((a, b) => a.due.localeCompare(b.due))[0];
  const titles = {
    plan: 'My recovery',
    team: 'Care team',
    sources: 'My documents',
    resources: 'Helpful resources',
    harness: 'Agent activity',
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView('plan');
          }}
        >
          <span className="brand-mark">
            <HeartPulse size={23} strokeWidth={2} />
          </span>
          <span>
            homeward<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="workspace-label">CARE WORKSPACE</div>
        <nav aria-label="Main navigation">
          {[
            ['plan', LayoutDashboard, 'My recovery'],
            ['team', Users, 'Care team'],
            ['sources', FileText, 'My documents'],
            ['resources', BookOpen, 'Resources'],
          ].map(([key, Icon, title]) => (
            <button
              key={key}
              className={`nav-item ${view === key ? 'active' : ''}`}
              onClick={() => setView(key)}
            >
              <Icon size={19} />
              <span>{title}</span>
              {key === 'plan' && <span className="nav-count">{plan?.tasks.length || 0}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <div className="workspace-label">BEHIND THE CARE</div>
        <button
          className={`nav-item ${view === 'harness' ? 'active' : ''}`}
          onClick={() => setView('harness')}
        >
          <Activity size={19} />
          <span>Agent activity</span>
          <span className="live-dot" />
        </button>
        <div className="sidebar-bottom">
          <div className="support-card">
            <span className="support-icon">
              <ShieldCheck size={21} />
            </span>
            <h3>Built around your approval</h3>
            <p>Review proposed actions and see exactly what happened.</p>
            <button onClick={() => setView('harness')}>
              How it works <ArrowUpRight size={14} />
            </button>
          </div>
          <div className="sidebar-profile">
            <span className={`avatar ${plan?.patient.color || ''}`}>
              {plan?.patient.initials || 'AM'}
            </span>
            <div>
              <strong>{plan?.patient.name || 'Loading…'}</strong>
              <span>Synthetic demo patient</span>
            </div>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Homeward</span>
            <ChevronRight size={14} />
            <strong>{titles[view]}</strong>
          </div>
          <div className="topbar-right">
            <span className="demo-tag">
              <span /> SYNTHETIC DEMO
            </span>
            <span className="topbar-date">September 19, 2026</span>
            <IconButton
              label="View pending approvals"
              onClick={() => {
                const next = plan?.actions.find((a) => a.status === 'proposed');
                if (next) setAction(next);
                else setToast('You have no pending approvals.');
              }}
            >
              <Bell size={19} />
              {pendingApprovals > 0 && <i className="notification-dot" />}
            </IconButton>
          </div>
        </header>
        <main>
          {error && (
            <div role="alert" className="error-banner">
              <AlertCircle size={18} />
              <span>{error}</span>
              <IconButton label="Dismiss error" onClick={() => setError('')}>
                <X size={16} />
              </IconButton>
            </div>
          )}
          {!plan ? (
            <div className="loading-state">
              <LoaderCircle className="spin" />
              Loading your recovery plan…
            </div>
          ) : (
            <>
              {view === 'plan' && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">RECOVERY OVERVIEW</div>
                      <h1>Your recovery, organized.</h1>
                      <p>
                        {plan.patient.name.split(' ')[0]}, here’s your plan. Track next steps and
                        keep your care team in the loop.
                      </p>
                    </div>
                    <button className="button secondary" onClick={() => setImportOpen(true)}>
                      <Plus size={17} /> Add discharge record
                    </button>
                  </div>
                  <section className="recovery-hero">
                    <div className="hero-copy">
                      <div className="hero-pill">
                        <span /> {nextTask ? 'NEXT ON YOUR PLAN' : 'YOUR RECOVERY CHECKLIST'}
                      </div>
                      <h2>{nextTask ? nextTask.title : 'No dated tasks left to complete.'}</h2>
                      <p>
                        {nextTask
                          ? 'One clear next step, backed by your discharge instructions.'
                          : 'Review your checklist below for preparation and clarification items.'}
                      </p>
                      <button
                        className="button hero-action"
                        onClick={() => (nextTask ? showSource(nextTask) : setAssistantOpen(true))}
                      >
                        {nextTask ? 'Review instruction' : 'Ask Homeward'}{' '}
                        <ArrowUpRight size={17} />
                      </button>
                    </div>
                    <div className="focus-summary">
                      <div className="focus-summary-label">
                        <CalendarDays size={16} /> {nextTask ? 'DUE DATE' : 'PLAN PROGRESS'}
                      </div>
                      <strong>
                        {nextTask ? prettyDate(nextTask.due) : `${done} / ${plan.tasks.length}`}
                      </strong>
                      <span>
                        {nextTask ? 'From your discharge record' : 'Tasks reported complete'}
                      </span>
                      <div className="focus-summary-footer">
                        <Link2 size={13} /> Source-linked care plan
                      </div>
                    </div>
                  </section>
                  <div className="stat-grid">
                    <Stat
                      icon={CheckCheck}
                      label="Your next steps"
                      value={`${done} of ${plan.tasks.length}`}
                      detail="patient-reported complete"
                      progress={done / plan.tasks.length}
                    />
                    <Stat
                      icon={CalendarDays}
                      label="Next follow-up"
                      value={prettyDate(plan.tasks.find((t) => t.category === 'appointment')?.due)}
                      detail="Arrange a visit by this date"
                    />
                    <Stat
                      icon={ShieldCheck}
                      label="You’re in control"
                      value={pendingApprovals ? `${pendingApprovals} to review` : 'Approval first'}
                      detail="Actions wait for your permission"
                    />
                  </div>
                  <div className="content-grid">
                    <section className="card plan-card">
                      <div className="section-heading">
                        <div>
                          <h2>
                            Your next steps <span className="small-count">{plan.tasks.length}</span>
                          </h2>
                          <p>A manageable plan, straight from your discharge record.</p>
                        </div>
                        <span className="tiny-label">
                          DISCHARGED {prettyDate(plan.patient.dischargedAt).toUpperCase()}
                        </span>
                      </div>
                      <div className="task-list">
                        {plan.tasks.map((task) => {
                          const Icon = categoryIcons[task.category];
                          const completed = task.status === 'completed';
                          const needsReview = task.status === 'needs_clarification';
                          const saved = plan.actions.find(
                            (a) => a.taskId === task.id && a.status === 'executed',
                          );
                          const overdue = task.due && task.due < plan.demoDate && !completed;
                          return (
                            <article
                              className={`task ${completed ? 'completed' : ''}`}
                              key={task.id}
                            >
                              <button
                                className={`task-check ${completed ? 'checked' : ''}`}
                                disabled={busy || needsReview}
                                aria-label={`${completed ? 'Reopen' : 'Mark complete'}: ${task.title}`}
                                onClick={() =>
                                  perform(
                                    () =>
                                      api(`/patients/${patientId}/tasks/${task.id}`, {
                                        method: 'PATCH',
                                        body: JSON.stringify({ complete: !completed }),
                                      }),
                                    completed
                                      ? 'Task reopened.'
                                      : 'Saved as patient-reported complete.',
                                  )
                                }
                              >
                                {completed && <Check size={14} />}
                              </button>
                              <div className={`task-icon ${task.category}`}>
                                <Icon size={19} />
                              </div>
                              <div className="task-body">
                                <div className="task-title-row">
                                  <h3>{task.title}</h3>
                                  {needsReview && <Badge tone="amber">Needs clarification</Badge>}
                                  {completed && <Badge tone="green">Complete</Badge>}
                                </div>
                                <p>{task.detail}</p>
                                <div className="task-meta">
                                  <span className={overdue ? 'overdue' : ''}>
                                    <Clock3 size={12} />
                                    {task.due
                                      ? `${overdue ? 'Overdue · ' : 'By '}${prettyDate(task.due)}`
                                      : needsReview
                                        ? 'No date specified'
                                        : 'Before your visit'}
                                  </span>
                                  <span className="meta-dot">·</span>
                                  <button className="source-link" onClick={() => showSource(task)}>
                                    <Link2 size={12} /> View source
                                  </button>
                                </div>
                                {saved && (
                                  <a
                                    className="saved-reminder"
                                    href={`/api/patients/${patientId}/actions/${saved.id}/calendar`}
                                  >
                                    <CheckCircle2 size={13} /> Reminder ready <Download size={12} />
                                  </a>
                                )}
                              </div>
                              {!needsReview && !completed && task.due && !saved && (
                                <IconButton
                                  label={`Set reminder for ${task.title}`}
                                  onClick={() => remind(task)}
                                  disabled={busy}
                                >
                                  <Bell size={17} />
                                </IconButton>
                              )}
                            </article>
                          );
                        })}
                      </div>
                      <div className="plan-footer">
                        <ShieldCheck size={15} />
                        <span>
                          Every step links to its source. Missing details go to your care team.
                        </span>
                      </div>
                    </section>
                    <div className="right-column">
                      <section className="card companion-card">
                        <div className="companion-icon">
                          <Sparkles size={23} />
                        </div>
                        <Badge>DISCHARGE ASSISTANT</Badge>
                        <h2>Get clarity on your plan.</h2>
                        <p>
                          Find the answer in your discharge instructions, with the source right
                          there.
                        </p>
                        <button className="question-chip" onClick={() => setAssistantOpen(true)}>
                          “What should I do next?” <ArrowUpRight size={15} />
                        </button>
                        <button
                          className="button primary full"
                          onClick={() => setAssistantOpen(true)}
                        >
                          Ask Homeward <Sparkles size={16} />
                        </button>
                        <span className="assistant-mode">
                          {status?.ready
                            ? 'Connected to TrueForge'
                            : 'Source search available · connect a model for AI'}
                        </span>
                      </section>
                      <section className="card care-contact">
                        <span className="eyebrow">YOUR FOLLOW-UP TEAM</span>
                        <div className="doctor-row">
                          <div className="doctor-avatar">
                            <HeartPulse size={21} />
                          </div>
                          <div>
                            <h3>{plan.patient.clinician}</h3>
                            <p>Discharge care team · fictional</p>
                          </div>
                        </div>
                        <div className="contact-note">
                          <CircleHelp size={16} />
                          <span>
                            Unclear instructions? Keep a question ready for your next conversation.
                          </span>
                        </div>
                        <button className="text-button" onClick={() => setView('team')}>
                          View care-team overview <ArrowRight size={15} />
                        </button>
                      </section>
                    </div>
                  </div>
                </>
              )}
              {view === 'team' && (
                <>
                  <PageTitle
                    eyebrow="A SHARED PICTURE"
                    title="No next step left unseen."
                    subtitle="A demo care-team overview of follow-through, open questions, and approvals."
                  />
                  <div className="stat-grid">
                    <Stat
                      icon={Users}
                      label="Demo patients"
                      value={patients.length}
                      detail="Synthetic records only"
                    />
                    <Stat
                      icon={CircleHelp}
                      label="Needs clarification"
                      value={
                        patients
                          .flatMap((p) => p.tasks)
                          .filter((t) => t.status === 'needs_clarification').length
                      }
                      detail="Instructions awaiting care-team review"
                    />
                    <Stat
                      icon={Clock3}
                      label="Overdue steps"
                      value={
                        patients
                          .flatMap((p) => p.tasks)
                          .filter((t) => t.due && t.due < plan.demoDate && t.status === 'pending')
                          .length
                      }
                      detail="As of the demo date: September 19"
                    />
                  </div>
                  <section className="card">
                    <div className="section-heading">
                      <h2>Patient follow-through</h2>
                      <Badge>Synthetic cohort</Badge>
                    </div>
                    <div className="patient-table">
                      <div className="patient-table-header">
                        <span>Patient</span>
                        <span>Progress</span>
                        <span>Attention</span>
                        <span />
                      </div>
                      {patients.map((p) => {
                        const count = p.tasks.filter((t) => t.status === 'completed').length;
                        const late = p.tasks.some(
                          (t) => t.due && t.due < plan.demoDate && t.status === 'pending',
                        );
                        const review = p.tasks.some((t) => t.status === 'needs_clarification');
                        return (
                          <button
                            className="patient-row"
                            key={p.id}
                            onClick={() => {
                              setPatientId(p.id);
                              setView('plan');
                            }}
                          >
                            <div className="patient-cell">
                              <span className={`avatar ${p.color}`}>{p.initials}</span>
                              <div>
                                <strong>{p.name}</strong>
                                <small>
                                  {p.clinician} · discharged {prettyDate(p.dischargedAt)}
                                </small>
                              </div>
                            </div>
                            <div className="table-progress">
                              <span>
                                {count} / {p.tasks.length} complete
                              </span>
                              <div className="progress-track">
                                <i style={{ width: `${(count / p.tasks.length) * 100}%` }} />
                              </div>
                            </div>
                            <div>
                              <Badge tone={late ? 'red' : review ? 'amber' : 'green'}>
                                {late
                                  ? 'Overdue follow-up'
                                  : review
                                    ? 'Clarification needed'
                                    : 'Plan in progress'}
                              </Badge>
                            </div>
                            <ChevronRight size={18} />
                          </button>
                        );
                      })}
                    </div>
                    <div className="plan-footer">
                      <CircleHelp size={15} />
                      Completion is patient-reported. This demo does not connect to a hospital EHR
                      or provide clinician authentication.
                    </div>
                  </section>
                </>
              )}
              {view === 'sources' && (
                <>
                  <PageTitle
                    eyebrow="THE SOURCE OF YOUR PLAN"
                    title="Your instructions, together."
                    subtitle="Searchable discharge documents with a direct path back to every instruction."
                    action={
                      <button className="button primary" onClick={() => setImportOpen(true)}>
                        <Plus size={17} />
                        Add record
                      </button>
                    }
                  />
                  <div className="document-grid">
                    {plan.documents.map((doc) => (
                      <button
                        className="card document-card"
                        key={doc.id}
                        onClick={() => setSource({ document: doc })}
                      >
                        <div className="document-top">
                          <span className="document-icon">
                            <FileText size={26} />
                          </span>
                          <Badge tone={doc.kind === 'synthetic' ? 'green' : 'amber'}>
                            {doc.kind === 'synthetic'
                              ? 'Synthetic fixture'
                              : 'Imported · unreviewed'}
                          </Badge>
                        </div>
                        <h2>{doc.title}</h2>
                        <p>
                          {doc.sections.length} source passages · {plan.patient.name}
                        </p>
                        <div className="document-bottom">
                          Read source passages <ArrowUpRight size={17} />
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="info-strip">
                    <ShieldCheck size={20} />
                    <p>
                      Imported documents become searchable immediately. New instructions are added
                      for review with exact citations, without inferred deadlines.
                    </p>
                  </div>
                </>
              )}
              {view === 'resources' && <Resources onError={setError} />}
              {view === 'harness' && <Harness status={status} onReset={() => setResetOpen(true)} />}
              <footer className="page-footer">
                <span>
                  <House size={13} /> A clearer path home.
                </span>
                <span>
                  Built with TrueForge <span className="footer-dot">·</span> Agent Harness Hackathon
                  2026
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {source && (
        <Modal title={source.document.title} onClose={() => setSource(null)} wide>
          <div className="source-intro">
            <Badge tone={source.document.kind === 'synthetic' ? 'green' : 'amber'}>
              {source.document.kind === 'synthetic'
                ? 'Fictional discharge record'
                : 'Imported text · requires review'}
            </Badge>
            <p>
              Original passages for {plan.patient.name}. Highlighted text supports the selected
              task.
            </p>
          </div>
          <div className="source-passages">
            {source.document.sections.map((s) => (
              <article
                className={`source-passage ${s.id === source.sectionId ? 'highlight' : ''}`}
                key={s.id}
              >
                <div className="passage-heading">
                  <h3>{s.heading}</h3>
                  <span>
                    {s.page ? `Page ${s.page}` : 'Imported text'} · {s.id}
                  </span>
                </div>
                <p>{s.text}</p>
                {source.document.kind === 'imported' && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      perform(
                        () =>
                          post(`/patients/${patientId}/tasks/review`, {
                            documentId: source.document.id,
                            sectionId: s.id,
                            quote: s.text,
                          }),
                        'Instruction added for care-team review.',
                      )
                    }
                  >
                    <Plus size={14} /> Add for care-team review
                  </button>
                )}
              </article>
            ))}
          </div>
        </Modal>
      )}
      {importOpen && (
        <ImportModal
          patientId={patientId}
          onClose={() => setImportOpen(false)}
          onImported={async () => {
            await refresh();
            setImportOpen(false);
            setToast('Record imported. Its passages are ready for source search.');
            setView('sources');
          }}
        />
      )}
      {action && (
        <ActionModal
          action={action}
          patientId={patientId}
          onClose={() => setAction(null)}
          onChange={refresh}
        />
      )}
      {assistantOpen && (
        <Assistant
          key={patientId}
          patientId={patientId}
          status={status}
          onClose={() => setAssistantOpen(false)}
          onUpdate={refresh}
          onSource={(c) => {
            const document = plan.documents.find((d) => d.id === c.documentId);
            if (document) setSource({ document, sectionId: c.sectionId });
          }}
        />
      )}
      {resetOpen && (
        <Modal title="Reset the synthetic demo?" onClose={() => setResetOpen(false)}>
          <p className="modal-copy">
            This removes imported demo documents, task changes, reminders, and traces from this
            local app. The original three fictional patients will be restored.
          </p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setResetOpen(false)}>
              Keep my changes
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                const result = await perform(() => post('/demo/reset'), 'Demo restored.');
                if (result) setResetOpen(false);
              }}
            >
              Reset demo
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PageTitle({ eyebrow, title, subtitle, action }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
function Stat({ icon: Icon, label, value, detail, progress }) {
  return (
    <section className="stat-card">
      <div className="stat-icon">
        <Icon size={19} />
      </div>
      <div className="stat-content">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      {progress !== undefined && (
        <div className="stat-ring" style={{ '--progress': `${progress * 360}deg` }}>
          <Check size={18} />
        </div>
      )}
    </section>
  );
}

function ImportModal({ patientId, onClose, onImported }) {
  const [title, setTitle] = useState('Additional discharge instructions');
  const [text, setText] = useState('');
  const [pdf, setPdf] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();
  async function fileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError('');
    if (file.size > 5 * 1024 * 1024) {
      setError('Choose a file smaller than 5 MB.');
      return;
    }
    setTitle(file.name);
    if (file.name.toLowerCase().endsWith('.pdf')) {
      const reader = new FileReader();
      reader.onload = () => {
        setPdf(String(reader.result).split(',')[1]);
        setText('');
      };
      reader.readAsDataURL(file);
    } else {
      setPdf(null);
      setText(await file.text());
    }
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post(`/patients/${patientId}/documents`, { title, ...(pdf ? { pdf } : { text }) });
      await onImported();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Add a discharge record" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="modal-copy">
          Use a fictional record for this demo. Upload a text-based PDF or text file, or paste the
          instructions below.
        </p>
        <button type="button" className="upload-zone" onClick={() => fileRef.current.click()}>
          <Upload size={25} />
          <strong>{pdf ? `${title} selected` : 'Choose a PDF or text file'}</strong>
          <span>Up to 5 MB · scanned images need text extraction first</span>
        </button>
        <input ref={fileRef} type="file" accept=".pdf,.txt,.md" hidden onChange={fileSelected} />
        <label className="field-label">
          Document title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            required
          />
        </label>
        {!pdf && (
          <label className="field-label">
            Discharge instructions
            <textarea
              rows={7}
              placeholder="Paste the original instructions here…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              minLength={20}
              maxLength={80000}
              required
            />
          </label>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}Import record
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ActionModal({ action: initial, patientId, onClose, onChange }) {
  const [action, setAction] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [simulate, setSimulate] = useState(false);
  async function act(path, body) {
    setBusy(true);
    setError('');
    try {
      const result = await post(`/patients/${patientId}/actions/${action.id}/${path}`, body);
      setAction(result);
    } catch (e) {
      setError(e.message);
    } finally {
      await onChange();
      setBusy(false);
    }
  }
  return (
    <Modal
      title={action.status === 'executed' ? 'Your reminder is ready' : 'You decide the next step'}
      onClose={onClose}
    >
      <div className="approval-illustration">
        <ShieldCheck size={32} />
      </div>
      <p className="modal-copy">
        Homeward can create a local calendar reminder. Review the details before approving. This
        does not book a visit or send an external message.
      </p>
      <div className="approval-details">
        <span>REMINDER</span>
        <h3>{action.title}</h3>
        <p>
          <CalendarDays size={16} />
          {prettyDate(action.due)}, 2026 · all day
        </p>
        <Badge tone={action.status === 'executed' ? 'green' : 'amber'}>
          {action.status === 'proposed' ? 'Waiting for your approval' : action.status}
        </Badge>
      </div>
      {action.status === 'approved' && (
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={simulate}
            onChange={(e) => setSimulate(e.target.checked)}
          />
          Demo: simulate a timeout after saving
        </label>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {action.receipt && <p className="receipt">Receipt: {action.receipt}</p>}
      <div className="modal-actions">
        {action.status === 'proposed' && (
          <>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => act('approval', { approve: false })}
            >
              Decline
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => act('approval', { approve: true })}
            >
              <Check size={16} />
              Approve reminder
            </button>
          </>
        )}
        {action.status === 'approved' && (
          <button
            className="button primary"
            disabled={busy}
            onClick={() => act('execute', { simulateTimeout: simulate })}
          >
            {busy ? <LoaderCircle size={16} className="spin" /> : <Bell size={16} />}{' '}
            {error ? 'Retry safely' : 'Create local reminder'}
          </button>
        )}
        {action.status === 'executed' && (
          <a
            className="button primary"
            href={`/api/patients/${patientId}/actions/${action.id}/calendar`}
          >
            <Download size={16} />
            Download calendar reminder
          </a>
        )}
        {action.status === 'rejected' && (
          <button className="button secondary" onClick={onClose}>
            Close
          </button>
        )}
      </div>
    </Modal>
  );
}

function Assistant({ patientId, status, onClose, onUpdate, onSource }) {
  const [mode, setMode] = useState(status?.ready ? 'live' : 'source-search');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, busy]);
  async function send(value = input) {
    if (!value.trim() || busy) return;
    setInput('');
    setError('');
    setMessages((m) => [...m, { role: 'user', text: value }]);
    setBusy(true);
    try {
      const result = await post(`/patients/${patientId}/chat`, { message: value, mode });
      setMessages((m) => [...m, { role: 'assistant', text: result.answer, ...result }]);
      await onUpdate();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="assistant-panel" aria-label="Homeward discharge assistant">
      <div className="assistant-header">
        <div>
          <span className="mini-spark">
            <Sparkles size={19} />
          </span>
          <div>
            <h2>Ask Homeward</h2>
            <span>Your instructions, made clearer</span>
          </div>
        </div>
        <IconButton label="Close assistant" onClick={onClose}>
          <PanelRightClose size={21} />
        </IconButton>
      </div>
      <div className="mode-switch">
        <button
          className={mode === 'source-search' ? 'selected' : ''}
          onClick={() => setMode('source-search')}
        >
          Source search
        </button>
        <button className={mode === 'live' ? 'selected' : ''} onClick={() => setMode('live')}>
          TrueForge agent {status?.ready && <span className="live-dot" />}
        </button>
      </div>
      <div className="mode-note">
        {mode === 'live'
          ? status?.ready
            ? 'Live model · patient-scoped MCP tools · approval controls'
            : 'Configure a model in TrueForge Settings → Models to enable live runs.'
          : 'Exact document retrieval. No language model is used in this mode.'}
      </div>
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <div className="companion-icon">
              <Sparkles size={26} />
            </div>
            <h3>Let’s find your next step.</h3>
            <p>Ask about your follow-up, paperwork, or an instruction you want to clarify.</p>
            {[
              'What follow-up do I need?',
              'What paperwork should I bring?',
              'What does the laboratory instruction say?',
            ].map((q) => (
              <button className="question-chip" key={q} onClick={() => send(q)}>
                {q}
                <ArrowUpRight size={14} />
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div className={`chat-message ${m.role}`} key={i}>
            {m.role === 'assistant' && (
              <span className="message-label">
                <Sparkles size={13} />
                {m.mode === 'live' ? 'TRUEFORGE AGENT' : 'SOURCE SEARCH'}
              </span>
            )}
            <div className="message-text">{m.text}</div>
            {m.citations?.map((c, n) => (
              <button className="citation-chip" key={n} onClick={() => onSource(c)}>
                <Link2 size={12} />[{n + 1}] {c.heading}
              </button>
            ))}
            {m.sessionId && (
              <div className="message-run">
                Run {m.sessionId.slice(0, 8)} · {Math.round(m.latencyMs / 1000)}s
                {m.metrics?.total_tokens !== undefined && ` · ${m.metrics.total_tokens} tokens`}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="chat-thinking">
            <LoaderCircle className="spin" size={16} />
            {mode === 'live'
              ? 'TrueForge is working with your care tools…'
              : 'Finding source passages…'}
          </div>
        )}
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>
      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label className="sr-only" htmlFor="chat-input">
          Ask about your discharge
        </label>
        <textarea
          id="chat-input"
          placeholder="Ask about your discharge…"
          value={input}
          maxLength={2500}
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button aria-label="Send question" disabled={busy || !input.trim()}>
          <Send size={18} />
        </button>
      </form>
      <p className="chat-footnote">
        Each question starts a fresh run. For changes to your care or new symptoms, contact your
        care team.
      </p>
    </aside>
  );
}

function Resources({ onError }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/education')
      .then(setData)
      .catch((e) => onError(e.message));
  }, []);
  return (
    <>
      <PageTitle
        eyebrow="A LITTLE MORE UNDERSTANDING"
        title="Good information. Clear sources."
        subtitle="General patient education from MedlinePlus, separate from your personal discharge instructions."
        action={
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setData(await post('/education/refresh'));
              } catch (e) {
                onError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <RefreshCw size={16} className={busy ? 'spin' : ''} />
            Check live resources
          </button>
        }
      />
      <div className="info-strip">
        <BookOpen size={21} />
        <p>
          {data?.note ||
            'Curated links to MedlinePlus. A live lookup sends only a general topic, never patient identifiers or discharge text.'}
        </p>
        <Badge>{data?.mode || 'Loading'}</Badge>
      </div>
      <div className="document-grid">
        {data?.links.map((link, i) => (
          <a
            className="card document-card resource-card"
            key={`${link.url}-${i}`}
            href={link.url}
            target="_blank"
            rel="noreferrer"
          >
            <div className="document-top">
              <span className="document-icon">
                <BookOpen size={25} />
              </span>
              <ArrowUpRight size={20} />
            </div>
            <span className="eyebrow">{link.label}</span>
            <h2>{link.title}</h2>
            <p>{link.description}</p>
            <div className="document-bottom">
              {link.source}
              <ExternalLink size={14} />
            </div>
          </a>
        ))}
      </div>
      <p className="resource-disclaimer">
        Information is from MedlinePlus.gov. MedlinePlus does not endorse this application. Online
        educational information does not replace or modify your discharge plan.
      </p>
    </>
  );
}

function Harness({ status, onReset }) {
  const [traces, setTraces] = useState([]);
  const [evaluation, setEvaluation] = useState(null);
  const [error, setError] = useState('');
  async function load() {
    try {
      const [t, e] = await Promise.all([api('/traces'), api('/evaluations')]);
      setTraces(t);
      setEvaluation(e);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);
  const runs = traces.filter((t) => t.event === 'agent.completed');
  const tokens = runs.reduce((n, t) => n + (t.metrics?.total_tokens || 0), 0);
  const costs = runs.filter((t) => t.metrics?.total_cost_in_usd != null);
  return (
    <>
      <PageTitle
        eyebrow="VISIBLE. CONTROLLED. VERIFIED."
        title="Trust is in the details."
        subtitle="Inspect actual tool calls, approvals, failures, and evaluation results."
        action={
          <button className="button secondary" onClick={load}>
            <RefreshCw size={16} />
            Refresh
          </button>
        }
      />
      {error && <p className="inline-error">{error}</p>}
      <div className="runtime-banner">
        <div className="runtime-icon">
          <Zap size={23} />
        </div>
        <div>
          <h3>
            {status?.ready
              ? 'TrueForge is ready'
              : status?.connected
                ? 'TrueForge connected · add a model'
                : 'Start TrueForge to enable live agents'}
          </h3>
          <p>
            {status?.ready
              ? status.selectedModel
              : 'Source search and approval workflows work locally. Live agent runs require a configured model.'}
          </p>
        </div>
        <a
          href="http://localhost:8790"
          target="_blank"
          rel="noreferrer"
          className="button secondary"
        >
          Open TrueForge <ExternalLink size={14} />
        </a>
      </div>
      <div className="stat-grid">
        <Stat
          icon={Activity}
          label="Live runs completed"
          value={runs.length}
          detail="Actual TrueForge responses"
        />
        <Stat
          icon={Zap}
          label="Tokens reported"
          value={tokens.toLocaleString()}
          detail={runs.length ? 'From available provider metrics' : 'No model usage recorded yet'}
        />
        <Stat
          icon={ShieldCheck}
          label="Reported run cost"
          value={
            costs.length
              ? `$${costs.reduce((n, t) => n + t.metrics.total_cost_in_usd, 0).toFixed(4)}`
              : 'Not reported'
          }
          detail="No estimated or fabricated usage"
        />
      </div>
      <div className="harness-grid">
        <section className="card">
          <div className="section-heading">
            <div>
              <h2>Execution timeline</h2>
              <p>Latest 200 local events · refreshes every 5 seconds</p>
            </div>
            <Badge>{traces.length} events</Badge>
          </div>
          <div className="trace-list">
            {traces.length === 0 ? (
              <div className="empty-state">
                <Activity size={28} />
                <h3>Your first run starts here.</h3>
                <p>Search a source, create a reminder, or run the agent to see its trail.</p>
              </div>
            ) : (
              traces.map((t) => (
                <div className="trace" key={t.id}>
                  <span className={`trace-dot ${t.status}`} />
                  <div>
                    <strong>{t.event}</strong>
                    <p>{t.detail}</p>
                    <small>
                      {new Date(t.at).toLocaleTimeString()} {t.patientId && `· ${t.patientId}`}{' '}
                      {t.latencyMs != null && `· ${t.latencyMs}ms`}
                      {t.sessionId && ` · session ${t.sessionId.slice(0, 8)}`}
                    </small>
                  </div>
                  <Badge
                    tone={
                      t.status === 'error' || t.status === 'blocked'
                        ? 'amber'
                        : t.status === 'ok'
                          ? 'green'
                          : ''
                    }
                  >
                    {t.status}
                  </Badge>
                </div>
              ))
            )}
          </div>
        </section>
        <div className="right-column">
          <section className="card eval-card">
            <div className="section-heading">
              <div>
                <h2>Guardrail checks</h2>
                <p>Deterministic checks · isolated test data</p>
              </div>
              <ShieldCheck size={21} />
            </div>
            {evaluation?.cases?.length ? (
              <>
                <div className="eval-score">
                  {evaluation.cases.filter((c) => c.passed).length}
                  <span> / {evaluation.cases.length} passed</span>
                </div>
                <div className="eval-list">
                  {evaluation.cases.map((c) => (
                    <div key={c.name}>
                      {c.passed ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                      <span>{c.name}</span>
                    </div>
                  ))}
                </div>
                <p className="eval-date">
                  Run {new Date(evaluation.ranAt).toLocaleString()}
                  <br />
                  These checks do not measure medical accuracy or live model quality.
                </p>
              </>
            ) : (
              <p className="eval-date">
                Run <code>npm run eval</code> to generate verified results.
              </p>
            )}
          </section>
          <section className="card controls-card">
            <h2>Runtime boundaries</h2>
            <ul>
              <li>
                <Check size={15} />
                Patient-bound MCP connectors
              </li>
              <li>
                <Check size={15} />
                Human-only approval endpoint
              </li>
              <li>
                <Check size={15} />
                Idempotent reminder execution
              </li>
              <li>
                <Check size={15} />8 agent iterations per turn
              </li>
              <li>
                <Check size={15} />
                90-second live run budget
              </li>
              <li>
                <Check size={15} />8 live requests per minute
              </li>
            </ul>
            <div className="mcp-address">
              <span>LOCAL MCP · NO AUTH</span>
              <code>http://localhost:8000/mcp</code>
            </div>
            <button className="text-button" onClick={onReset}>
              <RefreshCw size={14} />
              Reset synthetic demo
            </button>
          </section>
        </div>
      </div>
    </>
  );
}
