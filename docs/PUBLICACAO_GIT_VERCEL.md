# Publicacao no Git e Vercel

## Antes de publicar

Este painel envia `data/desktop-impact-data.json` ao navegador. Portanto, os dados ficam acessiveis a qualquer pessoa que consiga abrir a URL. Use repositorio privado e habilite a protecao de acesso do projeto no Vercel antes de compartilhar o endereco.

O build nao publica planilhas, executavel, PowerPoint, Word, copias de trabalho ou caminhos locais do computador.

## Validar localmente

Abra o PowerShell na pasta do projeto:

```powershell
cd "C:\OneDrive - Claro SA\Jonathan\Desktop\ESTUDO_DESKTOP_OUTPUT\desktop-impact-dashboard"
npm.cmd run check
npm.cmd run dev
```

Endereco local esperado: `http://127.0.0.1:8097`

## Enviar para o GitHub

```powershell
git init
git add .
git commit -m "Publica Estudo Desktop Canal AA"
git branch -M main
git remote add origin URL_DO_REPOSITORIO_PRIVADO
git push -u origin main
```

Antes do `git commit`, confirme com `git status` que `DesktopImpact.exe`, planilhas, documentos e `source_copies/` nao aparecem na lista.

## Publicar no Vercel

1. No Vercel, escolha **Add New > Project**.
2. Importe o repositorio privado.
3. Em **Framework Preset**, use **Other**.
4. O projeto ja informa `npm run build` e a pasta de saida `dist` em `vercel.json`.
5. Publique e habilite **Deployment Protection** antes de distribuir o link.

Cada novo `git push` na branch principal gera uma nova versao automaticamente.

## Atualizar os dados

No computador que possui as bases:

```powershell
npm.cmd run data:update
npm.cmd run check
git add data/desktop-impact-data.json
git commit -m "Atualiza dados do Estudo Desktop"
git push
```

O script de dados le as fontes configuradas e atualiza os derivados. As bases originais nao sao modificadas.
