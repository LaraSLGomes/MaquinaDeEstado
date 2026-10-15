import { VirtualClock } from './VirtualClock.js';

// Peguei essa função de seed em um fórum para garantir que a simulação seja determinística (reproduzível)
export function createSeededRandom(seed = 1) {
  let s = seed;
  return () => {
    // Math.sin é um jeito simples de gerar pseudo-aleatório com seed no JS puro
    s = Math.sin(s) * 10000;
    return s - Math.floor(s);
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
    // Guarda as estatísticas pro painel do React
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
    
    // Verifica se tem alguma regra manual mandando dropar o pacote (usado nos testes)
    const ruleIndex = this.dropRules.findIndex((predicate) => predicate(outgoing));
    const mustDrop = this.dropNext || ruleIndex >= 0 || this.random() * 100 < probability(this.options.lossProb);
    
    if (this.dropNext) this.dropNext = false;
    if (ruleIndex >= 0) this.dropRules.splice(ruleIndex, 1);

    if (mustDrop) {
      this.stats.lost += 1;
      this.records.push({ time: this.clock.now, packet: outgoing, outcome: 'lost' });
      // console.log(`[Canal] Pacote ${outgoing.kind} perdido.`); // Deixei comentado caso precise debugar depois
      onDrop(outgoing);
      return null;
    }

    const minDelay = Math.max(0, Number(this.options.delayMinMs) || 0);
    const maxDelay = Math.max(minDelay, Number(this.options.delayMaxMs ?? minDelay) || 0);
    let delay = minDelay + this.random() * (maxDelay - minDelay);
    
    const reordered = this.random() * 100 < probability(this.options.reorderProb);
    if (reordered) {
      delay += Math.max(1, maxDelay - minDelay, minDelay); // Joga o atraso lá pra frente pra simular reordenação
      this.stats.reordered += 1;
    }

    if (this.random() * 100 < probability(this.options.corruptProb)) {
      outgoing.corrupted = true;
      // Adiciona um caractere bizarro para estragar o checksum
      if (typeof outgoing.payload === 'string') outgoing.payload += '\u0001';
      else if (Array.isArray(outgoing.payload)) outgoing.payload = [...outgoing.payload, 255];
      this.stats.corrupted += 1;
    }

    const deliver = (copy, duplicate = false) => {
      this.stats.delivered += 1;
      this.records.push({ time: this.clock.now, packet: copy, outcome: duplicate ? 'duplicate' : 'delivered' });
      onDeliver(copy, { duplicate, reordered });
    };
    
    // Agenda a entrega usando o relógio virtual
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