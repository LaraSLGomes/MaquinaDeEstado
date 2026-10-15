import { VirtualClock } from './VirtualClock.js';

export function createSeededRandom(seed = 1) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const probability = (value) => Math.min(100, Math.max(0, Number(value) || 0));
const clone = (packet) => structuredClone(packet);

export class SimChannel {
  constructor(options = {}, dependencies = {}) {
    this.options = {
      lossProb: 0,
      corruptProb: 0,
      duplicateProb: 0,
      reorderProb: 0,
      delayMinMs: 0,
      delayMaxMs: 0,
      ...options,
    };
    this.clock = dependencies.clock ?? new VirtualClock();
    this.random = dependencies.random ?? Math.random;
    this.dropNext = false;
    this.dropRules = [];
    this.stats = { sent: 0, delivered: 0, lost: 0, corrupted: 0, duplicated: 0, reordered: 0 };
    this.records = [];
  }

  configure(options) {
    this.options = { ...this.options, ...options };
  }

  discardNext() {
    this.dropNext = true;
  }

  discardNextMatching(predicate) {
    this.dropRules.push(predicate);
  }

  transmit(packet, onDeliver, onDrop = () => {}) {
    this.stats.sent += 1;
    const outgoing = clone(packet);
    const ruleIndex = this.dropRules.findIndex((predicate) => predicate(outgoing));
    const mustDrop = this.dropNext || ruleIndex >= 0 || this.random() * 100 < probability(this.options.lossProb);
    if (this.dropNext) this.dropNext = false;
    if (ruleIndex >= 0) this.dropRules.splice(ruleIndex, 1);

    if (mustDrop) {
      this.stats.lost += 1;
      this.records.push({ time: this.clock.now, packet: outgoing, outcome: 'lost' });
      onDrop(outgoing);
      return null;
    }

    const minDelay = Math.max(0, Number(this.options.delayMinMs) || 0);
    const maxDelay = Math.max(minDelay, Number(this.options.delayMaxMs ?? minDelay) || 0);
    let delay = minDelay + this.random() * (maxDelay - minDelay);
    const reordered = this.random() * 100 < probability(this.options.reorderProb);
    if (reordered) {
      delay += Math.max(1, maxDelay - minDelay, minDelay);
      this.stats.reordered += 1;
    }

    if (this.random() * 100 < probability(this.options.corruptProb)) {
      outgoing.corrupted = true;
      if (typeof outgoing.payload === 'string') outgoing.payload += '\u0001';
      else if (Array.isArray(outgoing.payload)) outgoing.payload = [...outgoing.payload, 255];
      this.stats.corrupted += 1;
    }

    const deliver = (copy, duplicate = false) => {
      this.stats.delivered += 1;
      this.records.push({ time: this.clock.now, packet: copy, outcome: duplicate ? 'duplicate' : 'delivered' });
      onDeliver(copy, { duplicate, reordered });
    };
    this.clock.schedule(delay, () => deliver(outgoing), `deliver:${outgoing.kind ?? outgoing.type ?? 'packet'}`);

    if (this.random() * 100 < probability(this.options.duplicateProb)) {
      this.stats.duplicated += 1;
      this.clock.schedule(delay + 1, () => deliver(clone(outgoing), true), 'duplicate');
    }
    return outgoing;
  }

  reset() {
    this.dropNext = false;
    this.dropRules = [];
    this.stats = { sent: 0, delivered: 0, lost: 0, corrupted: 0, duplicated: 0, reordered: 0 };
    this.records = [];
  }
}