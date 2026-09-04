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

  // Cupom de teste: tipo "teste", ilimitado, não trava.
  assert.deepEqual(await post("/api/validar-cupom", { codigo: " GabiMinuzzi100 " }).then((r) => r.json()), {
    valido: true,
    tipo: "teste",
  });
  await post("/api/usar-cupom", { codigo: "GabiMinuzzi100", orderId: "X3" });
  assert.equal(
    (await post("/api/validar-cupom", { codigo: "gabiminuzzi100" }).then((r) => r.json())).valido,
    true
  );

  // GabrielaMinuzzi100: mesmo comportamento, e não colide com "Gabriela Minuzzi" (custo).
  assert.deepEqual(await post("/api/validar-cupom", { codigo: "  GabrielaMinuzzi100 " }).then((r) => r.json()), {
    valido: true,
    tipo: "teste",
  });
  assert.deepEqual(await post("/api/validar-cupom", { codigo: "Gabriela Minuzzi" }).then((r) => r.json()), {
    valido: true,
    tipo: "custo",
  });
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
    const { images, coverImage, coverFit, coverPosition, coverBackground, galleryFit, accent, tag, ...resto } = p;
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

  // Só a camiseta é personalizável, e o nome/número entram na chave do carrinho.
  assert.deepEqual(
    wolf.pieces.map((p) => [p.key, Boolean(p.personalization)]),
    [["hoodie", false], ["shirt", true], ["jersey", false]],
  );
  const wolfArthur = { ...wolfM, shirtPersonalizationName: "ARTHUR", shirtPersonalizationNumber: "23" };
  const wolfPedro = { ...wolfM, shirtPersonalizationName: "PEDRO", shirtPersonalizationNumber: "10" };
  assert.notEqual(
    multiPieceBundleConfigurationKey(wolf, wolfArthur),
    multiPieceBundleConfigurationKey(wolf, wolfPedro),
    "personalizações diferentes da camiseta não separaram o Combo Wolf no carrinho",
  );
  assert.notEqual(
    multiPieceBundleConfigurationKey(wolf, wolfArthur),
    multiPieceBundleConfigurationKey(wolf, wolfM),
    "com × sem personalização deveriam ser itens diferentes",
  );
  assert.equal(validateSelection({ "combo-wolf": wolfArthur }), null, "personalização válida foi recusada");
  assert.match(
    validateSelection({ "combo-wolf": { ...wolfM, shirtPersonalizationName: "x".repeat(30) } }).error,
    /Camiseta/,
  );

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

