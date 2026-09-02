/**
 * Regras do Churrasco da Alcateia — compartilhadas entre frontend e backend.
 *
 * Este arquivo é espelhado em `frontend/src/shared/churrasco.js` (mesma
 * convenção de `order.js` / `products.js`). O frontend usa estas funções para
 * dar feedback imediato; o backend as usa como fonte de verdade — o valor
 * enviado pelo navegador nunca é aceito.
 *
 * O churrasco cobra por Pix no Mercado Pago (API de Orders). A loja continua
 * na InfinitePay: nada aqui é usado pelo checkout do e-commerce.
 */

export const SI_COURSE = "Sistemas de Informação";

/**
 * "Outro" é a saída para quem não estuda na faculdade — participante externo,
 * convidado, egresso. Não abre campo de texto: a pessoa escolhe e segue.
 */
export const OTHER_COURSE = "Outro";

/** Ordem exata exibida na lista de cursos. */
export const COURSES = [
  "Administração",
  "Ciências Contábeis",
  "Direito",
  SI_COURSE,
  "Pedagogia",
  "Ontopsicologia",
  "Hotelaria",
  "Gastronomia",
  OTHER_COURSE,
];

export const PRICE_SI_CENTS = 2500;
export const PRICE_OTHER_CENTS = 3500;

export const CATEGORY_SI = "Aluno de SI";
export const CATEGORY_OTHER = "Outro curso";
/** Quem escolheu "Outro" não tem curso na casa: a comanda diz isso. */
export const CATEGORY_EXTERNAL = "Participante externo";

export const REGISTRATION_SOURCE = "Formulário Churrasco AASIAM";

export const NAME_MAX_LENGTH = 80;
export const NAME_MIN_LENGTH = 5;
export const PHONE_MIN_DIGITS = 10;
export const PHONE_MAX_DIGITS = 11;
export const EMAIL_MAX_LENGTH = 120;

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** "R$ 25,00" a partir de centavos. */
export function formatBRL(cents) {
  return brl.format((Number(cents) || 0) / 100);
}

/* ─── Dinheiro ─────────────────────────────────────────────────────────
   Centavos inteiros são a fonte de verdade. A API de Orders quer o valor
   como string decimal ("25.00"), então a conversão acontece só na borda —
   e a volta é feita por texto, nunca por ponto flutuante. */

