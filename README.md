# Estudo Desktop - Canal AA

Dashboard estatico para analisar a atuacao Desktop, a capilaridade das lojas Canal AA e Vivo, shares municipais, cobertura, capacidade e agrupamentos territoriais no interior de Sao Paulo.

## Estrutura

- `index.html`, `app.js` e `styles.css`: aplicacao web.
- `data/desktop-impact-data.json`: base derivada usada pelo navegador.
- `vendor/`: React e Leaflet locais, sem dependencia de CDN.
- `scripts/`: build, validacao e servidor local da versao web.
- `tools/`: processamento e validacao das bases de origem.
- `docs/`: instrucoes de publicacao.
- `source_copies/` e `source_working/`: copias locais ignoradas pelo Git.
- `DesktopImpact.exe` e `launcher.py`: modo desktop local, nao publicado no Vercel.

## Rodar como site

No PowerShell:

```powershell
cd "C:\OneDrive - Claro SA\Jonathan\Desktop\ESTUDO_DESKTOP_OUTPUT\desktop-impact-dashboard"
npm.cmd run check
npm.cmd run dev
```

Abra `http://127.0.0.1:8097`.

Outros comandos:

- `npm.cmd run build`: gera a versao publicavel em `dist/`.
- `npm.cmd run preview`: gera e abre um servidor em `http://127.0.0.1:4173`.
- `npm.cmd run data:update`: reprocessa as fontes configuradas.
- `npm.cmd run check`: valida JavaScript, estrutura publicada, totais principais e ausencia de caminhos locais.

## Rodar como aplicativo local

Execute `DesktopImpact.exe` ou `Abrir_Dashboard.bat`. Esse modo continua disponivel, mas seus arquivos nao entram no Git nem no Vercel.

## Atualizar as bases

O arquivo `dashboard_config.json` aponta para a pasta das fontes. O processo le:

- `ESTUDO_DESKTOP_OUTPUT/input_ESTUDO_DESKTOP_V3xlsx.xlsx`
- `ESTUDO_DESKTOP_OUTPUT/input_BASE_CIDADES_APOIO.xlsx`
- `Senha_Ago.csv`
- `Fluxo.csv`

As fontes originais nao sao alteradas. Copias de trabalho ficam em `source_working/` e resultados derivados em `data/`.

## Publicacao

Leia [`docs/PUBLICACAO_GIT_VERCEL.md`](docs/PUBLICACAO_GIT_VERCEL.md).

O JSON usado pelo painel e entregue ao navegador. Para dados corporativos, mantenha o repositorio privado e proteja o acesso ao projeto Vercel.
