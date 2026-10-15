export class FSMEngine {
  constructor(name, definition, initialState) {
    this.name = name;
    this.definition = definition; // As regras da FSM (estados e transições)
    this.currentState = initialState;
    this.logs = [];
  }

  processEvent(eventName, conditionParam = null) {
    const stateTransitions = this.definition[this.currentState];
    
    if (!stateTransitions) {
      this.log(`[ERRO] Estado atual '${this.currentState}' não existe na definição.`);
      return false;
    }

    // Busca a transição correspondente ao evento
    const transition = stateTransitions.find(t => t.event === eventName);

    if (!transition) {
      this.log(`[REJEITADO] Evento '${eventName}' inválido para o estado '${this.currentState}'.`);
      return false;
    }

    // Verifica condição (se existir)
    if (transition.condition && !transition.condition(conditionParam)) {
      this.log(`[REJEITADO] Evento '${eventName}' ocorreu, mas a condição falhou.`);
      return false;
    }

    const oldState = this.currentState;
    this.currentState = transition.nextState;
    
    // Executa a ação da transição
    let actionResult = "Nenhuma ação";
    if (transition.action) {
      actionResult = transition.action(conditionParam);
    }

    this.log(`[TRANSICAO] ${oldState} --(${eventName})--> ${this.currentState} | Ação: ${actionResult}`);
    return true;
  }

  log(message) {
    const timestamp = new Date().toISOString().substring(11, 19);
    this.logs.unshift(`[${timestamp}] ${this.name}: ${message}`);
  }

  getLogs() {
    return this.logs;
  }

  getState() {
    return this.currentState;
  }
}