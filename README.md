<p align="center"><img src="build/icon.svg" width="86" alt="Símbolo do Configura"></p>

<h1 align="center">Configura</h1>

<p align="center">Seu arquivo de configuração, com espaço para respirar.<br>Editor visual para Windows · x64 · MIT</p>

Uma interface escura e direta para ler e editar configurações: abas no topo, seções recolhíveis no centro e valores com controles próprios. Texto em azul, números em verde, booleanos em coral e listas em violeta. Baseado na concept original de Deimox, com transições suaves e ícones vetoriais feitos no Figma.

## Instalação

O canal de distribuição do projeto é [GitHub Releases](https://github.com/ItsDeimox/configura/releases). Uma versão só está publicada quando seus arquivos aparecem nessa página.

| Arquivo | Uso |
| --- | --- |
| `Configura-Setup-1.0.0-x64.exe` | Instalador por usuário, com atalhos, **Abrir com** e **Editar com Configura**. |
| `Configura-1.0.0-x64.zip` | Extraia a pasta inteira e execute `Configura.exe`. Mantenha os arquivos acompanhantes. |
| `SHA256SUMS.txt` | Hash SHA-256 dos downloads da release. |

Requer Windows 10/11 de 64 bits. Não precisa instalar Node.js para usar o aplicativo. O instalador deixa escolher a pasta e não exige privilégios de administrador. A versão ZIP não registra opções do Explorer; para a integração e as atualizações, prefira o instalador.

A primeira distribuição **não tem assinatura Authenticode**. Por isso, o Windows pode mostrar “editor desconhecido” ou uma tela do SmartScreen. Os hashes permitem conferir a integridade do download, mas não substituem uma assinatura de identidade.

### Abrir com

Depois de instalar, clique com o botão direito no arquivo e escolha **Abrir com → Configura**. O menu também pode mostrar **Editar com Configura**; no Windows 11, procure em **Mostrar mais opções** quando necessário. O instalador adiciona o Configura como opção, sem substituir o aplicativo padrão existente.

## Usando o editor

- Abra arquivos pelo botão **+**, por `Ctrl+O`, arrastando para a janela ou pelo Explorer. Arquivos abertos pelo Windows entram na mesma instância do app.
- Clique no valor para editar. Booleanos têm interruptor; números têm ajuste por passos; enums exibem suas opções.
- Passe sobre uma propriedade e escolha seu **tipo**. Em **Tipos**, crie ou edite listas como Resolution, Quality e Difficulty. Trocar o controle não converte o conteúdo do arquivo por conta própria.
- Recolha seções, busque por nomes ou valores e alterne entre **Visual** e **Texto**.
- Use **save** para gravar e **reset** para voltar à última versão salva. O reset também pode ser desfeito.
- Uma marca na aba indica alterações pendentes. Antes de fechar uma aba, sair ou reiniciar para atualizar, o app pede uma decisão sobre o que ainda não foi salvo.

Os arquivos de exemplo exibidos na primeira abertura servem para explorar a interface. Eles só viram arquivos reais quando você escolhe onde salvá-los.

### Atalhos

| Ação | Atalho |
| --- | --- |
| Abrir arquivo | `Ctrl+O` |
| Novo arquivo | `Ctrl+N` |
| Salvar | `Ctrl+S` |
| Salvar como | `Ctrl+Shift+S` |
| Buscar | `Ctrl+F` |
| Desfazer / refazer | `Ctrl+Z` / `Ctrl+Y` ou `Ctrl+Shift+Z` |
| Fechar aba | `Ctrl+W` |
| Próxima / aba anterior | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Preferências | `Ctrl+,` |

## Formatos e preservação

O editor visual reconhece configurações em texto com seções `[nome]` e atribuições `chave=valor` ou `chave:valor`. Essa estrutura aparece em muitos arquivos `.ini`, `.cfg`, `.conf`, `.cnf`, `.properties`, `.env` e `.config`. A extensão sozinha não define a sintaxe.

Na edição visual, o parser altera somente o valor escolhido: mantém comentários, espaços, ordem, duplicatas, aspas e finais de linha das partes não editadas. Linhas desconhecidas permanecem no arquivo. Booleanos reconhecem `true/false`, `yes/no` e `on/off`; números com zeros à esquerda são tratados como texto para preservar sua representação.

**Limites da versão 1.0:** não é um parser completo de TOML, JSON, XML, YAML, shell ou de todos os dialetos CFG. Sintaxe complexa, multilinha ou não reconhecida deve ser editada no modo **Texto**. O app não executa configurações, não expande variáveis e não valida regras específicas do jogo ou programa que utiliza o arquivo. `.toml` aparece no “Abrir com” para permitir edição textual; isso não significa suporte visual completo ao formato.

Arquivos têm limite de **10 MiB**. São aceitos UTF-8 com ou sem BOM, UTF-16 LE/BE com BOM e Windows-1252 como alternativa para bytes que não forem UTF-8 válido. Sem um marcador explícito, a identificação de codificações antigas é uma convenção, não uma detecção universal. Arquivos binários ou que não possam ser regravados com os mesmos bytes são recusados.

Ao salvar, a codificação original é mantida. Se você inserir um caractere que não existe em Windows-1252, o app impede a conversão com perda; **Salvar como** oferece criar uma cópia em UTF-8.

## Backups e recuperação

**Backup ao salvar** vem ativado. Antes de substituir um arquivo existente, a versão anterior é guardada ao lado dele:

```text
GameData.ini
GameData.ini.configura.bak
```

O backup guarda **uma versão anterior**, sendo atualizado a cada gravação que muda o conteúdo. Para recuperar, feche a aba correspondente e copie o `.configura.bak` para o nome original, ou abra o backup e use **Salvar como**. Salvar sem mudanças não renova o backup.

A gravação usa um arquivo temporário na mesma pasta e substituição por rename. Se outro programa alterar o arquivo desde sua abertura, o Configura mostra um conflito antes de sobrescrever. Não há autosave nem recuperação de alterações que nunca foram salvas após uma falha do processo.

Preferências, listas de enums, arquivos recentes e posição da janela ficam no perfil local do aplicativo. A desinstalação preserva esses dados. A edição funciona offline; a verificação de atualizações consulta o GitHub quando solicitada.

## Atualizações

Na versão instalada, abra **Preferências → Atualizações → Verificar atualizações**. Se houver uma release estável mais nova, escolha **Baixar atualização** e depois **Reiniciar e atualizar**. Download e instalação exigem ações explícitas. O app verifica alterações pendentes antes de reiniciar.

O canal configurado é `ItsDeimox/configura` no GitHub. Atualizações dependem de uma release publicada contendo o instalador e `latest.yml`. Esta versão baixa o **instalador completo**, sem exigir download diferencial ou blockmap. Antes da primeira publicação, a consulta pode retornar que o canal ainda não está disponível. O ciclo completo de atualização só pode ser validado com uma instalação Windows e uma release posterior; não é apresentado como já testado nesta primeira versão. Para a distribuição ZIP, use o download e a substituição manual da pasta.

## Desenvolvimento

Use **Node.js 24**, npm e Git:

```bash
npm ci
npm run dev:desktop
```

Comandos do projeto:

```bash
npm test                 # Parser, preservação e demais testes em tests/
npm run test:native      # Arquivos reais, codificações, backups e conflitos
npm run build           # TypeScript + interface de produção
npm run dist:win         # Instalador NSIS e ZIP para Windows x64
node scripts/qa-native.mjs # Smoke do Electron real, depois de npm run build
```

O workflow de release compila e testa no Windows. O instalador usa NSIS com um script próprio e o ícone/recursos do executável são aplicados durante o empacotamento. `npm run dev` serve apenas a interface para desenvolvimento; abrir essa página no navegador não transforma o site no aplicativo instalado.

O smoke nativo abre o Electron real, verifica a abertura de arquivos pela linha de comando, edição e gravação, BOM/CRLF, backup, cancelamento de fechamento e envio de arquivos à instância existente. No workflow, o instalador é executado silenciosamente em uma pasta temporária e o smoke usa o `Configura.exe` instalado. Também são conferidos os registros **Abrir com**, a preservação dos aplicativos padrão e a limpeza da desinstalação. A publicação depende desses testes; um teste de atualização entre duas releases continua sendo uma validação separada.

## Publicando uma versão

O workflow [`Windows release`](.github/workflows/release.yml) roda na `main` quando `package.json`, `package-lock.json` ou o próprio workflow mudam. Também pode ser iniciado manualmente na página Actions.

1. Atualize a versão com `npm version patch --no-git-tag-version` ou escolha `minor`/`major`.
2. Atualize o [changelog](CHANGELOG.md), faça commit e envie para `main`.
3. O workflow instala as dependências do lockfile, roda os testes, compila o instalador, valida a instalação e o aplicativo real em Windows e publica `v<versão>` com os arquivos de atualização e checksums.

Antes de publicar, também confere se o nome, a versão e o SHA-512 do instalador correspondem a `latest.yml`, além do tamanho quando informado nos metadados. Blockmaps, se forem gerados por uma configuração futura, são incluídos; a configuração atual usa downloads completos.

A tag é criada no commit exato do build. Se a mesma versão já foi publicada a partir desse commit, o workflow encerra sem alterar assets. Se a tag aponta para outro commit, ele falha e pede uma nova versão. Um draft remanescente de falha precisa ser inspecionado antes da nova tentativa; o workflow não substitui uma release existente.

As actions de checkout e Node estão fixadas em SHAs. A publicação usa o `GITHUB_TOKEN` temporário do workflow com `contents: write`; nenhuma credencial de publicação é incluída no executável.

Para a primeira publicação pelo seu computador, com GitHub CLI autenticado na conta `ItsDeimox`, há o script [`scripts/publish-github.ps1`](scripts/publish-github.ps1). Ele cria o repositório público se estiver ausente e envia a `main` sem force push. Se você já criou um repositório com histórico diferente, ele não o sobrescreve.

## Licença e design

Código e ícones originais sob [MIT](LICENSE). Dependências e fontes conservam suas próprias licenças, relacionadas em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

[Ícones no Figma](https://www.figma.com/design/XiCmRxhmvMzhClgdqWz15a/Configura-Icons?node-id=2-68) · [Detalhes dos assets](docs/figma-assets.md)
