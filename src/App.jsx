import { useEffect, useRef, useState } from 'react';
import { NetworkSimulator } from './engine/NetworkSimulator.js';
import { tcpConnectionDefinition, tcpStatePositions } from './engine/fsmDefinitions.js';
import './App.css';

const defaultConfig = {
  lossProb: 0,
  corruptProb: 0,
  duplicateProb: 0,
  reorderProb: 0,
  delayMinMs: 35,
  delayMaxMs: 85,
  timeWaitMs: 500,
  initialRtoMs: 240,
  seed: 17,
};

const defaultPayload = Array.from({ length: 10 }, (_, index) => `segment-${index}-`).join('\n');

function RangeField({ label, value, onChange, max = 100, suffix = '%' }) {
  return (
    <label className="range-field">
      <span>{label}</span>
      <input type="range" min="0" max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <span className="field-value">{value}{suffix}</span>
    </label>
  );
}

function StateDiagram({ simulator, protocol }) {
  const states = Object.fromEntries(Object.entries(simulator.hosts).map(([id, host]) => [id, host.fsm.getState()]));
  const lastTransition = [...simulator.timeline].reverse().find((entry) => entry.type === 'transition');
  const edges = Object.entries(tcpConnectionDefinition).flatMap(([from, transitions]) =>
    transitions.map((transition) => ({ from, to: transition.nextState, event: transition.event, action: transition.action }))
  );
  const connector = (from, to) => {
    const [x1, y1] = tcpStatePositions[from];
    const [x2, y2] = tcpStatePositions[to];
    const length = Math.hypot(x2 - x1, y2 - y1) || 1;
    const offset = 64;
    return `M ${x1 + ((x2 - x1) / length) * offset} ${y1 + ((y2 - y1) / length) * offset} L ${x2 - ((x2 - x1) / length) * offset} ${y2 - ((y2 - y1) / length) * offset}`;
  };

  if (protocol === 'UDP') {
    return (
      <svg className="state-svg udp-state-svg" viewBox="0 0 600 250" role="img" aria-label="FSM UDP com estado único">
        <defs><marker id="udp-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>
        <path className="state-loop" d="M 260 80 C 160 15, 420 15, 340 80" markerEnd="url(#udp-arrow)" />
        <text className="edge-label" x="300" y="34" textAnchor="middle">SEND / RECEIVE</text>
        <rect className="state-node active-a active-b" x="225" y="90" width="150" height="58" rx="10" />
        <text className="state-label" x="300" y="116" textAnchor="middle">UDP_READY</text>
        <text className="state-host-label" x="300" y="136" textAnchor="middle">A · B</text>
      </svg>
    );
  }

  return (
    <svg className="state-svg" viewBox="0 0 1020 370" role="img" aria-label="Diagrama da FSM TCP">
      <defs><marker id="tcp-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>
      {edges.map((edge, index) => {
        const active = lastTransition?.previousState === edge.from && lastTransition?.nextState === edge.to && lastTransition?.event === edge.event;
        const [x1, y1] = tcpStatePositions[edge.from];
        const [x2, y2] = tcpStatePositions[edge.to];
        return (
          <g key={`${edge.from}-${edge.event}-${index}`} className={active ? 'state-edge active' : 'state-edge'}>
            <path d={connector(edge.from, edge.to)} markerEnd="url(#tcp-arrow)" />
            <text className="edge-label" x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 5}>{edge.event}</text>
          </g>
        );
      })}
      {Object.entries(tcpStatePositions).map(([state, [x, y]]) => {
        const isA = states.A === state;
        const isB = states.B === state;
        return (
          <g key={state} className={`state-node-group${isA ? ' active-a' : ''}${isB ? ' active-b' : ''}`}>
            <rect className="state-node" x={x - 58} y={y - 22} width="116" height="44" rx="8" />
            <text className="state-label" x={x} y={y + 4} textAnchor="middle">{state}</text>
            {(isA || isB) && <text className="state-host-label" x={x} y={y + 35} textAnchor="middle">{[isA && 'A', isB && 'B'].filter(Boolean).join(' · ')}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function SequenceDiagram({ timeline }) {
  const outgoing = timeline.filter((entry) => entry.type === 'segment-out');
  const lost = timeline.filter((entry) => entry.type === 'segment-lost');
  const endTime = Math.max(1, ...outgoing.map((entry) => entry.time));
  const width = Math.max(900, Math.min(1600, endTime * 2 + 200));
  return (
    <div className="sequence-scroll">
      <svg className="sequence-svg" viewBox={`0 0 ${width} 230`} role="img" aria-label="Diagrama de sequência dos segmentos">
        <defs><marker id="sequence-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>
        <text className="lane-label" x="18" y="67">Host A</text>
        <text className="lane-label" x="18" y="177">Host B</text>
        <line className="lane-line" x1="100" y1="62" x2={width - 18} y2="62" />
        <line className="lane-line" x1="100" y1="172" x2={width - 18} y2="172" />
        {outgoing.map((entry, index) => {
          const packet = entry.packet;
          const x = 115 + (entry.time / endTime) * (width - 155) + (index % 4) * 2;
          const fromA = packet.from === 'A';
          const startY = fromA ? 62 : 172;
          const endY = fromA ? 172 : 62;
          const wasLost = !packet.retransmission && lost.some((item) => item.packet?.id === packet.id && item.time >= entry.time);
          const visualEndY = wasLost ? startY + (endY - startY) * 0.58 : endY;
          const className = packet.retransmission ? 'sequence-line retransmitted' : wasLost ? 'sequence-line lost' : 'sequence-line';
          const label = [packet.kind, Number.isFinite(packet.seq) ? `SEQ ${packet.seq}` : '', Number.isFinite(packet.ack) ? `ACK ${packet.ack}` : ''].filter(Boolean).join(' · ');
          return (
            <g key={`${packet.id}-${index}`} className={className}>
              <line x1={x} y1={startY} x2={x} y2={visualEndY} markerEnd="url(#sequence-arrow)" />
              <text x={x + 7} y={(startY + endY) / 2 + (index % 2 ? 14 : -4)}>{label}{wasLost ? ' · perdido' : packet.retransmission ? ' · retransmitido' : ''}</text>
              {wasLost && <text className="loss-cross" x={x + 5} y={visualEndY + (fromA ? 4 : -4)}>×</text>}
              <text className="time-mark" x={x} y="218" textAnchor="middle">{entry.time.toFixed(0)} ms</text>
            </g>
          );
        })}
        {!outgoing.length && <text className="empty-chart" x={width / 2} y="125" textAnchor="middle">Os segmentos aparecerão aqui quando a simulação avançar.</text>}
      </svg>
    </div>
  );
}

function App() {
  const [protocol, setProtocol] = useState('TCP');
  const [config, setConfig] = useState(defaultConfig);
  const [simulator, setSimulator] = useState(() => new NetworkSimulator({ ...defaultConfig, protocol: 'TCP' }));
  const simulatorRef = useRef(simulator);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [payloadInput, setPayloadInput] = useState(defaultPayload);
  const [filter, setFilter] = useState('');
  const [hostFilter, setHostFilter] = useState('all');
  const [comparison, setComparison] = useState(null);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('Pronto para simular.');

  useEffect(() => {
    simulatorRef.current = simulator;
  }, [simulator]);

  useEffect(() => {
    simulator.setChannel({
      lossProb: config.lossProb,
      corruptProb: config.corruptProb,
      duplicateProb: config.duplicateProb,
      reorderProb: config.reorderProb,
      delayMinMs: config.delayMinMs,
      delayMaxMs: config.delayMaxMs,
      timeWaitMs: config.timeWaitMs,
      initialRtoMs: config.initialRtoMs,
    });
  }, [simulator, config]);

  useEffect(() => {
    if (!running) return undefined;
    const interval = window.setInterval(() => {
      const active = simulatorRef.current;
      if (!active.runNext()) {
        setRunning(false);
        return;
      }
      setRevision((value) => value + 1);
    }, Math.max(60, 850 / speed));
    return () => window.clearInterval(interval);
  }, [running, speed]);

  const refresh = () => setRevision((value) => value + 1);
  const updateConfig = (key, value) => setConfig((current) => ({ ...current, [key]: value }));
  const createSimulator = (nextProtocol = protocol) => new NetworkSimulator({ ...config, protocol: nextProtocol, seed: Number(config.seed) });

  const reset = () => {
    const next = createSimulator();
    setRunning(false);
    setSimulator(next);
    simulatorRef.current = next;
    setComparison(null);
    setMessage('Simulação reiniciada.');
    refresh();
  };

  const changeProtocol = (nextProtocol) => {
    setProtocol(nextProtocol);
    const next = createSimulator(nextProtocol);
    setRunning(false);
    setSimulator(next);
    simulatorRef.current = next;
    setComparison(null);
    setMessage(`${nextProtocol} selecionado.`);
    refresh();
  };

  const startConnection = () => {
    if (protocol !== 'TCP') return;
    const active = simulatorRef.current;
    if (active.hosts.B.fsm.getState() === 'CLOSED') active.passiveOpen('B');
    if (active.hosts.A.fsm.getState() === 'CLOSED') active.activeOpen('A', 'B');
    setMessage('Handshake iniciado entre A e B.');
    refresh();
  };

  const closeHost = (hostId) => {
    const closed = simulatorRef.current.close(hostId);
    setMessage(closed ? `Host ${hostId} iniciou o encerramento.` : `APP_CLOSE inválido para Host ${hostId}.`);
    refresh();
  };

  const sendTcpData = () => {
    try {
      const segments = payloadInput.split('\n').filter((value) => value.length > 0);
      simulatorRef.current.sendTCPData('A', segments);
      setMessage(`${segments.length} segmentos enviados de A para B.`);
    } catch (error) {
      setMessage(error.message);
    }
    refresh();
  };

  const sendUdpData = () => {
    const payload = payloadInput.split('\n').filter(Boolean).join(' ');
    simulatorRef.current.sendUDP(payload, { srcPort: 5000, destPort: 8080 });
    setMessage('Datagrama UDP enviado pelo canal.');
    refresh();
  };

  const step = () => {
    if (!simulatorRef.current.runNext()) setMessage('Não há eventos pendentes.');
    else setMessage(`Relógio virtual: ${simulatorRef.current.clock.now.toFixed(1)} ms.`);
    refresh();
  };

  const compareProtocols = () => {
    const data = payloadInput.split('\n').filter(Boolean).slice(0, 10);
    const common = {
      ...config,
      seed: Number(config.seed),
      lossProb: config.lossProb,
      corruptProb: config.corruptProb,
      duplicateProb: config.duplicateProb,
      reorderProb: config.reorderProb,
    };
    const udp = new NetworkSimulator({ ...common, protocol: 'UDP' });
    data.forEach((payload) => udp.sendUDP(payload));
    udp.runUntilIdle();
    const tcp = new NetworkSimulator({ ...common, protocol: 'TCP' });
    tcp.connect();
    tcp.runUntilIdle();
    if (tcp.hosts.A.fsm.getState() === 'ESTABLISHED') {
      tcp.sendTCPData('A', data);
      tcp.runUntilIdle();
    }
    setComparison({
      udp: udp.summary,
      tcp: tcp.summary,
      udpInOrder: udp.metrics.udpOutOfOrderDeliveries === 0,
      tcpInOrder: tcp.hosts.B.delivered.join('|') === data.join('|'),
      expected: data.length,
    });
    setMessage('Comparação executada com a mesma carga e os mesmos parâmetros do canal.');
  };

  const transitions = simulator.timeline.filter((entry) => entry.type === 'transition');
  const visibleTransitions = transitions.filter((entry) => {
    const hostMatches = hostFilter === 'all' || entry.host === `Host ${hostFilter}`;
    const query = filter.trim().toLowerCase();
    const textMatches = !query || `${entry.event} ${entry.action} ${entry.previousState} ${entry.nextState}`.toLowerCase().includes(query);
    return hostMatches && textMatches;
  }).slice().reverse();

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">REDES CONVERGENTES · TRANSPORTE</p>
          <h1>Laboratório de FSM</h1>
          <p className="subtitle">Simulação determinística de estados, segmentos e falhas de rede.</p>
        </div>
        <div className="header-actions">
          <label className="protocol-select">Protocolo
            <select value={protocol} onChange={(event) => changeProtocol(event.target.value)}>
              <option value="TCP">TCP</option>
              <option value="UDP">UDP</option>
            </select>
          </label>
          <button className="button button-secondary" onClick={compareProtocols}>Comparar UDP × TCP</button>
        </div>
      </header>

      <section className="channel-panel" aria-label="Configuração do canal">
        <div className="section-heading">
          <div><p className="eyebrow">AMBIENTE DE REDE</p><h2>Canal simulado</h2></div>
          <div className="virtual-clock"><span>RELÓGIO VIRTUAL</span><strong>{simulator.clock.now.toFixed(1)} <small>ms</small></strong></div>
        </div>
        <div className="channel-controls">
          <RangeField label="Perda" value={config.lossProb} onChange={(value) => updateConfig('lossProb', value)} />
          <RangeField label="Corrupção" value={config.corruptProb} onChange={(value) => updateConfig('corruptProb', value)} />
          <RangeField label="Duplicação" value={config.duplicateProb} onChange={(value) => updateConfig('duplicateProb', value)} />
          <RangeField label="Reordenação" value={config.reorderProb} onChange={(value) => updateConfig('reorderProb', value)} />
          <label className="number-field">Atraso mínimo (ms)<input type="number" min="0" value={config.delayMinMs} onChange={(event) => updateConfig('delayMinMs', Math.max(0, Number(event.target.value)))} /></label>
          <label className="number-field">Atraso máximo (ms)<input type="number" min={config.delayMinMs} value={config.delayMaxMs} onChange={(event) => updateConfig('delayMaxMs', Math.max(config.delayMinMs, Number(event.target.value)))} /></label>
          <label className="number-field">2×MSL (ms)<input type="number" min="1" value={config.timeWaitMs} onChange={(event) => updateConfig('timeWaitMs', Math.max(1, Number(event.target.value)))} /></label>
          <label className="number-field">Seed<input type="number" value={config.seed} onChange={(event) => updateConfig('seed', Number(event.target.value))} /></label>
        </div>
      </section>

      <section className="control-strip" aria-label="Controles da simulação">
        <div className="command-group">
          {protocol === 'TCP' ? <>
            <button className="button button-primary" onClick={startConnection}>Iniciar handshake A ↔ B</button>
            <button className="button button-secondary" onClick={() => closeHost('A')}>Fechar A</button>
            <button className="button button-secondary" onClick={() => closeHost('B')}>Fechar B</button>
            <button className="button button-secondary" onClick={() => { simulatorRef.current.closeBoth(); setMessage('A e B iniciaram fechamento simultâneo.'); refresh(); }}>Fechamento simultâneo</button>
            <button className="button button-secondary" onClick={sendTcpData}>Enviar segmentos</button>
            <button className="button button-warn" onClick={() => simulatorRef.current.sendRawTCP('A', 'B', 'DATA', { seq: 10, payload: 'probe' })}>Testar porta fechada</button>
          </> : <button className="button button-primary" onClick={sendUdpData}>Enviar datagrama UDP</button>}
          <button className="button button-outline" onClick={() => { simulatorRef.current.discardNextSegment(); setMessage('O próximo segmento será descartado.'); }}>Descartar próximo segmento</button>
        </div>
        <div className="playback-controls">
          <button className="button button-secondary" onClick={() => setRunning((value) => !value)}>{running ? 'Pausar' : 'Iniciar'}</button>
          <button className="button button-secondary" onClick={step}>Passo</button>
          <label className="speed-select">Velocidade
            <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
              <option value="0.5">0,5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option>
            </select>
          </label>
          <button className="button button-reset" onClick={reset}>Reset</button>
        </div>
      </section>

      <p className="status-line" aria-live="polite">{message}</p>

      <section className="overview-grid">
        <article className="work-panel state-panel">
          <div className="panel-heading"><div><p className="eyebrow">ESTADOS TCP</p><h2>Máquina de conexão</h2></div><div className="legend"><span className="legend-a">A</span><span className="legend-b">B</span></div></div>
          <div className="diagram-frame"><StateDiagram simulator={simulator} protocol={protocol} /></div>
          <div className="host-state-row">
            {Object.entries(simulator.hosts).map(([id, host]) => <div className={`host-state host-${id.toLowerCase()}`} key={id}><span>HOST {id}</span><strong>{host.fsm.getState()}</strong></div>)}
          </div>
          {simulator.timeline.filter((entry) => entry.type === 'transition').slice(-1).map((entry, index) => <div className="last-transition" key={`${entry.time}-${index}`}><span>ÚLTIMA TRANSIÇÃO · {entry.host}</span><strong>{entry.previousState} → {entry.nextState}</strong><small>{entry.event} / {entry.action}</small></div>)}
        </article>

        <article className="work-panel metrics-panel">
          <div className="panel-heading"><div><p className="eyebrow">TELEMETRIA</p><h2>Resumo da simulação</h2></div><span className="live-dot">{running ? 'RODANDO' : 'PAUSADA'}</span></div>
          <div className="metric-grid">
            <div className="metric"><span>Segmentos enviados</span><strong>{simulator.channel.stats.sent}</strong></div>
            <div className="metric"><span>Perdidos</span><strong>{simulator.channel.stats.lost}</strong></div>
            <div className="metric"><span>Retransmissões</span><strong>{simulator.metrics.retransmissions}</strong></div>
            <div className="metric"><span>Fast retransmit</span><strong>{simulator.metrics.fastRetransmissions}</strong></div>
            <div className="metric"><span>TCP entregue</span><strong>{simulator.metrics.deliveredTcpSegments}</strong></div>
            <div className="metric"><span>UDP entregue</span><strong>{simulator.metrics.deliveredUdpDatagrams}</strong></div>
          </div>
          <div className="rtt-summary"><strong>EstimatedRTT / DevRTT / TimeoutInterval</strong>{Object.entries(simulator.hosts).map(([id, host]) => <span key={id}>Host {id}: {host.rtt.estimated === null ? '—' : `${host.rtt.estimated.toFixed(1)} / ${host.rtt.deviation.toFixed(1)}`} / {host.rtt.timeout.toFixed(1)} ms</span>)}</div>
          <div className="channel-summary"><span>Corrupção <b>{simulator.channel.stats.corrupted}</b></span><span>Duplicação <b>{simulator.channel.stats.duplicated}</b></span><span>Reordenação <b>{simulator.channel.stats.reordered}</b></span><span>Checksum descartado <b>{simulator.metrics.checksumDrops}</b></span></div>
        </article>
      </section>

      <section className="work-panel payload-panel">
        <div className="panel-heading"><div><p className="eyebrow">CARGA DE APLICAÇÃO</p><h2>Dados de teste</h2></div><span className="subtle-label">Uma linha por segmento TCP</span></div>
        <textarea value={payloadInput} onChange={(event) => setPayloadInput(event.target.value)} aria-label="Payload de teste" rows="3" />
      </section>

      <section className="work-panel sequence-panel">
        <div className="panel-heading"><div><p className="eyebrow">TEMPO VIRTUAL · A ↔ B</p><h2>Diagrama de sequência</h2></div><div className="sequence-legend"><span><i className="legend-normal" />Segmento</span><span><i className="legend-lost-mark" />Perdido</span><span><i className="legend-retry-mark" />Retransmitido</span></div></div>
        <SequenceDiagram timeline={simulator.timeline} />
      </section>

      {comparison && <section className="comparison-panel" aria-live="polite">
        <div className="panel-heading"><div><p className="eyebrow">CARGA COMUM · {comparison.expected} DATAGRAMAS/SEGMENTOS</p><h2>UDP × TCP</h2></div><button className="button button-reset" onClick={() => setComparison(null)}>Fechar comparação</button></div>
        <div className="comparison-grid">
          {[
            ['UDP', comparison.udp, comparison.udpInOrder, comparison.udp.metrics.udpDuplicateDeliveries],
            ['TCP', comparison.tcp, comparison.tcpInOrder, 0],
          ].map(([name, report, inOrder, duplicates]) => <div className={`comparison-result comparison-${name.toLowerCase()}`} key={name}><h3>{name}</h3><dl><div><dt>Entregues</dt><dd>{name === 'UDP' ? report.metrics.uniqueUdpDatagramsDelivered : report.metrics.deliveredTcpSegments}</dd></div><div><dt>Perdidos</dt><dd>{report.channel.lost}</dd></div><div><dt>Duplicados na aplicação</dt><dd>{duplicates}</dd></div><div><dt>Entrega em ordem</dt><dd>{inOrder ? 'Sim' : 'Não'}</dd></div><div><dt>Retransmissões</dt><dd>{report.metrics.retransmissions}</dd></div><div><dt>Tempo total</dt><dd>{report.virtualTimeMs.toFixed(1)} ms</dd></div></dl></div>)}
        </div>
      </section>}

      <section className="work-panel log-panel">
        <div className="panel-heading"><div><p className="eyebrow">EVENTOS DA FSM</p><h2>Log de transições</h2></div><div className="log-filters"><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filtrar evento ou ação" aria-label="Filtrar eventos" /><select value={hostFilter} onChange={(event) => setHostFilter(event.target.value)} aria-label="Filtrar host"><option value="all">Todos os hosts</option><option value="A">Host A</option><option value="B">Host B</option></select></div></div>
        <div className="table-scroll"><table><thead><tr><th>Tempo</th><th>Host</th><th>Estado anterior</th><th>Evento</th><th>Ação</th><th>Novo estado</th></tr></thead><tbody>
          {visibleTransitions.map((entry, index) => <tr key={`${entry.time}-${entry.host}-${entry.event}-${index}`}><td>{entry.time.toFixed(1)} ms</td><td>{entry.host}</td><td>{entry.previousState}</td><td><code>{entry.event}</code></td><td>{String(entry.action ?? '')}</td><td><strong>{entry.nextState}</strong></td></tr>)}
          {!visibleTransitions.length && <tr><td className="empty-table" colSpan="6">Nenhuma transição corresponde ao filtro.</td></tr>}
        </tbody></table></div>
      </section>

      <footer className="app-footer"><span>FSM definida por dados · canal em memória · seed {config.seed}</span><span>{revision} atualizações da simulação</span></footer>
    </main>
  );
}

export default App;