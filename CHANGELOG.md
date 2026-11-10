# Changelog

As versões seguem Semantic Versioning. Cada release publicada corresponde a uma tag e a um commit específico; assets de uma versão publicada não são substituídos pelo workflow.

## 1.0.0 — 2026-11-09

### Adicionado

- Aplicativo Windows x64 com interface escura baseada na concept de Deimox.
- Abas, seções recolhíveis, busca, edição visual e editor de texto com números de linha.
- Controles de texto, número, booleano e enum; listas de enum personalizáveis.
- Abertura e gravação de arquivos locais, arrastar e soltar, arquivos recentes e atalhos.
- Parser conservador de configurações em texto, preservando conteúdo não editado, comentários, aspas, espaçamento e ordem.
- UTF-8 com/sem BOM, UTF-16 LE/BE com BOM e alternativa Windows-1252, com recusa de conversões com perda.
- Backup da versão anterior ao salvar, gravação por arquivo temporário e confirmação de conflitos externos.
- Histórico de desfazer/refazer e proteção de alterações pendentes ao fechar ou reiniciar.
- Instalador por usuário com atalhos, “Abrir com” e “Editar com Configura”, sem alterar o aplicativo padrão.
- ZIP para execução sem instalação.
- Verificação, download completo do instalador e instalação explícitos de atualizações por GitHub Releases.
- Logo e ícones vetoriais originais criados no Figma; fontes locais Inter e Share Tech.
- Licença MIT, testes de parser e operações de arquivo, smoke do Electron real como condição no workflow de release Windows e checksums SHA-256.
- Conferência de versão, nome, tamanho e SHA-512 do instalador em relação aos metadados de atualização antes da publicação.

### Limites conhecidos

- O editor visual não implementa integralmente todos os dialetos de INI/CFG nem TOML, JSON, XML, YAML ou shell. Use Texto para sintaxe não reconhecida.
- Limite de 10 MiB por arquivo; UTF-16 sem BOM e codificações antigas além de Windows-1252 não têm detecção específica.
- Backup mantém uma versão anterior; não há autosave ou recuperação de alterações nunca salvas após falha do processo.
- Primeira distribuição sem certificado Authenticode.
- Smoke nativo ainda não concluído no ambiente Linux de preparação; o workflow precisa executá-lo em Windows antes da publicação.
- O ciclo completo do atualizador depende de uma instalação Windows e de uma release posterior; esse cenário ainda não foi validado na primeira versão.