await test("Combos novos (Signature, Território, Domínio): modelagem, preço e validação reaproveitam multiPieceBundle", async () => {
  const { PRODUCTS } = await import("./shared/products.js");
  const {
    calculateOrder,
    multiPieceBundleConfigurationKey,
    sanitizeSelection,
    validateSelection,
  } = await import("./shared/order.js");
  const { PRODUCTS: frontendProducts } = await import("../frontend/src/shared/products.js");
  const { readFile } = await import("node:fs/promises");

  const back = (id) => PRODUCTS.find((p) => p.id === id);
  const front = (id) => frontendProducts.find((p) => p.id === id);

  // Todos são multiPieceBundle — nada de kind novo por combo.
  for (const id of ["combo-signature", "combo-territorio", "combo-dominio"]) {
    assert.equal(back(id)?.kind, "multiPieceBundle", `${id} não é multiPieceBundle`);
    assert.equal(back(id)?.costCents, undefined, `${id} ganhou costCents sem autorização`);
  }

  // Preço oficial, igual no frontend e no backend.
  assert.deepEqual(
    ["combo-signature", "combo-territorio", "combo-dominio"].map((id) => [back(id).priceCents, front(id).priceCents]),
    [[16000, 16000], [18000, 18000], [23000, 23000]],
  );

  // Paridade comercial/estrutural frontend × backend (fora imagem/capa/tag/accent).
  const semApresentacao = (p) => {
    const { images, coverImage, coverFit, coverPosition, coverBackground, galleryFit, accent, tag, ...resto } = p;
    return resto;
  };
  for (const id of ["combo-signature", "combo-territorio", "combo-dominio"]) {
    assert.deepEqual(semApresentacao(front(id)), semApresentacao(back(id)), `${id}: catálogo diverge`);
  }

  // ── Signature: duas camisetas de cor FIXA (verde + chumbo), personalização por peça.
  const signature = back("combo-signature");
  assert.deepEqual(signature.includes, ["Camiseta Verde", "Camiseta Chumbo"]);
  assert.deepEqual(
    signature.pieces.map((p) => [p.key, p.colors.map((c) => c.code), Boolean(p.personalization)]),
    [["greenShirt", ["verde"], true], ["charcoalShirt", ["chumbo"], true]],
  );

  const sigBase = {
    quantity: 1,
    greenShirtSize: "M", greenShirtPersonalizationName: "ARTHUR", greenShirtPersonalizationNumber: "23",
    charcoalShirtSize: "G", charcoalShirtPersonalizationName: "PEDRO", charcoalShirtPersonalizationNumber: "10",
  };
  assert.equal(validateSelection({ "combo-signature": sigBase }), null, "config válida do Signature foi recusada");

  // A cor não é escolhível: mandar "chumbo" na camiseta verde é ignorado, não vira erro.
  const sigForjado = { ...sigBase, greenShirtColor: "chumbo", charcoalShirtColor: "verde" };
  assert.equal(validateSelection({ "combo-signature": sigForjado }), null);
  const linhaForjada = calculateOrder(sanitizeSelection({ "combo-signature": { configurations: { a: sigForjado } } })).lines[0];
  assert.equal(linhaForjada.greenShirtColor, "verde", "camiseta verde aceitou virar chumbo");
  assert.equal(linhaForjada.charcoalShirtColor, "chumbo", "camiseta chumbo aceitou virar verde");
  assert.equal(linhaForjada.unitPriceCents, 16000);

  // Tamanho obrigatório nas duas; tamanho inválido recusado.
  assert.match(validateSelection({ "combo-signature": { ...sigBase, greenShirtSize: "XXXX" } }).error, /tamanho.*Camiseta Verde/i);
  assert.match(validateSelection({ "combo-signature": { ...sigBase, charcoalShirtSize: "" } }).error, /tamanho.*Camiseta Chumbo/i);

  // Personalizações independentes: chave distinta, sem agrupar.
  assert.notEqual(
    multiPieceBundleConfigurationKey(signature, sigBase),
    multiPieceBundleConfigurationKey(signature, { ...sigBase, charcoalShirtPersonalizationName: "JOAO" }),
  );
  const sigOrder = calculateOrder(sanitizeSelection({
    "combo-signature": { configurations: { a: sigBase, b: { ...sigBase, greenShirtSize: "P" } } },
  }));
  assert.equal(sigOrder.lines.length, 2, "configs diferentes do Signature foram fundidas");
  assert.equal(sigOrder.totalCents, 32000);
  // Espelho plano p/ planilha reúne as DUAS camisetas.
  assert.equal(sigOrder.lines[0].personalizationName, "ARTHUR / PEDRO");
  assert.equal(sigOrder.lines[0].personalizationNumber, "23 / 10");
  assert.match(sigOrder.lines[0].variant, /Camiseta Verde: Verde \/ M · Nome: ARTHUR · Número: 23/);
  assert.match(sigOrder.lines[0].variant, /Camiseta Chumbo: Chumbo \/ G · Nome: PEDRO · Número: 10/);

  // ── Território: 1 Jersey (reusa JERSEY_VARIANTS) + caneca fixa.
  const territorio = back("combo-territorio");
  assert.deepEqual(territorio.pieces.map((p) => p.key), ["jersey"]);
  assert.deepEqual(territorio.pieces[0].colors.map((c) => c.code), ["branca", "preta"]);
  assert.deepEqual(territorio.fixedItems, [{ name: "Caneca com tirante", quantity: 1 }]);
  const terrOk = { quantity: 1, jerseyColor: "preta", jerseySize: "M", jerseyPersonalizationName: "ARTHUR", jerseyPersonalizationNumber: "23" };
  assert.equal(validateSelection({ "combo-territorio": terrOk }), null);
  for (const color of ["branca", "preta"]) {
    assert.equal(validateSelection({ "combo-territorio": { ...terrOk, jerseyColor: color } }), null, `Jersey ${color} recusada`);
  }
  assert.match(validateSelection({ "combo-territorio": { ...terrOk, jerseyColor: "azul" } }).error, /cor válida.*Jersey/i);
  assert.match(validateSelection({ "combo-territorio": { ...terrOk, jerseySize: "XXXX" } }).error, /tamanho válido.*Jersey/i);
  const terrLinha = calculateOrder(sanitizeSelection({ "combo-territorio": { configurations: { a: terrOk } } })).lines[0];
  assert.equal(terrLinha.unitPriceCents, 18000);
  assert.equal(terrLinha.jerseyColor, "preta");
  assert.deepEqual(terrLinha.fixedItems, [{ name: "Caneca com tirante", quantity: 1 }]);
  assert.match(terrLinha.variant, /Jersey: Preta \/ M · Nome: ARTHUR · Número: 23 · Caneca com tirante: 1 unidade/);
  assert.equal(terrLinha.personalizationName, "ARTHUR");

  // Nome e número são opcionais.
  assert.equal(validateSelection({ "combo-territorio": { quantity: 1, jerseyColor: "branca", jerseySize: "P" } }), null);

  // ── Domínio: moletom (HOODIE_VARIANTS) + camiseta (SHIRT_VARIANTS), só a camiseta personaliza.
  const dominio = back("combo-dominio");
  assert.deepEqual(
    dominio.pieces.map((p) => [p.key, p.colors.map((c) => c.code), Boolean(p.personalization)]),
    [["hoodie", ["verde", "bege"], false], ["shirt", ["verde", "chumbo"], true]],
  );
  const domOk = { quantity: 1, hoodieColor: "bege", hoodieSize: "G", shirtColor: "chumbo", shirtSize: "M", shirtPersonalizationName: "ARTHUR", shirtPersonalizationNumber: "23" };
  assert.equal(validateSelection({ "combo-dominio": domOk }), null);
  assert.match(validateSelection({ "combo-dominio": { ...domOk, shirtColor: "rosa" } }).error, /cor válida.*Camiseta/i);
  assert.match(validateSelection({ "combo-dominio": { ...domOk, shirtColor: "bege" } }).error, /cor válida.*Camiseta/i);
  assert.match(validateSelection({ "combo-dominio": { ...domOk, hoodieColor: "chumbo" } }).error, /cor válida.*Moletom/i);
  assert.match(validateSelection({ "combo-dominio": { ...domOk, hoodieSize: "XXXX" } }).error, /tamanho válido.*Moletom/i);
  const domLinha = calculateOrder(sanitizeSelection({ "combo-dominio": { configurations: { a: domOk } } })).lines[0];
  assert.equal(domLinha.unitPriceCents, 23000);
  assert.equal(domLinha.personalizationName, "ARTHUR");
  assert.ok(!("hoodiePersonalizationName" in domLinha), "personalização vazou para o moletom");
  assert.match(domLinha.variant, /Moletom: Off-white \/ G · Camiseta: Chumbo \/ M · Nome: ARTHUR · Número: 23/);

  // Preço nunca vem do navegador.
  assert.equal(
    calculateOrder(sanitizeSelection({ "combo-dominio": { configurations: { a: { ...domOk, priceCents: 1, unitPriceCents: 1 } } } })).lines[0].unitPriceCents,
    23000,
  );

  // Categoria e contador: os três entram em Combos, sem hardcode de quantidade.
  const app = await readFile(path.join(here, "..", "frontend", "src", "App.jsx"), "utf8");
  for (const id of ["combo-signature", "combo-territorio", "combo-dominio"]) {
    assert.match(app, new RegExp(`'${id}': 'kits'`), `${id} não está na seção Combos`);
  }
  // O card/carrinho aguenta bundle SEM fixedItems (Signature/Domínio) e peça de cor fixa.
  assert.match(app, /product\.fixedItems \|\| \[\]/, "buildCartItem quebra em bundle sem fixedItems");
  assert.match(app, /piece\.colors\.length === 1/, "seletor de cor fixa do multiPieceBundle sumiu");
});

