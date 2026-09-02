# AASIAM Pedidos

Aplicacao da atletica com duas frentes independentes:

| Frente | Pagina | Provedor | Meios aceitos |
| --- | --- | --- | --- |
| Loja de moletons, canecas, mochilas e mantas | `/` | **InfinitePay** (Checkout Integrado) | Pix, cartao de credito e debito |
| Inscricoes do Churrasco da Alcateia | `/churrasco` | **Mercado Pago** (Checkout Transparente, API de Orders) | **Somente Pix** |

As duas nao se cruzam: a loja **continua na InfinitePay** e nada do churrasco a
toca. Os webhooks sao endpoints separados e as inscricoes vao para uma aba
propria da planilha.

## Rodar localmente

```bash
cd backend  && npm install && npm run dev   # API na porta 3333
cd frontend && npm install && npm run dev   # site na porta 5173
```

Abra `http://localhost:5173`. O proxy do Vite manda `/api` para a porta 3333.

## Testes

```bash
cd backend && npm test
```

Roda as tres suites, sem credencial e sem chamada externa:

- `npm run test:churrasco` — sobe as rotas reais do churrasco com a planilha em
  memoria e um `fetch` falso no lugar de `api.mercadopago.com`. O cliente do
  Mercado Pago exercitado e o de verdade, entao os testes afirmam o que sai pela
  rede: o payload da order, o header `X-Idempotency-Key`, o tratamento de 429 e a
  validacao da assinatura do webhook. Cobre tambem a lista de cursos: a ordem, o
  preco de cada um e o espelhamento entre backend e frontend.
- `npm run test:comprovante` — gera o PDF de producao e le o conteudo do arquivo
  para provar o que aparece nele (curso, categoria, valor) e o que nunca aparece
  (credencial, token, telefone). Cobre tambem a validacao pelo QR Code.
- `npm run test:loja` — sobe o `index.js` de verdade e confere que as rotas do
  e-commerce continuam no ar (health, config, cupons, checkout, webhook da
  InfinitePay, consulta de pedido, CORS).

