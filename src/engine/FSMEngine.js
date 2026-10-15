export class FSMEngine {
  constructor(name, definition, options = {}) {
    const normalized = typeof options === 'string' ? { initialState: options } : options;
    const { initialState, now = () => 0 } = normalized;
    this.name = name;
    this.definition = definition;
    this.currentState = initialState;
    this.now = now;
    this.logs = [];
    this.history = [];
  }

  processEvent(eventName, params = {}) {
    const transitions = this.definition[this.currentState];
    if (!transitions) {
      this.log(`[ERRO] Estado '${this.currentState}' não existe na definição.`);
      return false;
    }

    let transition;
    try {
      transition = transitions.find((candidate) =>
        candidate.event === eventName &&
        (candidate.condition === undefined || candidate.condition(params))
      );
    } catch (error) {
      this.log(`[ERRO] Condição de '${eventName}' falhou: ${error.message}`);
      return false;
    }

    if (!transition) {
      this.log(`[REJEITADO] Evento '${eventName}' inválido em '${this.currentState}'.`);
      return false;
    }

    const previousState = this.currentState;
    let actionResult = transition.actionLabel ?? 'Nenhuma ação';
    try {
      if (typeof transition.action === 'function') actionResult = transition.action(params);
      else if (typeof transition.action === 'string') actionResult = transition.action;
    } catch (error) {
      this.log(`[ERRO] Ação de '${eventName}' falhou: ${error.message}`);
      return false;
    }

    this.currentState = transition.nextState;
    const result = {
      time: this.now(),
      host: this.name,
      previousState,
      event: eventName,
      action: actionResult,
      nextState: this.currentState,
      silent: Boolean(transition.silent),
      deliver: Boolean(transition.deliver),
      discard: Boolean(transition.discard),
    };
    this.history.push(result);
    if (!result.silent) {
      this.log(`[TRANSICAO] ${previousState} --(${eventName})--> ${this.currentState} | ${actionResult}`);
    }
    return result;
  }

  log(message) {
    this.logs.unshift(`[${this.now()} ms] ${this.name}: ${message}`);
  }

  getLogs() { return [...this.logs]; }
  getHistory() { return [...this.history]; }
  getState() { return this.currentState; }

  reset(initialState) {
    this.currentState = initialState;
    this.logs = [];
    this.history = [];
  }
}