await test("Jersey e conjuntos: kind unificado, tamanhos, cor e personalização da camiseta", async () => {
  const { readFile } = await import("node:fs/promises");
  const { PRODUCTS } = await import("./shared/products.js");
  const { calculateOrder, sanitizeSelection, validateSelection } = await import("./shared/order.js");

  // Os três (mais as camisetas avulsas) agora usam UM kind só.
  assert.deepEqual(
    PRODUCTS.filter((p) => ["conjunto-chumbo", "conjunto-verde", "jersey"].includes(p.id)).map((p) => [
      p.id,
      p.name,
      p.kind,
      p.priceCents,
      p.attributes.map((a) => a.key),
      Boolean(p.personalization),
    ]),
    [
      ["conjunto-chumbo", "Conjunto Chumbo AASIAM", "personalizedProduct", 14000, ["shirtSize", "shortsSize"], true],
      ["conjunto-verde", "Conjunto Verde AASIAM", "personalizedProduct", 14000, ["shirtSize", "shortsSize"], true],
      ["jersey", "Jersey AASIAM", "personalizedProduct", 15000, ["color", "size"], true],
    ],
  );
  assert.deepEqual(
    PRODUCTS.find((p) => p.id === "jersey").attributes[0].options.map((o) => o.code),
    ["branca", "preta"],
    "a Jersey perdeu as cores Branca/Preta",
  );

  // Jersey: preço não muda; personalizações diferentes são itens diferentes.
  const jerseySel = {
    jersey: {
      configurations: {
        a: { quantity: 1, color: "preta", size: "M", personalizationName: " Arthur ", personalizationNumber: "23" },
        b: { quantity: 1, color: "preta", size: "M", personalizationName: "PEDRO", personalizationNumber: "23" },
        c: { quantity: 2, color: "preta", size: "M", personalizationName: "arthur", personalizationNumber: "23" },
        d: { quantity: 1, color: "branca", size: "M", personalizationName: "Arthur", personalizationNumber: "23" },
      },
    },
  };
  const jerseyOrder = calculateOrder(sanitizeSelection(jerseySel));
  assert.equal(jerseyOrder.lines.length, 3, "Arthur/23/preta/M deveria fundir; Pedro e Branca não");
  const arthurPreta = jerseyOrder.lines.find(
    (l) => l.color === "preta" && l.personalizationName.toLowerCase() === "arthur"
  );
  assert.equal(arthurPreta.quantity, 3, "trim/caixa não fundiu 'Arthur' e ' arthur '");
  assert.equal(arthurPreta.personalizationNumber, "23");
  assert.equal(jerseyOrder.totalCents, 5 * 15000);

  // O valor salvo preserva a caixa que o cliente digitou (aqui, um único item).
  const soArthur = calculateOrder(
    sanitizeSelection({
      jersey: {
        configurations: { a: { quantity: 1, color: "branca", size: "M", personalizationName: "  Arthur  " } },
      },
    })
  ).lines[0];
  assert.equal(soArthur.personalizationName, "Arthur", "trim manteve a caixa original");

  // Conjunto: nome/número pertencem à CAMISETA; calção não tem personalização.
  const conjSel = {
    "conjunto-chumbo": {
      configurations: {
        a: { quantity: 1, shirtSize: "M", shortsSize: "G", personalizationName: "ARTHUR", personalizationNumber: "23" },
        b: { quantity: 1, shirtSize: "M", shortsSize: "G", personalizationName: "PEDRO", personalizationNumber: "10" },
        c: { quantity: 1, shirtSize: "M", shortsSize: "G" },
      },
    },
  };
  const conjOrder = calculateOrder(sanitizeSelection(conjSel));
  assert.equal(conjOrder.lines.length, 3, "ARTHUR, PEDRO e sem personalização deveriam ser 3 itens");
  assert.equal(conjOrder.totalCents, 3 * 14000);
  const arthurConj = conjOrder.lines.find((l) => l.personalizationName === "ARTHUR");
  assert.equal(arthurConj.shirtSize, "M");
  assert.equal(arthurConj.shortsSize, "G");
  assert.equal("shortsPersonalizationName" in arthurConj, false, "personalização vazou para o calção");
  assert.match(arthurConj.variant, /Camiseta M · Calção G · Nome: ARTHUR · Número: 23/);

  // Validação (backend é autoridade).
  assert.match(validateSelection({ "conjunto-chumbo": { configurations: { a: { quantity: 1, shortsSize: "G" } } } }).error, /camiseta/i);
  assert.match(validateSelection({ "conjunto-chumbo": { configurations: { a: { quantity: 1, shirtSize: "M" } } } }).error, /cal[çc]/i);
  assert.match(validateSelection({ jersey: { configurations: { a: { quantity: 1, size: "M" } } } }).error, /cor/i);
  assert.match(validateSelection({ jersey: { configurations: { a: { quantity: 1, color: "azul", size: "M" } } } }).error, /cor/i);
  assert.match(
    validateSelection({ jersey: { configurations: { a: { quantity: 1, color: "preta", size: "M", personalizationName: "N".repeat(30) } } } }).error,
    /20 caracteres/i
  );
  assert.match(
    validateSelection({ jersey: { configurations: { a: { quantity: 1, color: "preta", size: "M", personalizationNumber: "999" } } } }).error,
    /d[íi]gitos/i
  );

  const app = await readFile(path.join(here, "..", "frontend", "src", "App.jsx"), "utf8");
  for (const id of ["conjunto-chumbo", "conjunto-verde", "jersey", "camiseta-aasiam"]) {
    assert.match(app, new RegExp(`'${id}': 'camiseta'`), `${id} não está na seção Camisetas`);
  }
  assert.match(app, /PersonalizationFields/, "o componente compartilhado não é usado no App.jsx");
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
    assert.equal(p.kind, "personalizedProduct", `${id} não é personalizedProduct`);
    assert.deepEqual(p.attributes.map((a) => a.key), ["size"], `${id} tem atributos errados`);
    assert.deepEqual(p.attributes[0].options, ["PP", "P", "M", "G", "GG", "XG"], `${id} tem tamanhos errados`);
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
  const k = (name, number) => personalizationKey(["M"], name, number);
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
