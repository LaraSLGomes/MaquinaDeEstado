import assert from 'node:assert/strict';
import { NetworkSimulator } from './NetworkSimulator.js';

const states = (host) => host.fsm.getHistory().map((entry) => entry.nextState);
const payloads = Array.from({ length: 10 }, (_, index) => `segment-${index}-`);
const tcpOptions = { delayMinMs: 2, delayMaxMs: 4, initialRtoMs: 80, timeWaitMs: 40, maxRetries: 4 };

function scenario(name, run) {
  return { name, run };
}

export const testScenarios = [
  scenario('TCP handshake sem falhas', () => {
    const sim = new NetworkSimulator(tcpOptions);
    sim.connect();
    sim.runUntilIdle();
    assert.deepEqual(states(sim.hosts.A), ['SYN_SENT', 'ESTABLISHED']);
    assert.deepEqual(states(sim.hosts.B), ['LISTEN', 'SYN_RCVD', 'ESTABLISHED']);
    assert.ok(sim.metrics.rttSamples.length >= 2, 'Amostras RTT não foram registradas');
  }),

  scenario('TCP recupera SYN perdido', () => {
    const sim = new NetworkSimulator(tcpOptions);
    sim.channel.discardNextMatching((packet) => packet.kind === 'SYN' && packet.from === 'A');
    sim.connect();
    sim.runUntilIdle();
    assert.ok(sim.metrics.timeoutRetransmissions >= 1);
    assert.equal(sim.hosts.A.fsm.getState(), 'ESTABLISHED');
    assert.equal(sim.hosts.B.fsm.getState(), 'ESTABLISHED');
  }),

  scenario('TCP recupera SYN-ACK perdido', () => {
    const sim = new NetworkSimulator(tcpOptions);
    sim.channel.discardNextMatching((packet) => packet.kind === 'SYN_ACK');
    sim.connect();
    sim.runUntilIdle();
    assert.ok(sim.metrics.timeoutRetransmissions >= 1);
    assert.equal(sim.hosts.A.fsm.getState(), 'ESTABLISHED');
    assert.equal(sim.hosts.B.fsm.getState(), 'ESTABLISHED');
    assert.ok(sim.timeline.some((entry) => entry.type === 'timeout' && entry.kind === 'SYN_ACK'));
  }),

  scenario('TCP encerramento normal de quatro vias', () => {
    const sim = new NetworkSimulator(tcpOptions);
    sim.connect();
    sim.runUntilIdle();
    sim.close('A');
    sim.runUntilIdle();
    assert.equal(sim.hosts.A.fsm.getState(), 'FIN_WAIT_2');
    assert.equal(sim.hosts.B.fsm.getState(), 'CLOSE_WAIT');
    sim.close('B');
    sim.runUntilIdle();
    assert.ok(states(sim.hosts.A).includes('FIN_WAIT_1'));
    assert.ok(states(sim.hosts.A).includes('FIN_WAIT_2'));
    assert.ok(states(sim.hosts.A).includes('TIME_WAIT'));
    assert.ok(states(sim.hosts.B).includes('CLOSE_WAIT'));
    assert.ok(states(sim.hosts.B).includes('LAST_ACK'));
    assert.equal(sim.hosts.A.fsm.getState(), 'CLOSED');
    assert.equal(sim.hosts.B.fsm.getState(), 'CLOSED');
  }),

  scenario('TCP fechamento simultâneo passa por CLOSING', () => {
    const sim = new NetworkSimulator(tcpOptions);
    sim.connect();
    sim.runUntilIdle();
    sim.closeBoth();
    sim.runUntilIdle();
    for (const host of Object.values(sim.hosts)) {
      const history = states(host);
      const closing = history.indexOf('CLOSING');
      assert.ok(closing >= 0, `${host.id} não passou por CLOSING`);
      assert.equal(history[closing + 1], 'TIME_WAIT');
      assert.equal(host.fsm.getState(), 'CLOSED');
    }
  }),

  scenario('TCP fast retransmit após três ACKs duplicados', () => {
    const sim = new NetworkSimulator({ ...tcpOptions, delayMinMs: 1, delayMaxMs: 1 });
    sim.connect();
    sim.runUntilIdle();
    const first = sim.hosts.A.nextSeq;
    const missingIndex = 4;
    const missingSeq = first + payloads.slice(0, missingIndex).reduce((sum, value) => sum + new TextEncoder().encode(value).length, 0);
    sim.channel.discardNextMatching((packet) => packet.kind === 'DATA' && packet.seq === missingSeq);
    sim.sendTCPData('A', payloads);
    sim.runUntilIdle();
    assert.ok(sim.metrics.fastRetransmissions >= 1, 'Nenhuma retransmissão rápida ocorreu');
    assert.equal(sim.metrics.timeoutRetransmissions, 0, 'A perda foi recuperada pelo timeout em vez do fast retransmit');
    assert.equal(sim.hosts.B.delivered.length, payloads.length);
    assert.deepEqual(sim.hosts.B.delivered, payloads);
  }),

  scenario('TCP envia RST para porta fechada', () => {
    const sim = new NetworkSimulator(tcpOptions);
    sim.sendRawTCP('A', 'B', 'DATA', { seq: 10, payload: 'probe' });
    sim.runUntilIdle();
    assert.equal(sim.metrics.rstSent, 1);
    assert.ok(sim.timeline.some((entry) => entry.type === 'rst-received'));
  }),

  scenario('UDP não retransmite datagramas perdidos', () => {
    const sim = new NetworkSimulator({
      ...tcpOptions,
      protocol: 'UDP',
      seed: 812,
      lossProb: 30,
      duplicateProb: 35,
      reorderProb: 50,
      delayMinMs: 1,
      delayMaxMs: 30,
    });
    for (let index = 0; index < 20; index += 1) sim.sendUDP(`udp-${index}`);
    sim.runUntilIdle();
    assert.ok(sim.channel.stats.lost > 0);
    assert.ok(sim.metrics.uniqueUdpDatagramsDelivered < 20);
    assert.ok(sim.metrics.udpDuplicateDeliveries > 0);
    assert.ok(sim.metrics.udpOutOfOrderDeliveries > 0);
    assert.equal(sim.metrics.retransmissions, 0);
    assert.equal(sim.channel.stats.sent, 20);
    return {
      sent: sim.channel.stats.sent,
      uniqueDelivered: sim.metrics.uniqueUdpDatagramsDelivered,
      lost: sim.channel.stats.lost,
      duplicates: sim.metrics.udpDuplicateDeliveries,
      outOfOrder: sim.metrics.udpOutOfOrderDeliveries,
      retransmissions: sim.metrics.retransmissions,
    };
  }),

  scenario('UDP descarta checksum corrompido sem aviso', () => {
    const sim = new NetworkSimulator({ ...tcpOptions, protocol: 'UDP', corruptProb: 100 });
    sim.sendUDP('checksum-test');
    sim.runUntilIdle();
    assert.equal(sim.metrics.checksumDrops, 1);
    assert.equal(sim.metrics.deliveredUdpDatagrams, 0);
    assert.equal(sim.hosts.B.fsm.getLogs().length, 0);
  }),

  scenario('Comparação UDP × TCP sob o mesmo canal', () => {
    const channel = { seed: 606, lossProb: 18, delayMinMs: 2, delayMaxMs: 6, initialRtoMs: 80, timeWaitMs: 40 };
    const udp = new NetworkSimulator({ ...channel, protocol: 'UDP' });
    for (const payload of payloads) udp.sendUDP(payload);
    udp.runUntilIdle();

    const tcp = new NetworkSimulator({ ...channel, protocol: 'TCP' });
    tcp.connect();
    tcp.runUntilIdle();
    tcp.sendTCPData('A', payloads);
    tcp.runUntilIdle();

    const report = {
      udp: {
        delivered: udp.metrics.deliveredUdpDatagrams,
        uniqueDelivered: udp.metrics.uniqueUdpDatagramsDelivered,
        lost: udp.channel.stats.lost,
        duplicates: udp.metrics.udpDuplicateDeliveries,
        outOfOrder: udp.metrics.udpOutOfOrderDeliveries,
        elapsedMs: udp.clock.now,
      },
      tcp: {
        delivered: tcp.metrics.deliveredTcpSegments,
        lost: tcp.channel.stats.lost,
        retransmissions: tcp.metrics.retransmissions,
        inOrder: tcp.hosts.B.delivered.join('|') === payloads.join('|'),
        elapsedMs: tcp.clock.now,
      },
    };
    assert.equal(report.udp.delivered + report.udp.lost, payloads.length);
    assert.equal(report.udp.uniqueDelivered + report.udp.lost, payloads.length);
    assert.equal(report.tcp.delivered, payloads.length);
    assert.equal(report.tcp.inOrder, true);
    return report;
  }),
];

export function runAllScenarios() {
  return testScenarios.map(({ name, run }) => {
    try {
      const details = run();
      return { name, passed: true, details };
    } catch (error) {
      return { name, passed: false, error: error.message };
    }
  });
}
