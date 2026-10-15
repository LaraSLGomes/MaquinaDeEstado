# Laboratório de FSM: TCP e UDP

Simulador didático de máquinas de estado de transporte. O núcleo funciona em Node.js sem React; a interface React apresenta estados, eventos, segmentos e métricas da simulação.

## Executar

Requisitos: Node.js 20 ou superior.

```sh
npm install
npm run dev
npm test
npm run build
npm run lint
```

## Arquitetura

- `src/engine/FSMEngine.js`: motor de transições dirigido por definições, independente da GUI.
- `src/engine/fsmDefinitions.js`: estados TCP, transições e FSM UDP de estado único, além do checksum UDP IPv4.
- `src/engine/VirtualClock.js`: fila de eventos e timers sem depender do relógio de parede.
- `src/engine/Channel.js`: perda, corrupção, atraso variável, duplicação, reordenação, descarte manual e PRNG com seed.
- `src/engine/NetworkSimulator.js`: hosts A/B, handshake, encerramento, retransmissão, RTT/RTO, ACK cumulativo, fast retransmit, UDP e métricas.
- `src/engine/testScenarios.js`: cenários executáveis sem importar React.
- `src/App.jsx`: interface e visualizações; não implementa regras de transporte.

O canal e o relógio usam o mesmo gerador pseudoaleatório com seed para reproduzir uma execução. O relógio pode avançar um evento por vez ou até esvaziar a fila. Os timers TCP são virtuais, incluindo retransmissão e TIME_WAIT.

## Testes automatizados

`npm test` executa os dez cenários do trabalho e termina com código diferente de zero quando qualquer asserção falha. O relatório mostra o status por cenário e a comparação de entrega UDP/TCP.

1. Handshake TCP sem falhas.
2. Perda do SYN e retransmissão.
3. Perda do SYN-ACK e recuperação com SYN/SYN-ACK retransmitidos.
4. Encerramento normal de quatro vias.
5. Fechamento simultâneo via CLOSING.
6. Fast retransmit após três ACKs duplicados.
7. RST ao atingir porta TCP fechada.
8. Perda UDP sem retransmissão.
9. Descarte UDP silencioso por checksum inválido.
10. Comparação UDP × TCP sob os mesmos parâmetros de canal.

## Interface

Selecione TCP ou UDP; ajuste as probabilidades de perda, corrupção, duplicação e reordenação, o intervalo de atraso, a seed e o tempo de TIME_WAIT. No TCP, inicie a conexão A↔B, envie os segmentos da caixa de texto ou percorra os fechamentos. `Descartar próximo segmento` injeta uma perda determinística. `Passo`, `Iniciar`, `Pausar`, velocidade e `Reset` controlam o relógio virtual. O botão de comparação executa uma carga comum em duas simulações isoladas.

Os segmentos são representados no diagrama de sequência; o grafo destaca os estados atuais de A e B; o log de transições é filtrável por host e conteúdo.
