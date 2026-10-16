# Simulador de FSM: TCP e UDP

Aplicação web interativa para explorar máquinas de estados finitos (FSM) e alguns mecanismos dos protocolos TCP e UDP. O simulador representa dois hosts, A e B, que trocam segmentos e datagramas por um canal de rede configurável.

O canal pode introduzir perda, corrupção, duplicação, reordenação e atraso. Uma seed controla a sequência pseudoaleatória para facilitar a reprodução de uma simulação.

O projeto é uma ferramenta didática inspirada nos tópicos de protocolos de transporte de *Redes de Computadores e a Internet*, de Kurose e Ross. Não implementa as pilhas TCP/IP do sistema operacional nem pretende cobrir todas as regras das especificações dos protocolos.

## Começar

### Pré-requisitos

- Node.js `^20.19.0` ou `>=22.12.0` (requisito do Vite 8).
- npm.

Na raiz do projeto, instale as dependências e inicie o servidor de desenvolvimento:

```bash
npm install
npm run dev
```

Abra no navegador o endereço mostrado pelo Vite, normalmente `http://localhost:5173`.

### Fluxo rápido

1. Escolha TCP ou UDP no seletor de protocolo.
2. Ajuste as probabilidades de falha, o intervalo de atraso e a seed no painel do canal.
3. Para TCP, inicie o handshake antes de enviar segmentos. Para UDP, envie um datagrama diretamente.
4. Use **Passo** para avançar um evento do relógio virtual ou **Iniciar** para processar a fila continuamente; **Pausar** interrompe a execução.
5. Observe os estados dos hosts, o diagrama de sequência, as métricas e o log de transições. Use **Reset** para começar de novo com a configuração atual.
6. Use **Comparar UDP × TCP** para executar a mesma carga nos dois protocolos com os parâmetros atuais do canal.

No campo **Dados de teste**, cada linha representa um segmento TCP. No modo UDP, as linhas são combinadas em um único datagrama.

## O que é simulado

- **FSM TCP orientada por dados:** estados e transições de conexão são descritos em `src/engine/fsmDefinitions.js`. A simulação inclui abertura, handshake de três vias, encerramento normal e simultâneo, `TIME_WAIT`, retransmissão por timeout, fast retransmit após três ACKs duplicados e resposta RST para tráfego dirigido a uma porta fechada.
- **Entrega de dados TCP:** segmentos são retransmitidos quando necessário e entregues em ordem nos cenários implementados.
- **UDP sem conexão:** datagramas podem ser perdidos, duplicados ou entregues fora de ordem; o protocolo não tenta retransmiti-los.
- **Checksum UDP:** cálculo de checksum de 16 bits usando complemento de 1 e pseudo-cabeçalho IPv4. Pacotes inválidos são descartados sem aviso ao remetente, como ilustração do comportamento sem confiabilidade do UDP.
- **Relógio virtual:** eventos e timeouts avançam em uma fila lógica, sem esperar o tempo real de rede. Isso permite repetir cenários e testar resultados rapidamente.

### Termos usados na interface

- **RTO (Retransmission Timeout):** intervalo estimado antes de retransmitir um segmento sem confirmação. A simulação atualiza a estimativa de timeout a partir de amostras de RTT.
- **RTT (Round-Trip Time):** tempo entre o envio de um segmento e o recebimento de sua confirmação.
- **2×MSL / TIME_WAIT:** intervalo simulado de espera antes de encerrar completamente uma conexão TCP.
- **Seed:** valor inicial do gerador pseudoaleatório do canal. Mantendo seed e configuração, é possível reproduzir sequências de falhas.

## Estrutura

```text
src/
	engine/       Motor FSM, canal, relógio virtual, simulador e cenários de teste
	App.jsx       Interface React, controles da simulação, diagramas e métricas
test-runner.js  Execução dos cenários automatizados
```

O núcleo em `src/engine` usa JavaScript e não depende do React. A interface chama o simulador para configurar e executar ações, e apresenta o estado resultante. Assim, a lógica central pode ser testada pelo Node sem abrir o navegador; a interface, por sua vez, é servida pelo Vite.

## Comandos

```bash
npm run dev      # inicia o servidor de desenvolvimento
npm test         # executa os cenários automatizados do simulador
npm run lint     # verifica problemas de código com oxlint
npm run build    # gera a versão de produção em dist/
npm run preview  # serve localmente a versão gerada pelo build
```

Para testar a versão de produção, execute `npm run build` e depois `npm run preview`.

## Referência

Kurose, James F.; Ross, Keith W. *Redes de Computadores e a Internet: uma abordagem top-down*. Consulte o capítulo sobre a camada de transporte; a numeração e a edição variam entre edições do livro.