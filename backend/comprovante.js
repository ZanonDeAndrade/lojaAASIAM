/**
 * Comprovante de inscrição e pagamento do Churrasco da Alcateia — PDF.
 *
 * O documento é a comanda da tela, impressa: mesma linguagem visual (a linha
 * serrilhada, o código em monoespaçada, o carimbo de status), invertida para o
 * papel — fundo branco, preto no texto e o verde da AASIAM como único acento.
 *
 * Tudo é gerado aqui dentro, a partir da linha oficial da inscrição. Nada vem
 * do navegador, nada sai para a rede: a fonte é a padrão do PDF e a logo é um
 * arquivo local.
 *
 * O QR Code impresso NÃO é o do Pix. É um token próprio, assinado por HMAC,
 * que abre a página de validação — o Pix já venceu quando o comprovante existe.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import PDFDocument from "pdfkit";
import QRCode from "qrcode";

import {
  METODO_PERMITIDO,
  PROVEDOR,
  STATUS_PAGO,
  categoryForCourse,
  formatBRL,
} from "./shared/churrasco.js";

const aqui = path.dirname(fileURLToPath(import.meta.url));

export const COMPROVANTE_TITULO = "Comprovante de inscrição e pagamento";
export const EVENTO = "Churrasco da Alcateia";

/* ─── Paleta ──────────────────────────────────────────────────────────
   Os mesmos tokens da página, traduzidos para papel: o neon (#3be477) some
   sobre branco, então quem carrega o acento é o verde escuro (--ch-neon-dim),
   e o "preto" continua sendo o preto esverdeado da página, não um #000 seco. */
const VERDE = "#1AA85A";
const VERDE_LAVADO = "#EAF7F0";
const PRETO = "#0B120E";
const CINZA = "#5D7264";
const LINHA = "#C6DCCE";

/* Helvetica e Courier são as fontes padrão do PDF: nada é baixado, e a
   codificação WinAnsi cobre todos os acentos do português. */
const TITULO = "Helvetica-Bold";
const TEXTO = "Helvetica";
const MONO = "Courier-Bold";

const A4 = { largura: 595.28, altura: 841.89 };
const MARGEM = 48;
const CONTEUDO = A4.largura - MARGEM * 2;

/* ─── Token de verificação ───────────────────────────────────────────── */

/**
 * Segredo exclusivo do comprovante. Fica só no backend e nunca entra no PDF.
 * Sem ele configurado, cai no mesmo encadeamento de segredos que o resto do
 * churrasco usa — o comprovante nunca deixa de funcionar por falta de env.
 */
function segredoAssinatura() {
  return (
    process.env.COMPROVANTE_SIGNING_SECRET ||
    process.env.CHURRASCO_TOKEN_SECRET ||
    process.env.MERCADO_PAGO_WEBHOOK_SECRET ||
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64 ||
    ""
  );
}

export function isComprovanteSecretConfigured() {
  return Boolean(process.env.COMPROVANTE_SIGNING_SECRET);
}

const b64 = (texto) => Buffer.from(String(texto), "utf8").toString("base64url");
const deB64 = (texto) => Buffer.from(String(texto), "base64url").toString("utf8");

function assinar(referencia) {
  return crypto
    .createHmac("sha256", `comprovante-v1:${segredoAssinatura()}`)
    .update(String(referencia))
    .digest("base64url")
    .slice(0, 32);
}

/**
 * Token do QR Code: só a referência da inscrição e a assinatura dela.
 *
 * A referência é sorteada e não diz nada sobre a pessoa, então o QR não
 * carrega dado pessoal nenhum — quem resolve isso é a página de validação,
 * consultando a planilha.
 */
export function criarTokenVerificacao(referencia) {
  return `${b64(referencia)}.${assinar(referencia)}`;
}

/**
 * Devolve a referência quando a assinatura confere, ou `null`.
 * A comparação é em tempo constante.
 */
