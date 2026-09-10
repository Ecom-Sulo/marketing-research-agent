import { useCallback, useEffect, useState } from 'react';
import {
  api,
  TERMINAL_STATUSES,
  type Config,
  type RunSummary,
} from './api';
import Login from './Login';
import RunView from './RunView';
import StartRun from './StartRun';
import StepIn from './StepIn';

/** The cockpit shell: a header bar over the three-column run view.
 *
 *  The header is the demo's (`cockpit-demo/`) — subject chip, run clock, the
 *  two buttons that matter. Everything a run needs is asked for in the Start
 *  run modal: a product and a market, nothing else. Finding the URLs is the
 *  agent's job, not the operator's.
 */
export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [stepInOpen, setStepInOpen] = useState(false);
  const [error, setError] = useState('');
  // Bumped when a judgement is saved at this level so RunView reloads them.
  const [judgementsRev, setJudgementsRev] = useState(0);

  useEffect(() => {
    api
      .session()
      .then((s) => setAuthed(s.authenticated))
      .catch(() => setAuthed(false));
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const { data } = await api.runs();
      setRuns(data);
      setActiveId((current) => current ?? data[0]?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!authed) return;
    void loadRuns();
    api.config().then(setConfig).catch(() => undefined);
  }, [authed, loadRuns]);

  const activeRun = runs.find((r) => r.id === activeId) ?? null;
  const live = !!activeRun && !TERMINAL_STATUSES.has(activeRun.status);
  const clock = useClock(activeRun);

  async function stopRun() {
    if (!activeRun) return;
    try {
      await api.stopRun(activeRun.id);
      await loadRuns();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveJudgement(body: {
    kind: string;
    text: string;
    rejects_kinds: string[];
  }) {
    setStepInOpen(false);
    try {
      if (live && activeRun) await api.steer(activeRun.id, body);
      else await api.addJudgement(body);
      setJudgementsRev((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (authed === null) return <div className="boot">Loading…</div>;
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;

  return (
    <div className="app">
      <header>
        <span className="brand">research cockpit</span>
        <span className="brand-sub">stage 1 · raw material</span>
        <div className="subject">
          {activeRun && (
            <>
              <span className="chip">
                {activeRun.brief.product}
                {activeRun.brief.market ? ` — ${activeRun.brief.market}` : ''}
              </span>
              <span className="chip">{clock}</span>
              <span className={`status ${activeRun.status}`}>
                {activeRun.status}
              </span>
            </>
          )}
          <button
            className="ghost"
            disabled={!activeRun}
            onClick={() => setStepInOpen(true)}
          >
            Step in
          </button>
          {live && (
            <button className="ghost" onClick={stopRun}>
              Stop
            </button>
          )}
          <button className="primary" onClick={() => setStartOpen(true)}>
            Start run
          </button>
          <button
            className="ghost"
            title="Sign out"
            onClick={async () => {
              await api.logout();
              setAuthed(false);
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {error && (
        <div className="error banner" onClick={() => setError('')}>
          {error}
        </div>
      )}

      {activeId ? (
        <RunView
          runId={activeId}
          runs={runs}
          judgementsRev={judgementsRev}
          onSelectRun={setActiveId}
          onChanged={loadRuns}
        />
      ) : (
        <div className="empty intro">
          <h2>Stage 1 — raw material</h2>
          <p>
            Four nodes: product data, competitors, review mining, category
            data. Their job is to put material in a box — not to read it,
            weigh it, or notice patterns in it.
          </p>
          <p>
            The output schema has no field a conclusion could be written into.
            An agent that wants to conclude something here has nowhere to put
            it, which is a stronger guarantee than a prompt asking it not to.
          </p>
          <p className="muted">
            Press <b>Start run</b>. A product name and a market is the whole
            brief — finding the URLs is the agent's job.
          </p>
        </div>
      )}

      {startOpen && (
        <StartRun
          config={config}
          onClose={() => setStartOpen(false)}
          onStarted={async (run) => {
            setStartOpen(false);
            await loadRuns();
            setActiveId(run.id);
          }}
          onFailed={loadRuns}
        />
      )}
      {stepInOpen && activeRun && (
        <StepIn
          live={live}
          onSave={saveJudgement}
          onClose={() => setStepInOpen(false)}
        />
      )}
    </div>
  );
}

/** Elapsed run time, ticking once a second while the run is live. */
function useClock(run: RunSummary | null): string {
  const live = !!run && !TERMINAL_STATUSES.has(run.status);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const iv = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, [live]);
  if (!run) return '';
  const start = new Date(run.created_at).getTime();
  const end = run.ended_at ? new Date(run.ended_at).getTime() : Date.now();
  const s = Math.max(0, Math.floor((end - start) / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
