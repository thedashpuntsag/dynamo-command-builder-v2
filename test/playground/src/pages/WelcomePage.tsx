import type { PlaygroundConfig } from '../shared/commands';
import { icons } from '../lib/commands';

export function WelcomePage({ config }: { config: PlaygroundConfig }) {
  return (
    <div className='welcome'>
      <div className='eyebrow'>
        <span className='tiny-square' /> YOUR LOCAL DYNAMODB WORKBENCH
      </div>
      <div className='welcome-heading'>
        <div>
          <h1>
            Less guessing.
            <br />
            <span>More building.</span>
          </h1>
          <p>
            One place to explore every command builder.
            <br />
            Edit an object, inspect the input, and run it against your local database.
          </p>
        </div>
        <div className='hero-mark' aria-hidden='true'>
          <span>{'{'}</span>
          <div>
            input
            <br />
            <b>↓</b>
            <br />
            output
          </div>
          <span>{'}'}</span>
        </div>
      </div>
      <div className='flow'>
        <span>
          <b>01</b> Pick a command
        </span>
        <i>→</i>
        <span>
          <b>02</b> Make it yours
        </span>
        <i>→</i>
        <span>
          <b>03</b> See what happens
        </span>
        <a href='#/command/get'>
          Start with Get <span>↗</span>
        </a>
      </div>
      <div className='section-heading'>
        <h2>
          The command collection <span>10</span>
        </h2>
        <p>Real builders. Real local results.</p>
      </div>
      <div className='command-grid'>
        {config.commands.map((command) => (
          <a className='command-card' key={command.id} href={`#/command/${command.id}`}>
            <div className='card-top'>
              <span className='command-icon'>{icons[command.id]}</span>
              <span className={`badge ${command.writes ? 'write' : ''}`}>{command.writes ? 'WRITE' : 'READ'}</span>
            </div>
            <h3>
              {command.name}
              <span>↗</span>
            </h3>
            <p>{command.description}</p>
            <code>{command.builder.replace('buildValidated', '')}()</code>
          </a>
        ))}
      </div>
      <div className='welcome-note'>
        <span>✳</span>
        <p>
          <b>A small database. A lot to explore.</b> Your seed has 50 items with nested maps, lists, sets, and binary
          data. Read examples use <code>local-test-001</code>; write examples use <code>playground-*</code> IDs.
        </p>
      </div>
    </div>
  );
}
