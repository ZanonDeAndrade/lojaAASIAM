/**
 * Eventos de churrasco da AASIAM — compartilhado entre frontend e backend.
 *
 * Espelhado byte a byte em `frontend/src/shared/churrasco-eventos.js` (um
 * teste falha se os dois divergirem). Cada evento tem a própria referência
 * externa, a própria aba de planilha e a própria regra de preço; as
 * validações de nome, telefone, e-mail e curso continuam em `churrasco.js`,
 * iguais para todos.
 *
 * A referência externa (`external_reference` no Mercado Pago) começa com o
 * prefixo do evento — é ela que separa os pagamentos de um churrasco dos do
 * outro. Nenhum prefixo pode começar com outro: o do AMF Games é
 * `CHURRASCO-`, então um evento novo NÃO pode usar `CHURRASCO-ALGUMA-COISA`,
 * senão o webhook o entregaria à planilha do AMF.
 */
import {
  SI_COURSE,
  categoryForCourse,
  formatBRL,
  normalizeCourse,
  priceCentsForCourse,
} from "./churrasco.js";

export const EVENTO_AMF = "amf-games-2026";
export const EVENTO_SEMANA_SI = "semana-si-2026";

export const EVENTOS_CHURRASCO = {
  /* Churrasco da Alcateia, 12/09, durante o AMF Games. O preço vem do curso
     (R$ 25,00 para SI, R$ 35,00 para os demais — ver `churrasco.js`). */
  [EVENTO_AMF]: {
    id: EVENTO_AMF,
    titulo: "Churrasco da Alcateia",
    subtitulo: "",
    prefixo: "CHURRASCO-",
    caracteresDoCodigo: 8,
    // A pessoa escolhe o curso no formulário; o preço sai dele.
    cursoFixo: null,
    precoCents: null,
    pessoasPorInscricao: 1,
    // O evento foi em 12/09; as inscrições fecham no fim daquele dia.
    inscricoesAte: "2026-09-12T23:59:59.999-03:00",
    inscricoesAteTexto: "12/09 às 23h59",
    vagas: null,
    carona: false,
    recuperacao: false,
    data: "",
    horario: "",
    local: "",
    cardapio: [],
    rotaPagina: "/churrasco",
    apiBase: "/api/churrasco",
  },

  [EVENTO_SEMANA_SI]: {
    id: EVENTO_SEMANA_SI,
    titulo: "Churrasco da AASIAM",
    subtitulo: "Semana Acadêmica de Sistemas de Informação",
    prefixo: "SEMANASI-",
    // 10 caracteres de um alfabeto de 32: 50 bits sorteados. O código vale
    // junto com o e-mail para recuperar o comprovante, então precisa ser
    // impossível de adivinhar.
    caracteresDoCodigo: 10,
    // Evento só de SI: o formulário não pergunta o curso, e a coluna "Curso"
    // da planilha recebe sempre este valor (o cabeçalho não muda).
    cursoFixo: SI_COURSE,
    precoCents: 2000,
    pessoasPorInscricao: 1,
    // 22/10/2026 às 23:59 em Brasília (UTC-03:00, sem horário de verão desde
    // 2019). O offset explícito evita que um servidor em UTC encerre as
    // inscrições três horas antes. Um Pix gerado antes disso e pago depois é
    // confirmado normalmente: o prazo só barra inscrição e Pix novos.
    inscricoesAte: "2026-10-22T23:59:59.999-03:00",
    inscricoesAteTexto: "22/10 às 23h59",
    // Sem limite. Para limitar, troque por um número: inscrições pagas, em
    // conferência ou com Pix ainda válido ocupam vaga.
    vagas: null,
    carona: true,
    recuperacao: true,
    data: "24/10/2026",
    horario: "A partir das 11h para quem precisar de transporte poder participar",
    local: "Projeto Terra",
    cardapio: ["Pão", "Salsichão", "Refri"],
    rotaPagina: "/churrasco-semana-academica",
    apiBase: "/api/churrasco-semana-si",
  },
};

export const LISTA_EVENTOS_CHURRASCO = Object.values(EVENTOS_CHURRASCO);

export function eventoPorId(id) {
  return EVENTOS_CHURRASCO[id] || null;
}

/** O evento dono de uma referência externa, ou `null` se não for de churrasco. */
export function eventoDaReferencia(referencia) {
  const ref = String(referencia || "");
  return LISTA_EVENTOS_CHURRASCO.find((evento) => ref.startsWith(evento.prefixo)) || null;
}

/**
 * O curso da inscrição: o fixo do evento, quando houver (o que vier do
 * navegador é ignorado), ou o escolhido, na grafia da lista. `null` se
 * inválido.
 */
export function cursoDaInscricao(evento, cursoEscolhido) {
  return evento?.cursoFixo || normalizeCourse(cursoEscolhido);
}

/** Valor em centavos para o curso escolhido. `null` para curso inválido. */
export function precoCentsDoEvento(evento, curso) {
  if (!normalizeCourse(curso)) return null;
  return Number.isInteger(evento?.precoCents) ? evento.precoCents : priceCentsForCourse(curso);
}

/** Instante (ms) em que as inscrições fecham, ou `null` quando não há prazo. */
export function prazoDoEvento(evento) {
  if (!evento?.inscricoesAte) return null;
  const instante = Date.parse(evento.inscricoesAte);
  return Number.isNaN(instante) ? null : instante;
}

/** O prazo ainda não passou? Sem prazo, sempre aberto. */
export function inscricoesAbertas(evento, agora = Date.now()) {
  const prazo = prazoDoEvento(evento);
  return prazo === null || agora <= prazo;
}

/** "1 pessoa", "2 pessoas". */
export function pessoasPorExtenso(quantidade) {
  const n = Number(quantidade) || 1;
  return `${n} ${n === 1 ? "pessoa" : "pessoas"}`;
}

/** ["Pão", "Salsichão", "Refri"] → "Pão, salsichão e refri". */
export function cardapioPorExtenso(evento) {
  const itens = (evento?.cardapio || []).map((item, i) => (i === 0 ? item : item.toLowerCase()));
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/**
 * Resumo da inscrição derivado só do curso — o mesmo que
 * `buildRegistrationSummary`, com o preço do evento.
 */
export function resumoDaInscricao(evento, cursoEscolhido) {
  const course = cursoDaInscricao(evento, cursoEscolhido);
  if (!course) return null;
  const priceCents = precoCentsDoEvento(evento, course);
  return {
    course,
    category: categoryForCourse(course),
    priceCents,
    price: formatBRL(priceCents),
    pessoas: evento?.pessoasPorInscricao || 1,
  };
}
