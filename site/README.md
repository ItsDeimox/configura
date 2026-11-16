# Ini Studio — landing page

Site de download do editor Windows. Projeto Vercel independente, dentro da pasta `site/` do repositório do aplicativo, evitando duplicação dos assets e da gestão de releases.

## Publicação

- Repositório: `ItsDeimox/configura`, branch `main`.
- Vercel: importe o repositório e configure **Root Directory = site**.
- Framework: **Other** (HTML, CSS e JavaScript sem build).
- Página principal: `site/index.html`; API: `site/api/releases.js`.

## Downloads e contador

A rota `/api/releases` consulta a API pública do GitHub, encontra a **release estável mais recente com instalador Windows x64** e retorna os links oficiais do .exe e do .zip. O contador soma o campo `download_count` dos **instaladores .exe e dos arquivos portáteis .zip** presentes nas últimas 100 releases estáveis. Não inclui `latest.yml`, checksums e arquivos automáticos do GitHub; não representa instalações ou usuários únicos.

A resposta é cacheada na Vercel por 15 minutos. Caso a função falhe, o navegador consulta a API pública diretamente; se ambas falharem, a página mantém o link para GitHub Releases e esconde o contador (nunca exibe número inventado).

O preview do editor é uma composição HTML/CSS **ilustrativa**, baseada nos controles e tokens visuais reais do aplicativo, não um screenshot.
