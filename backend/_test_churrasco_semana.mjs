/**
 * Teste de integração do Churrasco da AASIAM na Semana Acadêmica de SI.
 *
 * Mesmo desenho das outras suítes: Express de verdade com as rotas reais,
 * planilha em memória e `fetch` falso no lugar de api.mercadopago.com — o
 * cliente do Mercado Pago exercitado é o REAL. O relógio das rotas é trocado
 * para que os testes de prazo continuem valendo depois de 22/10/2026.
 *
 * Prova também que o Churrasco da Alcateia (AMF Games) segue intacto: preço
 * por curso, aba de sempre, 20 colunas.
 *
 * Nenhuma credencial, nenhuma chamada externa, nenhum pagamento real.
 *
 * Rodar: node backend/_test_churrasco_semana.mjs
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const fake = (name) => pathToFileURL(path.join(here, "_test_churrasco_fakes", name)).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith("/google-sheets.js")) {
      return { url: fake("google-sheets.js"), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

// Sorteados a cada execução: nenhum segredo fica escrito neste arquivo.
const ACCESS_TOKEN = `TEST-${crypto.randomBytes(12).toString("hex")}`;
const WEBHOOK_SECRET = crypto.randomBytes(24).toString("hex");
const COMPROVANTE_SECRET = crypto.randomBytes(32).toString("hex");

process.env.APP_URL = "https://loja.exemplo.com";
process.env.API_URL = "https://api.exemplo.com";
process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "planilha-de-teste";
process.env.CHURRASCO_TOKEN_SECRET = crypto.randomBytes(16).toString("hex");
process.env.MERCADO_PAGO_ACCESS_TOKEN = ACCESS_TOKEN;
process.env.MERCADO_PAGO_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.COMPROVANTE_SIGNING_SECRET = COMPROVANTE_SECRET;

const express = (await import("express")).default;
const { sheet, resetSheet, SEMANA_SI_TAB } = await import(fake("google-sheets.js"));
const { mp, creditar, instalarFetchFalso, moverOrder, orderDe, requisicoesPara, resetMercadoPago } =
  await import(fake("mercadopago-api.mjs"));

instalarFetchFalso();

const {
  CHURRASCO_WEBHOOK_PATH,
  createOrderNsu,
  inscricaoToken,
  isReferenciaDeChurrasco,
  registrarRotasDoChurrasco,
} = await import("./churrasco.js");
const {
  CHURRASCO_SEMANA_SI_SHEET_NAME,
  CHURRASCO_SHEET_HEADERS,
  registroAmf,
  registroSemanaSi,
} = await import("./churrasco-inscricoes.js");
const { criarTokenVerificacao, lerTokenVerificacao, urlValidacao } = await import("./comprovante.js");
const {
  EVENTOS_CHURRASCO,
  EVENTO_AMF,
  EVENTO_SEMANA_SI,
  LISTA_EVENTOS_CHURRASCO,
  cardapioPorExtenso,
  eventoDaReferencia,
  inscricoesAbertas,
  resumoDaInscricao,
} = await import("./shared/churrasco-eventos.js");

const AMF = EVENTOS_CHURRASCO[EVENTO_AMF];
const SEMANA = EVENTOS_CHURRASCO[EVENTO_SEMANA_SI];

/* O relógio das rotas da Semana. Cada teste começa dois dias antes do prazo. */
const PRAZO = Date.parse("2026-10-22T23:59:59.999-03:00");
const ANTES_DO_PRAZO = Date.parse("2026-10-20T12:00:00-03:00");
const relogio = { agora: ANTES_DO_PRAZO };
const agora = () => relogio.agora;

const app = express();
// Igual à produção (index.js): o IP do cliente vem do último salto do
// X-Forwarded-For, que o teste usa para simular visitantes diferentes.
app.set("trust proxy", 1);
app.use(express.json());
registrarRotasDoChurrasco(app, { evento: AMF, registro: registroAmf, webhookLegado: true });
registrarRotasDoChurrasco(app, { evento: SEMANA, registro: registroSemanaSi, agora });
// A mesma aba, com limite de 2 vagas, numa base só dos testes.
const SEMANA_COM_VAGAS = { ...SEMANA, vagas: 2, apiBase: "/api/teste-semana-vagas" };
registrarRotasDoChurrasco(app, { evento: SEMANA_COM_VAGAS, registro: registroSemanaSi, agora });

const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// Índices das colunas (A=0). U (20) é a carona, só na aba da Semana.
const COL = {
  id: 1,
  nome: 2,
  curso: 4,
  valor: 6,
  status: 7,
  orderMpId: 9,
  paymentMpId: 10,
  pagoEm: 12,
  email: 15,
  valorPago: 17,
  carona: 20,
};

let passed = 0;
const failures = [];
let ipDoTeste = "";
let proximoIp = 0;

