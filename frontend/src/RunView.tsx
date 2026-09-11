import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  streamRunEvents,
  TERMINAL_STATUSES,
  type Judgement,
  type RunDetail,
  type RunEvent,
  type RunSummary,
  type Source,
} from './api';
import StageRail, { NODE_LABELS } from './StageRail';
import { ChatText } from './FileBox';

/** Live fetch lanes, derived from tool events.
 *
 *  Worth being honest about: `tool.started` carries the primary argument
 *  truncated for display, and `web_extract` takes a list and previews only its
 *  first element. Lanes are a liveness indicator, never a count — the packet is
 *  the record of what was actually collected. The bar is indeterminate for the
 *  same reason: a tool call reports no progress, only start and end.
 */
interface Lane {
  key: string;
  tool: string;
  kind: string;
  preview: string;
  state: 'running' | 'done' | 'error';
}

const AWARENESS = ['Unaware', 'Problem', 'Solution', 'Product', 'Most'];

export default function RunView({
  runId,
  runs,
  judgementsRev,
  onSelectRun,
  onChanged,
}: {
  runId: string;
  runs: RunSummary[];
  judgementsRev: number;
  onSelectRun: (id: string) => void;
  onChanged: () => void;
}) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [judgements, setJudgements] = useState<Judgement[]>([]);
  const [error, setError] = useState('');
  const traceRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    try {
      const [detail, { data }] = await Promise.all([api.run(runId), api.judgements()]);
      setRun(detail);
      setJudgements(data);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [runId]);

  useEffect(() => {
    setRun(null);
    setEvents([]);
    setLanes([]);
    void reload();
  }, [runId, reload]);

  // A judgement saved from the header applies to this run; refresh the list.
  useEffect(() => {
    api.judgements().then(({ data }) => setJudgements(data)).catch(() => undefined);
  }, [judgementsRev]);

  // Follow the run. The backend replays from `after=0` before going live, so a
  // refresh or a second tab both get the whole run rather than the tail of it.
  useEffect(() => {
    const stop = streamRunEvents(runId, 0, {
      onEvent: (event) => {
        setEvents((current) => [...current, event]);
        applyToLanes(event, setLanes);
        if (event.kind.startsWith('run.') || event.kind.startsWith('packet.')) {
          void reload();
          onChanged();
        }
      },
      onEnd: () => void reload(),
      onError: (message) => setError(message),
    });
    return () => stop();
  }, [runId, reload, onChanged]);

  useEffect(() => {
    traceRef.current?.scrollTo({ top: traceRef.current.scrollHeight });
  }, [events.length]);

  const packet = run?.packet ?? null;
  const live = !!run && !TERMINAL_STATUSES.has(run.status);
  const sources = packet?.sources ?? [];
  const admitted = useMemo(() => sources.filter((s) => s.admitted), [sources]);
  const rejected = useMemo(() => sources.filter((s) => !s.admitted), [sources]);
  const unarchived = useMemo(
    () => admitted.filter((s) => !s.archived).length,
    [admitted],
  );

  const lastTool = useMemo(
    () => [...events].reverse().find((e) => e.kind === 'tool.started'),
    [events],
  );

  // The deltas are chunks of one message; merge consecutive ones so fenced
  // blocks that straddle several events still render as one box.
  const traceRows = useMemo(() => groupEvents(events), [events]);

  if (!run) return <div className="empty">Loading run…</div>;

  const now = nowPanel(run, live, lastTool);

  return (
    <div className="cols">
      <div className="rail-col">
        <StageRail
          status={run.status}
          nodes={packet?.nodes ?? []}
          saturation={packet?.saturation ?? []}
        />

        <h3 style={{ marginTop: 18 }}>Run</h3>
        <div className="runmeta">
          <div>
            Harness <span>pi-agent-core</span>
          </div>
          <div>
            {/* Every run names its model now. The fallback is only ever hit by a
                row written when a gateway default still existed. */}
            Model <span>{run.model || 'unrecorded'}</span>
          </div>
          <div>
            Skill <span>research-compartment v1.0</span>
          </div>
          <div>
            Started <span>{new Date(run.created_at).toLocaleString()}</span>
          </div>
          <div>
            Tokens{' '}
            <span>
              {run.usage?.total_tokens
                ? `${(run.usage.total_tokens / 1000).toFixed(0)}k`
                : '—'}
            </span>
          </div>
        </div>

        <h3 style={{ marginTop: 18 }}>Runs</h3>
        <div className="runlist">
          {runs.map((r) => (
            <div
              key={r.id}
              className={`runrow ${r.id === runId ? 'active' : ''}`}
              onClick={() => onSelectRun(r.id)}
            >
              <div className="runrow-top">
                <span className="runrow-title">{r.brief.product}</span>
                <span className={`status ${r.status}`}>{r.status}</span>
              </div>
              <div className="runrow-sub">
                {r.counts.sources} sources · {r.counts.excerpts} excerpts ·{' '}
                {r.counts.gaps} gaps
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mid">
        {error && <div className="error">{error}</div>}
        {run.status === 'invalid' && (
          <div className="error">
            <b>Packet rejected.</b> {run.error}
            <div className="error-note">
              The agent finished and what it produced broke the stage-1 contract.
              That is a more useful failure than a crash — the raw output is below.
            </div>
          </div>
        )}
        {run.status === 'failed' && <div className="error">{run.error}</div>}

        <section>
          <h3>
            Now <span className="n">{live ? 'live' : 'finished'}</span>
          </h3>
          <div className="now">
            <span className={`pulse ${live ? '' : 'off'}`} />
            <div className="txt">
              <b>{now.title}</b>
              <div className="sub">{now.sub}</div>
            </div>
          </div>
        </section>

        <section>
          <h3>
            Crawling <span className="n">{live ? 'live' : `${lanes.length} calls`}</span>
          </h3>
          <div className="lanes">
            {lanes.length === 0 && <p className="muted">No activity yet.</p>}
            {lanes.slice(-8).map((lane) => (
              <div key={lane.key} className={`lane ${lane.state}`}>
                <span className="st">
                  {lane.state === 'running'
                    ? lane.kind === 'search'
                      ? 'SEARCH'
                      : lane.kind === 'corpus'
                        ? 'WRITE'
                        : 'FETCH'
                    : lane.state === 'error'
                      ? 'ERROR'
                      : 'DONE'}
                </span>
                <div className="lane-body">
                  <div className="url">{lane.preview || lane.tool}</div>
                  {lane.state === 'running' && (
                    <div className="bar">
                      <i />
                    </div>
                  )}
                </div>
                <span className="kind">{lane.tool}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3>
            Reasoning trace <span className="n">{events.length} events</span>
          </h3>
          <div className="trace" ref={traceRef}>
            {events.length === 0 && <p className="muted">Nothing yet.</p>}
            {traceRows.map((row) =>
              row.message ? (
                <div key={row.id} className="chatmsg">
                  <span className="tag">
                    {new Date(row.events[0].created_at).toLocaleTimeString()}
                  </span>
                  <ChatText
                    text={row.events
                      .map((e) => String((e.payload as { delta?: string }).delta ?? ''))
                      .join('')}
                  />
                </div>
              ) : (
                <p key={row.id} className={row.cls}>
                  <span className="tag">
                    {new Date(row.events[0].created_at).toLocaleTimeString()}
                  </span>
                  {traceText(row.events[0])}
                </p>
              ),
            )}
          </div>
        </section>

        {packet && (
          <section>
            <h3>
              Sources{' '}
              <span className="n">
                {admitted.length} admitted · {rejected.length} rejected
              </span>
            </h3>
            <div className="src-list">
              {sources.map((source) => (
                <SourceRow key={source.id} runId={runId} source={source} />
              ))}
            </div>
          </section>
        )}

        {packet && packet.attributes.length > 0 && (
          <section>
            <h3>
              Attributes <span className="n">read off a page, not worked out</span>
            </h3>
            <div className="kv">
              {packet.attributes.map((attribute) => (
                <div key={attribute.id} className="kv-row">
                  <span className="k">{attribute.key}</span>
                  <span className="v">{attribute.value}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {packet && packet.measurements.length > 0 && (
          <section>
            <h3>
              Measurements <span className="n">numbers a source states</span>
            </h3>
            <div className="kv">
              {packet.measurements.map((measurement) => (
                <div key={measurement.id} className="kv-row">
                  <span className="k">{measurement.metric}</span>
                  <span className="v">
                    {measurement.value} {measurement.unit}
                    {measurement.period ? ` · ${measurement.period}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {run.status === 'invalid' && (
          <section>
            <h3>Raw output</h3>
            <div className="trace">
              <ChatText text={run.output} />
            </div>
          </section>
        )}
      </div>

      <div className="right">
        <div className="cards">
          <Card label="Sources" value={run.counts.sources} />
          <Card label="Excerpts" value={run.counts.excerpts} />
          <Card label="Measurements" value={run.counts.measurements} />
          <Card label="Gaps" value={run.counts.gaps} tone="gap" />
        </div>

        {unarchived > 0 && (
          <div className="warn">
            {unarchived} admitted source{unarchived === 1 ? '' : 's'} not archived —
            those spans cannot be checked against the page they came from.
          </div>
        )}

        <section>
          <h3>
            Angle map <span className="n">avatar × awareness</span>
          </h3>
          <div className="grid">
            <div />
            {AWARENESS.map((a) => (
              <div key={a} className="gh">
                {a}
              </div>
            ))}
            {[0, 1, 2, 3].map((row) => (
              <Fragment key={row}>
                <div className="rh">—</div>
                {AWARENESS.map((_, col) => (
                  <div key={col} className="cell no" />
                ))}
              </Fragment>
            ))}
          </div>
          <div className="legend">
            <span>
              <i className="sw" style={{ background: 'rgba(74,222,128,.5)' }} />
              evidenced
            </span>
            <span>
              <i className="sw" style={{ background: 'rgba(192,132,252,.5)' }} />
              inferred
            </span>
            <span>
              <i className="sw" style={{ background: '#1b2130' }} />
              empty
            </span>
          </div>
          <p className="muted">
            Stage-4 output, rendered empty here for the same reason the rail
            shows stages 2–5 greyed out: an accurate picture of where this is.
          </p>
        </section>

        <section>
          <h3>
            Voice of customer <span className="n">verbatim, never paraphrased</span>
          </h3>
          {(packet?.excerpts ?? []).length === 0 && <p className="muted">Nothing yet.</p>}
          {(packet?.excerpts ?? []).slice(0, 25).map((excerpt) => (
            <div key={excerpt.id} className="item">
              <div className="q">
                “{excerpt.text}”
                {excerpt.star_rating != null && (
                  <span className="pill star">{excerpt.star_rating}★</span>
                )}
              </div>
              <div className="src">
                {NODE_LABELS[excerpt.node]}
                {excerpt.axis ? ` · ${excerpt.axis.replace('why_', 'why ')}` : ''}
                {excerpt.posted_at ? ` · ${excerpt.posted_at}` : ''}
              </div>
            </div>
          ))}
        </section>

        <section>
          <h3>
            Gaps <span className="n">{run.counts.gaps}</span>
          </h3>
          {(packet?.gaps ?? []).length === 0 && (
            <p className="muted">
              Nothing yet. An empty gap list on a finished run means the run
              stopped looking, and the packet is rejected for it.
            </p>
          )}
          {(packet?.gaps ?? []).map((gap, index) => (
            <div key={index} className="item">
              <div className="q">{gap.missing}</div>
              <div className="src">
                {NODE_LABELS[gap.node]}
                {gap.would_need ? ` · needs: ${gap.would_need}` : ''}
              </div>
            </div>
          ))}
        </section>

        <section>
          <h3>
            Standing judgements <span className="n">{judgements.length}</span>
          </h3>
          {judgements.length === 0 && (
            <p className="muted">None yet. “Step in” to correct the agent.</p>
          )}
          {judgements.map((judgement) => (
            <div key={judgement.id} className="judge">
              <div className="w">{judgement.kind.replace('_', ' ')}</div>
              <div>{judgement.text}</div>
              <div className="used">
                applied {judgement.applied_count} time
                {judgement.applied_count === 1 ? '' : 's'}
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

/** The "Now" panel: one glance, what is the run doing. */
function nowPanel(
  run: RunDetail,
  live: boolean,
  lastTool: RunEvent | undefined,
): { title: string; sub: string } {
  if (!live) {
    switch (run.status) {
      case 'completed':
        return {
          title: 'Run complete',
          sub: `packet accepted — ${run.counts.sources} sources, ${run.counts.excerpts} excerpts, ${run.counts.gaps} gaps`,
        };
      case 'invalid':
        return { title: 'Packet rejected', sub: run.error };
      case 'failed':
        return { title: 'Run failed', sub: run.error };
      case 'cancelled':
        return { title: 'Run stopped', sub: 'cancelled before the packet was written' };
      default:
        return { title: run.status, sub: '' };
    }
  }
  if (lastTool) {
    const p = lastTool.payload as Record<string, string>;
    return {
      title: `Stage 1 · ${p.tool ?? 'working'}`,
      sub: p.preview ?? '',
    };
  }
  return {
    title: 'Stage 1 · Raw material',
    sub: 'gathering only — no conclusions drawn here',
  };
}

function Card({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`card ${tone ?? ''}`}>
      <div className="v">{value}</div>
      <div className="l">{label}</div>
    </div>
  );
}

function SourceRow({ runId, source }: { runId: string; source: Source }) {
  const body = source.archived ? api.sourceUrl(runId, source.id) : null;
  return (
    <div className={`src-row ${source.admitted ? '' : 'rejected'}`}>
      <span className="st">{source.admitted ? 'ADMITTED' : 'SKIPPED'}</span>
      <span className="url" title={source.admission_reason || source.url}>
        {source.url}
      </span>
      <span className="kind">
        {source.kind}
        {source.marketing ? ' · marketing' : ''}
      </span>
      {body ? (
        <a className="archived" href={body} target="_blank" rel="noreferrer">
          body
        </a>
      ) : (
        <span className="archived off" title="not archived">
          —
        </span>
      )}
    </div>
  );
}

function applyToLanes(
  event: RunEvent,
  setLanes: (fn: (current: Lane[]) => Lane[]) => void,
) {
  const payload = event.payload as Record<string, string | boolean>;
  if (event.kind === 'tool.started') {
    setLanes((current) => [
      ...current,
      {
        key: `${event.id}`,
        tool: String(payload.tool ?? ''),
        kind: String(payload.lane ?? 'other'),
        preview: String(payload.preview ?? ''),
        state: 'running',
      },
    ]);
  } else if (event.kind === 'tool.completed') {
    // No correlation id upstream, so settle the newest running lane for that
    // tool. Wrong only when the same tool has two calls genuinely in flight,
    // and it costs a misplaced tick rather than a wrong number.
    setLanes((current) => {
      const reversed = [...current]
        .reverse()
        .findIndex((l) => l.tool === payload.tool && l.state === 'running');
      if (reversed === -1) return current;
      const at = current.length - 1 - reversed;
      const next = [...current];
      next[at] = { ...next[at], state: payload.error ? 'error' : 'done' };
      return next;
    });
  }
}

function traceClass(kind: string): string {
  if (kind === 'run.steered') return 'rule';
  if (kind === 'packet.invalid' || kind === 'run.failed') return 'bad';
  return '';
}

interface TraceRow {
  /** First event id of the row — events are unique, so the key survives grouping. */
  id: number;
  message: boolean;
  cls: string;
  events: RunEvent[];
}

/** One rendered row per event, except chat: consecutive `message.delta` chunks
 *  are one message, and fences that span chunks need the whole of it. */
function groupEvents(events: RunEvent[]): TraceRow[] {
  const rows: TraceRow[] = [];
  for (const event of events) {
    const isMessage = event.kind === 'message.delta';
    const last = rows[rows.length - 1];
    if (isMessage && last?.message) {
      last.events.push(event);
    } else {
      rows.push({
        id: event.id,
        message: isMessage,
        cls: traceClass(event.kind),
        events: [event],
      });
    }
  }
  return rows;
}

function traceText(event: RunEvent): string {
  const p = event.payload as Record<string, unknown>;
  switch (event.kind) {
    case 'run.started':
      return 'run admitted — stage 1, gather only';
    case 'tool.started':
      return `${p.tool}: ${p.preview ?? ''}`;
    case 'tool.completed':
      return `${p.tool} ${p.error ? 'failed' : 'done'}${
        p.duration ? ` in ${p.duration}s` : ''
      }`;
    case 'reasoning.available':
      return String(p.text ?? '');
    case 'run.steered':
      return `judgement applied mid-run — ${p.text ?? ''}`;
    case 'packet.ready':
      return `packet accepted — ${p.sources} sources, ${p.excerpts} excerpts, ${p.gaps} gaps`;
    case 'packet.invalid':
      return `packet rejected — ${p.error ?? ''}`;
    case 'run.failed':
      return `run failed — ${p.error ?? ''}`;
    default:
      return event.kind;
  }
}
