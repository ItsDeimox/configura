# Validação da versão 1.0.0

## Verificações concluídas

| Área | Resultado |
| --- | --- |
| TypeScript e build de produção Vite | Aprovados |
| Parser e edição de texto sem normalização destrutiva | 56 testes aprovados |
| Arquivos reais, codificações e ponte IPC | 20 testes aprovados |
| Interface em Chromium real | 10 cenários aprovados; nenhum erro de console |
| Interface em 1366 × 768 | Sem overflow; ação de salvar acessível |
| Interface em 1366 × 850 | Captura inspecionada contra a concept |
| Compilação do script NSIS | Aprovada com warnings tratados como erros |
| Recursos do executável | PE x64, nome/versão e sete tamanhos de ícone conferidos |

Os cenários de navegador verificam abertura e download de arquivos com BOM,
comentários e CRLF preservados; edição de números, booleanos, textos com espaços
e aspas; desfazer; inserção com Tab; enums personalizados; busca; inclusão de
propriedades; chaves/seções duplicadas; cancelamento do fechamento; salvamento
antes de fechar; sobreposição de diálogos e proteção de atalhos durante modais.

O cenário de cancelamento da caixa nativa usa uma implementação de teste do
contrato `window.configura`. Ele verifica a interface, sem substituir o teste do
Electron real.

## Limites desta validação

O ambiente de compilação é Linux e impede os sockets Unix necessários para
abrir a janela Electron. O teste nativo real foi tentado e interrompido pelo
ambiente, antes de carregar a interface. Não foi apresentado como aprovado.

O instalador precisa ser executado em Windows para validar sua instalação,
desinstalação, registro no Explorer e inicialização final nesse sistema. O
workflow exige o smoke do Electron em Windows antes da publicação da release;
ele não substitui um ensaio completo do instalador.

O ciclo de atualização entre duas versões ainda precisa de uma instalação
Windows e uma release posterior disponível no repositório. O mecanismo de
consulta, download completo e reinicialização está implementado; não há uma
atualização posterior fictícia na primeira versão.

## Reproduzir

```sh
npm ci
npm run build
npm test
npm run test:native
node scripts/qa-ui.mjs --serve
node scripts/qa-native.mjs
npm run dist:win
```

Para os testes de navegador, configure `CHROMIUM_EXECUTABLE` para um Chromium
instalado. O script `--serve` inicia seu próprio servidor. O teste nativo exige
um ambiente capaz de abrir janelas Electron, como o runner Windows do workflow.
