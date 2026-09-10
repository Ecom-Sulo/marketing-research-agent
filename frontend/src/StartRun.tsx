import { useState } from 'react';
import { api, type Config, type RunSummary } from './api';

/** Start a stage-1 run.
 *
 *  The brief is a product and a market — deliberately no URL field. Finding
 *  the product's own site, its reviews, its competitors and its ad-library
 *  entries is the agent's job (SearXNG to find, Firecrawl to fetch); a human
 *  pasting in a URL only anchors the run to one page.
 */
export default function StartRun({
  config,
  onStarted,
  onFailed,
  onClose,
}: {
  config: Config | null;
  onStarted: (run: RunSummary) => Promise<void>;
  onFailed: () => Promise<void>;
  onClose: () => void;
}) {
  const [product, setProduct] = useState('');
  const [market, setMarket] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!product.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const run = await api.startRun({
        product: product.trim(),
        market: market.trim(),
      });
      await onStarted(run);
    } catch (e) {
      setError((e as Error).message);
      // The run row exists and is marked failed — surface it rather than
      // losing the attempt.
      await onFailed();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scrim" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2>Start run</h2>
        <p className="lede">
          Stage 1 gathers raw material on a product. Name it and pick the
          market — the agent finds the URLs itself, by search and page fetch.
        </p>
        <input
          autoFocus
          placeholder="Product (e.g. MagnaCalm glycinate 400mg)"
          value={product}
          onChange={(e) => setProduct(e.target.value)}
        />
        <input
          placeholder="Market (e.g. UK)"
          value={market}
          onChange={(e) => setMarket(e.target.value)}
        />
        {config && !config.corpus_mounted && (
          <p className="warn small">
            Corpus volume {config.corpus_path} is not mounted. Runs still work,
            but nothing is archived and every source becomes a gap.
          </p>
        )}
        {error && <p className="error small">{error}</p>}
        <div className="row">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={!product.trim() || busy}>
            {busy ? 'Starting…' : 'Start run'}
          </button>
        </div>
      </form>
    </div>
  );
}
