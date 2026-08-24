# Catálogo Amvox — Associados

Catálogo de itens de TI para associados reservarem, com avaliação do DP para
compras em crédito em folha. Front-end estático (`index.html`) + funções
serverless da Vercel (`api/`) que salvam **tudo** — catálogo, reservas,
decisões do DP — num banco Postgres real no **Supabase**.

## Estrutura

```
.
├── index.html                 → todo o catálogo (HTML + CSS + JS num arquivo só)
├── api/
│   ├── _supabase.js            → configura a conexão com o Supabase (server-side)
│   ├── catalog/
│   │   ├── index.js            → GET (lista catálogo) / POST (adiciona item)
│   │   └── [id].js             → PATCH (edita) / DELETE (remove item)
│   └── reservas/
│       ├── index.js            → GET (busca/lista chamados) / POST (abre reserva)
│       └── [protocolo].js      → PATCH (aprova/reprova/conclui/cancela)
├── supabase/
│   └── schema.sql              → script que cria as tabelas e já popula com os 128 itens originais
├── package.json
├── .gitignore
└── .env.example
```

## Passo a passo para colocar no ar

### 1. Crie o projeto no Supabase

1. Entre em [supabase.com](https://supabase.com) e crie um projeto novo (o plano gratuito serve)
2. Vá em **SQL Editor** → **New query**
3. Abra o arquivo `supabase/schema.sql` deste projeto, copie **todo o conteúdo** e cole lá
4. Clique em **Run** — isso cria as tabelas (`items`, `item_state`, `chamados`, `chamado_itens`) e já cadastra os 128 itens da planilha original
5. Vá em **Project Settings → API** e anote dois valores: **Project URL** e a chave **service_role** (não é a `anon`/`public` — é a secreta, marcada como "secret")

### 2. Suba este projeto pro GitHub

```bash
cd amvox-catalogo-vercel
git add -A
git commit -m "Migra para Supabase"
git remote add origin https://github.com/SEU-USUARIO/amvox-catalogo.git   # só na primeira vez
git branch -M main
git push -u origin main
```

### 3. Importe o repositório na Vercel

1. Entre em [vercel.com/new](https://vercel.com/new)
2. **Import Git Repository** → escolha o repositório
3. Antes de clicar em Deploy, abra **Environment Variables** e adicione:
   - `SUPABASE_URL` → a Project URL que você anotou
   - `SUPABASE_SERVICE_ROLE_KEY` → a chave service_role
4. Clique em **Deploy**

A partir daqui, todo `git push` pro `main` atualiza o site automaticamente (deploy contínuo via Git).

### 4. Teste

Abra a URL que a Vercel te deu, selecione um item, finalize uma reserva. Se aparecer o protocolo (ex: `AMX-00001`), está tudo funcionando. Para conferir no banco: no Supabase, vá em **Table Editor** → tabela `chamados` — a reserva deve aparecer lá.

## Por que Supabase em vez de um Redis genérico?

Como é um banco Postgres de verdade, dá pra abrir o **Table Editor** do Supabase
e ver/filtrar/exportar as tabelas `items`, `chamados`, `chamado_itens` direto
pelo navegador — sem precisar decifrar JSON. Cada linha é um registro real
(um chamado, um item), então é possível fazer relatórios, conferir histórico
e até editar manualmente em caso de emergência, direto no painel do Supabase.

## Código de acesso do Painel Administrativo

Fica definido dentro do `index.html`, na constante:

```js
const ADMIN_CODE = 'AMVOX2026';
```

Troque esse valor antes de publicar se quiser um código diferente.
**Importante:** como o `index.html` é servido como está (qualquer pessoa pode
ver o código-fonte pelo navegador), esse código é uma trava simples, não uma
senha de verdade — não reutilize uma senha sensível aqui.

## Segurança do banco

As funções em `api/` usam a chave **service_role** do Supabase, que tem acesso
total ao banco — por isso ela só existe como variável de ambiente do lado do
servidor (na Vercel), nunca no `index.html` nem em qualquer código que rode no
navegador. Além disso, o `schema.sql` já ativa Row Level Security em todas as
tabelas sem nenhuma política de acesso público, então mesmo que alguém
descubra a URL do projeto Supabase, não consegue ler nem escrever nada sem
passar pelas funções da Vercel.

## Removendo/editando itens

Itens removidos pelo Painel Administrativo não são apagados do banco — ficam
marcados como `ativo = false` (soft delete), então o histórico nunca se perde.
Se precisar reativar um item, basta rodar no SQL Editor do Supabase:

```sql
update items set ativo = true where id = 'ID_DO_ITEM';
```

## Domínio próprio (opcional)

Se quiser usar algo como `catalogo.amvoxtech.com.br` em vez do `.vercel.app`:
no projeto na Vercel → **Settings → Domains** → adicione o domínio e siga as
instruções de DNS (geralmente um registro CNAME apontando pra Vercel).