export function lerTokenVerificacao(token) {
  const partes = String(token || "").split(".");
  if (partes.length !== 2) return null;

  const [corpo, assinatura] = partes;
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(corpo)) return null;
  if (!/^[A-Za-z0-9_-]{32}$/.test(assinatura)) return null;

  let referencia;
  try {
    referencia = deB64(corpo);
  } catch {
    return null;
  }
  if (!referencia || referencia.length > 60) return null;

  const esperada = Buffer.from(assinar(referencia));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length) return null;
  if (!crypto.timingSafeEqual(esperada, recebida)) return null;

  return referencia;
}

/** URL pública que o QR Code carrega. */
export function urlValidacao(referencia) {
  const base = (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
  return `${base}/churrasco/validar/${criarTokenVerificacao(referencia)}`;
}

/* ─── Nome do arquivo ────────────────────────────────────────────────── */

/** Só a referência entra no nome — nunca o nome da pessoa. */
export function nomeArquivoComprovante(referencia) {
  const limpo = String(referencia || "")
    .normalize("NFD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[^A-Za-z0-9-]/g, "")
    .slice(0, 48);
  return `comprovante-churrasco-${limpo || "inscricao"}.pdf`;
}

/* ─── Desenho ────────────────────────────────────────────────────────── */

let logoEmCache;
function logo() {
  if (logoEmCache !== undefined) return logoEmCache;
  try {
    logoEmCache = fs.readFileSync(path.join(aqui, "assets", "logo-aasiam.png"));
  } catch {
    logoEmCache = null; // sem a arte, o documento sai sem ela em vez de falhar
  }
  return logoEmCache;
}

/** Rótulo pequeno em caixa alta — o "eyebrow" da comanda. */
function rotulo(doc, texto, x, y, largura) {
  doc
    .font(TITULO)
    .fontSize(7.5)
    .fillColor(CINZA)
    .text(texto.toUpperCase(), x, y, { width: largura, characterSpacing: 1.3, lineBreak: false });
}

function valor(doc, texto, x, y, largura, { fonte = TEXTO, tamanho = 11.5, cor = PRETO } = {}) {
  doc
    .font(fonte)
    .fontSize(tamanho)
    .fillColor(cor)
    .text(texto, x, y, { width: largura, lineBreak: false, ellipsis: true });
}

/**
 * A linha serrilhada da comanda: o tracejado com os dois furos nas margens.
 * É o detalhe que faz o papel ser reconhecido como o mesmo objeto da tela.
 */
function serrilha(doc, y) {
  doc.save();
  doc
    .moveTo(MARGEM + 12, y)
    .lineTo(A4.largura - MARGEM - 12, y)
    .lineWidth(1)
    .dash(3, { space: 3.5 })
    .strokeColor(LINHA)
    .stroke()
    .undash();

  for (const x of [MARGEM, A4.largura - MARGEM]) {
    doc.circle(x, y, 5).lineWidth(1).strokeColor(LINHA).stroke();
  }
  doc.restore();
}

/**
 * Monta o PDF de uma página. Recebe a inscrição já validada pela rota.
 * @returns {Promise<Buffer>}
 */
export async function gerarComprovantePdf(inscricao) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    autoFirstPage: true,
    info: {
      Title: `${COMPROVANTE_TITULO} — ${inscricao.id}`,
      Author: "AASIAM — Atlética de Sistemas de Informação",
      Subject: `${EVENTO} — inscrição ${inscricao.id}`,
      Creator: "AASIAM",
    },
  });

  const pedacos = [];
  doc.on("data", (p) => pedacos.push(p));
  const pronto = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(pedacos)));
    doc.on("error", reject);
  });

  /* ── faixa e cabeçalho ── */
  doc.rect(0, 0, A4.largura, 7).fill(VERDE);

  const arte = logo();
  const topo = 46;
  if (arte) doc.image(arte, MARGEM, topo, { width: 46, height: 46 });

  const xMarca = MARGEM + (arte ? 60 : 0);
  doc.font(TITULO).fontSize(15).fillColor(PRETO)
    .text("AASIAM", xMarca, topo + 9, { characterSpacing: 1.6, lineBreak: false });
  doc.font(TEXTO).fontSize(8).fillColor(CINZA)
    .text("Atlética de Sistemas de Informação", xMarca, topo + 28, { lineBreak: false });

  doc.font(TITULO).fontSize(8).fillColor(CINZA)
    .text("COMPROVANTE DE INSCRIÇÃO", MARGEM, topo + 10, {
      width: CONTEUDO, align: "right", characterSpacing: 1.1, lineBreak: false,
    })
    .text("E PAGAMENTO", MARGEM, topo + 22, {
      width: CONTEUDO, align: "right", characterSpacing: 1.1, lineBreak: false,
    });

  doc.moveTo(MARGEM, topo + 66).lineTo(A4.largura - MARGEM, topo + 66)
    .lineWidth(1).strokeColor(LINHA).stroke();

  /* ── evento e carimbo de status ──
     Na tela o carimbo é um contorno fino; no papel vira uma faixa cheia,
     porque na entrada do evento o que precisa ser lido de longe é o bloco de
     cor — e ele continua legível numa impressão em preto e branco. */
  doc.font(TITULO).fontSize(29).fillColor(PRETO)
    .text(EVENTO, MARGEM, 138, { width: CONTEUDO, lineBreak: false });

  const faixaY = 186;
  doc.rect(MARGEM, faixaY, CONTEUDO, 42).fill(VERDE);
  doc.font(TITULO).fontSize(14.5).fillColor("#FFFFFF")
    .text("PAGAMENTO CONFIRMADO", MARGEM, faixaY + 14.5, {
      width: CONTEUDO, align: "center", characterSpacing: 2.4, lineBreak: false,
    });

  /* ── participante ── */
  rotulo(doc, "Participante", MARGEM, 254, CONTEUDO);
  doc.font(TITULO).fontSize(21).fillColor(PRETO)
    .text(inscricao.nome || "—", MARGEM, 268, { width: CONTEUDO, lineBreak: false, ellipsis: true });

  /* ── painel de dados ── */
  const painelY = 308;
  const painelAltura = 132;
  doc.roundedRect(MARGEM, painelY, CONTEUDO, painelAltura, 8).fill(VERDE_LAVADO);

  const colA = MARGEM + 22;
  const colB = MARGEM + CONTEUDO / 2 + 8;
  const larguraCol = CONTEUDO / 2 - 30;

  const campos = [
    ["Curso", inscricao.curso || "—", "Valor pago", formatBRL(inscricao.valorPagoCents ?? inscricao.valorCents)],
    ["Categoria", inscricao.categoria || "—", "Forma de pagamento", "Pix · Mercado Pago"],
    ["Pagamento confirmado em", inscricao.pagoEm || "—", "Identificador do pagamento", inscricao.paymentMpId || "—"],
  ];

  campos.forEach(([rA, vA, rB, vB], i) => {
    const y = painelY + 20 + i * 38;
    rotulo(doc, rA, colA, y, larguraCol);
    valor(doc, vA, colA, y + 12, larguraCol);
    rotulo(doc, rB, colB, y, larguraCol);
    const mono = rB.startsWith("Identificador");
    valor(doc, vB, colB, y + 12, larguraCol, mono ? { fonte: "Courier", tamanho: 9 } : {});
  });

  /* ── serrilha e código ── */
  serrilha(doc, painelY + painelAltura + 30);

  rotulo(doc, "Código da inscrição", MARGEM, painelY + painelAltura + 54, CONTEUDO);
  doc.font(MONO).fontSize(16.5).fillColor(PRETO)
    .text(inscricao.id, MARGEM, painelY + painelAltura + 68, {
      width: CONTEUDO, characterSpacing: 0.6, lineBreak: false,
    });

  /* ── QR Code de validação ── */
  const qrY = 548;
  const qrLado = 122;
  const qrPng = await QRCode.toBuffer(urlValidacao(inscricao.id), {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 620, // folga de resolução para a impressão e para a câmera
    color: { dark: "#0B120EFF", light: "#FFFFFFFF" },
  });

  doc.roundedRect(MARGEM, qrY, qrLado + 16, qrLado + 16, 8)
    .lineWidth(1).strokeColor(LINHA).stroke();
  doc.image(qrPng, MARGEM + 8, qrY + 8, { width: qrLado, height: qrLado });

  const xTexto = MARGEM + qrLado + 40;
  const larguraTexto = A4.largura - MARGEM - xTexto;

  rotulo(doc, "Validação na entrada", xTexto, qrY + 14, larguraTexto);
  doc.font(TEXTO).fontSize(10.5).fillColor(PRETO)
    .text(
      "Aponte a câmera do celular para o código ao lado. A página abre com a situação atual desta inscrição, consultada na hora.",
      xTexto, qrY + 32, { width: larguraTexto, lineGap: 2.5 }
    );
  // Segue o parágrafo em vez de flutuar num offset fixo — sem vão no meio.
  doc.font(TEXTO).fontSize(9).fillColor(CINZA)
    .text("Este código não é um Pix e não cobra nada.", xTexto, doc.y + 10, {
      width: larguraTexto, lineBreak: false,
    });

  /* ── rodapé ── */
  const rodapeY = 726;
  doc.moveTo(MARGEM, rodapeY).lineTo(A4.largura - MARGEM, rodapeY)
    .lineWidth(1).strokeColor(LINHA).stroke();

  doc.font(TITULO).fontSize(10).fillColor(PRETO)
    .text(
      "Apresente este comprovante na entrada do evento. A autenticidade da inscrição pode ser confirmada pelo QR Code.",
      MARGEM, rodapeY + 16, { width: CONTEUDO, lineGap: 2 }
    );
  doc.font(TEXTO).fontSize(8).fillColor(CINZA)
    .text(
      "Este documento confirma a inscrição e o pagamento do evento. Não substitui um comprovante bancário oficial.",
      MARGEM, rodapeY + 48, { width: CONTEUDO, lineGap: 1.5 }
    );

  doc.end();
  return pronto;
}

