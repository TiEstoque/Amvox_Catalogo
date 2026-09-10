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

## Janela de compras

As reservas só são aceitas **todos os dias das 07:08 às 17:08** (horário da
Bahia). A trava fica no `POST /api/reservas` (com 20 min de tolerância no
fim, pra quem está no cronômetro do Pix); o `index.html` mostra a faixa
verde/escura no topo e bloqueia o botão Finalizar fora do horário. Pra mudar
o horário, ajuste `JANELA_INICIO_MIN`/`JANELA_FIM_MIN` em
`api/reservas/index.js` e `JANELA_COMPRAS` no `index.html`.

## Limite de itens e "segunda rodada"

Cada pessoa pode comprar até 4 itens somando reservas e compras (limite
individual: botão **Limite** no usuário, coluna `cadastros_acesso.limite_itens`).
O card **Limite de itens por pessoa** (Painel → Usuários) tem o botão **Zerar
contagem (segunda rodada)**: grava a data/hora em `config_catalogo.limite_desde`
e, a partir daí, só os chamados abertos depois dessa data contam no limite — o
histórico não muda, mas todo mundo volta a ter a cota inteira. "Voltar a contar
todas as compras" desfaz.

## Lista de colaboradores autorizados (Painel Administrativo → Usuários)

A tabela `colaboradores_autorizados` guarda os CPFs que podem usar o catálogo:
a relação de colaboradores do RH (origem `RH`) e exceções liberadas pela TI
(origem `Exceção`, ex.: gestores fora da folha, pessoal da Qcompra). Regras:

- **Cadastro novo** (`POST /api/cadastro`) só é aceito se o CPF estiver na
  lista e ativo; senão a pessoa vê "Esse CPF não está na relação de
  colaboradores da Amvox…". Quem já tem cadastro continua entrando com
  e-mail e senha — pra tirar o acesso de alguém, use **Bloquear** na tela de
  usuários.
- A **promoção por e-mail** vai só pra cadastrados que estão na lista.
- Na tela de usuários, quem não está na lista aparece com o selo
  **Fora da lista**.

Pra atualizar a lista quando o RH mandar uma relação nova: copie a coluna de
CPFs (pode ir com o nome junto, "CPF;Nome") e cole no card **Colaboradores
autorizados**, origem "Relação do RH". CPFs repetidos só são atualizados.
"Ver lista completa" abre a lista com busca, e cada CPF pode ser desativado
(não se cadastra mais) ou removido. Rota: `/api/usuarios?recurso=autorizados`
(admin; código em `api/_autorizados.js` — o plano Hobby da Vercel limita a 12
funções por deploy e o projeto já usa as 12).

## Promoção por e-mail (Painel Administrativo → aba Promoção)

Manda um e-mail pra **todos os usuários cadastrados** que estão na lista de
colaboradores autorizados (bloqueados e quem está fora da lista não recebem),
usando o mesmo remetente SMTP das notas de débito
(`EMAIL_REMETENTE` / `EMAIL_SENHA_APP`). Fluxo:

1. Preencha o **assunto** e a **mensagem** (texto simples — já vem um modelo).
   O e-mail sai formatado, com cabeçalho do catálogo e um botão "Ver o catálogo"
   apontando pro endereço do site (`SITE_URL`, se definida; senão o domínio da
   própria requisição).
2. Clique em **Enviar teste** pra receber uma cópia e conferir como ficou.
3. Clique em **Enviar para todos (N)** e confirme. O envio é feito em lotes de
   10 pela rota `POST /api/promocao` (máx. 20 por chamada, 5 simultâneos), com
   progresso na tela; cada envio fica registrado em `email_logs`.

A rota só aceita destinatários que existam em `cadastros_acesso` e não estejam
bloqueados — mesmo com o token de admin, não dá pra usá-la pra mandar e-mail
pra endereços de fora. Lembre-se do limite diário do Gmail (cerca de 500
destinatários/dia na conta comum), que também conta os e-mails automáticos.

## Domínio próprio (opcional)

Se quiser usar algo como `catalogo.amvoxtech.com.br` em vez do `.vercel.app`:
no projeto na Vercel → **Settings → Domains** → adicione o domínio e siga as
instruções de DNS (geralmente um registro CNAME apontando pra Vercel).
