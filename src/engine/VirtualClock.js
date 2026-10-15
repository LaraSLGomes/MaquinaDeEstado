export class VirtualClock {
  constructor() {
    this.now = 0;
    this.queue = [];
    this.nextId = 1;
  }

  schedule(delay, callback, label = "event") {
    const task = {
      id: this.nextId++,
      at: this.now + Math.max(0, Number(delay) || 0),
      callback,
      label,
      cancelled: false,
    };
    this.queue.push(task);
    return task;
  }

  cancel(task) {
    if (task) task.cancelled = true;
  }

  runNext() {
    this.queue.sort((left, right) => left.at - right.at || left.id - right.id);
    while (this.queue.length) {
      const task = this.queue.shift();
      if (task.cancelled) continue;
      this.now = task.at;
      task.callback();
      return true;
    }
    return false;
  }

  runUntilIdle(maxEvents = 10000) {
    let count = 0;
    while (this.queue.length && count < maxEvents) {
      this.runNext();
      count += 1;
    }
    if (this.queue.length) throw new Error(`Limite de ${maxEvents} eventos do relógio excedido.`);
    return count;
  }

  clear() {
    this.queue = [];
    this.now = 0;
    this.nextId = 1;
  }

  get pendingCount() {
    return this.queue.filter((task) => !task.cancelled).length;
  }
}
