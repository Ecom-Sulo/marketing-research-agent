import type { NodeStatus, ResearchNode, RunStatus, Saturation } from './api';

/**
 * The compartment's five stages and its gate.
 *
 * Stages 2-5 render as `not built` rather than being hidden. The rail is the
 * framework's dependency graph, and showing four fifths of it greyed out is an
 * accurate picture of where this is — hiding them would suggest a finished run
 * had done more than a fifth of the work.
 */

const STAGES = [
  { id: '1', name: 'Raw material', note: 'gather only' },
  { id: '2', name: 'Product truth', note: 'product in isolation' },
  { id: '3', name: 'Market truth', note: 'product vs world' },
  { id: 'gate', name: 'Viability gate', note: 'human decision' },
  { id: '4', name: 'Customer truth', note: 'after the gate only' },
  { id: '5', name: 'Synthesis', note: 'artifacts leave here' },
];

export const NODE_LABELS: Record<ResearchNode, string> = {
  product_data: 'Product data',
  competitors: 'Competitors',
  review_mining: 'Review mining',
  category_data: 'Category data',
};

const NODE_ORDER: ResearchNode[] = [
  'product_data',
  'competitors',
  'review_mining',
  'category_data',
];

function stageOneState(status: RunStatus): { cls: string; label: string } {
  switch (status) {
    case 'queued':
      return { cls: 'active', label: 'starting' };
    case 'running':
      return { cls: 'active', label: 'running' };
    case 'stopping':
      return { cls: 'active', label: 'stopping' };
    case 'completed':
      return { cls: 'done', label: 'complete' };
    case 'invalid':
      return { cls: 'blocked', label: 'packet rejected' };
    case 'failed':
      return { cls: 'blocked', label: 'failed' };
    case 'cancelled':
      return { cls: 'blocked', label: 'cancelled' };
    default:
      return { cls: '', label: 'not started' };
  }
}

export default function StageRail({
  status,
  nodes,
  saturation,
}: {
  status: RunStatus | null;
  nodes: NodeStatus[];
  saturation: Saturation[];
}) {
  const byNode = new Map(nodes.map((n) => [n.node, n]));
  const curves = new Map(saturation.map((s) => [s.node, s]));

  return (
    <div className="rail">
      <h3>Stages</h3>
      {STAGES.map((stage) => {
        const isOne = stage.id === '1';
        const state = isOne && status ? stageOneState(status) : null;
        return (
          <div key={stage.id}>
            <div className={`stage ${state?.cls ?? 'unbuilt'}`}>
              <span className="dot" />
              <div>
                <div className="stage-t">
                  {stage.id !== 'gate' ? `Stage ${stage.id} · ` : ''}
                  {stage.name}
                </div>
                <div className="stage-s">
                  {state ? state.label : isOne ? stage.note : 'not built'}
                </div>
              </div>
            </div>
            {isOne && (
              <div className="node-list">
                {NODE_ORDER.map((node) => {
                  const record = byNode.get(node);
                  const cls = !record
                    ? ''
                    : record.status === 'complete' && record.done_criterion_met
                      ? 'done'
                      : 'partial';
                  return (
                    <div key={node} className={`node ${cls}`} title={record?.why ?? ''}>
                      <span className="node-dot" />
                      <span className="node-name">{NODE_LABELS[node]}</span>
                      <Curve entry={curves.get(node)} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The saturation curve as a sparkline: new themes per additional source.
 *
 * This is the one place "done" is visible as a measurement rather than an
 * assertion. A curve that flattens is a node that stopped yielding; a curve
 * that flattens at source three every time means the threshold is too eager.
 */
function Curve({ entry }: { entry?: Saturation }) {
  if (!entry || entry.curve.length === 0) return <span className="node-why">—</span>;
  const peak = Math.max(1, ...entry.curve.map((p) => p.new_themes));
  return (
    <span className="spark" title={entry.stopped_because}>
      {entry.curve.map((point, index) => (
        <i
          key={index}
          style={{ height: `${Math.max(2, (point.new_themes / peak) * 14)}px` }}
        />
      ))}
    </span>
  );
}
