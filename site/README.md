# Ini Studio — site de downloads

**Produção:** https://ini-studio.vercel.app/  
**Fonte:** `ItsDeimox/configura`, branch `main`, pasta `site/`.  
**Deploy:** Vercel, projeto independente `ini-studio`, framework Other, root directory `site`, publicações automáticas via GitHub.

## Identidade visual / renderizador

- `index.html` + `style.css`: landing minimalista, logo original, prévia fiel à linguagem visual do app, bordas seletivas com iluminação radial, reflexos, hovers e transições.
- `energy-field.js`: shader real **GLSL ES 3.00 / WebGL2** com linhas que aparecem conforme a posição do mouse, nós luminosos e pulsos que percorrem arestas com dissipação.
- Solicita contexto `powerPreference: 'high-performance'`, mas **não é possível forçar GPU ou reativar WebGL** contra as configurações do navegador/sistema.
- Proteções: layer puramente decorativa, canvas sem receber cliques, 1,6 MP máximo de pixels de efeito, escala DPR ≤ 1,4, limite de 45 quadros/s desktop e 30 quadros/s mobile, pausa com a aba invisível, fallback CSS se WebGL falhar.
- Efeitos ligados por padrão, independentemente da configuração global de animações do Windows. Botão `Efeitos ativos` permite desligar e salva a preferência em `localStorage`. O conteúdo permanece legível e links funcionam mesmo com shaders indisponíveis.
- O preview da interface é **ilustrativo em HTML/CSS**, não é um screenshot nem editor funcional.

## Downloads e contador

A rota `/api/releases` consulta releases estáveis de `ItsDeimox/configura`, encontra o último instalador Windows x64 e retorna URLs oficiais do .exe e .zip. O total soma `download_count` desses binários das últimas 100 releases estáveis. Não representa instalações nem usuários únicos. A API é cacheada por 15 minutos; quando indisponível, há fallback no navegador e a página nunca fabrica números.

## QA / regressão

1. Verificar desktop e mobile, contraste, ausência de horizontal overflow e preview legível.
2. Verificar botões de download e `/api/releases` com binários e versão da release atual.
3. Com WebGL2 disponível, observar surgimento de linhas/nós ao mover mouse e verificar erros GLSL no console.
4. Sem WebGL2, confirmar fundo estático e todas as interações funcionais.
5. Acionar botão de efeitos, recarregar e confirmar que a preferência persiste.
6. Inspecionar hover do botão e a inclinação discreta do preview. Conferir navegação por teclado.
7. Testar quando o navegador usa `prefers-reduced-motion: reduce`: efeitos continuam controlados apenas pelo botão do site.