async function test(nome, fn) {
  resetSheet();
  resetMercadoPago();
  relogio.agora = ANTES_DO_PRAZO;
  ipDoTeste = `192.0.2.${(proximoIp++ % 250) + 1}`;
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${nome}`);
  } catch (err) {
    failures.push({ nome, err });
    console.log(`  ✗ ${nome}\n      ${err.message}`);
  }
}

/* ─── Atalhos ────────────────────────────────────────────────────────── */

/** Linhas da aba da Semana (isolada no dublê) e da aba do AMF. */
const linhasSemana = () => sheet.byTab[SEMANA_SI_TAB] || [];
const linhasAmf = () => sheet.rows;

/** Intl usa espaço não separável; a planilha grava espaço comum. */
const reais = (texto) => String(texto).replace(/\s/g, " ");

const post = (rota, body) =>
  fetch(`${base}${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ipDoTeste },
    body: JSON.stringify(body),
  });

const get = (rota, headers = {}) =>
  fetch(`${base}${rota}`, { headers: { "x-forwarded-for": ipDoTeste, ...headers } });

const checkout = (body, apiBase = SEMANA.apiBase) => post(`${apiBase}/checkout`, body);
const status = (orderId, token, apiBase = SEMANA.apiBase) =>
  get(`${apiBase}/pagamentos/${orderId}/status`, token ? { "X-Inscricao-Token": token } : {});
const baixar = (orderId, token, apiBase = SEMANA.apiBase) =>
  get(`${apiBase}/comprovantes/${encodeURIComponent(orderId)}/pdf`, { "X-Inscricao-Token": token });
const validar = (token, apiBase = SEMANA.apiBase) =>
  get(`${apiBase}/comprovantes/validar/${encodeURIComponent(token)}`);
const recuperar = (corpo) => post(`${SEMANA.apiBase}/inscricoes/recuperar`, corpo);

