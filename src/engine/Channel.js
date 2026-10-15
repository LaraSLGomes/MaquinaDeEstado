export class SimChannel {
  constructor(lossProb = 0, corruptProb = 0, delay = 500) {
    this.lossProb = lossProb;       // 0 a 100%
    this.corruptProb = corruptProb; // 0 a 100%
    this.delay = delay;             // em ms
  }

  transmit(packet, onSuccess, onDrop, onCorrupt) {
    setTimeout(() => {
      const roll = Math.random() * 100;
      
      if (roll < this.lossProb) {
        if(onDrop) onDrop(packet);
        return; // Pacote perdido
      }

      if (roll < (this.lossProb + this.corruptProb)) {
        packet.checksumValid = false; // Simula corrupção de bits
        if(onCorrupt) onCorrupt(packet);
      } else {
        packet.checksumValid = true;
      }

      if(onSuccess) onSuccess(packet);
    }, this.delay);
  }
}