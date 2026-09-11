import { useState } from 'react';

/** Chat text from the agent, with generated files lifted into their own boxes.
 *
 *  The stage-1 packet reaches the cockpit as a fenced ```json block inside the
 *  agent's chat output (spec-stage-1.md §6). Prose and code deserve different
 *  rendering — a box with a type label and a copy button for markdown/JSON,
 *  plain text for the rest. Detection is deliberately narrow: fenced blocks of
 *  any language, and whole-message JSON. Anything looser catches stray braces
 *  in ordinary prose, which costs more than it saves.
 */

export interface ChatSegment {
  /** Fence language, normalised lower-case; `null` marks a plain-text segment. */
  lang: string | null;
  text: string;
}

const FENCE = /```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g;

export function splitChat(text: string): ChatSegment[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (looksLikeJson(trimmed)) return [{ lang: 'json', text: trimmed }];

  const segments: ChatSegment[] = [];
  let at = 0;
  for (const match of trimmed.matchAll(FENCE)) {
    const before = trimmed.slice(at, match.index).trim();
    if (before) segments.push({ lang: null, text: before });
    const body = (match[2] ?? '').trim();
    if (body) {
      const lang = (match[1] ?? '').trim().toLowerCase();
      segments.push({ lang: lang || 'text', text: body });
    }
    at = (match.index ?? 0) + match[0].length;
  }
  const after = trimmed.slice(at).trim();
  if (after) segments.push({ lang: null, text: after });
  return segments.length ? segments : [{ lang: null, text: trimmed }];
}

function looksLikeJson(text: string): boolean {
  if (!text.startsWith('{') && !text.startsWith('[')) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** The boxed segments — md, json, anything else fenced — with copy on top. */
export function ChatText({ text }: { text: string }) {
  return (
    <>
      {splitChat(text).map((segment, index) =>
        segment.lang === null ? (
          <p key={index} className="chat-txt">
            {segment.text}
          </p>
        ) : (
          <FileBox key={index} text={segment.text} lang={segment.lang} />
        ),
      )}
    </>
  );
}

/** One generated block of text: labelled, scrollable, copyable to clipboard. */
export default function FileBox({ text, lang }: { text: string; lang: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    const ok = await copyToClipboard(text);
    setState(ok ? 'copied' : 'failed');
    setTimeout(() => setState('idle'), 1500);
  }

  return (
    <div className="filebox">
      <div className="filebox-head">
        <span className="filebox-lang">{lang}</span>
        <button type="button" className="filebox-copy" onClick={() => void copy()}>
          {state === 'copied' ? 'copied' : state === 'failed' ? 'copy failed' : 'copy'}
        </button>
      </div>
      <pre className="filebox-body">{text}</pre>
    </div>
  );
}

/** Clipboard API first; it needs a secure context, so keep the textarea route.
 *  `execCommand` is deprecated but still the only fallback that exists. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the long way around */
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  return ok;
}
