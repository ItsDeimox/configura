# Ini Studio — site de downloads

**Produção:** https://ini-studio.vercel.app/  
**Fonte:** `ItsDeimox/configura`, branch `main`, pasta `site/`.  
**Deploy:** Vercel, projeto independente `ini-studio`, framework Other, root directory `site`, publicações automáticas via GitHub.

## Identidade visual / renderizador

- `index.html` + `style.css`: landing minimalista, logo original, prévia ilustrativa do app com letras renderizadas diretamente (sem inclinação 3D que borrava texto), reflexos especulares brancos no botão e linhas de 1 px. O antigo filtro SVG de ruído com `feTurbulence` e o blur fixo foram substituídos por microtextura CSS de pixels precisos. Não há bloom global sobre textos.
- `energy-field.js`: shader real **GLSL ES 3.00 / WebGL2** com linhas que aparecem conforme a posição do mouse, nós luminosos e pulsos que percorrem arestas com dissipação.
- Solicita contexto `powerPreference: 'high-performance'`, mas **não é possível forçar GPU ou reativar WebGL** contra as configurações do navegador/sistema. A interface tenta oferecer contraste e realces de alta definição com sRGB e `display-p3` quando disponível; **HDR físico (luminância ampliada) não pode ser imposto pelo site**.
- Proteções de performance (revisão 16/11/2026): campo de luz **local de 420×420 CSS px** com **DPR até 1,85**, limite de **~620 mil pixels por quadro**, desenho só depois de interação com o mouse (**até 24 FPS por ~420 ms**), suspensão imediata durante scroll, pausa em abas ocultas, **sem WebGL em telas de toque** e fallback CSS se WebGL falhar.
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

## Validação da revisão de nitidez / desempenho

- Desktop (1440×900): página, CSS, JS e endpoint de releases responderam com HTTP 200. Console sem erros de script. Botão continua apontando para a release real 1.1.0.
- Scroll repetido no browser de teste avançou até a seção do aplicativo sem travamento e sem overflow horizontal. O microshader só inicializa quando o mouse se move.
- O navegador automatizado de QA não oferece WebGL2 (fallback CSS ativado). Portanto, a compilação e o tempo real de execução na GPU do visitante precisam ser observados num navegador com aceleração habilitada; não afirmar que foram validados neste ambiente.
