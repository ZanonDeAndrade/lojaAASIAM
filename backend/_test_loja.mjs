/**
 * Regressão da LOJA: sobe o `index.js` de verdade e confere que as rotas do
 * e-commerce continuam no ar depois da migração do churrasco para o Mercado
 * Pago — e que as rotas do churrasco entraram sem colidir com nenhuma delas.
 *
 * Todas as variáveis são preenchidas com valores de teste ANTES do import, e
 * `dotenv` não sobrescreve o que já existe no ambiente: o `.env` real não é
 * lido, nenhuma credencial é impressa e nada sai para a rede.
 *
 * Rodar: node backend/_test_loja.mjs
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = 3599;

process.env.PORT = String(PORT);
process.env.APP_URL = "https://loja.exemplo.com";
process.env.API_URL = "https://api.exemplo.com";
process.env.INFINITEPAY_HANDLE = "loja-de-teste";
process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "planilha-de-teste";
process.env.GOOGLE_SHEETS_SHEET_NAME = "Pedidos de teste";
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "conta-de-teste@exemplo.iam.gserviceaccount.com";
process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nteste\n-----END PRIVATE KEY-----\n";
process.env.MERCADO_PAGO_ACCESS_TOKEN = "TEST-token-de-mentira";
process.env.MERCADO_PAGO_WEBHOOK_SECRET = "segredo-de-teste";
process.env.CHURRASCO_TOKEN_SECRET = "segredo-de-teste";

// Nada deste teste pode sair para a internet.
const fetchLocal = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const alvo = new URL(String(url));
  if (alvo.hostname !== "127.0.0.1" && alvo.hostname !== "localhost") {
    throw new Error(`chamada externa bloqueada no teste: ${alvo.hostname}`);
  }
  return fetchLocal(url, init);
};

// O boot imprime diagnóstico; o teste fica legível sem ele.
const logOriginal = console.log;
console.log = () => {};
await import("./index.js");
await new Promise((r) => setTimeout(r, 400));
console.log = logOriginal;

const base = `http://127.0.0.1:${PORT}`;
const get = (rota, init) => fetch(base + rota, init);
const post = (rota, corpo) =>
  fetch(base + rota, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });

let passed = 0;
const failures = [];

async function test(nome, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${nome}`);
  } catch (err) {
    failures.push({ nome, err });
    console.log(`  ✗ ${nome}\n      ${err.message}`);
  }
}

console.log("\nLoja — as rotas do e-commerce depois da migração do churrasco\n");

await test("/api/health responde e separa loja e churrasco", async () => {
  const corpo = await (await get("/api/health")).json();

  assert.equal(corpo.ok, true);
  assert.equal(corpo.infinitePayConfigured, true, "a loja continua na InfinitePay");
  assert.equal(corpo.churrascoConfigured, true, "o churrasco está no Mercado Pago");
  assert.equal(corpo.churrascoAmbiente, "teste");

  const cru = JSON.stringify(corpo);
  assert.ok(!cru.includes(process.env.INFINITEPAY_HANDLE), "InfiniteTag vazou");
  assert.ok(!cru.includes(process.env.MERCADO_PAGO_ACCESS_TOKEN), "Access Token vazou");
  assert.ok(!cru.includes(process.env.MERCADO_PAGO_WEBHOOK_SECRET), "segredo do webhook vazou");
});

await test("/api/config continua entregando o que a loja lê", async () => {
  const corpo = await (await get("/api/config")).json();

  assert.equal(corpo.infinitePayConfigured, true);
  assert.equal(corpo.googleSheetName, "Pedidos de teste");
  assert.ok(!JSON.stringify(corpo).includes(process.env.INFINITEPAY_HANDLE));
});

await test("os cupons da loja continuam funcionando", async () => {
  assert.deepEqual(await post("/api/validar-cupom", { codigo: "  MILTON   ROBERTO  " }).then((r) => r.json()), {
    valido: true,
    tipo: "custo",
  });
  assert.deepEqual(await post("/api/validar-cupom", { codigo: "fulano da silva" }).then((r) => r.json()), {
    valido: false,
    motivo: "invalido",
  });

  // Uso único: usar e revalidar.
  assert.equal((await post("/api/usar-cupom", { codigo: "Amanda Roos", orderId: "X1" }).then((r) => r.json())).ok, true);
  assert.equal(
    (await post("/api/validar-cupom", { codigo: "amanda roos" }).then((r) => r.json())).motivo,
    "ja_utilizado"
  );

  // Ilimitado continua valendo depois do uso.
  await post("/api/usar-cupom", { codigo: "Gabriela Minuzzi", orderId: "X2" });
  assert.equal(
    (await post("/api/validar-cupom", { codigo: "Gabriela Minuzzi" }).then((r) => r.json())).valido,
    true
  );
});

await test("o checkout da loja continua validando antes de chamar a InfinitePay", async () => {
  // Sem nome, sem telefone e sem itens a rota recusa localmente — nenhuma
  // chamada externa acontece (o fetch deste teste bloquearia).
  const semNome = await post("/api/checkout", { customer: { phone: "51999999999" }, selection: {} });
  assert.equal(semNome.status, 400);
  assert.match((await semNome.json()).error, /nome/i);

  const semTelefone = await post("/api/checkout", { customer: { name: "Teste Loja" }, selection: {} });
  assert.equal(semTelefone.status, 400);
  assert.match((await semTelefone.json()).error, /telefone/i);

  const semItens = await post("/api/checkout", {
    customer: { name: "Teste Loja", phone: "51999999999" },
    selection: {},
  });
  assert.equal(semItens.status, 400);
  assert.match((await semItens.json()).error, /produto/i);
});

await test("somente mochilas e cachecol estão esgotados", async () => {
  const { PRODUCTS } = await import("./shared/products.js");
  const { calculateOrder, createEmptySelection } = await import("./shared/order.js");

  const esgotados = PRODUCTS.filter((p) => p.soldOut === true);
  assert.deepEqual(
    esgotados.map((p) => p.id),
    ["mochila-listras", "mochila-estampa", "manta"],
    "a lista de produtos esgotados está incorreta",
  );

  // Mesmo um carrinho forjado com produtos esgotados não devolve linha nenhuma.
  const selecao = createEmptySelection();
  for (const produto of esgotados) {
    const item = selecao[produto.id];
    if (item.variants) {
      for (const variante of Object.keys(item.variants))
        for (const tamanho of Object.keys(item.variants[variante]))
          item.variants[variante][tamanho] = 5;
    }
    if (item.models) for (const modelo of Object.keys(item.models)) item.models[modelo] = 5;
    if ("quantity" in item) item.quantity = 5;
  }

  const pedido = calculateOrder(selecao);
  assert.equal(pedido.lines.length, 0, "produto esgotado entrou no pedido");
  assert.equal(pedido.totalCents, 0);
  assert.equal(pedido.totalQuantity, 0);

  // E a rota recusa antes de falar com a InfinitePay — o fetch deste teste
  // bloquearia a chamada externa, então um 400 prova que ela nem foi tentada.
  const res = await post("/api/checkout", {
    customer: { name: "Teste Loja", phone: "51999999999" },
    selection: selecao,
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /produto/i);
});

await test("Combo Alcateia mantém R$ 185,00 como preço-base no catálogo e no pedido", async () => {
  const { PRODUCTS } = await import("./shared/products.js");
  const { PRODUCTS: frontendProducts } = await import("../frontend/src/shared/products.js");
  const { calculateOrder, sanitizeSelection } = await import("./shared/order.js");
  const id = "kit-moletom-caneca";

  assert.equal(PRODUCTS.find((product) => product.id === id)?.priceCents, 18500);
  assert.equal(frontendProducts.find((product) => product.id === id)?.priceCents, 18500);

  const order = calculateOrder(sanitizeSelection({
    [id]: { quantity: 1, hoodieVariant: "verde", hoodieSize: "M" },
  }));
  assert.equal(order.totalCents, 18500);
});

await test("Combo Wolf usa peças configuráveis, preço base e snapshot estrutural", async () => {
  const { readFile } = await import("node:fs/promises");
  const { PRODUCTS } = await import("./shared/products.js");
  const {
    calculateOrder,
    multiPieceBundleConfigurationKey,
    sanitizeSelection,
    validateSelection,
  } = await import("./shared/order.js");
  const { PRODUCTS: frontendProducts } = await import("../frontend/src/shared/products.js");
  const wolf = PRODUCTS.find((product) => product.id === "combo-wolf");
  const frontendWolf = frontendProducts.find((product) => product.id === "combo-wolf");

  assert.deepEqual(
    [wolf?.name, wolf?.kind, wolf?.priceCents, wolf?.soldOut, wolf?.costCents],
    ["Combo Wolf", "multiPieceBundle", 41500, undefined, undefined],
  );
  assert.deepEqual(wolf.includes, ["Moletom", "Camiseta", "Caneca com tirante", "Jersey"]);
  assert.deepEqual(wolf.pieces.find((piece) => piece.key === "hoodie").colors.map((color) => color.code), ["verde", "bege"]);
  assert.deepEqual(wolf.pieces.find((piece) => piece.key === "shirt").colors.map((color) => color.code), ["verde", "chumbo"]);
  assert.deepEqual(wolf.pieces.find((piece) => piece.key === "jersey").colors.map((color) => color.code), ["branca", "preta"]);
  assert.equal(PRODUCTS.some((product) => product.id === "kit-completo" || product.name === "Combo Alpha"), false);

  // As imagens são só do frontend (o backend não renderiza nada). A galeria do
  // Combo Wolf mostra as peças soltas; a foto de composição e a capa ficam fora
  // do carrossel.
  assert.deepEqual(frontendWolf.images, [
    "/imgs/moletom-verde.png",
    "/imgs/camiseta-aasiam.png",
    "/imgs/jerseys.png",
    "/imgs/copo.png",
  ]);
  assert.ok(!frontendWolf.images.includes("/imgs/combo-wolf.png"));
  assert.ok(!frontendWolf.images.includes(frontendWolf.coverImage), "a capa não pode estar na galeria");
  assert.equal(frontendWolf.coverImage, "/imgs/wolfc.png");

  // Fora das chaves de apresentação (imagens, capa, enquadramento, cor de
  // destaque, tag), o catálogo do frontend TEM de bater com o do backend, que é
  // quem manda no preço e na composição.
  const semApresentacao = (p) => {
    const { images, coverImage, galleryFit, accent, tag, ...resto } = p;
    return resto;
  };
  assert.deepEqual(
    semApresentacao(frontendWolf),
    semApresentacao(wolf),
    "catálogo do frontend diverge do backend em campo comercial/estrutural",
  );

  const wolfM = {
    quantity: 1,
    hoodieColor: "verde", hoodieSize: "M",
    shirtColor: "chumbo", shirtSize: "G",
    jerseyColor: "preta", jerseySize: "GG",
  };
  const wolfG = { ...wolfM, hoodieSize: "G" };
  assert.notEqual(
    multiPieceBundleConfigurationKey(wolf, wolfM),
    multiPieceBundleConfigurationKey(wolf, wolfG),
    "configurações distintas do Combo Wolf foram identificadas como o mesmo item",
  );
  assert.equal(validateSelection({ "combo-wolf": wolfM }), null);

  const selection = sanitizeSelection({
    "combo-wolf": {
      configurations: {
        primeiro: wolfM,
        segundo: wolfG,
      },
    },
  });
  const order = calculateOrder(selection);
  assert.equal(order.lines.length, 2, "combinações diferentes foram fundidas no pedido");
  assert.equal(order.totalCents, 83000);
  assert.deepEqual(
    order.lines.map((line) => [
      line.hoodieColor, line.hoodieSize,
      line.shirtColor, line.shirtSize,
      line.jerseyColor, line.jerseySize,
      line.fixedItems,
    ]),
    [
      ["verde", "M", "chumbo", "G", "preta", "GG", [{ name: "Caneca com tirante", quantity: 1 }]],
      ["verde", "G", "chumbo", "G", "preta", "GG", [{ name: "Caneca com tirante", quantity: 1 }]],
    ],
  );

  for (const [field, value] of [
    ["hoodieColor", "hack"], ["hoodieSize", "XXXX"],
    ["shirtColor", "hack"], ["shirtColor", "off-white"], ["shirtColor", "preta"], ["shirtSize", "XXXX"],
    ["jerseyColor", "hack"], ["jerseyColor", "bicolor"], ["jerseySize", "XXXX"],
  ]) {
    assert.match(validateSelection({ "combo-wolf": { ...wolfM, [field]: value } }).error, /válid[ao]/i);
  }

  const app = await readFile(path.join(here, "..", "frontend", "src", "App.jsx"), "utf8");
  assert.match(app, /'combo-wolf': 'kits'/);
  assert.match(app, /multiPieceBundleConfigurationKey/);
  assert.match(app, /disabled=\{!selectionComplete\}/);
});

await test("os novos uniformes preservam tamanhos, preço e combinações", async () => {
  const { readFile } = await import("node:fs/promises");
  const { PRODUCTS } = await import("./shared/products.js");
  const { calculateOrder, sanitizeSelection, validateSelection } = await import("./shared/order.js");

  assert.deepEqual(
    PRODUCTS.filter((p) => ["conjunto-chumbo", "conjunto-verde", "jersey"].includes(p.id)).map((p) => [p.id, p.name, p.kind, p.priceCents]),
    [
      ["conjunto-chumbo", "Conjunto Chumbo AASIAM", "twoPieceSet", 14000],
      ["conjunto-verde", "Conjunto Verde AASIAM", "twoPieceSet", 14000],
      ["jersey", "Jersey AASIAM", "sizedVariants", 15000],
    ],
  );

  const selection = sanitizeSelection({
    "conjunto-chumbo": { combinations: { M: { G: 1, M: 1 } } },
    "conjunto-verde": { combinations: { G: { M: 1 } } },
    jersey: { variants: { branca: { G: 1 }, preta: { G: 1 } } },
  });
  const order = calculateOrder(selection);
  assert.deepEqual(
    order.lines.map((line) => [line.productId, line.color || "", line.shirtSize || line.size, line.shortsSize || "", line.unitPriceCents]),
    [
      ["conjunto-chumbo", "", "M", "M", 14000],
      ["conjunto-chumbo", "", "M", "G", 14000],
      ["conjunto-verde", "", "G", "M", 14000],
      ["jersey", "branca", "G", "", 15000],
      ["jersey", "preta", "G", "", 15000],
    ],
    "combinações distintas do conjunto foram mescladas ou perderam tamanhos",
  );
  assert.equal(order.totalCents, 72000);
  assert.match(
    validateSelection({ "conjunto-chumbo": { combinations: { XXXXXX: { G: 1 } } } }).error,
    /camiseta/i,
  );
  assert.match(
    validateSelection({ "conjunto-chumbo": { combinations: { M: { XXXXXX: 1 } } } }).error,
    /calção/i,
  );
  assert.equal(validateSelection({ jersey: { variants: { branca: { M: 1 }, preta: { GG: 1 } } } }), null);
  assert.match(validateSelection({ jersey: { variants: { azul: { M: 1 } } } }).error, /cor/i);
  assert.match(validateSelection({ jersey: { variants: { branca: { XXXXXX: 1 } } } }).error, /tamanho/i);
  assert.match(validateSelection({ jersey: { quantity: 1, size: "M" } }).error, /cor/i);

  const app = await readFile(path.join(here, "..", "frontend", "src", "App.jsx"), "utf8");
  for (const id of ["conjunto-chumbo", "conjunto-verde", "jersey"]) {
    assert.match(app, new RegExp(`'${id}': 'camiseta'`), `${id} não está na seção Camisetas`);
  }
});

await test("o cálculo do pedido é o mesmo no frontend e no backend", async () => {
  const { readFile } = await import("node:fs/promises");
  const daqui = path.join(here, "shared");
  const doFront = path.join(here, "..", "frontend", "src", "shared");

  // order.js é a regra de dinheiro: as duas cópias precisam ser a mesma.
  const [backend, frontend] = await Promise.all([
    readFile(path.join(daqui, "order.js"), "utf8"),
    readFile(path.join(doFront, "order.js"), "utf8"),
  ]);
  assert.equal(frontend, backend, "backend/shared/order.js e o do frontend divergiram");

  // products.js diverge de propósito em nome e imagem, mas o que decide venda
  // e preço tem de bater produto a produto.
  const daquiP = await import("./shared/products.js");
  const doFrontP = await import(
    pathToFileURL(path.join(doFront, "products.js")).href
  );
  assert.deepEqual(
    doFrontP.PRODUCTS.map((p) => [p.id, p.priceCents, p.soldOut === true]),
    daquiP.PRODUCTS.map((p) => [p.id, p.priceCents, p.soldOut === true]),
    "id, preço ou situação de venda divergem entre frontend e backend"
  );
});

await test("Camisetas Verde e Chumbo: tamanho obrigatório, nome/número opcionais e estruturados", async () => {
  const { PRODUCTS } = await import("./shared/products.js");
  const { calculateOrder, sanitizeSelection, validateSelection, personalizationKey } = await import(
    "./shared/order.js"
  );

  const IDS = ["camiseta-aasiam", "camiseta-goleiro-aasiam"];
  for (const id of IDS) {
    const p = PRODUCTS.find((x) => x.id === id);
    assert.equal(p.kind, "personalizedSizedProduct", `${id} não é personalizedSizedProduct`);
    assert.deepEqual(p.sizes, ["PP", "P", "M", "G", "GG", "XG"], `${id} tem tamanhos errados`);
    assert.equal(p.priceCents, 9000, `${id} teve o preço alterado`);
  }

  const sel = (cfg) => ({ "camiseta-aasiam": cfg });
  const linhaUnica = (cfg) => {
    const order = calculateOrder(sanitizeSelection(sel(cfg)));
    return order.lines;
  };

  // Tamanho obrigatório — sem tamanho não entra no pedido e a validação recusa.
  assert.equal(linhaUnica({ configurations: { a: { quantity: 1 } } }).length, 0, "camiseta sem tamanho entrou no pedido");
  assert.match(
    validateSelection(sel({ configurations: { a: { quantity: 1, size: "XXL" } } })).error,
    /tamanho/i
  );
  for (const size of ["PP", "P", "M", "G", "GG", "XG"]) {
    assert.equal(validateSelection(sel({ configurations: { a: { quantity: 1, size } } })), null, `${size} deveria valer`);
  }

  // Compra sem personalização é válida e a linha guarda os campos vazios.
  const semPerso = linhaUnica({ configurations: { a: { quantity: 1, size: "M" } } });
  assert.equal(semPerso.length, 1);
  assert.equal(semPerso[0].size, "M");
  assert.equal(semPerso[0].personalizationName, "");
  assert.equal(semPerso[0].personalizationNumber, "");
  assert.equal(semPerso[0].unitPriceCents, 9000);

  // Nome sem número · número sem nome · nome + número — todos válidos e estruturados.
  const soNome = linhaUnica({ configurations: { a: { quantity: 1, size: "G", personalizationName: "  Ana Clara  " } } })[0];
  assert.equal(soNome.personalizationName, "Ana Clara", "trim/colapso de espaço do nome falhou");
  assert.equal(soNome.personalizationNumber, "");

  const soNumero = linhaUnica({ configurations: { a: { quantity: 1, size: "GG", personalizationNumber: "23" } } })[0];
  assert.equal(soNumero.personalizationName, "");
  assert.equal(soNumero.personalizationNumber, "23");

  const nomeENumero = linhaUnica({
    configurations: { a: { quantity: 1, size: "P", personalizationName: "D'Avila-Neto", personalizationNumber: "7" } },
  })[0];
  assert.equal(nomeENumero.personalizationName, "D'Avila-Neto");
  assert.equal(nomeENumero.personalizationNumber, "7");
  assert.match(nomeENumero.variant, /Tam\. P · Nome: D'Avila-Neto · Número: 7/);

  // Rejeições.
  assert.match(
    validateSelection(sel({ configurations: { a: { quantity: 1, size: "M", personalizationName: "x".repeat(21) } } })).error,
    /20 caracteres/i
  );
  assert.match(
    validateSelection(sel({ configurations: { a: { quantity: 1, size: "M", personalizationName: "<script>" } } })).error,
    /letras/i
  );
  for (const numeroRuim of ["-10", "1.5", "23abc", "100"]) {
    assert.match(
      validateSelection(sel({ configurations: { a: { quantity: 1, size: "M", personalizationNumber: numeroRuim } } })).error || "",
      /\d+ d[íi]gitos|dígitos/i,
      `número "${numeroRuim}" deveria ser recusado`
    );
  }

  // Chave do carrinho: diferencia nome, número e "com × sem personalização".
  const k = (name, number) =>
    personalizationKey({ size: "M", personalizationName: name, personalizationNumber: number });
  assert.notEqual(k("ARTHUR", "23"), k("PEDRO", "23"));
  assert.notEqual(k("ARTHUR", "23"), k("ARTHUR", "10"));
  assert.notEqual(k("ARTHUR", "23"), k("", ""));
  assert.equal(k(" Arthur ", "23"), k("arthur", "23"), "trim/caixa não normalizou a chave");

  // sanitizeSelection funde a MESMA personalização e mantém as diferentes.
  const fundido = calculateOrder(
    sanitizeSelection(
      sel({
        configurations: {
          a: { quantity: 1, size: "M", personalizationName: "ARTHUR", personalizationNumber: "23" },
          b: { quantity: 2, size: "M", personalizationName: " arthur ", personalizationNumber: "23" },
          c: { quantity: 1, size: "M", personalizationName: "PEDRO", personalizationNumber: "10" },
        },
      })
    )
  );
  assert.equal(fundido.lines.length, 2, "personalizações iguais não foram fundidas ou as diferentes sumiram");
  const arthur = fundido.lines.find((l) => l.personalizationName.toLowerCase() === "arthur");
  assert.equal(arthur.quantity, 3, "quantidades da mesma personalização não somaram");
  assert.equal(fundido.totalCents, 4 * 9000, "preço da camiseta mudou com a personalização");
});

await test("o webhook da InfinitePay da loja continua no ar e no endereço antigo", async () => {
  const res = await post("/api/webhooks/infinitepay", {});
  assert.equal(res.status, 200, "a loja precisa continuar respondendo 200 rápido");
});

await test("a consulta de pedido da loja continua respondendo", async () => {
  const corpo = await (await get("/api/pedido/AASIAM-20260101120000-ABC123")).json();

  assert.equal(corpo.orderId, "AASIAM-20260101120000-ABC123");
  assert.equal(corpo.verified, false, "sem transaction_nsu não há verificação");
  assert.equal(corpo.paid, false);
});

await test("as rotas do churrasco estão montadas e não colidem com as da loja", async () => {
  const config = await (await get("/api/churrasco/config")).json();
  assert.equal(config.pagamento, "pix");
  assert.equal(config.provedor, "Mercado Pago");

  // Sem token, a consulta de inscrição responde 404 — nunca vaza existência.
  const semToken = await get("/api/churrasco/pagamentos/CHURRASCO-2026-ABCDEFGH/status");
  assert.equal(semToken.status, 404);

  // O webhook do churrasco exige assinatura; o da loja não foi tocado.
  const semAssinatura = await post("/api/churrasco/webhook/mercadopago", {
    type: "order",
    data: { id: "ORD01X" },
  });
  assert.equal(semAssinatura.status, 401);
});

await test("o CORS libera o header da inscrição sem afetar a loja", async () => {
  const res = await fetch(`${base}/api/config`, {
    method: "OPTIONS",
    headers: { Origin: "https://loja.exemplo.com" },
  });

  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://loja.exemplo.com");
  assert.match(res.headers.get("access-control-allow-headers"), /X-Inscricao-Token/);
});

console.log(`\n${passed} teste(s) passaram, ${failures.length} falharam.\n`);
if (failures.length) {
  for (const { nome, err } of failures) console.error(`FALHOU: ${nome}\n${err.stack}\n`);
  process.exitCode = 1;
}
process.exit(failures.length ? 1 : 0);
