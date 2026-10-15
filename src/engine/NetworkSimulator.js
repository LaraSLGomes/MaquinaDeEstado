import { FSMEngine } from './FSMEngine.js';
import { SimChannel, createSeededRandom } from './Channel.js';
import { VirtualClock } from './VirtualClock.js';
import { calculateUDPChecksum, tcpConnectionDefinition, udpDefinition } from './fsmDefinitions.js';

const byteLength = (value) => new TextEncoder().encode(String(value)).length;

export class NetworkSimulator {
  constructor(options = {}) {
    this.options = {
      protocol: 'TCP',
      seed: 17,
      lossProb: 0,
      corruptProb: 0,
      duplicateProb: 0,
      reorderProb: 0,
      delayMinMs: 25,
      delayMaxMs: 60,
      initialRtoMs: 240,
      timeWaitMs: 500,
      maxRetries: 5,
      ...options,
    };
    this.clock = new VirtualClock();
    this.random = createSeededRandom(this.options.seed);
    this.channel = new SimChannel(this.options, { clock: this.clock, random: this.random });
    this.timeline = [];
    this.nextPacketId = 1;
    this.metrics = {
      retransmissions: 0,
      timeoutRetransmissions: 0,
      fastRetransmissions: 0,
      deliveredTcpSegments: 0,
      deliveredTcpBytes: 0,
      deliveredUdpDatagrams: 0,
      uniqueUdpDatagramsDelivered: 0,
      udpDuplicateDeliveries: 0,
      udpOutOfOrderDeliveries: 0,
      checksumDrops: 0,
      rstSent: 0,
      rttSamples: [],
    };
    this.hosts = {};
    this.resetHosts();
  }

  resetHosts() {
    const protocol = this.options.protocol;
    const definition = protocol === 'UDP' ? udpDefinition : tcpConnectionDefinition;
    const initialState = protocol === 'UDP' ? 'UDP_READY' : 'CLOSED';
    this.hosts = {
      A: this.createHost('A', definition, initialState, 1000),
      B: this.createHost('B', definition, initialState, 9000),
    };
  }

  createHost(id, definition, initialState, initialSequence) {
    return {
      id,
      fsm: new FSMEngine(`Host ${id}`, definition, {
        initialState,
        now: () => this.clock.now,
      }),
      nextSeq: initialSequence,
      expectedSeq: null,
      pending: new Map(),
      receiveBuffer: new Map(),
      lastAck: null,
      duplicateAcks: 0,
      rtt: { estimated: null, deviation: null, timeout: this.options.initialRtoMs },
      delivered: [],
      deliveredPacketIds: [],
    };
  }

  record(type, details = {}) {
    const entry = { time: this.clock.now, type, ...details };
    this.timeline.push(entry);
    return entry;
  }

  transition(hostId, event, params = {}) {
    const host = this.hosts[hostId];
    const result = host.fsm.processEvent(event, params);
    if (!result) {
      const latestLog = host.fsm.getLogs()[0];
      this.record('rejected', { host: hostId, event, state: host.fsm.getState(), message: latestLog });
      return false;
    }
    this.record('transition', result);
    if (result.nextState === 'TIME_WAIT' && result.previousState !== 'TIME_WAIT') {
      this.clock.schedule(this.options.timeWaitMs, () => this.transition(hostId, 'TIMEOUT'), `TIME_WAIT:${hostId}`);
    }
    return result;
  }

  passiveOpen(hostId = 'B') {
    return this.transition(hostId, 'APP_PASSIVE_OPEN');
  }

  activeOpen(hostId = 'A', remoteId = 'B') {
    const host = this.hosts[hostId];
    const result = this.transition(hostId, 'APP_ACTIVE_OPEN');
    if (!result) return false;
    const sequence = host.nextSeq++;
    this.sendTracked(host, this.packet(hostId, remoteId, 'SYN', { seq: sequence }));
    return true;
  }

  connect() {
    this.passiveOpen('B');
    this.activeOpen('A', 'B');
  }

  close(hostId) {
    const host = this.hosts[hostId];
    const result = this.transition(hostId, 'APP_CLOSE');
    if (!result) return false;
    const sequence = host.nextSeq++;
    this.sendTracked(host, this.packet(hostId, hostId === 'A' ? 'B' : 'A', 'FIN', {
      seq: sequence,
      ack: host.expectedSeq ?? 0,
    }));
    return true;
  }