/* ─── Regras de emissão ──────────────────────────────────────────────── */

/**
 * Decide se a inscrição pode virar comprovante.
 * Devolve `{ ok: true }` ou `{ ok: false, status, error }` já com o código
 * HTTP que a rota deve responder.
 */
export function podeEmitirComprovante(inscricao) {
  if (!inscricao) {
    return { ok: false, status: 404, error: "Inscrição não encontrada." };
  }

  if (inscricao.status !== STATUS_PAGO) {
    const encerradas = new Set(["expirado", "cancelado", "reembolsado", "falhou", "recusado", "erro"]);
    if (encerradas.has(inscricao.status)) {
      return {
        ok: false,
        status: 410,
        error: "Esta inscrição não está paga, então não há comprovante para emitir.",
      };
    }
    return {
      ok: false,
      status: 409,
      error: "O pagamento ainda não foi confirmado. Assim que confirmar, o comprovante fica disponível.",
    };
  }

  // Pago, mas por um meio que a inscrição não aceita: a organização confere.
  const metodo = String(inscricao.metodo || "").toLowerCase();
  if (metodo && metodo !== METODO_PERMITIDO && metodo !== "pix") {
    return {
      ok: false,
      status: 409,
      error: "Esta inscrição está em conferência pela organização.",
    };
  }

  // O valor gravado precisa bater com o valor do curso, em centavos inteiros.
  const esperado = inscricao.valorCents;
  const pago = inscricao.valorPagoCents;
  if (!Number.isInteger(esperado)) {
    return { ok: false, status: 409, error: "Esta inscrição está em conferência pela organização." };
  }
  if (Number.isInteger(pago) && pago !== esperado) {
    return { ok: false, status: 409, error: "Esta inscrição está em conferência pela organização." };
  }

  return { ok: true };
}

/** Projeção mínima usada pela página de validação. */
export function validacaoView(inscricao, { valido }) {
  if (!valido || !inscricao) {
    return { ok: true, valido: false, motivo: "invalido" };
  }
  return {
    ok: true,
    valido: inscricao.status === STATUS_PAGO,
    status: inscricao.status,
    statusLabel: inscricao.statusLabel || "",
    orderId: inscricao.id,
    nome: inscricao.nome,
    curso: inscricao.curso,
    categoria: inscricao.categoria || categoryForCourse(inscricao.curso) || "",
    amount: formatBRL(inscricao.valorPagoCents ?? inscricao.valorCents),
    pagoEm: inscricao.pagoEm || null,
    provedor: inscricao.status === STATUS_PAGO ? PROVEDOR : null,
  };
}
