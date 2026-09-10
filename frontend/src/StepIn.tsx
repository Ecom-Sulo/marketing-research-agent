import { useState } from 'react';

/**
 * Correct the research strategy.
 *
 * A judgement is stored whether or not the run is still live: a correction the
 * human made is worth keeping even if the run it was aimed at has just ended.
 * When the run *is* live it also goes upstream as a steer, so the agent does
 * not have to be told twice.
 */

interface Preset {
  id: string;
  kind: string;
  title: string;
  detail: string;
  rejects: string[];
}

const PRESETS: Preset[] = [
  {
    id: 'listicle',
    kind: 'source_rule',
    title: 'Reject SEO listicles and review-roundup sites',
    detail: 'Marketing content dressed as review data.',
    rejects: ['seo_listicle', 'review_roundup'],
  },
  {
    id: 'competitor-marketing',
    kind: 'source_rule',
    title: "Reject competitors' own marketing as evidence",
    detail: 'Evidence of what they claim, never of what is true.',
    rejects: ['competitor_marketing'],
  },
  {
    id: 'three-star',
    kind: 'weighting',
    title: 'Weight 3★ reviews above 5★ and 1★',
    detail: 'The most honest text in commerce. Prioritise them when mining.',
    rejects: [],
  },
  {
    id: 'verbatim',
    kind: 'language_rule',
    title: 'Never paraphrase customer language',
    detail: '“I wake up at 3am” is usable; “sleep maintenance issues” is not.',
    rejects: [],
  },
];

export default function StepIn({
  live,
  onSave,
  onClose,
}: {
  live: boolean;
  onSave: (body: { kind: string; text: string; rejects_kinds: string[] }) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string>(PRESETS[0].id);
  const [custom, setCustom] = useState('');

  function save() {
    if (selected === 'custom') {
      if (!custom.trim()) return;
      onSave({ kind: 'custom', text: custom.trim(), rejects_kinds: [] });
      return;
    }
    const preset = PRESETS.find((p) => p.id === selected)!;
    onSave({ kind: preset.kind, text: preset.title, rejects_kinds: preset.rejects });
  }

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Step in</h2>
        <p className="lede">
          Stored as a standing judgement and applied to every future run.
          {live
            ? ' The run is live, so it is also injected now without restarting it.'
            : ' This run has finished, so it applies from the next one.'}
        </p>

        {PRESETS.map((preset) => (
          <label
            key={preset.id}
            className={`opt ${selected === preset.id ? 'sel' : ''}`}
            onClick={() => setSelected(preset.id)}
          >
            <input
              type="radio"
              name="judgement"
              checked={selected === preset.id}
              onChange={() => setSelected(preset.id)}
            />
            <div>
              <div className="t">{preset.title}</div>
              <div className="d">{preset.detail}</div>
              {preset.rejects.length > 0 && (
                <div className="d mech">
                  Applied mechanically: {preset.rejects.join(', ')} become ineligible
                  for admission, so it does not depend on the agent remembering.
                </div>
              )}
            </div>
          </label>
        ))}

        <label
          className={`opt ${selected === 'custom' ? 'sel' : ''}`}
          onClick={() => setSelected('custom')}
        >
          <input
            type="radio"
            name="judgement"
            checked={selected === 'custom'}
            onChange={() => setSelected('custom')}
          />
          <div style={{ flex: 1 }}>
            <div className="t">Something else</div>
            <textarea
              value={custom}
              placeholder="e.g. Ignore the UK market entirely — we can't ship there."
              onChange={(e) => setCustom(e.target.value)}
              onFocus={() => setSelected('custom')}
            />
          </div>
        </label>

        <div className="row">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={save}>
            {live ? 'Save & steer' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
