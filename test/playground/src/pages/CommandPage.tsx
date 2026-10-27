import { useCallback, useEffect, useState } from 'react';
import JSON5 from 'json5';
import { Editor } from '../components/Editor';
import type { CommandExample, PlaygroundConfig, CommandOutcome } from '../shared/commands';

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export function CommandPage({ command, config }: { command: CommandExample; config: PlaygroundConfig }) {
  const storageKey = `dynamo-playground:${config.tableName}:${command.id}`;
  const [preset, setPreset] = useState<'seeded' | 'all'>(() => {
    try {
      return localStorage.getItem(`${storageKey}:preset`) === 'all' ? 'all' : 'seeded';
    } catch {
      return 'seeded';
    }
  });
  const initial = pretty(preset === 'all' ? command.allFieldsInput : command.input);
  const [source, setSource] = useState(() => {
    try {
      return localStorage.getItem(storageKey) ?? initial;
    } catch {
      return initial;
    }
  });
  const [outcome, setOutcome] = useState<CommandOutcome | null>(null);
  const [tab, setTab] = useState<'result' | 'built'>('result');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [executedSource, setExecutedSource] = useState('');
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, source);
      localStorage.setItem(`${storageKey}:preset`, preset);
    } catch {
      /* A draft can stay in memory when storage is unavailable. */
    }
  }, [source, storageKey, preset]);
  function loadPreset(next: 'seeded' | 'all') {
    setPreset(next);
    setSource(pretty(next === 'all' ? command.allFieldsInput : command.input));
    setNotice(next === 'all' ? 'All-fields example loaded.' : 'Seeded-table example loaded.');
  }
  const execute = useCallback(
    async (action: 'build' | 'run') => {
      if (busy) return;
      setBusy(true);
      setNotice('');
      setExecutedSource(source);
      setTab(action === 'build' ? 'built' : 'result');
      try {
        const response = await fetch('/api/playground/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: command.id, source, action }),
        });
        const data = (await response.json()) as CommandOutcome;
        if (!response.ok && !data.error) throw new Error(`Request failed (${response.status}).`);
        setOutcome(data);
        if (data.error && data.builtInput === undefined) setTab('result');
      } catch (error: unknown) {
        setOutcome({
          ok: false,
          phase: 'network',
          error: { message: error instanceof Error ? error.message : String(error) },
        });
        setTab('result');
      } finally {
        setBusy(false);
      }
    },
    [busy, command.id, source]
  );
  const output = tab === 'built' ? outcome?.builtInput : (outcome?.error ?? outcome?.result);
  const outputText = output === undefined ? '' : pretty(output);
  function format() {
    try {
      setSource(pretty(JSON5.parse(source)));
      setNotice('Input formatted.');
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(outputText);
      setNotice('Output copied.');
    } catch {
      setNotice('Clipboard unavailable. Select the output to copy it.');
    }
  }
  return (
    <div className='workspace'>
      <div className='workspace-heading'>
        <div>
          <div className='eyebrow'>{command.group.toUpperCase()} / COMMAND BUILDER</div>
          <h1>
            {command.name}
            <span className={`badge ${command.writes ? 'write' : ''}`}>
              {command.writes ? 'WRITES DATA' : 'READ ONLY'}
            </span>
          </h1>
          <p>{command.description}</p>
        </div>
        <a className='text-link' href='#/'>
          All commands ↗
        </a>
      </div>
      <div className='builder-strip'>
        <span>ƒ</span>
        <code>{command.builder}(input)</code>
        <span className='strip-end'>
          Validate <i>→</i> Build <i>→</i> Execute
        </span>
      </div>
      <div className='example-presets'>
        <div className='preset-options' role='group' aria-label='Input example presets'>
          <span>INPUT EXAMPLE</span>
          <button aria-pressed={preset === 'seeded'} onClick={() => loadPreset('seeded')} disabled={busy}>
            Seeded table
          </button>
          <button aria-pressed={preset === 'all'} onClick={() => loadPreset('all')} disabled={busy}>
            All fields
          </button>
        </div>
        <p>
          {preset === 'all'
            ? command.allFieldsNote
            : 'Expanded example for the seeded table. Choose All fields for schema-dependent options and alternative input modes. Loading a preset replaces the current draft.'}
        </p>
      </div>
      <div className='workbench'>
        <section className='result-pane' aria-label='Command output'>
          <div className='pane-header'>
            <span className='pane-number'>01</span>
            <h2>Output</h2>
            <span className='pane-caption'>The moment of truth</span>
            <button
              className='icon-button'
              onClick={() => void copy()}
              disabled={!outputText}
              title='Copy output'
              aria-label='Copy output'
            >
              ⧉
            </button>
          </div>
          <div className='pane-tabs'>
            <button className={tab === 'result' ? 'active' : ''} onClick={() => setTab('result')}>
              Response {outcome?.error && <span className='error-dot' />}
            </button>
            <button className={tab === 'built' ? 'active' : ''} onClick={() => setTab('built')}>
              Built SDK input
            </button>
            {outcome && (
              <span className={`status-pill ${outcome.ok ? 'success' : 'failure'}`}>
                {outcome.ok ? '✓' : '×'} {outcome.phase}
              </span>
            )}
          </div>
          <div className='output-body' aria-live='polite' aria-busy={busy}>
            {busy ? (
              <div className='empty-state'>
                <div className='loading-symbol'>↻</div>
                <h3>Working on it…</h3>
                <p>Validating your object and building the command.</p>
              </div>
            ) : outputText ? (
              <pre className={outcome?.error && tab === 'result' ? 'error-output' : ''}>
                <code>{outputText}</code>
              </pre>
            ) : (
              <div className='empty-state'>
                <div className='empty-symbol'>{'{ }'}</div>
                <h3>{outcome?.phase === 'built' ? 'Your command is built.' : 'A little input. A little magic.'}</h3>
                <p>
                  {outcome?.phase === 'built'
                    ? 'Open Built SDK input to inspect it, or Run command to call DynamoDB.'
                    : 'Edit the object on the right, then run your command. The response will appear here.'}
                </p>
                <span className='key-hint'>⌘ / Ctrl + Enter to run</span>
              </div>
            )}
          </div>
          <div className='pane-footer'>
            <span className={outcome?.ok ? 'green-text' : ''}>
              {busy
                ? '● Running'
                : outcome
                  ? outcome.ok
                    ? '● Complete'
                    : '● Request failed'
                  : '○ Waiting for a command'}
            </span>
            <span>
              {outcome?.durationMs !== undefined ? `${outcome.durationMs} ms` : '—'}
              {outcome && source !== executedSource ? ' · Input changed' : ''}
            </span>
          </div>
        </section>
        <section className='input-pane' aria-label='Command parameters'>
          <div className='pane-header'>
            <span className='pane-number'>02</span>
            <h2>Input</h2>
            <span className='pane-caption'>Make it your own</span>
            <span className='language-label'>JS OBJECT</span>
          </div>
          <div className='input-toolbar'>
            <code>params.js</code>
            <div>
              <button onClick={format} disabled={busy}>
                Format
              </button>
              <button
                onClick={() => {
                  setSource(initial);
                  setNotice('Example restored.');
                }}
                disabled={busy}
              >
                Reset example
              </button>
            </div>
          </div>
          <Editor value={source} onChange={setSource} onRun={() => void execute('run')} />
          <div className='input-actions'>
            <button className='secondary-button' onClick={() => void execute('build')} disabled={busy}>
              Build only
            </button>
            <button className='primary-button' onClick={() => void execute('run')} disabled={busy}>
              {busy ? 'Running…' : 'Run command'} <span>↗</span>
            </button>
          </div>
        </section>
      </div>
      <div className='workspace-bottom'>
        <p>
          {command.writes
            ? '↗ Run sends a write request to your local table. Changes persist until cleared or re-seeded.'
            : '↙ Run reads from your local table. Build only validates without contacting DynamoDB.'}
        </p>
        <p className='notice' role='status'>
          {notice}
        </p>
      </div>
      <details className='syntax-help'>
        <summary>
          Object syntax & DynamoDB types <span>＋</span>
        </summary>
        <div>
          <p>
            Use JSON or JS object literal syntax: unquoted keys, single quotes, comments, and trailing commas are
            supported. Expressions and function calls are not evaluated.
          </p>
          <code>{"{ tags: { $set: ['local', 'ready'] }, payload: { $binary: 'SGVsbG8=' } }"}</code>
          <p>
            <code>$set</code> creates a native string or number Set. <code>$binary</code> creates binary bytes from
            base64. These tags also appear in the response. For Scan or Query pagination, copy{' '}
            <code>LastEvaluatedKey</code> into <code>exclusiveStartKey</code>. Batch responses may include unprocessed
            items or keys; rerun those explicitly.
          </p>
        </div>
      </details>
    </div>
  );
}