/** Assina como o Mercado Pago assina: id + request-id + ts. */
function assinar(dataId) {
  const ts = String(Date.now());
  const manifesto = `id:${dataId};request-id:req-de-teste;ts:${ts};`;
  const v1 = crypto.createHmac("sha256", WEBHOOK_SECRET).update(manifesto).digest("hex");
  return { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": "req-de-teste" };
}

const notificar = (dataId) =>
  fetch(`${base}${CHURRASCO_WEBHOOK_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ipDoTeste, ...assinar(dataId) },
    body: JSON.stringify({ type: "order", action: "order.updated", data: { id: dataId } }),
  });

let sequencia = 0;
const dados = (extra = {}) => ({
  name: "Bruna Costa Lima",
  phone: "(55) 99876-5432",
  email: `bruna.lima+${++sequencia}@exemplo.com`,
  course: "Sistemas de Informação",
  ...extra,
});

async function inscrever(extra = {}, apiBase = SEMANA.apiBase) {
  const res = await checkout(dados(extra), apiBase);
  const corpo = await res.json();
  assert.equal(res.status, 201, `checkout falhou: ${JSON.stringify(corpo)}`);
  return corpo;
}

async function inscricaoPaga(extra = {}) {
  const inscricao = await inscrever(extra);
  const order = orderDe(inscricao.orderId);
  creditar(order.id);
  assert.equal((await notificar(order.id)).status, 200);
  return { ...inscricao, mpOrderId: order.id, paymentId: order.transactions.payments[0].id };
}

/* ─── Leitura do PDF (mesma técnica de _test_comprovante.mjs) ─────────── */

function streamsInflados(buffer) {
  const saida = [];
  const marcaInicio = Buffer.from("stream");
  const marcaFim = Buffer.from("endstream");
  let de = 0;
  for (;;) {
    const inicio = buffer.indexOf(marcaInicio, de);
    if (inicio === -1) break;
    const fim = buffer.indexOf(marcaFim, inicio);
    if (fim === -1) break;
    let corpo = buffer.subarray(inicio + marcaInicio.length, fim);
    let i = 0;
    while (i < corpo.length && (corpo[i] === 0x0d || corpo[i] === 0x0a)) i++;
    corpo = corpo.subarray(i);
    try {
      saida.push(zlib.inflateSync(corpo).toString("latin1"));
    } catch {
      /* stream que não é zlib */
    }
    de = fim + marcaFim.length;
  }
  return saida;
}

const textoDoPdf = (buffer) => [buffer.toString("latin1"), ...streamsInflados(buffer)].join("");

/** O texto impresso, achatado e sem espaços (o kerning parte as palavras). */
function textoLegivel(buffer) {
  const bruto = streamsInflados(buffer)
    .filter((s) => s.includes("BT") && s.includes("Tf"))
    .join("");
  let saida = "";
  for (const pedaco of bruto.match(/<[0-9A-Fa-f\s]*>|\((?:\\.|[^()\\])*\)/g) || []) {
    if (pedaco.startsWith("<")) {
      const hex = pedaco.slice(1, -1).replace(/\s+/g, "");
      if (hex.length % 2 === 0) saida += Buffer.from(hex, "hex").toString("latin1");
    } else {
      saida += pedaco.slice(1, -1).replace(/\\([()\\])/g, "$1");
    }
  }
  return saida.replace(/\s+/g, "");
}

const impresso = (texto) => String(texto).replace(/\s+/g, "");

console.log("\nChurrasco da AASIAM — Semana Acadêmica de Sistemas de Informação\n");

/* ─── Configuração do evento ─────────────────────────────────────────── */

await test("o arquivo de eventos do frontend é idêntico ao do backend", async () => {
  const { readFile } = await import("node:fs/promises");
  const back = await readFile(path.join(here, "shared", "churrasco-eventos.js"));
  const front = await readFile(path.join(here, "..", "frontend", "src", "shared", "churrasco-eventos.js"));
  assert.ok(back.equals(front), "frontend/src/shared/churrasco-eventos.js divergiu do backend");
});

await test("os dados do evento são os combinados com a organização", () => {
  assert.equal(SEMANA.titulo, "Churrasco da AASIAM");
  assert.equal(SEMANA.subtitulo, "Semana Acadêmica de Sistemas de Informação");
  assert.equal(SEMANA.data, "24/10/2026");
  assert.equal(SEMANA.horario, "A partir das 11h para quem precisar de transporte poder participar");
  assert.equal(SEMANA.cursoFixo, "Sistemas de Informação");
  assert.equal(AMF.cursoFixo, null, "o AMF ganhou curso fixo");
  assert.equal(SEMANA.local, "Projeto Terra");
  assert.equal(SEMANA.precoCents, 2000);
  assert.equal(SEMANA.pessoasPorInscricao, 1);
  assert.equal(SEMANA.vagas, null, "o evento não tem limite de vagas");
  assert.equal(cardapioPorExtenso(SEMANA), "Pão, salsichão e refri");
  assert.equal(Date.parse(SEMANA.inscricoesAte), PRAZO);
});

await test("nenhum prefixo começa com outro e o do AMF continua CHURRASCO-", () => {
  assert.equal(AMF.prefixo, "CHURRASCO-");
  for (const a of LISTA_EVENTOS_CHURRASCO) {
    for (const b of LISTA_EVENTOS_CHURRASCO) {
      if (a !== b) assert.ok(!a.prefixo.startsWith(b.prefixo), `${a.prefixo} começa com ${b.prefixo}`);
    }
    // Nem com os prefixos da loja e do torneio.
    for (const outro of ["LOJA-", "ROCKET-"]) {
      assert.ok(!a.prefixo.startsWith(outro) && !outro.startsWith(a.prefixo));
    }
  }
  assert.equal(eventoDaReferencia("SEMANASI-2026-ABCDEFGHJK")?.id, EVENTO_SEMANA_SI);
  assert.equal(eventoDaReferencia("CHURRASCO-2026-ABCDEFGH")?.id, EVENTO_AMF);
  assert.equal(eventoDaReferencia("LOJA-2026-ABC"), null);
  assert.ok(isReferenciaDeChurrasco("SEMANASI-2026-ABCDEFGHJK"));
  assert.ok(!isReferenciaDeChurrasco("ROCKET-2026-ABC"));
});

await test("o código tem 10 caracteres sorteados de 32 (50 bits) e não se repete", () => {
  const vistos = new Set();
  for (let i = 0; i < 3000; i++) {
    const codigo = createOrderNsu(new Date(), SEMANA);
    assert.match(codigo, /^SEMANASI-\d{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/);
    vistos.add(codigo);
  }
  assert.equal(vistos.size, 3000, "códigos repetidos em 3000 sorteios");
  // O AMF continua com os 8 caracteres de sempre.
  assert.match(createOrderNsu(), /^CHURRASCO-\d{4}-[A-Z2-9]{8}$/);
});

/* ─── Inscrição e cobrança ───────────────────────────────────────────── */

await test("cria a cobrança de R$ 20,00 na aba própria, sem encostar na aba do AMF", async () => {
  const corpo = await inscrever();

  assert.match(corpo.orderId, /^SEMANASI-\d{4}-[A-Z2-9]{10}$/);
  assert.equal(corpo.amountCents, 2000);
  assert.equal(reais(corpo.amount), "R$ 20,00");
  assert.equal(corpo.pessoas, 1);
  assert.equal(corpo.evento, EVENTO_SEMANA_SI);
  assert.ok(corpo.pix?.qrCode && corpo.pix?.qrCodeBase64, "sem QR Code na resposta");
  assert.equal(corpo.token, inscricaoToken(corpo.orderId));

  assert.equal(linhasSemana().length, 1, "a linha não foi para a aba da Semana");
  assert.equal(linhasAmf().length, 0, "a inscrição da Semana encostou na aba do AMF");

  const linha = linhasSemana()[0];
  assert.equal(linha.length, 21, "a aba da Semana tem A–U");
  assert.equal(linha[COL.id], corpo.orderId);
  assert.equal(reais(linha[COL.valor]), "R$ 20,00");
  assert.equal(linha[COL.status], "Pendente");
  assert.equal(linha[COL.carona], "Não");
});

await test("o cabeçalho da aba nova é o do AMF mais a coluna de carona", () => {
  assert.equal(CHURRASCO_SEMANA_SI_SHEET_NAME, "Inscrições Churrasco Semana SI");
  assert.deepEqual(registroSemanaSi.cabecalhos.slice(0, 20), CHURRASCO_SHEET_HEADERS);
  assert.equal(registroSemanaSi.cabecalhos[20], "Precisa de carona");
  assert.equal(registroSemanaSi.cabecalhos.length, 21);
  assert.deepEqual(registroAmf.cabecalhos, CHURRASCO_SHEET_HEADERS, "o cabeçalho do AMF mudou");
});

await test("o curso não é pedido: com ou sem curso, grava Sistemas de Informação e cobra R$ 20,00", async () => {
  // Sem curso nenhum (o formulário novo), com qualquer curso (um navegador com
  // a página antiga) e com lixo: tudo vira SI, e o preço forjado é ignorado.
  for (const curso of [undefined, "", "Direito", "Medicina", ["Outro"], 42]) {
    const corpo = await inscrever({
      course: curso,
      amount: 1,
      price: "0.01",
      valorCents: 1,
      amountCents: 1,
      status: "pago",
    });
    assert.equal(corpo.amountCents, 2000, `curso ${JSON.stringify(curso)} não cobrou R$ 20,00`);
    assert.equal(corpo.status, "pendente", "status forjado foi aceito");
    assert.equal(corpo.curso, "Sistemas de Informação");
    assert.equal(orderDe(corpo.orderId).total_amount, "20.00");
  }
  for (const linha of linhasSemana()) {
    assert.equal(linha[COL.curso], "Sistemas de Informação", "a coluna Curso não recebeu SI");
    assert.equal(linha[5], "Aluno de SI");
  }
  assert.equal(resumoDaInscricao(SEMANA, "").course, "Sistemas de Informação");
  assert.equal(resumoDaInscricao(SEMANA, "Direito").priceCents, 2000);
});

await test("inscrição feita quando o curso ainda era perguntado continua valendo", async () => {
  // Uma linha antiga, com outro curso na coluna E, como as gravadas antes.
  const antiga = createOrderNsu(new Date(), SEMANA);
  await registroSemanaSi.criarInscricaoPendente({
    id: antiga,
    nome: "Bruna Costa Lima",
    telefone: "55998765432",
    curso: "Direito",
    categoria: "Outro curso",
    valorCents: 2000,
    email: "antiga@exemplo.com",
    precisaCarona: false,
  });

  // A mesma pessoa preenche o formulário novo (sem curso): reencontra a
  // inscrição dela, sem linha nova e sem segunda inscrição.
  const corpo = await inscrever({ email: "antiga@exemplo.com", course: undefined });
  assert.equal(corpo.orderId, antiga, "virou uma inscrição nova");
  assert.equal(linhasSemana().length, 1);
  assert.equal(linhasSemana()[0][COL.curso], "Direito", "a linha antiga foi reescrita");

  // E segue pagável, com comprovante e recuperação.
  creditar(orderDe(antiga).id);
  await notificar(orderDe(antiga).id);
  assert.equal(linhasSemana()[0][COL.status], "Pago");
  assert.equal((await baixar(antiga, corpo.token)).status, 200);
  const recuperada = await recuperar({ email: "antiga@exemplo.com", codigo: antiga });
  assert.equal(recuperada.status, 200);
});

await test("a order é só Pix e leva o evento na referência externa", async () => {
  const corpo = await inscrever();
  const [criacao] = requisicoesPara("POST", "/v1/orders");

  assert.equal(criacao.body.external_reference, corpo.orderId);
  assert.ok(criacao.body.external_reference.startsWith("SEMANASI-"));
  assert.equal(criacao.body.total_amount, "20.00");
  assert.equal(criacao.body.transactions.payments.length, 1);
  assert.deepEqual(criacao.body.transactions.payments[0].payment_method, {
    id: "pix",
    type: "bank_transfer",
  });
  assert.ok(criacao.headers["X-Idempotency-Key"], "sem X-Idempotency-Key");
  assert.equal(criacao.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
  assert.ok(!JSON.stringify(corpo).includes(ACCESS_TOKEN), "a resposta vazou o Access Token");
});

await test("Preciso de carona: só um true de verdade grava Sim", async () => {
  await inscrever({ needsRide: true });
  await inscrever({ needsRide: "true" });
  await inscrever({ needsRide: 1 });
  await inscrever();
  assert.deepEqual(
    linhasSemana().map((l) => l[COL.carona]),
    ["Sim", "Não", "Não", "Não"]
  );
});

await test("campos inválidos são recusados como no AMF, sem linha nem cobrança", async () => {
  const casos = [
    [{ name: "Ana" }, "name"],
    [{ phone: "123" }, "phone"],
    [{ email: "sem-arroba" }, "email"],
  ];
  for (const [extra, campo] of casos) {
    const res = await checkout(dados(extra));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).field, campo);
  }
  assert.equal(linhasSemana().length, 0);
  assert.equal(mp.orders.size, 0);
});

await test("duplo clique e F5 reaproveitam a mesma linha e o mesmo Pix", async () => {
  const pessoa = dados();
  const [a, b] = await Promise.all([checkout(pessoa), checkout(pessoa)]);
  const [ca, cb] = [await a.json(), await b.json()];
  assert.equal(ca.orderId, cb.orderId);
  const deNovo = await (await checkout(pessoa)).json();
  assert.equal(deNovo.orderId, ca.orderId);
  assert.equal(linhasSemana().length, 1);
  assert.equal(mp.orders.size, 1);
});

await test("o e-mail de outra pessoa no checkout não devolve código, nome nem token", async () => {
  const vitima = await inscricaoPaga({ email: "vitima@exemplo.com", name: "Vitória Alves Ramos" });

  const res = await checkout(
    dados({ email: "vitima@exemplo.com", name: "Alguém Qualquer", phone: "(51) 98888-1111" })
  );
  const texto = await res.text();
  assert.equal(res.status, 409);
  for (const segredo of [vitima.orderId, vitima.token, "Vitória", "pago", "Pago"]) {
    assert.ok(!texto.includes(segredo), `o checkout revelou "${segredo}"`);
  }
  assert.match(JSON.parse(texto).error, /Recuperar comprovante/);
  assert.equal(linhasSemana().length, 1, "criou outra linha");
  assert.equal(mp.orders.size, 1, "criou outra cobrança");

  // A própria pessoa (mesmo telefone, mesmo com outra máscara) continua
  // recebendo a inscrição dela, como antes.
  const dona = await checkout(dados({ email: "vitima@exemplo.com", phone: "55 99876 5432" }));
  assert.equal(dona.status, 201);
  assert.equal((await dona.json()).orderId, vitima.orderId);
});

await test("no AMF o curso continua obrigatório e define o preço", async () => {
  const semCurso = await checkout(dados({ course: undefined }), AMF.apiBase);
  assert.equal(semCurso.status, 400);
  assert.equal((await semCurso.json()).field, "course");
  const invalido = await checkout(dados({ course: "Medicina" }), AMF.apiBase);
  assert.equal(invalido.status, 400);
  assert.equal(linhasAmf().length, 0);
});

await test("no AMF o checkout segue como sempre: o e-mail basta para reencontrar a inscrição", async () => {
  const primeira = await inscrever({ email: "amf@exemplo.com", course: "Direito" }, AMF.apiBase);
  const outra = await checkout(dados({ email: "amf@exemplo.com", course: "Direito", phone: "(51) 98888-1111" }), AMF.apiBase);
  assert.equal(outra.status, 201);
  assert.equal((await outra.json()).orderId, primeira.orderId);
});

await test("ao renovar um Pix vencido, vale a resposta de carona mais recente", async () => {
  const pessoa = dados({ needsRide: false });
  const inscricao = await (await checkout(pessoa)).json();
  assert.equal(linhasSemana()[0][COL.carona], "Não");
  moverOrder(orderDe(inscricao.orderId).id, {
    order: { status: "expired", status_detail: "expired" },
    payment: { status: "expired", status_detail: "expired" },
  });
  await notificar(orderDe(inscricao.orderId).id);

  const renovada = await (await checkout({ ...pessoa, needsRide: true })).json();
  assert.equal(renovada.orderId, inscricao.orderId, "a renovação não reaproveitou a linha");
  assert.equal(linhasSemana().length, 1);
  assert.equal(linhasSemana()[0][COL.carona], "Sim");
  assert.equal(mp.orders.size, 2, "a renovação não gerou o Pix novo");
});

/* ─── Confirmação ────────────────────────────────────────────────────── */

await test("webhook aprovado confirma como Pago depois de consultar a order", async () => {
  const inscricao = await inscrever();
  const order = orderDe(inscricao.orderId);
  creditar(order.id);

  const consultasAntes = requisicoesPara("GET", `/v1/orders/${order.id}`).length;
  assert.equal((await notificar(order.id)).status, 200);
  assert.ok(
    requisicoesPara("GET", `/v1/orders/${order.id}`).length > consultasAntes,
    "o webhook confirmou sem consultar a order"
  );

  const linha = linhasSemana()[0];
  assert.equal(linha[COL.status], "Pago");
  assert.equal(reais(linha[COL.valorPago]), "R$ 20,00");
  assert.equal(linha[COL.paymentMpId], order.transactions.payments[0].id);
  assert.ok(linha[COL.pagoEm], "sem data do pagamento");
  assert.equal(linhasAmf().length, 0);
});

await test("pendente continua Pendente, recusado vira Falhou e vencido vira Expirado", async () => {
  const pendente = await inscrever();
  await notificar(orderDe(pendente.orderId).id);

  const recusado = await inscrever();
  moverOrder(orderDe(recusado.orderId).id, {
    order: { status: "failed", status_detail: "rejected" },
    payment: { status: "failed", status_detail: "rejected" },
  });
  await notificar(orderDe(recusado.orderId).id);

  const vencido = await inscrever();
  moverOrder(orderDe(vencido.orderId).id, {
    order: { status: "expired", status_detail: "expired" },
    payment: { status: "expired", status_detail: "expired" },
  });
  await notificar(orderDe(vencido.orderId).id);

  const porId = Object.fromEntries(linhasSemana().map((l) => [l[COL.id], l[COL.status]]));
  assert.equal(porId[pendente.orderId], "Pendente");
  assert.equal(porId[recusado.orderId], "Falhou");
  assert.equal(porId[vencido.orderId], "Expirado");

  // Nenhum deles tem comprovante.
  for (const inscricao of [pendente, recusado, vencido]) {
    const res = await baixar(inscricao.orderId, inscricao.token);
    assert.ok([409, 410].includes(res.status), `comprovante saiu para ${porId[inscricao.orderId]}`);
  }
});

await test("notificação duplicada não grava de novo e Pago não regride", async () => {
  const inscricao = await inscricaoPaga();
  const gravacoes = sheet.calls.update;
  await notificar(inscricao.mpOrderId);
  await notificar(inscricao.mpOrderId);
  assert.equal(sheet.calls.update, gravacoes, "reenvio do webhook gravou de novo");

  moverOrder(inscricao.mpOrderId, {
    order: { status: "action_required", status_detail: "waiting_transfer" },
  });
  await notificar(inscricao.mpOrderId);
  assert.equal(linhasSemana()[0][COL.status], "Pago", "o status regrediu");
});

await test("a página só confirma depois de o backend ler a order", async () => {
  const inscricao = await inscrever();
  const antes = await (await status(inscricao.orderId, inscricao.token)).json();
  assert.equal(antes.status, "pendente");

  creditar(orderDe(inscricao.orderId).id);
  await new Promise((r) => setTimeout(r, 4100)); // janela do cache de order
  const depois = await (await status(inscricao.orderId, inscricao.token)).json();
  assert.equal(depois.status, "pago");
  assert.equal(linhasSemana()[0][COL.status], "Pago");
});

await test("o token de uma inscrição do AMF não abre a da Semana, e vice-versa", async () => {
  const semana = await inscrever();
  const amf = await inscrever({ course: "Direito" }, AMF.apiBase);

  assert.equal((await status(amf.orderId, amf.token)).status, 404, "AMF aberto na rota da Semana");
  assert.equal((await status(semana.orderId, semana.token, AMF.apiBase)).status, 404);
  assert.equal((await status(semana.orderId, amf.token)).status, 404, "token alheio aceito");
  assert.equal((await status(semana.orderId, semana.token)).status, 200);
});

/* ─── Comprovante ────────────────────────────────────────────────────── */

await test("o comprovante só sai depois do pagamento aprovado", async () => {
  const inscricao = await inscrever();
  assert.equal((await baixar(inscricao.orderId, inscricao.token)).status, 409);

  creditar(orderDe(inscricao.orderId).id);
  await notificar(orderDe(inscricao.orderId).id);

  const res = await baixar(inscricao.orderId, inscricao.token);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.equal(
    res.headers.get("content-disposition"),
    `attachment; filename="comprovante-churrasco-${inscricao.orderId}.pdf"`
  );
});

await test("o comprovante traz evento, data, quantidade, valor, ID do pagamento, código e confirmação", async () => {
  const inscricao = await inscricaoPaga({ name: "Bruna Costa Lima" });
  const pdf = Buffer.from(await (await baixar(inscricao.orderId, inscricao.token)).arrayBuffer());
  const texto = textoLegivel(pdf);
  const pagoEm = linhasSemana()[0][COL.pagoEm];

  const esperados = [
    "Bruna Costa Lima",
    "Churrasco da AASIAM",
    "Semana Acadêmica de Sistemas de Informação",
    "24/10/2026",
    "A partir das 11h para quem precisar de transporte poder participar",
    "Projeto Terra",
    "1 pessoa",
    "20,00",
    inscricao.paymentId,
    inscricao.orderId,
    pagoEm,
    "PAGAMENTO CONFIRMADO",
  ];
  for (const trecho of esperados) {
    assert.ok(texto.includes(impresso(trecho)), `o PDF não traz "${trecho}"`);
  }
  assert.ok(!texto.includes(impresso("Churrasco da Alcateia")), "o PDF saiu com o nome do AMF");
  assert.ok(!texto.includes(impresso("Ao meio-dia")), "o PDF ainda traz o horário antigo");
  assert.ok(!texto.includes(impresso("CURSO")), "o PDF da Semana ainda mostra o curso");
});

await test("o comprovante não carrega e-mail, telefone, token nem credencial", async () => {
  const inscricao = await inscricaoPaga({ email: "pessoa.secreta@exemplo.com" });
  const pdf = Buffer.from(await (await baixar(inscricao.orderId, inscricao.token)).arrayBuffer());
  const cru = textoDoPdf(pdf);
  for (const segredo of [
    ACCESS_TOKEN,
    WEBHOOK_SECRET,
    COMPROVANTE_SECRET,
    inscricao.token,
    "pessoa.secreta@exemplo.com",
    "55998765432",
    "00020126",
  ]) {
    assert.ok(!cru.includes(segredo), `o PDF vazou "${segredo.slice(0, 18)}..."`);
  }
});

await test("o QR abre a validação da Semana, e um QR não vale no outro evento", async () => {
  const inscricao = await inscricaoPaga();
  const token = criarTokenVerificacao(inscricao.orderId);

  assert.equal(lerTokenVerificacao(token), inscricao.orderId);
  assert.ok(
    urlValidacao(inscricao.orderId, SEMANA).startsWith(
      "https://loja.exemplo.com/churrasco-semana-academica/validar/"
    )
  );

  const valido = await (await validar(token)).json();
  assert.equal(valido.valido, true);
  assert.equal(valido.evento, "Churrasco da AASIAM");
  assert.equal(valido.nome, "Bruna Costa Lima");
  assert.ok(!JSON.stringify(valido).includes("@"), "a validação expôs o e-mail");

  const naRotaDoAmf = await (await validar(token, AMF.apiBase)).json();
  assert.equal(naRotaDoAmf.valido, false, "QR da Semana valeu na validação do AMF");

  const amf = await inscrever({ course: "Direito" }, AMF.apiBase);
  const doAmf = await (await validar(criarTokenVerificacao(amf.orderId))).json();
  assert.equal(doAmf.valido, false, "QR do AMF valeu na validação da Semana");
});

/* ─── Recuperação do comprovante ─────────────────────────────────────── */

await test("e-mail e código certos devolvem o token e a situação", async () => {
  const inscricao = await inscricaoPaga({ email: "recupera@exemplo.com" });

  const res = await recuperar({
    email: "  RECUPERA@exemplo.com ",
    codigo: ` ${inscricao.orderId.toLowerCase()} `,
  });
  const corpo = await res.json();
  assert.equal(res.status, 200);
  assert.equal(corpo.token, inscricaoToken(inscricao.orderId));
  assert.equal(corpo.orderId, inscricao.orderId);
  assert.equal(corpo.status, "pago");
  assert.ok(!JSON.stringify(corpo).includes("recupera@"), "a resposta devolveu o e-mail");

  // Com o token recuperado, o comprovante baixa de novo.
  assert.equal((await baixar(inscricao.orderId, corpo.token)).status, 200);
});

await test("e-mail errado, código inexistente ou malformado recebem a mesma resposta", async () => {
  const inscricao = await inscricaoPaga({ email: "certo@exemplo.com" });
  const outroCodigo = createOrderNsu(new Date(), SEMANA);

  const respostas = [];
  for (const corpo of [
    { email: "errado@exemplo.com", codigo: inscricao.orderId },
    { email: "certo@exemplo.com", codigo: outroCodigo },
    { email: "errado@exemplo.com", codigo: outroCodigo },
    { email: "certo@exemplo.com", codigo: "SEMANASI-2026-CURTO" },
    { email: "certo@exemplo.com", codigo: "CHURRASCO-2026-ABCDEFGH" },
    { email: "não é e-mail", codigo: inscricao.orderId },
    {},
  ]) {
    const res = await recuperar(corpo);
    respostas.push({ status: res.status, corpo: await res.text() });
  }
  for (const r of respostas) {
    assert.equal(r.status, 404);
    assert.equal(r.corpo, respostas[0].corpo, "a resposta muda conforme o caso — revela informação");
    assert.ok(!r.corpo.includes("token"), "devolveu token sem conferir");
  }
  assert.match(
    JSON.parse(respostas[0].corpo).error,
    /Não encontramos uma inscrição com esse e-mail e esse código/
  );
});

await test("a recuperação de uma inscrição pendente devolve o caminho para pagar", async () => {
  const inscricao = await inscrever({ email: "pendente@exemplo.com" });
  const corpo = await (await recuperar({ email: "pendente@exemplo.com", codigo: inscricao.orderId })).json();
  assert.equal(corpo.status, "pendente");
  assert.equal(corpo.final, false);
  const depois = await (await status(inscricao.orderId, corpo.token)).json();
  assert.ok(depois.pix?.qrCode, "o token recuperado não trouxe o Pix de volta");
});

await test("quem insiste no mesmo código é freado, com ou sem espaços no código", async () => {
  const inscricao = await inscrever({ email: "alvo@exemplo.com" });
  const id = inscricao.orderId;
  // Variações que a rota trata como o mesmo código dividem o mesmo balde.
  const variacoes = [id, ` ${id}`, `${id} `, id.toLowerCase(), `${id.slice(0, 9)} ${id.slice(9)}`];
  let ultimo = 0;
  for (let i = 0; i < 12; i++) {
    ultimo = (await recuperar({ email: `tentativa${i}@exemplo.com`, codigo: variacoes[i % variacoes.length] }))
      .status;
  }
  assert.equal(ultimo, 429);
});

/* ─── Prazo de inscrição ─────────────────────────────────────────────── */

await test("aberto até 22/10 23:59:59 em Brasília e fechado a partir de 23/10 00:00", async () => {
  assert.ok(inscricoesAbertas(SEMANA, PRAZO));
  assert.ok(!inscricoesAbertas(SEMANA, PRAZO + 1));
  assert.ok(!inscricoesAbertas(SEMANA, Date.parse("2026-10-23T00:00:00-03:00")));
  assert.ok(inscricoesAbertas(AMF, Date.parse("2030-01-01T00:00:00Z")), "o AMF ganhou prazo");

  relogio.agora = PRAZO;
  assert.equal((await checkout(dados())).status, 201, "fechou antes da hora");

  relogio.agora = PRAZO + 1;
  const res = await checkout(dados());
  const corpo = await res.json();
  assert.equal(res.status, 403);
  assert.equal(corpo.encerradas, true);
  assert.match(corpo.error, /Inscrições encerradas/);
  assert.equal(linhasSemana().length, 1, "criou linha depois do prazo");
  assert.equal(mp.orders.size, 1, "criou cobrança depois do prazo");

  const config = await (await get(`${SEMANA.apiBase}/config`)).json();
  assert.equal(config.inscricoesAbertas, false);
  assert.equal(config.inscricoesAte, SEMANA.inscricoesAte);
});

await test("um Pix gerado antes do prazo e pago depois é confirmado normalmente", async () => {
  const inscricao = await inscrever({ email: "em.cima.da.hora@exemplo.com" });

  relogio.agora = PRAZO + 10 * 60 * 1000; // pagou 10 minutos depois do prazo
  const order = orderDe(inscricao.orderId);
  creditar(order.id);
  assert.equal((await notificar(order.id)).status, 200);
  assert.equal(linhasSemana()[0][COL.status], "Pago");

  assert.equal((await baixar(inscricao.orderId, inscricao.token)).status, 200);
  const recuperada = await recuperar({ email: "em.cima.da.hora@exemplo.com", codigo: inscricao.orderId });
  assert.equal(recuperada.status, 200, "a recuperação fechou junto com as inscrições");
});

await test("depois do prazo um Pix vencido não pode ser renovado", async () => {
  const pessoa = dados();
  const inscricao = await (await checkout(pessoa)).json();
  moverOrder(orderDe(inscricao.orderId).id, {
    order: { status: "expired", status_detail: "expired" },
    payment: { status: "expired", status_detail: "expired" },
  });

  const antes = await (await status(inscricao.orderId, inscricao.token)).json();
  assert.equal(antes.status, "expirado");
  assert.equal(antes.podeRenovar, true, "antes do prazo o Pix vencido pode ser renovado");

  relogio.agora = PRAZO + 1;
  const depois = await (await status(inscricao.orderId, inscricao.token)).json();
  assert.equal(depois.podeRenovar, false);
  assert.equal(depois.inscricoesAbertas, false);
  assert.equal((await checkout(pessoa)).status, 403, "gerou Pix novo depois do prazo");
  assert.equal(mp.orders.size, 1);
});

/* ─── Vagas ──────────────────────────────────────────────────────────── */

await test("sem limite por padrão; com limite, a última vaga não é disputada", async () => {
  const semLimite = await (await get(`${SEMANA.apiBase}/config`)).json();
  assert.equal(semLimite.vagas, null);
  assert.equal(semLimite.vagasRestantes, null);

  const respostas = await Promise.all(
    Array.from({ length: 5 }, () => checkout(dados(), SEMANA_COM_VAGAS.apiBase))
  );
  const codigos = respostas.map((r) => r.status).sort();
  assert.deepEqual(codigos, [201, 201, 409, 409, 409]);
  assert.equal(linhasSemana().length, 2);

  const esgotada = await (await get(`${SEMANA_COM_VAGAS.apiBase}/config`)).json();
  assert.equal(esgotada.vagasRestantes, 0);
  assert.equal(esgotada.inscricoesAbertas, false);

  // Um Pix que venceu devolve a vaga — e a própria pessoa pode renová-lo,
  // mesmo com o evento cheio de novo, sem contar a vaga duas vezes.
  const umaLinha = linhasSemana()[0];
  moverOrder(umaLinha[COL.orderMpId], {
    order: { status: "expired", status_detail: "expired" },
    payment: { status: "expired", status_detail: "expired" },
  });
  await notificar(umaLinha[COL.orderMpId]);
  const dono = { ...dados(), email: umaLinha[COL.email] };

  const [novo, renovacao] = await Promise.all([
    checkout(dados(), SEMANA_COM_VAGAS.apiBase),
    checkout(dono, SEMANA_COM_VAGAS.apiBase),
  ]);
  const disputa = [novo.status, renovacao.status].sort();
  assert.deepEqual(disputa, [201, 409], "a última vaga foi para os dois");
});

/* ─── O AMF segue intacto ────────────────────────────────────────────── */

await test("o AMF segue com preço por curso, na aba de sempre e com 20 colunas", async () => {
  const si = await inscrever({ course: "Sistemas de Informação" }, AMF.apiBase);
  const direito = await inscrever({ course: "Direito", needsRide: true }, AMF.apiBase);

  assert.equal(si.amountCents, 2500);
  assert.equal(direito.amountCents, 3500);
  assert.match(si.orderId, /^CHURRASCO-\d{4}-[A-Z2-9]{8}$/);
  assert.equal(linhasAmf().length, 2);
  assert.ok(linhasAmf().every((l) => l.length === 20), "a aba do AMF ganhou coluna");
  assert.equal(linhasSemana().length, 0, "o AMF escreveu na aba da Semana");

  // Confirma pelo mesmo webhook, na aba dele.
  creditar(orderDe(si.orderId).id);
  await notificar(orderDe(si.orderId).id);
  assert.equal(linhasAmf().find((l) => l[COL.id] === si.orderId)[COL.status], "Pago");
});

await test("a configuração pública da Semana não expõe credencial", async () => {
  const corpo = await (await get(`${SEMANA.apiBase}/config`)).json();
  assert.equal(corpo.evento, EVENTO_SEMANA_SI);
  assert.equal(corpo.inscricoesAbertas, true);
  assert.equal(corpo.abaPlanilha, "Inscrições Churrasco Semana SI");
  assert.equal(corpo.ambiente, "teste");
  const cru = JSON.stringify(corpo);
  assert.ok(!cru.includes(ACCESS_TOKEN) && !cru.includes(WEBHOOK_SECRET));
});

server.close();

console.log(`\n${passed} teste(s) passaram, ${failures.length} falharam.\n`);
if (failures.length) {
  for (const { nome, err } of failures) console.error(`FALHOU: ${nome}\n${err.stack}\n`);
  process.exit(1);
}