/** 2500 → "25.00". */
export function centsToAmountString(cents) {
  const inteiro = Math.trunc(Number(cents) || 0);
  const sinal = inteiro < 0 ? "-" : "";
  const abs = Math.abs(inteiro);
  return `${sinal}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** "25.00" → 2500. `null` quando o formato não é um decimal com até 2 casas. */
export function amountToCents(value) {
  if (value === null || value === undefined) return null;
  const bruto = String(value).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(bruto)) return null;

  const negativo = bruto.startsWith("-");
  const [inteiro, decimal = ""] = bruto.replace("-", "").split(".");
  const cents = Number(inteiro) * 100 + Number(decimal.padEnd(2, "0"));
  return negativo ? -cents : cents;
}

/**
 * Remove acentos e caixa para comparar cursos de forma tolerante.
 *
 * Só texto entra: `["Outro"]` vira "Outro" num `String()` e passaria pela
 * allowlist como se fosse a palavra. Curso é campo de texto — o resto é
 * entrada malformada e sai daqui vazio, que `normalizeCourse` recusa.
 */
function foldCourse(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Devolve o curso na grafia canônica da lista, ou `null` se não estiver nela.
 * É o único portão de entrada: qualquer valor fora da lista é recusado.
 */
export function normalizeCourse(value) {
  const folded = foldCourse(value);
  if (!folded) return null;
  return COURSES.find((course) => foldCourse(course) === folded) ?? null;
}

/** Valor em centavos do curso. `null` para curso inválido. */
export function priceCentsForCourse(value) {
  const course = normalizeCourse(value);
  if (!course) return null;
  return course === SI_COURSE ? PRICE_SI_CENTS : PRICE_OTHER_CENTS;
}

/**
 * "Aluno de SI", "Participante externo" ou "Outro curso".
 * `null` para curso inválido. A categoria é rótulo: o preço não sai daqui.
 */
export function categoryForCourse(value) {
  const course = normalizeCourse(value);
  if (!course) return null;
  if (course === SI_COURSE) return CATEGORY_SI;
  if (course === OTHER_COURSE) return CATEGORY_EXTERNAL;
  return CATEGORY_OTHER;
}

/** Colapsa espaços duplicados, remove as pontas e limita o tamanho. */
export function normalizeFullName(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX_LENGTH);
}

const NAME_ALLOWED_RE = /^[\p{L}][\p{L}'.-]*$/u;

/**
 * Exige nome e sobrenome. Devolve `null` quando válido ou a mensagem de erro.
 */
export function validateFullName(value) {
  const name = normalizeFullName(value);
  if (!name) return "Informe seu nome completo.";
  if (name.length < NAME_MIN_LENGTH) return "Nome muito curto — informe nome e sobrenome.";

  const parts = name.split(" ");
  if (parts.length < 2) return "Informe nome e sobrenome.";
  if (!parts.every((part) => NAME_ALLOWED_RE.test(part))) {
    return "Use apenas letras no nome.";
  }
  if (!parts.some((part) => part.length >= 2) || parts[0].length < 2) {
    return "Informe nome e sobrenome.";
  }
  return null;
}

/**
 * Só os dígitos, já sem o código do país (+55) quando ele vier junto.
 * É o formato gravado na planilha.
 */
export function normalizePhoneDigits(value) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length > PHONE_MAX_DIGITS && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  return digits.slice(0, PHONE_MAX_DIGITS);
}

/**
 * Aceita celular (11 dígitos, começando com 9) e fixo (10 dígitos, começando
 * com 2–5). Devolve `null` quando válido ou a mensagem de erro.
 */
export function validatePhone(value) {
  const digits = normalizePhoneDigits(value);
  if (!digits) return "Informe seu telefone ou WhatsApp.";
  if (digits.length < PHONE_MIN_DIGITS) return "Número incompleto — inclua o DDD.";

  const ddd = Number(digits.slice(0, 2));
  if (ddd < 11 || ddd > 99) return "DDD inválido.";

  const subscriber = digits.slice(2);
  if (subscriber.length === 9) {
    if (subscriber[0] !== "9") return "Celular com 9 dígitos deve começar com 9.";
    return null;
  }
  if (subscriber.length === 8) {
    if (!/^[2-5]/.test(subscriber)) return "Telefone fixo inválido — confira o número.";
    return null;
  }
  return "Número inválido — confira o telefone.";
}

/** Máscara brasileira: (55) 99999-9999 ou (55) 3333-3333. */
export function formatPhoneBR(value) {
  const d = normalizePhoneDigits(value);
  if (!d) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/* ─── E-mail ───────────────────────────────────────────────────────────
   `payer.email` é obrigatório no Pix da API de Orders, então o campo passou
   a existir no formulário. Sempre em minúsculas: é assim que ele vai para o
   Mercado Pago e para a planilha, e é como duas tentativas da mesma pessoa
   se reconhecem como a mesma inscrição. */

export function normalizeEmail(value) {
  // Só as pontas: um espaço no meio é erro de digitação, não algo a limpar
  // em silêncio — a validação recusa e a pessoa corrige.
  return String(value ?? "").trim().toLowerCase().slice(0, EMAIL_MAX_LENGTH);
}

// Um endereço comum, sem tentar cobrir a RFC inteira: uma parte local sem
// espaços nem separadores de cabeçalho, arroba, e um domínio com ponto.
const EMAIL_RE =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

export function validateEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return "Informe seu e-mail.";
  if (email.length > EMAIL_MAX_LENGTH) return "E-mail muito longo.";
  if (!EMAIL_RE.test(email)) return "E-mail inválido — confira o endereço.";
  return null;
}

/** "an***@gmail.com" — o que pode ir para um log. */
export function maskEmail(value) {
  const email = normalizeEmail(value);
  const arroba = email.indexOf("@");
  if (arroba < 1) return "***";
  return `${email.slice(0, Math.min(2, arroba))}***${email.slice(arroba)}`;
}

/* ─── Status da inscrição ──────────────────────────────────────────────
   Um vocabulário só, do backend à tela. O rótulo é exatamente o texto
   gravado na coluna "Status" da planilha, para que a organização leia a
   planilha sem precisar traduzir nada. */

export const STATUS_PENDENTE = "pendente";
export const STATUS_PROCESSANDO = "processando";
export const STATUS_PAGO = "pago";
export const STATUS_FALHOU = "falhou";
export const STATUS_CANCELADO = "cancelado";
export const STATUS_EXPIRADO = "expirado";
export const STATUS_REEMBOLSADO = "reembolsado";
export const STATUS_ERRO = "erro";
export const STATUS_REVISAO = "revisao_manual";
/** Legado: rótulo gravado pelas inscrições da InfinitePay. Só é lido. */
export const STATUS_RECUSADO = "recusado";

export const STATUS_LABEL = {
  [STATUS_PENDENTE]: "Pendente",
  [STATUS_PROCESSANDO]: "Processando",
  [STATUS_PAGO]: "Pago",
  [STATUS_FALHOU]: "Falhou",
  [STATUS_CANCELADO]: "Cancelado",
  [STATUS_EXPIRADO]: "Expirado",
  [STATUS_REEMBOLSADO]: "Reembolsado",
  [STATUS_ERRO]: "Erro",
  [STATUS_REVISAO]: "Revisão manual",
  [STATUS_RECUSADO]: "Recusado",
};

const STATUS_POR_LABEL = new Map(
  Object.entries(STATUS_LABEL).map(([status, label]) => [label, status])
);

export function statusLabel(status) {
  return STATUS_LABEL[status] || STATUS_LABEL[STATUS_PENDENTE];
}

/** Rótulo lido da planilha → status canônico. */
export function statusFromLabel(label) {
  return STATUS_POR_LABEL.get(String(label || "").trim()) || STATUS_PENDENTE;
}

/** Estados que não mudam mais sozinhos — a consulta periódica pode parar. */
const FINAIS = new Set([
  STATUS_PAGO,
  STATUS_FALHOU,
  STATUS_CANCELADO,
  STATUS_EXPIRADO,
  STATUS_REEMBOLSADO,
  STATUS_REVISAO,
  STATUS_ERRO,
  STATUS_RECUSADO,
]);

export function isStatusFinal(status) {
  return FINAIS.has(status);
}

/** Estados em que faz sentido oferecer "gerar um novo Pix". */
const RENOVAVEIS = new Set([
  STATUS_EXPIRADO,
  STATUS_CANCELADO,
  STATUS_FALHOU,
  STATUS_ERRO,
  STATUS_RECUSADO,
]);

export function podeGerarNovoPix(status) {
  return RENOVAVEIS.has(status);
}

/**
 * Traduz o par `status` / `status_detail` da API de Orders.
 *
 * Só o `processed` + `accredited` vira "Pago" — e mesmo ele passa antes pelas
 * conferências de método e valor feitas no backend.
 */
export function statusFromMercadoPago(status, statusDetail) {
  const s = String(status || "").toLowerCase().trim();
  const detalhe = String(statusDetail || "").toLowerCase().trim();

  if (s === "processed") return detalhe === "accredited" ? STATUS_PAGO : STATUS_REVISAO;
  if (s === "processing") return STATUS_PROCESSANDO;
  if (s === "action_required") return STATUS_PENDENTE;
  if (s === "failed") return STATUS_FALHOU;
  if (s === "canceled" || s === "cancelled") return STATUS_CANCELADO;
  if (s === "expired") return STATUS_EXPIRADO;
  if (s === "refunded") return STATUS_REEMBOLSADO;
  if (s === "charged_back") return STATUS_REVISAO;
  return STATUS_PENDENTE;
}

/** Único meio de pagamento aceito na inscrição do churrasco. */
export const METODO_PERMITIDO = "pix";
/** E o único tipo — `bank_transfer` é como a API de Orders classifica o Pix. */
export const TIPO_METODO_PERMITIDO = "bank_transfer";

/** Nome do provedor gravado na planilha. A loja não usa este arquivo. */
export const PROVEDOR = "Mercado Pago";

/** Validade do Pix pedida ao Mercado Pago (formato ISO 8601 de duração). */
export const PIX_EXPIRACAO = "PT30M";
export const PIX_EXPIRACAO_MINUTOS = 30;

/**
 * Resumo da inscrição derivado apenas do curso — usado no card de resumo do
 * frontend e recalculado do zero pelo backend.
 */
export function buildRegistrationSummary(courseValue) {
  const course = normalizeCourse(courseValue);
  if (!course) return null;
  const priceCents = priceCentsForCourse(course);
  return {
    course,
    category: categoryForCourse(course),
    priceCents,
    price: formatBRL(priceCents),
  };
}
