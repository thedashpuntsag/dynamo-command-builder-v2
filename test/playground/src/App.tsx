import { useCallback, useEffect, useState } from 'react';
import type { PlaygroundConfig } from './shared/commands';
import { useRoute } from './hooks/useRoute';
import { groups, icons } from './lib/commands';
import { WelcomePage } from './pages/WelcomePage';
import { CommandPage } from './pages/CommandPage';

export function App() {
  const route = useRoute();
  const [config, setConfig] = useState<PlaygroundConfig | null>(null);
  const [error, setError] = useState('');
  const [health, setHealth] = useState<'checking' | 'connected' | 'offline'>('checking');
  const [healthMessage, setHealthMessage] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const checkHealth = useCallback(async () => {
    setHealth('checking');
    try {
      const response = await fetch('/api/playground/health');
      const data = (await response.json()) as { error?: { message: string } };
      if (!response.ok) throw new Error(data.error?.message ?? 'Local table unavailable.');
      setHealth('connected');
      setHealthMessage('Seeded table is available.');
    } catch (cause: unknown) {
      setHealth('offline');
      setHealthMessage(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);
  useEffect(() => {
    void fetch('/api/playground/config')
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load playground configuration.');
        setConfig((await response.json()) as PlaygroundConfig);
        void checkHealth();
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [checkHealth]);
  useEffect(() => setMenuOpen(false), [route]);
  const selected = config?.commands.find((command) => route === `/command/${command.id}`);
  return (
    <div className='app-shell'>
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <a href='#/' className='brand'>
          <span className='brand-mark'>
            d<span>↗</span>
          </span>
          <span>
            Dynamo Craft<small>THE LOCAL PLAYGROUND</small>
          </span>
        </a>
        <div className='sidebar-rule' />
        <nav aria-label='Commands'>
          <a href='#/' className={`overview-link ${route === '/' ? 'selected' : ''}`}>
            <span>⌂</span> Welcome
          </a>
          {groups.map((group) => (
            <div className='nav-group' key={group}>
              <h2>
                {group}
                <span>{config?.commands.filter((command) => command.group === group).length ?? '—'}</span>
              </h2>
              {config?.commands
                .filter((command) => command.group === group)
                .map((command) => (
                  <a
                    key={command.id}
                    className={selected?.id === command.id ? 'selected' : ''}
                    href={`#/command/${command.id}`}
                  >
                    <span>{icons[command.id]}</span>
                    {command.name}
                    {selected?.id === command.id && <i>●</i>}
                  </a>
                ))}
            </div>
          ))}
        </nav>
        <div className='sidebar-bottom'>
          <span className='local-label'>LOCAL DEVELOPMENT</span>
          <p>No cloud. Just your code.</p>
          <code>v0.0.0 · SDK v3</code>
        </div>
      </aside>
      <main>
        <header className='topbar'>
          <button
            className='menu-toggle'
            aria-label='Toggle navigation'
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            ☰
          </button>
          <div className='breadcrumbs'>
            Playground <span>/</span> <b>{selected?.name ?? 'Welcome'}</b>
          </div>
          <div className='connection'>
            <span className={`connection-dot ${health}`} />
            <span>
              {health === 'connected' ? 'DynamoDB Local' : health === 'checking' ? 'Connecting…' : 'Database offline'}
            </span>
            <button onClick={() => void checkHealth()} aria-label='Refresh database connection' title={healthMessage}>
              ↻
            </button>
          </div>
        </header>
        {config && (
          <div className='environment-bar'>
            <span>
              ▱ <code>{config.tableName}</code>
            </span>
            <code>{config.endpoint}</code>
            <span className='environment-tag'>LOCAL</span>
          </div>
        )}
        {health === 'offline' && config && (
          <div className='connection-warning'>
            <b>Local table unavailable.</b> Run <code>vp run local:dynamo:start</code>, then{' '}
            <code>vp run local:dynamo:seed</code>.{' '}
            <button onClick={() => void checkHealth()}>Retry connection ↻</button>
            <details>
              <summary>Connection details</summary>
              {healthMessage}
            </details>
          </div>
        )}
        {error ? (
          <div className='app-error' role='alert'>
            <h1>Couldn’t load the playground.</h1>
            <p>{error}</p>
            <button className='primary-button' onClick={() => window.location.reload()}>
              Try again
            </button>
          </div>
        ) : !config ? (
          <div className='app-error'>Loading your workbench…</div>
        ) : selected ? (
          <CommandPage key={selected.id} command={selected} config={config} />
        ) : route === '/' ? (
          <WelcomePage config={config} />
        ) : (
          <div className='app-error'>
            <h1>Command not found.</h1>
            <a href='#/'>Back to all commands ↗</a>
          </div>
        )}
        <footer className='app-footer'>
          <span>Built for the curious developer.</span>
          <span>
            Object in. Understanding out. <span className='green-text'>✳</span>
          </span>
        </footer>
      </main>
    </div>
  );
}