  closeBoth() {
    this.close('A');
    this.close('B');
  }

  sendTCPData(hostId, payloads) {
    const host = this.hosts[hostId];
    if (host.fsm.getState() !== 'ESTABLISHED') throw new Error(`Host ${hostId} não está ESTABLISHED.`);
    const list = Array.isArray(payloads) ? payloads : [payloads];
    return list.map((payload, index) => {
      const text = String(payload);
      const sequence = host.nextSeq;
      host.nextSeq += byteLength(text);
      const packet = this.packet(hostId, hostId === 'A' ? 'B' : 'A', 'DATA', {
        seq: sequence,
        ack: host.expectedSeq ?? 0,
        payload: text,
        segmentIndex: index,
      });
      this.sendTracked(host, packet);
      return packet;
    });
  }

  sendRawTCP(from, to, kind, fields = {}) {
    const packet = this.packet(from, to, kind, fields);
    this.transmit(packet);
    return packet;
  }

  sendUDP(payload, fields = {}) {
    const packet = {
      from: 'A',
      to: 'B',
      srcIP: '192.168.0.1',
      destIP: '10.0.0.1',
      srcPort: 5000,
      destPort: 8080,
      payload: String(payload),
      ...fields,
      protocol: 'UDP',
      id: this.nextPacketId++,
    };
    const prepared = this.transition('A', 'APP_SEND_DATA', packet);
    if (!prepared) return false;
    this.transmit(packet);
    return packet;
  }

  packet(from, to, kind, fields = {}) {
    return { id: this.nextPacketId++, protocol: 'TCP', from, to, kind, ...fields };
  }

  sendTracked(host, packet) {
    const key = `${packet.kind}:${packet.seq}`;
    const pending = {
      key,
      packet: structuredClone(packet),
      sentAt: this.clock.now,
      attempts: 0,
      retransmitted: false,
      timer: null,
    };
    host.pending.set(key, pending);
    this.transmit(packet);
    this.scheduleRetransmission(host, pending);
  }

  scheduleRetransmission(host, pending) {
    pending.timer = this.clock.schedule(host.rtt.timeout, () => {
      if (!host.pending.has(pending.key)) return;
      if (pending.attempts >= this.options.maxRetries) {
        host.pending.delete(pending.key);
        this.record('retry-limit', { host: host.id, kind: pending.packet.kind, seq: pending.packet.seq });
        return;
      }
      pending.attempts += 1;
      pending.retransmitted = true;
      host.rtt.timeout = Math.min(host.rtt.timeout * 2, 60000);
      this.metrics.retransmissions += 1;
      this.metrics.timeoutRetransmissions += 1;
      this.record('timeout', { host: host.id, kind: pending.packet.kind, seq: pending.packet.seq, rto: host.rtt.timeout });
      this.transmit({ ...pending.packet, retransmission: true });
      this.scheduleRetransmission(host, pending);
    }, `RTO:${host.id}:${pending.key}`);
  }

  transmit(packet) {
    this.record('segment-out', { host: packet.from, kind: packet.kind, packet: structuredClone(packet) });
    this.channel.transmit(
      packet,
      (delivered, flags) => {
        this.record('segment-in', { host: delivered.to, kind: delivered.kind, packet: structuredClone(delivered), ...flags });
        this.receive(delivered, flags);
      },
      (dropped) => this.record('segment-lost', { host: dropped.from, target: dropped.to, kind: dropped.kind, packet: dropped })
    );
  }

  receive(packet, flags = {}) {
    if (packet.protocol === 'UDP') return this.receiveUDP(packet, flags);
    const host = this.hosts[packet.to];
    if (!host) return;

    if (packet.corrupted) {
      this.record('segment-corrupted', { host: host.id, kind: packet.kind, packet });
      if (packet.kind === 'DATA' && host.fsm.getState() === 'ESTABLISHED') this.sendAck(host, host.expectedSeq);
      return;
    }

    if (packet.kind === 'SYN') return this.receiveSyn(host, packet);
    if (packet.kind === 'SYN_ACK') return this.receiveSynAck(host, packet);
    if (packet.kind === 'ACK') return this.receiveAck(host, packet);
    if (packet.kind === 'DATA') return this.receiveData(host, packet);
    if (packet.kind === 'FIN') return this.receiveFin(host, packet);
    if (packet.kind === 'RST') this.record('rst-received', { host: host.id, packet });
  }

