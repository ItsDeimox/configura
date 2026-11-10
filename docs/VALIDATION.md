# Validação da versão 1.0.0

Release publicada em 10 de novembro de 2026, após aprovação do
[workflow Windows](https://github.com/ItsDeimox/configura/actions/runs/42752326000).
O build validado corresponde ao commit `32c666e8413a814638b420d3083361f4fb3794e8`.

## Verificações concluídas

| Área | Resultado |
| --- | --- |
| TypeScript e build de produção Vite | Aprovados |
| Parser e edição de texto sem normalização destrutiva | 56 testes aprovados |
| Arquivos reais, codificações e ponte IPC | 20 testes aprovados no Linux; 19 aprovados e 1 de link simbólico ignorado no Windows |
| Interface em Chromium real | 10 cenários aprovados; nenhum erro de console |
| Interface em 1366 × 768 | Sem overflow; ação de salvar acessível |
| Interface em 1366 × 850 | Captura inspecionada contra a concept |
| Compilação do script NSIS | Aprovada com warnings tratados como erros |
| Recursos do executável | PE x64, nome/versão e sete tamanhos de ícone conferidos |
| Aplicativo instalado em Windows | 8 verificações reais aprovadas no `Configura.exe` instalado |
| Instalação, Abrir com e desinstalação | 5 verificações aprovadas, com preservação dos aplicativos padrão e da pasta pai |
| Metadados de atualização e publicação | Nome, versão e SHA-512 conferidos; instalador, ZIP, `latest.yml` e checksums publicados |

Os cenários de navegador verificam abertura e download de arquivos com BOM,
comentários e CRLF preservados; edição de números, booleanos, textos com espaços
e aspas; desfazer; inserção com Tab; enums personalizados; busca; inclusão de
propriedades; chaves/seções duplicadas; cancelamento do fechamento; salvamento
antes de fechar; sobreposição de diálogos e proteção de atalhos durante modais.

O cenário de cancelamento da caixa nativa usa uma implementação de teste do
contrato `window.configura`. Ele verifica a interface, sem substituir o teste do
Electron real.

O workflow executou o instalador silenciosamente em uma pasta temporária,
conferiu os arquivos extraídos e os comandos de oito extensões no registro,
abriu o executável instalado e validou edição, salvamento, backup, BOM/CRLF,
sandbox, cancelamento de fechamento, desfazer e abertura pela segunda instância.
Depois, desinstalou e verificou a remoção dos arquivos e registros do app,
mantendo as associações padrão de `.ini`/`.cfg` e um arquivo na pasta pai.

## Limites desta validação

A execução nativa foi aprovada no runner Windows do GitHub Actions. A tentativa
anterior no ambiente Linux havia sido bloqueada antes de carregar a interface;
ela não foi contada como sucesso. O smoke do instalador cobre a instalação
silenciosa e não substitui testes de todas as telas interativas, políticas
corporativas ou diferentes versões/configurações de Windows.

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
