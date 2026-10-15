// Definição da FSM do UDP (Estado Único) - Requisito 4.2
export const udpDefinition = {
  "UDP_READY": [
    {
      event: "SEND_DATA",
      nextState: "UDP_READY",
      action: (data) => `Calculando Checksum e Enviando datagrama: ${data.length} bytes`
    },
    {
      event: "RECEIVE_DATA",
      condition: (packet) => packet.checksumValid === true,
      nextState: "UDP_READY",
      action: () => "Datagrama recebido e entregue à aplicação."
    },
    {
      event: "RECEIVE_DATA",
      condition: (packet) => packet.checksumValid === false,
      nextState: "UDP_READY",
      action: () => "Checksum inválido! Descartando silenciosamente."
    }
  ]
};

// Definição Simplificada da FSM de Conexão TCP (Figuras 3.41 e 3.42) - Requisito 4.3
export const tcpConnectionDefinition = {
  "CLOSED": [
    { event: "APP_ACTIVE_OPEN", nextState: "SYN_SENT", action: () => "Enviando segmento SYN" },
    { event: "APP_PASSIVE_OPEN", nextState: "LISTEN", action: () => "Aguardando conexões" }
  ],
  "LISTEN": [
    { event: "RCV_SYN", nextState: "SYN_RCVD", action: () => "Enviando SYN+ACK" }
  ],
  "SYN_SENT": [
    { event: "RCV_SYN_ACK", nextState: "ESTABLISHED", action: () => "Enviando ACK. Conexão estabelecida!" }
  ],
  "SYN_RCVD": [
    { event: "RCV_ACK", nextState: "ESTABLISHED", action: () => "Conexão estabelecida no servidor!" }
  ],
  "ESTABLISHED": [
    { event: "APP_CLOSE", nextState: "FIN_WAIT_1", action: () => "Enviando FIN" },
    { event: "RCV_FIN", nextState: "CLOSE_WAIT", action: () => "Enviando ACK do FIN" }
  ],
  "FIN_WAIT_1": [
    { event: "RCV_ACK", nextState: "FIN_WAIT_2", action: () => "Aguardando FIN do servidor" },
    { event: "RCV_FIN_ACK", nextState: "TIME_WAIT", action: () => "Enviando ACK (Simultaneous close)" }
  ],
  "FIN_WAIT_2": [
    { event: "RCV_FIN", nextState: "TIME_WAIT", action: () => "Enviando ACK. Iniciando timer de TIME_WAIT" }
  ],
  "CLOSE_WAIT": [
    { event: "APP_CLOSE", nextState: "LAST_ACK", action: () => "Enviando FIN final" }
  ],
  "LAST_ACK": [
    { event: "RCV_ACK", nextState: "CLOSED", action: () => "Conexão encerrada com sucesso." }
  ],
  "TIME_WAIT": [
    { event: "TIMEOUT", nextState: "CLOSED", action: () => "Timer 2xMSL expirado. Conexão fechada." }
  ]
};