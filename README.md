# Catálogo Amvox — Associados

Catálogo de itens de TI para associados reservarem, com avaliação do DP para
compras em crédito em folha. Front-end estático (`index.html`) + uma função
serverless (`api/storage.js`) que guarda tudo (catálogo, reservas/chamados)
num banco Redis (Upstash), pra funcionar igual pra todo mundo que acessar o
link — sem depender do Claude.

## Estrutura

```
.
├── index.html          → todo o catálogo (HTML + CSS + JS num arquivo só)
├── api/
│   └── storage.js       → função serverless (GET/POST/DELETE) que fala com o Redis
├── package.json
├── .gitignore
└── .env.example
```

## Passo a passo para colocar no ar (Git + Vercel)

### 1. Suba este projeto pro GitHub

```bash
cd amvox-catalogo-vercel
git init                       # se ainda não tiver sido feito
git add -A
git commit -m "Catálogo Amvox"
```

Crie um repositório vazio no GitHub (github.com/new) e depois:

```bash
git remote add origin https://github.com/SEU-USUARIO/amvox-catalogo.git
git branch -M main
git push -u origin main
```

### 2. Importe o repositório na Vercel

1. Entre em [vercel.com/new](https://vercel.com/new)
2. Clique em **"Import Git Repository"** e escolha o repositório que você acabou de criar
3. Não precisa mudar nenhuma configuração de build — é um projeto estático + API, a Vercel detecta sozinha
4. Clique em **Deploy**

A partir daqui, todo `git push` pro `main` atualiza o site automaticamente (esse é o "Git integration" — deploy contínuo).

### 3. Conecte um banco Redis (obrigatório para as reservas funcionarem)

O catálogo em si vai abrir sem isso, mas **reservar item, aprovar/reprovar no DP e gerenciar o catálogo não vão funcionar** sem um banco conectado.

1. No dashboard do projeto na Vercel, vá em **Storage**
2. Clique em **Create Database** (ou **Browse Marketplace**) → escolha **Upstash** → **Redis**
3. Crie o banco (o plano gratuito é suficiente para esse uso) e **conecte ao projeto**
4. Isso injeta automaticamente as variáveis `KV_REST_API_URL` e `KV_REST_API_TOKEN` no projeto
5. Vá em **Deployments** e clique em **Redeploy** no último deploy, pra ele já subir com as variáveis novas

### 4. Teste

Abra a URL que a Vercel te deu (algo como `https://amvox-catalogo.vercel.app`), selecione um item e finalize uma reserva. Se aparecer o protocolo (ex: `AMX-00001`), está tudo funcionando.

## Código de acesso do Painel Administrativo

Fica definido dentro do `index.html`, na constante:

```js
const ADMIN_CODE = 'AMVOX2026';
```

Troque esse valor antes de publicar se quiser um código diferente. **Importante:** como o `index.html` é servido como está (qualquer pessoa pode ver o código-fonte pelo navegador), esse código é uma trava simples, não uma senha de verdade — não reutilize uma senha sensível aqui.

## Domínio próprio (opcional)

Se quiser usar algo como `catalogo.amvoxtech.com.br` em vez do `.vercel.app`:
No projeto na Vercel → **Settings → Domains** → adicione o domínio e siga as instruções de DNS (geralmente um registro CNAME apontando pra Vercel).

## Atualizando o catálogo por código (opcional)

O catálogo inicial (os itens que vieram da planilha) está embutido no `index.html`,
na constante `BASE_CATALOG`. Itens adicionados pelo Painel Administrativo ficam
guardados à parte, no Redis — não precisam editar o `index.html`. Só edite o
`BASE_CATALOG` se quiser trocar a lista original de fábrica.
