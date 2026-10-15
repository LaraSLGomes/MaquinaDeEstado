import React, { useState, useEffect, useRef } from 'react';
import { FSMEngine } from './engine/FSMEngine';
import { tcpConnectionDefinition, udpDefinition } from './engine/fsmDefinitions';
import { SimChannel } from './engine/Channel';
import './App.css'; // Usaremos um CSS básico

function App() {
  const [protocol, setProtocol] = useState('TCP');
  const [loss, setLoss] = useState(0);
  const [engine, setEngine] = useState(null);
  const [logs, setLogs] = useState([]);
  const [currentState, setCurrentState] = useState('');
  
  const channelRef = useRef(new SimChannel(0, 0, 500));

  // Inicializa o motor escolhido
  useEffect(() => {
    let newEngine;
    if (protocol === 'TCP') {
      newEngine = new FSMEngine('TCP FSM', tcpConnectionDefinition, 'CLOSED');
    } else {
      newEngine = new FSMEngine('UDP FSM', udpDefinition, 'UDP_READY');
    }
    setEngine(newEngine);
    setCurrentState(newEngine.getState());
    setLogs(newEngine.getLogs());
  }, [protocol]);

  // Atualiza canal quando altera a perda
  useEffect(() => {
    channelRef.current.lossProb = loss;
  }, [loss]);

  const triggerEvent = (event, param = null) => {
    if (!engine) return;
    
    // Simula a passagem pelo canal antes de chegar na FSM receptora
    channelRef.current.transmit(
      { type: event, checksumValid: true }, 
      (packet) => {
        engine.processEvent(event, packet);
        setCurrentState(engine.getState());
        setLogs([...engine.getLogs()]);
      },
      () => {
        engine.log(`[CANAL] Pacote contendo evento ${event} foi PERDIDO na rede.`);
        setLogs([...engine.getLogs()]);
      }
    );
  };

  return (
    <div className="container">
      <h1>Simulador de FSM - Redes</h1>
      
      <div className="config-panel">
        <label>
          Protocolo: 
          <select value={protocol} onChange={(e) => setProtocol(e.target.value)}>
            <option value="TCP">TCP (Conexão)</option>
            <option value="UDP">UDP</option>
          </select>
        </label>
        
        <label>
          Probabilidade de Perda (%): 
          <input type="number" min="0" max="100" value={loss} onChange={(e) => setLoss(Number(e.target.value))} />
        </label>
      </div>

      <div className="state-display">
        <h2>Estado Atual: <span className="highlight">{currentState}</span></h2>
      </div>

      <div className="controls">
        <h3>Disparar Eventos:</h3>
        {protocol === 'TCP' ? (
          <>
            <button onClick={() => triggerEvent('APP_ACTIVE_OPEN')}>Active Open (Cliente)</button>
            <button onClick={() => triggerEvent('APP_PASSIVE_OPEN')}>Passive Open (Servidor)</button>
            <button onClick={() => triggerEvent('RCV_SYN_ACK')}>Receber SYN+ACK</button>
            <button onClick={() => triggerEvent('APP_CLOSE')}>Fechar Conexão (APP_CLOSE)</button>
            <button onClick={() => triggerEvent('RCV_ACK')}>Receber ACK</button>
          </>
        ) : (
          <>
            <button onClick={() => triggerEvent('SEND_DATA', { length: 512 })}>Enviar Datagrama</button>
            <button onClick={() => triggerEvent('RECEIVE_DATA', { checksumValid: true })}>Receber (Valido)</button>
          </>
        )}
      </div>

      <div className="logs">
        <h3>Console de Logs do Motor:</h3>
        <ul>
          {logs.map((log, idx) => (
            <li key={idx}>{log}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default App;