  receiveSyn(host, packet) {
    if (host.fsm.getState() === 'CLOSED') return this.sendRst(host, packet);
    const result = this.transition(host.id, 'RCV_SYN', packet);
    if (!result) return;
    host.expectedSeq = packet.seq + 1;
    if (host.nextSeq === 9000 && host.id === 'B') host.nextSeq += 1;
    const sequence = host.nextSeq - 1;
    const response = this.packet(host.id, packet.from, 'SYN_ACK', {
      seq: sequence,
      ack: packet.seq + 1,
    });
    this.sendTracked(host, response);
  }

  receiveSynAck(host, packet) {
    if (host.fsm.getState() === 'SYN_SENT') {
      this.acknowledge(host, packet.ack);
      const result = this.transition(host.id, 'RCV_SYN_ACK', packet);
      if (!result) return;
      host.expectedSeq = packet.seq + 1;
      this.sendAck(host, packet.seq + 1);
      return;
    }
    if (host.fsm.getState() === 'ESTABLISHED') {
      this.sendAck(host, packet.seq + 1);
      return;
    }
    if (host.fsm.getState() === 'SYN_RCVD') {
      this.acknowledge(host, packet.ack);
      this.transition(host.id, 'RCV_ACK', packet);
      host.expectedSeq = packet.seq + 1;
      this.sendAck(host, packet.seq + 1);
    }
  }

  receiveAck(host, packet) {
    this.acknowledge(host, packet.ack);
    const state = host.fsm.getState();
    if (state === 'SYN_RCVD' || state === 'FIN_WAIT_1' || state === 'CLOSING' || state === 'LAST_ACK') {
      this.transition(host.id, 'RCV_ACK', packet);
      return;
    }
    if (state !== 'ESTABLISHED') return;

    if (packet.ack === host.lastAck) {
      host.duplicateAcks += 1;
      this.record('duplicate-ack', { host: host.id, ack: packet.ack, count: host.duplicateAcks });
      if (host.duplicateAcks === 3) this.fastRetransmit(host);
      return;
    }
    if (packet.ack > (host.lastAck ?? -Infinity)) {
      host.lastAck = packet.ack;
      host.duplicateAcks = 0;
    }
  }

  receiveData(host, packet) {
    if (host.fsm.getState() === 'CLOSED') return this.sendRst(host, packet);
    if (host.fsm.getState() !== 'ESTABLISHED') return;
    if (host.expectedSeq === null) host.expectedSeq = packet.seq;

    if (packet.seq > host.expectedSeq) {
      host.receiveBuffer.set(packet.seq, packet);
      this.sendAck(host, host.expectedSeq);
      return;
    }
    if (packet.seq < host.expectedSeq) {
      this.sendAck(host, host.expectedSeq);
      return;
    }

    this.deliverTcpData(host, packet);
    while (host.receiveBuffer.has(host.expectedSeq)) {
      const nextPacket = host.receiveBuffer.get(host.expectedSeq);
      host.receiveBuffer.delete(host.expectedSeq);
      this.deliverTcpData(host, nextPacket);
    }
    this.sendAck(host, host.expectedSeq);
  }

  deliverTcpData(host, packet) {
    host.delivered.push(packet.payload);
    host.expectedSeq += byteLength(packet.payload);
    this.metrics.deliveredTcpSegments += 1;
    this.metrics.deliveredTcpBytes += byteLength(packet.payload);
    this.record('application-delivery', { host: host.id, protocol: 'TCP', payload: packet.payload, seq: packet.seq });
  }

  receiveFin(host, packet) {
    const state = host.fsm.getState();
    if (state === 'CLOSED') return this.sendRst(host, packet);
    const result = this.transition(host.id, 'RCV_FIN', packet);
    if (!result) {
      this.sendAck(host, packet.seq + 1);
      return;
    }
    host.expectedSeq = packet.seq + 1;
    this.sendAck(host, host.expectedSeq);
  }