Para testar a pagina no navegador sem pagamento real, veja
[Ensaio no navegador](#ensaio-no-navegador).

---

# Loja (`/`)

## Como o dinheiro entra

1. O front-end monta o carrinho e chama `POST /api/checkout`.
2. O servidor **recalcula os totais** por `shared/products.js` — o navegador nao
   consegue alterar o preco enviado a InfinitePay.
3. Cupons validos aplicam o preco de custo, revalidados no servidor.
4. A pessoa paga no Checkout Integrado da InfinitePay e volta para
   `/pagamento-concluido`.
5. `POST /api/webhooks/infinitepay` confirma pelo `payment_check` e grava a linha
   na aba de pedidos.

## Rotas da loja

```text
POST /api/checkout                    cria o link de pagamento
GET  /api/pedido/:orderId             consulta do pedido
GET  /api/pedido/:orderId/status      polling do status
POST /api/validar-cupom               valida um cupom sem gastar
POST /api/usar-cupom                  marca um cupom de uso unico
POST /api/webhooks/infinitepay        webhook da loja
GET  /api/health · GET /api/config    diagnostico
```

## Variaveis da loja

```bash
INFINITEPAY_HANDLE=      # slug da conta InfinitePay — so a loja usa
APP_URL=
API_URL=
GOOGLE_SHEETS_SHEET_NAME=Pedidos AASIAM
```

## Precos e produtos

Edite `shared/products.js` para ajustar nomes, descricoes e valores. Os totais
sao recalculados no servidor.

---

# Churrasco da Alcateia (`/churrasco`)

Pagina propria de inscricoes, isolada da loja: sem carrinho e sem o header do
e-commerce. O pagamento e **Pix pelo Mercado Pago**, criado com o Checkout
Transparente (API de Orders) e concluido **dentro da propria pagina** — o QR
Code e o codigo copia e cola aparecem no site e **nao existe redirecionamento
para nenhum checkout externo**.

Nao ha produto cadastrado no Mercado Pago, nem cartao, boleto ou parcelamento:
o unico meio de pagamento no payload e `pix` / `bank_transfer`.

## Cursos e precos

A lista vive em um lugar so, `backend/shared/churrasco.js`, espelhada byte a
byte em `frontend/src/shared/churrasco.js` (um teste falha se as duas
divergirem). Ela e ao mesmo tempo o que a tela mostra e a allowlist que o
backend aceita — nao existe curso valido fora dela.

```text
1. Administracao              R$ 35,00    Outro curso
2. Ciencias Contabeis         R$ 35,00    Outro curso
3. Direito                    R$ 35,00    Outro curso
4. Sistemas de Informacao     R$ 25,00    Aluno de SI
5. Pedagogia                  R$ 35,00    Outro curso
6. Ontopsicologia             R$ 35,00    Outro curso
7. Hotelaria                  R$ 35,00    Outro curso
8. Gastronomia                R$ 35,00    Outro curso
9. Outro                      R$ 35,00    Participante externo
```

`Outro` e a opcao de quem nao estuda na faculdade — participante externo,
convidado, egresso. Nao pede curso por escrito: e um valor como qualquer outro,
gravado com essa palavra na planilha, no comprovante e na validacao.

A comparacao ignora acento e caixa na entrada (`ciencias contabeis` e aceito),
mas o registro final sai sempre na grafia da lista. O preco e calculado no
servidor, em centavos inteiros — 2500 para Sistemas de Informacao, 3500 para
todo o resto — e qualquer valor que o navegador mande e descartado.

## Como o dinheiro entra

1. A pessoa preenche **nome, telefone, e-mail e curso**. O e-mail e obrigatorio
   porque `payer.email` e exigido pelo Pix da API de Orders.
2. O front-end chama `POST /api/churrasco/checkout`.
3. O backend valida, **recalcula o valor pelo curso** (R$ 25,00 para Sistemas de
   Informacao, R$ 35,00 para os demais) e gera uma referencia sorteada com o
   prefixo `CHURRASCO-`. Preco, status ou ID enviados pelo navegador sao
   ignorados.
4. A inscricao vira uma linha **Pendente** na aba do churrasco — antes da
   cobranca, para nada se perder no caminho.
5. O backend chama `POST https://api.mercadopago.com/v1/orders` com
   `X-Idempotency-Key` e validade de 30 minutos.
6. A pagina mostra o QR Code, o codigo copia e cola, o valor e a contagem
   regressiva. Sem sair do site.
7. A pessoa paga pelo app do banco.
8. O Mercado Pago chama `POST /api/churrasco/webhook/mercadopago`. O backend
   **valida a assinatura**, consulta `GET /v1/orders/{id}` e atualiza a MESMA
   linha da planilha.
9. A pagina consulta `GET /api/churrasco/pagamentos/:orderId/status` a cada 7
   segundos e confirma sozinha.

Nada e confirmado pelo corpo do webhook nem pelo navegador. Uma inscricao so
vira `Pago` quando a order consultada na API diz `status: processed` +
`status_detail: accredited`, a transacao Pix interna tambem esta processada e
creditada, o metodo e `pix` / `bank_transfer` e o valor bate em centavos com o
preco do curso.

## Rotas do churrasco

```text
POST /api/churrasco/checkout                    cria (ou recupera) a cobranca Pix
GET  /api/churrasco/pagamentos/:orderId/status  status (header X-Inscricao-Token)
POST /api/churrasco/webhook/mercadopago         webhook do Mercado Pago
GET  /api/churrasco/config                      o que a pagina precisa saber
```

O webhook da loja (`/api/webhooks/infinitepay`) continua intacto e em outro
endereco. O do churrasco ignora qualquer order cuja `external_reference` nao
comece com `CHURRASCO-`.

## Variaveis do churrasco

```bash
MERCADO_PAGO_ACCESS_TOKEN=    # obrigatorio — SO NO BACKEND
MERCADO_PAGO_WEBHOOK_SECRET=  # obrigatorio — sem ela o webhook responde 401
APP_URL=                      # ja usada pela loja
API_URL=                      # ja usada pela loja; e a base do webhook
CHURRASCO_SHEET_NAME=Inscrições Churrasco
CHURRASCO_TOKEN_SECRET=       # opcional
```

- `MERCADO_PAGO_ACCESS_TOKEN` e `MERCADO_PAGO_WEBHOOK_SECRET` **existem so no
  backend**. Nunca use prefixo `VITE_`: isso as colocaria no bundle do
  navegador. Elas nao aparecem em nenhuma resposta da API, log ou mensagem de
  erro.
- `CHURRASCO_TOKEN_SECRET` e opcional. Vazio, o token publico de consulta e a
  chave de idempotencia sao derivados do segredo do webhook (ou, na falta dele,
  da chave privada da service account). Defina-o se quiser trocar um sem
  invalidar o outro.
- A **Public Key nao e necessaria**: o Pix e criado inteiramente pelo backend e
  a pagina so renderiza o QR Code que ele devolve. Nao ha SDK do Mercado Pago no
  front-end.

## Configurar as credenciais

1. Entre no [painel do Mercado Pago](https://www.mercadopago.com.br/developers/panel).
2. Abra **Suas integracoes** e crie (ou escolha) uma aplicacao.
3. Va em **Credenciais de producao** ou **Credenciais de teste**.
4. Copie o **Access Token**:
   - teste: comeca com `TEST-`;
   - producao: comeca com `APP_USR-`.
5. Coloque em `MERCADO_PAGO_ACCESS_TOKEN`. Nada de Public Key.

`GET /api/health` responde `churrascoAmbiente: "teste" | "producao" | "ausente"`
— e o jeito de conferir qual credencial esta ativa sem expor o valor dela.

## Cadastrar a chave Pix

O Pix so e liberado depois que a conta tem uma chave cadastrada:

1. Abra o app do Mercado Pago (ou `mercadopago.com.br` › **Seu perfil**).
2. Va em **Pix** › **Minhas chaves**.
3. Toque em **Criar chave** e escolha CPF/CNPJ, e-mail, telefone ou chave
   aleatoria.
4. Confirme. Sem chave cadastrada, `POST /v1/orders` recusa o pagamento Pix.

## Configurar o webhook

1. No painel, abra **Suas integracoes** › sua aplicacao › **Webhooks**.
2. Em **Configurar notificacoes**, informe a URL de producao:

   ```text
   https://SEU-BACKEND.onrender.com/api/churrasco/webhook/mercadopago
   ```

   Troque `SEU-BACKEND.onrender.com` pelo mesmo valor que esta em `API_URL`. O
   backend imprime a URL exata no boot, na linha `→ webhook :`.
3. Em **Eventos**, marque **`Order (Mercado Pago)`** — e so esse. O endpoint
   ignora qualquer outro topico.
4. Salve e clique em **Gerar chave secreta** (ou **Revelar**).
5. Copie a chave e coloque em `MERCADO_PAGO_WEBHOOK_SECRET`.
6. Reinicie o backend. No boot ele diz
   `→ assinatura do webhook: ✓ configurada`.

A assinatura e conferida em toda notificacao: o backend recalcula o HMAC-SHA256
do manifesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` e compara com o
`v1` do header `x-signature`. **Assinatura invalida responde `401` e nada e
lido nem gravado.**

## Colocar as variaveis no Render

1. Abra o servico do backend no [Render](https://dashboard.render.com).
2. Va em **Environment** › **Environment Variables**.
3. Adicione, uma a uma:

   | Chave | Valor |
   | --- | --- |
   | `MERCADO_PAGO_ACCESS_TOKEN` | o Access Token copiado do painel |
   | `MERCADO_PAGO_WEBHOOK_SECRET` | a chave secreta do webhook |
   | `API_URL` | a URL publica do backend, ex. `https://loja-aasiam-backend.onrender.com` |
   | `APP_URL` | a URL do frontend na Vercel |

4. Salve. O Render reinicia o servico sozinho.
5. `API_URL` precisa ser a URL **publica** do proprio backend (a que aparece no
   topo da pagina do servico no Render), sem barra final. E ela que voce cadastra
   no painel do Mercado Pago, com `/api/churrasco/webhook/mercadopago` no fim.

O `render.yaml` ja lista todas essas chaves com `sync: false` — os valores nunca
ficam no repositorio.

## Verificar a saude da integracao

```bash
curl https://SEU-BACKEND.onrender.com/api/health
curl https://SEU-BACKEND.onrender.com/api/churrasco/config
```

O que esperar:

```jsonc
// /api/health
{ "churrascoConfigured": true, "churrascoWebhookConfigured": true, "churrascoAmbiente": "producao" }

// /api/churrasco/config
{ "inscricoesDisponiveis": true, "pagamento": "pix", "provedor": "Mercado Pago", "webhookConfigurado": true }
```

Nenhuma das duas devolve credencial: so dizem se ela existe e de que tipo e.

## Testar sem pagamento real

Tres caminhos, do mais rapido ao mais completo:

**1. Testes automatizados** (nao pedem credencial nenhuma):

```bash
cd backend && npm test
```

**2. Ensaio no navegador**

Sobe as rotas reais com a planilha em memoria e um dublê de
`api.mercadopago.com`. Nenhuma chamada sai da maquina.

```bash
cd backend  && node _test_servidor_falso.mjs            # API de ensaio na 3333
cd frontend && npm run dev                              # site na 5173
```

Abra `http://localhost:5173/churrasco`, preencha o formulario e use os gatilhos
para mover o pagamento (a referencia aparece no campo **Codigo** da tela):

```bash
curl http://localhost:3333/__ensaio/pagar/CHURRASCO-2026-XXXXXXXX     # confirma
curl http://localhost:3333/__ensaio/expirar/CHURRASCO-2026-XXXXXXXX   # vence o Pix
curl http://localhost:3333/__ensaio/falhar/CHURRASCO-2026-XXXXXXXX    # recusa
curl http://localhost:3333/__ensaio/divergir/CHURRASCO-2026-XXXXXXXX  # valor errado
curl http://localhost:3333/__ensaio/cartao/CHURRASCO-2026-XXXXXXXX    # fora do Pix
curl http://localhost:3333/__ensaio/estado                            # o que foi gravado
```

Cada gatilho dispara o webhook assinado, exatamente como o Mercado Pago faria.

**3. Sandbox do Mercado Pago**, com credencial `TEST-`: crie um usuario de teste
comprador em **Suas integracoes** › **Contas de teste** e pague com o app dele.
Um Pix de teste nao movimenta dinheiro de verdade.

## Aba da planilha

`CHURRASCO_SHEET_NAME` (padrao `Inscrições Churrasco`), colunas A–T:

```text
A Data da inscrição      H Status                          O Observações
B ID da inscrição        I Método de pagamento             P E-mail
C Nome                   J ID da order (Mercado Pago)      Q Provedor
D Telefone               K ID do pagamento (Mercado Pago)  R Valor pago
E Curso                  L URL do comprovante              S Status Mercado Pago
F Categoria              M Data do pagamento               T Pix expira em
G Valor                  N Última atualização
```

- **A–O mantiveram as posicoes** para nao desalinhar as linhas antigas. So J e K
  trocaram de rotulo: guardavam `Transaction NSU` e `Invoice slug` da InfinitePay
  e agora guardam os identificadores do Mercado Pago. **P–T sao novas.**
- **B `ID da inscrição`** e a `external_reference` enviada ao Mercado Pago.
- **G `Valor`** e o valor esperado, sempre recalculado a partir do curso — o
  numero gravado nunca vira regra de negocio.
- **T** guarda a validade do Pix em ISO 8601, para o backend saber quando
  reaproveitar a cobranca em vez de criar outra.
- Categorias: `Aluno de SI`, `Outro curso` e `Participante externo` (quem
  escolheu `Outro`).
- Status: `Pendente`, `Processando`, `Pago`, `Falhou`, `Cancelado`, `Expirado`,
  `Reembolsado`, `Erro`, `Revisão manual` (e `Recusado`, so lido, das inscricoes
  antigas).

Nenhuma credencial, assinatura de webhook ou QR Code em Base64 vai para a
planilha — so os identificadores. O webhook localiza a linha pela referencia e
atualiza **no lugar**, nunca acrescenta.

## Uma linha por inscricao

A protecao contra cobranca duplicada tem tres camadas:

1. **Trava em memoria** por pessoa + curso: um duplo clique faz a segunda
   requisicao esperar a primeira e reaproveitar o resultado dela.
2. **Busca na planilha** por e-mail + curso antes de cobrar: sobrevive a um
   restart do backend, a um F5 e a um reenvio do formulario. Quem ja pagou nunca
   e cobrado de novo.
3. **`X-Idempotency-Key` estavel**: derivada da referencia e da order anterior.
   Um retry da mesma tentativa reusa a chave e o Mercado Pago devolve a MESMA
   cobranca. A chave so muda quando o Pix vence e a pessoa pede um novo — e ai a
   cobranca nova reaproveita a mesma linha e a mesma referencia.

O status nunca regride: uma inscricao `Pago` continua paga, mesmo com uma
notificacao atrasada ou fora de ordem dizendo o contrario.

### Limitacao residual

O Google Sheets nao oferece transacao nem escrita condicional, entao **nao ha
garantia atomica perfeita**. As gravacoes sao serializadas numa fila dentro do
processo e cada uma relê a linha antes de escrever, o que cobre o cenario real
(uma unica instancia no Render). Se o backend rodar em **duas instancias ao
mesmo tempo**, duas gravacoes simultaneas sobre a mesma linha podem se
sobrepor — a ultima vence. Na pratica isso significa, no pior caso, um campo
auxiliar desatualizado; o status `Pago` continua protegido contra regressao, e
a cobranca duplicada continua barrada pela `X-Idempotency-Key`, que e resolvida
pelo proprio Mercado Pago e nao depende da planilha.

## O que a pessoa ve

Tudo dentro de `/churrasco`, sem sair do site:

- "Gerando seu Pix..." enquanto a cobranca e criada;
- o valor da inscricao e o QR Code grande, impresso na comanda;
- o codigo copia e cola com botao **Copiar codigo Pix** e confirmacao
  "Codigo copiado";
- instrucao para abrir o app do banco;
- contagem regressiva da validade, que fica em brasa nos ultimos 5 minutos;
- status "Aguardando pagamento", com verificacao automatica a cada 7 segundos e
  botao **Verificar pagamento**;
- tela de Pix vencido com **Gerar um novo Pix**;
- tela de pagamento confirmado com o codigo da comanda e o comprovante;
- tela de erro com nova tentativa.

A verificacao automatica para sozinha quando o pagamento chega a um estado final
e pausa quando a aba sai da frente. O navegador nunca fala com o Mercado Pago
direto e nunca decide se alguem pagou.

## Recortar o mascote

A arte original fica em `frontend/assets-src/lobo-churrasco-original.png` e nunca
e sobrescrita. Para regerar a versao com transparencia:

```bash
cd frontend && node scripts/cutout-lobo.mjs
```

---

# Google Sheets

1. Crie uma service account no Google Cloud.
2. Ative a Google Sheets API.
3. Compartilhe a planilha com o e-mail da service account, como **Editor**.
4. Pegue o ID da planilha pela URL:

```text
https://docs.google.com/spreadsheets/d/ESTE_E_O_ID/edit#gid=0
```

5. Preencha no `.env` (veja `backend/.env.example`):

```bash
GOOGLE_SHEETS_SPREADSHEET_ID=
GOOGLE_SHEETS_SHEET_NAME=Pedidos AASIAM
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Se preferir evitar problemas com quebras de linha na chave privada, use
`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64`.

As duas abas (pedidos da loja e inscricoes do churrasco) sao criadas
automaticamente, com os cabecalhos certos, se ainda nao existirem.

## Validar a integracao com a planilha

1. Suba o backend.
2. Abra `/api/health` e confirme `googleSheetsConfigured: true`.
3. `GET /api/test-sheets` faz uma escrita de diagnostico na aba da loja.
