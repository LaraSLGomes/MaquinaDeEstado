const ipv4Bytes = (address = '0.0.0.0') => {
  const parts = String(address).split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error(`Endereço IPv4 inválido: ${address}`);
  }
  return parts;
};

const utf8Bytes = (value = '') => Array.from(new TextEncoder().encode(String(value)));
const appendWord = (bytes, value) => bytes.push((value >> 8) & 0xff, value & 0xff);

export function calculateUDPChecksum(packet) {
  const payload = utf8Bytes(packet.payload);
  const udpLength = 8 + payload.length;
  const bytes = [...ipv4Bytes(packet.srcIP), ...ipv4Bytes(packet.destIP), 0, 17];
  appendWord(bytes, udpLength);
  appendWord(bytes, Number(packet.srcPort));
  appendWord(bytes, Number(packet.destPort));
  appendWord(bytes, udpLength);
  appendWord(bytes, 0);
  bytes.push(...payload);
  if (bytes.length % 2) bytes.push(0);

  let sum = 0;
  for (let index = 0; index < bytes.length; index += 2) {
    sum += (bytes[index] << 8) | bytes[index + 1];
    sum = (sum & 0xffff) + (sum >>> 16);
  }
  const checksum = (~sum) & 0xffff;
  return checksum === 0 ? 0xffff : checksum;
}

const validUdpPacket = (packet) => {
  try {
    return Number.isInteger(packet.checksum) && calculateUDPChecksum(packet) === packet.checksum;
  } catch {
    return false;
  }
};

export const udpDefinition = {
  UDP_READY: [
    {
      event: 'APP_SEND_DATA',
      nextState: 'UDP_READY',
      action: (packet) => {
        packet.length = 8 + utf8Bytes(packet.payload).length;
        packet.checksum = calculateUDPChecksum(packet);
        return `Datagrama UDP ${packet.srcPort} → ${packet.destPort}, ${packet.length} bytes, checksum 0x${packet.checksum.toString(16).padStart(4, '0').toUpperCase()}`;
      },
    },
    {
      event: 'RECEIVE_DATA',
      condition: validUdpPacket,
      nextState: 'UDP_READY',
      action: () => 'Checksum válido; datagrama entregue à aplicação.',
      deliver: true,
    },
    {
      event: 'RECEIVE_DATA',
      condition: (packet) => !validUdpPacket(packet),
      nextState: 'UDP_READY',
      action: () => null,
      silent: true,
      discard: true,
    },
  ],
};

const selfLoop = (event, action) => ({ event, nextState: 'SYN_RCVD', action });

export const tcpConnectionDefinition = {
  CLOSED: [
    { event: 'APP_ACTIVE_OPEN', nextState: 'SYN_SENT', action: 'Envia SYN' },
    { event: 'APP_PASSIVE_OPEN', nextState: 'LISTEN', action: 'Aguarda conexão' },
  ],
  LISTEN: [
    { event: 'RCV_SYN', nextState: 'SYN_RCVD', action: 'Envia SYN+ACK' },
    { event: 'APP_CLOSE', nextState: 'CLOSED', action: 'Fecha porta' },
  ],
  SYN_SENT: [
    { event: 'RCV_SYN_ACK', nextState: 'ESTABLISHED', action: 'Envia ACK; conexão estabelecida' },
    { event: 'RCV_SYN', nextState: 'SYN_RCVD', action: 'Abertura simultânea; envia SYN+ACK' },
    { event: 'APP_CLOSE', nextState: 'CLOSED', action: 'Cancela abertura' },
  ],
  SYN_RCVD: [
    { event: 'RCV_ACK', nextState: 'ESTABLISHED', action: 'Conexão estabelecida' },
    selfLoop('RCV_SYN', 'SYN duplicado; retransmite SYN+ACK'),
  ],
  ESTABLISHED: [
    { event: 'APP_CLOSE', nextState: 'FIN_WAIT_1', action: 'Envia FIN' },
    { event: 'RCV_FIN', nextState: 'CLOSE_WAIT', action: 'Envia ACK do FIN' },
  ],
  FIN_WAIT_1: [
    { event: 'RCV_ACK', nextState: 'FIN_WAIT_2', action: 'FIN confirmado; aguarda FIN remoto' },
    { event: 'RCV_FIN', nextState: 'CLOSING', action: 'FIN simultâneo; envia ACK' },
  ],
  FIN_WAIT_2: [
    { event: 'RCV_FIN', nextState: 'TIME_WAIT', action: 'Envia ACK e inicia TIME_WAIT' },
  ],
  CLOSING: [
    { event: 'RCV_ACK', nextState: 'TIME_WAIT', action: 'FIN confirmado; inicia TIME_WAIT' },
  ],
  CLOSE_WAIT: [
    { event: 'APP_CLOSE', nextState: 'LAST_ACK', action: 'Envia FIN final' },
  ],
  LAST_ACK: [
    { event: 'RCV_ACK', nextState: 'CLOSED', action: 'FIN confirmado; conexão encerrada' },
  ],
  TIME_WAIT: [
    { event: 'TIMEOUT', nextState: 'CLOSED', action: '2×MSL expirado; conexão encerrada' },
  ],
};

export const tcpStatePositions = {
  CLOSED: [70, 150], LISTEN: [230, 70], SYN_SENT: [230, 230], SYN_RCVD: [410, 70],
  ESTABLISHED: [590, 150], FIN_WAIT_1: [760, 70], FIN_WAIT_2: [930, 70],
  CLOSING: [930, 230], TIME_WAIT: [760, 230], CLOSE_WAIT: [590, 300], LAST_ACK: [410, 300],
};