  receiveUDP(packet, flags = {}) {
    const receiver = this.hosts[packet.from === 'A' ? 'B' : 'A'];
    const valid = calculateUDPChecksum(packet) === packet.checksum;
    const result = this.transition(receiver.id, 'RECEIVE_DATA', packet);
    if (!valid || !result?.deliver) {
      this.metrics.checksumDrops += 1;
      this.record('checksum-drop', { host: receiver.id, packetId: packet.id });
      return;
    }
    const duplicate = flags.duplicate || receiver.deliveredPacketIds.includes(packet.id);
    if (duplicate) this.metrics.udpDuplicateDeliveries += 1;
    if (receiver.deliveredPacketIds.some((deliveredId) => deliveredId > packet.id)) {
      this.metrics.udpOutOfOrderDeliveries += 1;
    }
    if (!receiver.deliveredPacketIds.includes(packet.id)) this.metrics.uniqueUdpDatagramsDelivered += 1;
    receiver.deliveredPacketIds.push(packet.id);
    receiver.delivered.push(packet.payload);
    this.metrics.deliveredUdpDatagrams += 1;
    this.record('application-delivery', { host: receiver.id, protocol: 'UDP', payload: packet.payload, packetId: packet.id });
  }

  sendAck(host, ack) {
    const target = host.id === 'A' ? 'B' : 'A';
    this.transmit(this.packet(host.id, target, 'ACK', { seq: host.nextSeq, ack }));
  }

  sendRst(host, incoming) {
    const target = incoming.from;
    this.metrics.rstSent += 1;
    this.record('rst-sent', { host: host.id, target, reason: `Porta fechada para ${incoming.kind}` });
    this.transmit(this.packet(host.id, target, 'RST', { seq: 0, ack: (incoming.seq ?? 0) + 1 }));
  }

  acknowledge(host, acknowledgment) {
    if (!Number.isFinite(acknowledgment)) return;
    for (const [key, pending] of host.pending) {
      const packet = pending.packet;
      const end = packet.seq + (packet.kind === 'DATA' ? byteLength(packet.payload) : 1);
      if (acknowledgment < end) continue;
      this.clock.cancel(pending.timer);
      host.pending.delete(key);
      if (!pending.retransmitted) this.sampleRtt(host, this.clock.now - pending.sentAt);
    }
  }

  sampleRtt(host, sample) {
    if (sample <= 0) return;
    const { rtt } = host;
    if (rtt.estimated === null) {
      rtt.estimated = sample;
      rtt.deviation = sample / 2;
    } else {
      rtt.deviation = 0.75 * rtt.deviation + 0.25 * Math.abs(rtt.estimated - sample);
      rtt.estimated = 0.875 * rtt.estimated + 0.125 * sample;
    }
    rtt.timeout = Math.max(20, Math.min(60000, rtt.estimated + 4 * rtt.deviation));
    this.metrics.rttSamples.push({ host: host.id, sample, estimated: rtt.estimated, deviation: rtt.deviation, timeout: rtt.timeout });
  }

  fastRetransmit(host) {
    const oldest = [...host.pending.values()]
      .filter((pending) => pending.packet.kind === 'DATA')
      .sort((left, right) => left.packet.seq - right.packet.seq)[0];
    if (!oldest) return;
    oldest.retransmitted = true;
    oldest.attempts += 1;
    this.metrics.retransmissions += 1;
    this.metrics.fastRetransmissions += 1;
    this.record('fast-retransmit', { host: host.id, seq: oldest.packet.seq });
    this.transmit({ ...oldest.packet, retransmission: true, fastRetransmission: true });
  }

  runNext() { return this.clock.runNext(); }
  runUntilIdle(maxEvents = 10000) { return this.clock.runUntilIdle(maxEvents); }

  setChannel(options) {
    this.channel.configure(options);
    this.options = { ...this.options, ...options };
  }

  discardNextSegment() { this.channel.discardNext(); }

  reset() {
    this.clock.clear();
    this.channel.reset();
    this.random = createSeededRandom(this.options.seed);
    this.channel.random = this.random;
    this.timeline = [];
    this.metrics = {
      retransmissions: 0,
      timeoutRetransmissions: 0,
      fastRetransmissions: 0,
      deliveredTcpSegments: 0,
      deliveredTcpBytes: 0,
      deliveredUdpDatagrams: 0,
      uniqueUdpDatagramsDelivered: 0,
      udpDuplicateDeliveries: 0,
      udpOutOfOrderDeliveries: 0,
      checksumDrops: 0,
      rstSent: 0,
      rttSamples: [],
    };
    this.nextPacketId = 1;
    this.resetHosts();
  }

  get summary() {
    return {
      protocol: this.options.protocol,
      virtualTimeMs: this.clock.now,
      channel: { ...this.channel.stats },
      metrics: structuredClone(this.metrics),
      states: Object.fromEntries(Object.entries(this.hosts).map(([id, host]) => [id, host.fsm.getState()])),
    };
  }
}
