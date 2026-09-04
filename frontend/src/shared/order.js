import { PRODUCT_BY_ID, PRODUCTS } from "./products.js";

/* ─── Personalização: nome + número ───────────────────────────────────────
   REGRA ÚNICA, usada por toda peça personalizável — camiseta avulsa, Jersey,
   a camiseta do conjunto e a camiseta do Combo Wolf. Os dois campos são
   opcionais. O valor salvo preserva a capitalização do cliente; só a CHAVE do
   carrinho normaliza (trim + minúsculas), para não separar "Arthur" de
   " arthur ". O charset nem começa com "<": nada de HTML entra. */
export const PERSONALIZATION_NAME_MAX = 20;
const PERSONALIZATION_NAME_RE = /^[\p{L}][\p{L} '.\-]*$/u;

/** Nome como fica salvo: sem pontas, sem espaço duplo, capitalização intacta. */
export function normalizePersonalizationName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, PERSONALIZATION_NAME_MAX);
}

/** Número da camisa: só dígitos, no máximo dois. "" quando vazio. */
export function normalizePersonalizationNumber(value) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 2);
}

/** Nome + número já normalizados. `undefined`/`null` viram `""`, nunca escapam. */
export function normalizePersonalization(rawName, rawNumber) {
  return {
    personalizationName: normalizePersonalizationName(rawName),
    personalizationNumber: normalizePersonalizationNumber(rawNumber),
  };
}

/** Mensagem de erro do nome/número, ou `null` se ok (ou ambos vazios). */
export function personalizationError(rawName, rawNumber) {
  const nome = String(rawName ?? "").trim();
  if (nome.length > PERSONALIZATION_NAME_MAX) {
    return `O nome passa de ${PERSONALIZATION_NAME_MAX} caracteres.`;
  }
  if (nome && !PERSONALIZATION_NAME_RE.test(nome)) {
    return "Use só letras, espaços, hífen e apóstrofo no nome.";
  }
  const numero = String(rawNumber ?? "").trim();
  if (numero && !/^\d{1,2}$/.test(numero)) {
    return "O número deve ter 1 ou 2 dígitos.";
  }
  return null;
}

/** Trecho da chave do carrinho que representa a personalização. */
export function personalizationKeyPart(rawName, rawNumber) {
  return `${normalizePersonalizationName(rawName).toLowerCase()}--${normalizePersonalizationNumber(rawNumber)}`;
}

/**
 * Chave de identidade de uma configuração personalizável no carrinho: os
 * valores estruturais na ordem (tamanho, cor, tamanho do calção, ...) seguidos
 * do nome e do número. Dois pedidos só se agrupam se tudo bater.
 */
export function personalizationKey(structuralParts = [], rawName, rawNumber) {
  const parts = Array.isArray(structuralParts) ? structuralParts : [structuralParts];
  return [...parts.map((p) => String(p ?? "")), personalizationKeyPart(rawName, rawNumber)].join("--");
}

/** A opção (`"M"` ou `{ code, name }`) que casa com `value`, ou `null`. */
export function attributeOption(attribute, value) {
  return (attribute?.options || []).find((option) => (option.code ?? option) === value) || null;
}

/** Rótulo curto de um atributo para a descrição do item ("Tam. M", "Preta"). */
export function attributeChip(attribute, option) {
  const code = option.code ?? option;
  const template = attribute.chipLabel || "{value}";
  return template.replace("{value}", code).replace("{name}", option.name ?? code);
}

export function createEmptySelection() {
  return Object.fromEntries(
    PRODUCTS.map((product) => [product.id, createEmptyProductSelection(product)])
  );
}

export function calculateOrder(selection) {
  const lines = [];

  for (const product of PRODUCTS) {
    const selected = selection?.[product.id];

    if (!selected) {
      continue;
    }

    /* Esgotado não entra no pedido. O `disabled` do card é só a aparência da
       regra; quem monta a requisição na mão passa por cima dele. Sem linha,
       o checkout devolve "Selecione pelo menos um produto" e nada é cobrado. */
    if (product.soldOut === true) {
      continue;
    }

    if (product.kind === "sizedProduct") {
      const quantity = normalizeQuantity(selected.quantity);
      const size = product.sizes.includes(selected.size) ? selected.size : null;
      if (quantity > 0 && size) {
        lines.push(buildLine(product, quantity, `Tam. ${size}`, size, { size }));
      }
      continue;
    }

    if (product.kind === "personalizedProduct") {
      for (const configuration of configurationsOf(selected)) {
        const quantity = normalizeQuantity(configuration.quantity);
        if (quantity === 0) continue;

        const resolved = resolvePersonalizedAttributes(product, configuration);
        if (!resolved) continue; // faltou um atributo estrutural (tamanho, cor…)

        const { personalizationName, personalizationNumber } = normalizePersonalization(
          configuration.personalizationName,
          configuration.personalizationNumber
        );

        const partes = [...resolved.chips];
        if (personalizationName) partes.push(`Nome: ${personalizationName}`);
        if (personalizationNumber) partes.push(`Número: ${personalizationNumber}`);

        lines.push(
          buildLine(
            product,
            quantity,
            partes.join(" · "),
            personalizationKey(resolved.keyParts, personalizationName, personalizationNumber),
            { ...resolved.values, personalizationName, personalizationNumber }
          )
        );
      }
      continue;
    }

    if (product.kind === "multiPieceBundle") {
      for (const configuration of configurationsOf(selected)) {
        const quantity = normalizeQuantity(configuration.quantity);
        const pieces = product.pieces.map((piece) => ({
          ...piece,
          color: pieceColor(piece, configuration[`${piece.key}Color`]),
          size: piece.sizes.includes(configuration[`${piece.key}Size`])
            ? configuration[`${piece.key}Size`]
            : null
        }));

        if (quantity === 0 || pieces.some((piece) => !piece.color || !piece.size)) continue;

        const attributes = Object.fromEntries(
          pieces.flatMap((piece) => [
            [`${piece.key}Color`, piece.color.code],
            [`${piece.key}Size`, piece.size]
          ])
        );

        // Personalização por peça (camiseta, Jersey — cada peça que a declara).
        const personalizations = {};
        for (const piece of pieces) {
          if (!piece.personalization) continue;
          const norm = normalizePersonalization(
            configuration[`${piece.key}PersonalizationName`],
            configuration[`${piece.key}PersonalizationNumber`]
          );
          personalizations[`${piece.key}PersonalizationName`] = norm.personalizationName;
          personalizations[`${piece.key}PersonalizationNumber`] = norm.personalizationNumber;
        }
        // As peças personalizáveis espelham nome/número no topo da linha, para a
        // planilha (colunas Nome/Número) ler igual aos outros produtos. Quando há
        // mais de uma (Combo Signature), os valores preenchidos são unidos por
        // " / " — a quebra por peça continua completa na coluna de Itens.
        const personalizedPieces = pieces.filter((piece) => piece.personalization);
        const flat = personalizedPieces.length
          ? {
              personalizationName: personalizedPieces
                .map((piece) => personalizations[`${piece.key}PersonalizationName`])
                .filter(Boolean)
                .join(" / "),
              personalizationNumber: personalizedPieces
                .map((piece) => personalizations[`${piece.key}PersonalizationNumber`])
                .filter(Boolean)
                .join(" / "),
            }
          : {};

        const fixedItems = product.fixedItems?.map((item) => ({ ...item })) || [];
        const variantParts = [
          ...pieces.map((piece) => {
            let part = `${piece.name}: ${piece.color.name} / ${piece.size}`;
            if (piece.personalization) {
              const nome = personalizations[`${piece.key}PersonalizationName`];
              const numero = personalizations[`${piece.key}PersonalizationNumber`];
              if (nome) part += ` · Nome: ${nome}`;
              if (numero) part += ` · Número: ${numero}`;
            }
            return part;
          }),
          ...fixedItems.map((item) => `${item.name}: ${item.quantity} unidade${item.quantity === 1 ? "" : "s"}`)
        ];
        const code = multiPieceBundleConfigurationKey(product, { ...attributes, ...personalizations });

        lines.push(buildLine(product, quantity, variantParts.join(" · "), code, {
          ...attributes,
          ...personalizations,
          ...flat,
          fixedItems
        }));
      }
      continue;
    }

    if (product.kind === "sizedVariants") {
      for (const variant of product.variants) {
        for (const size of product.sizes) {
          const quantity = normalizeQuantity(selected.variants?.[variant.code]?.[size]);

          if (quantity > 0) {
            lines.push(
              buildLine(
                product,
                quantity,
                `${variant.name} - Tam. ${size}`,
                `${variant.code}-${size}`,
                { color: variant.code, size }
              )
            );
          }
        }
      }
      continue;
    }

    if (product.kind === "modelQuantity") {
      for (const model of product.models) {
        const quantity = normalizeQuantity(selected.models?.[model.code]);

        if (quantity > 0) {
          lines.push(buildLine(product, quantity, model.name, model.code));
        }
      }
      continue;
    }

    if (product.kind === "doubleHoodie") {
      const quantity = normalizeQuantity(selected.quantity);
      if (quantity > 0) {
        const verdeVariant = product.variants.find((v) => v.code === "verde");
        const begeVariant = product.variants.find((v) => v.code === "bege");
        const verdeSize = product.sizes.includes(selected.verdeSize) ? selected.verdeSize : product.defaultVerdeSize;
        const begeSize = product.sizes.includes(selected.begeSize) ? selected.begeSize : product.defaultBegeSize;
        lines.push(buildLine(
          product,
          quantity,
          `${verdeVariant.name} Tam. ${verdeSize} + ${begeVariant.name} Tam. ${begeSize}`,
          `verde-${verdeSize}-bege-${begeSize}`
        ));
      }
      continue;
    }

    if (product.kind === "configuredBundle") {
      const quantity = normalizeQuantity(selected.quantity);

      if (quantity > 0) {
        const { variant, size, model } = getConfiguredBundleOptions(product, selected);
        const variantParts = [];
        const codeParts = [];

        if (product.hasHoodie) {
          variantParts.push(`Moletom ${variant.name}`, `Tam. ${size}`);
          codeParts.push(variant.code, size);
        }

        if (product.hasBackpack) {
          variantParts.push(`Mochila ${model.name}`);
          codeParts.push(model.code);
        }

        lines.push(buildLine(product, quantity, variantParts.join(" / "), codeParts.join("-")));
      }
      continue;
    }

    const quantity = normalizeQuantity(selected.quantity);

    if (quantity > 0) {
      lines.push(buildLine(product, quantity));
    }
  }

  const totalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);

  return {
    lines,
    totalCents,
    totalAmount: centsToAmount(totalCents),
    totalQuantity
  };
}

export function sanitizeSelection(selection) {
  const clean = createEmptySelection();

  for (const product of PRODUCTS) {
    const selected = selection?.[product.id];

    if (!selected) {
      continue;
    }

    if (product.kind === "sizedProduct") {
      clean[product.id].quantity = normalizeQuantity(selected.quantity);
      clean[product.id].size = product.sizes.includes(selected.size) ? selected.size : null;
      continue;
    }

    if (product.kind === "personalizedProduct") {
      for (const configuration of configurationsOf(selected)) {
        const quantity = normalizeQuantity(configuration.quantity);
        if (quantity === 0) continue;

        const cleanConfiguration = { quantity };
        for (const attribute of product.attributes || []) {
          const option = attributeOption(attribute, configuration[attribute.key]);
          cleanConfiguration[attribute.key] = option ? option.code ?? option : null;
        }
        Object.assign(
          cleanConfiguration,
          normalizePersonalization(configuration.personalizationName, configuration.personalizationNumber)
        );

        const keyParts = (product.attributes || []).map((a) => cleanConfiguration[a.key]);
        const key = personalizationKey(
          keyParts,
          cleanConfiguration.personalizationName,
          cleanConfiguration.personalizationNumber
        );
        const current = clean[product.id].configurations[key];
        clean[product.id].configurations[key] = {
          ...cleanConfiguration,
          quantity: (current?.quantity || 0) + quantity,
        };
      }
      continue;
    }

    if (product.kind === "multiPieceBundle") {
      for (const configuration of configurationsOf(selected)) {
        const quantity = normalizeQuantity(configuration.quantity);
        if (quantity === 0) continue;

        const cleanConfiguration = { quantity };
        for (const piece of product.pieces) {
          const color = pieceColor(piece, configuration[`${piece.key}Color`]);
          cleanConfiguration[`${piece.key}Color`] = color?.code || null;
          cleanConfiguration[`${piece.key}Size`] = piece.sizes.includes(configuration[`${piece.key}Size`])
            ? configuration[`${piece.key}Size`]
            : null;
          if (piece.personalization) {
            const norm = normalizePersonalization(
              configuration[`${piece.key}PersonalizationName`],
              configuration[`${piece.key}PersonalizationNumber`]
            );
            cleanConfiguration[`${piece.key}PersonalizationName`] = norm.personalizationName;
            cleanConfiguration[`${piece.key}PersonalizationNumber`] = norm.personalizationNumber;
          }
        }

        const key = multiPieceBundleConfigurationKey(product, cleanConfiguration);
        const current = clean[product.id].configurations[key];
        clean[product.id].configurations[key] = {
          ...cleanConfiguration,
          quantity: (current?.quantity || 0) + quantity
        };
      }
      continue;
    }

    if (product.kind === "sizedVariants") {
      for (const variant of product.variants) {
        for (const size of product.sizes) {
          clean[product.id].variants[variant.code][size] = normalizeQuantity(
            selected.variants?.[variant.code]?.[size]
          );
        }
      }
      continue;
    }

    if (product.kind === "modelQuantity") {
      for (const model of product.models) {
        clean[product.id].models[model.code] = normalizeQuantity(
          selected.models?.[model.code]
        );
      }
      continue;
    }

    if (product.kind === "doubleHoodie") {
      clean[product.id].quantity = normalizeQuantity(selected.quantity);
      clean[product.id].verdeSize = product.sizes.includes(selected.verdeSize) ? selected.verdeSize : product.defaultVerdeSize;
      clean[product.id].begeSize = product.sizes.includes(selected.begeSize) ? selected.begeSize : product.defaultBegeSize;
      continue;
    }

    if (product.kind === "configuredBundle") {
      clean[product.id].quantity = normalizeQuantity(selected.quantity);
      clean[product.id].hoodieVariant = normalizeCode(
        selected.hoodieVariant,
        product.variants,
        product.defaultHoodieVariant
      );
      clean[product.id].hoodieSize = product.sizes.includes(selected.hoodieSize)
        ? selected.hoodieSize
        : product.defaultHoodieSize;

      if (product.hasBackpack) {
        clean[product.id].backpackModel = normalizeCode(
          selected.backpackModel,
          product.models,
          product.defaultBackpackModel
        );
      }
      continue;
    }

    clean[product.id].quantity = normalizeQuantity(selected.quantity);
  }

  return clean;
}

/** Valida os atributos obrigatórios dos produtos com tamanho explícito. */
export function validateSelection(selection) {
  if (selection == null || typeof selection !== "object" || Array.isArray(selection)) return null;

  for (const productId of Object.keys(selection)) {
    if (!PRODUCT_BY_ID[productId]) {
      return { error: "Produto inválido.", field: "selection" };
    }
  }

  for (const product of PRODUCTS) {
    const selected = selection[product.id];
    if (!selected) continue;

    if (
      product.kind === "sizedProduct" &&
      normalizeQuantity(selected.quantity) > 0 &&
      !product.sizes.includes(selected.size)
    ) {
      return { error: "Selecione um tamanho válido.", field: "selection" };
    }

    if (product.kind === "personalizedProduct") {
      for (const configuration of configurationsOf(selected)) {
        if (normalizeQuantity(configuration.quantity) === 0) continue;
        for (const attribute of product.attributes || []) {
          if (!attributeOption(attribute, configuration[attribute.key])) {
            return { error: `Selecione ${attribute.label.toLowerCase()}.`, field: "selection" };
          }
        }
        const erro = personalizationError(
          configuration.personalizationName,
          configuration.personalizationNumber
        );
        if (erro) return { error: erro, field: "selection" };
      }
    }

    if (product.kind === "sizedVariants") {
      if (normalizeQuantity(selected.quantity) > 0) {
        return { error: "Selecione uma cor válida.", field: "selection" };
      }
      for (const [variantCode, sizes] of Object.entries(selected.variants || {})) {
        for (const [size, quantity] of Object.entries(sizes || {})) {
          if (normalizeQuantity(quantity) === 0) continue;
          if (!findByCode(product.variants, variantCode)) {
            return { error: "Selecione uma cor válida.", field: "selection" };
          }
          if (!product.sizes.includes(size)) {
            return { error: "Selecione um tamanho válido.", field: "selection" };
          }
        }
      }
    }

    if (product.kind === "multiPieceBundle") {
      for (const configuration of configurationsOf(selected)) {
        if (normalizeQuantity(configuration.quantity) === 0) continue;
        for (const piece of product.pieces) {
          if (!pieceColor(piece, configuration[`${piece.key}Color`])) {
            return { error: `Selecione uma cor válida para ${piece.name}.`, field: "selection" };
          }
          if (!piece.sizes.includes(configuration[`${piece.key}Size`])) {
            return { error: `Selecione um tamanho válido para ${piece.name}.`, field: "selection" };
          }
          if (piece.personalization) {
            const erro = personalizationError(
              configuration[`${piece.key}PersonalizationName`],
              configuration[`${piece.key}PersonalizationNumber`]
            );
            if (erro) return { error: `${piece.name}: ${erro}`, field: "selection" };
          }
        }
      }
    }
  }

  return null;
}

export function getProduct(productId) {
  return PRODUCT_BY_ID[productId];
}

export function centsToAmount(cents) {
  return Number((Math.max(0, cents) / 100).toFixed(2));
}

/**
 * Chave estável de cada configuração independente de um bundle com várias
 * peças. Inclui a personalização das peças que a declaram (a camiseta).
 */
export function multiPieceBundleConfigurationKey(product, selection = {}) {
  return product.pieces
    .map((piece) => {
      let chave = `${piece.key}-${pieceColor(piece, selection[`${piece.key}Color`])?.code || ""}-${selection[`${piece.key}Size`] || ""}`;
      if (piece.personalization) {
        chave += `-${personalizationKeyPart(
          selection[`${piece.key}PersonalizationName`],
          selection[`${piece.key}PersonalizationNumber`]
        )}`;
      }
      return chave;
    })
    .join("--");
}

/**
 * Resolve os `attributes` declarados de um produto personalizável contra uma
 * configuração: valida cada um e devolve `{ values, chips, keyParts }`, ou
 * `null` se qualquer atributo estrutural faltou.
 */
export function resolvePersonalizedAttributes(product, configuration) {
  const values = {};
  const chips = [];
  const keyParts = [];
  for (const attribute of product.attributes || []) {
    const option = attributeOption(attribute, configuration[attribute.key]);
    if (!option) return null;
    const code = option.code ?? option;
    values[attribute.key] = code;
    keyParts.push(code);
    chips.push(attributeChip(attribute, option));
  }
  return { values, chips, keyParts };
}

function createEmptyProductSelection(product) {
  if (product.kind === "sizedProduct") {
    return { quantity: 0, size: null };
  }

  if (product.kind === "personalizedProduct" || product.kind === "multiPieceBundle") {
    return { configurations: {} };
  }

  if (product.kind === "sizedVariants") {
    return {
      variants: Object.fromEntries(
        product.variants.map((variant) => [
          variant.code,
          Object.fromEntries(product.sizes.map((size) => [size, 0]))
        ])
      )
    };
  }

  if (product.kind === "modelQuantity") {
    return {
      models: Object.fromEntries(product.models.map((model) => [model.code, 0]))
    };
  }

  if (product.kind === "doubleHoodie") {
    return {
      quantity: 0,
      verdeSize: product.defaultVerdeSize || product.sizes?.[2] || "M",
      begeSize: product.defaultBegeSize || product.sizes?.[2] || "M"
    };
  }

  if (product.kind === "configuredBundle") {
    return {
      quantity: 0,
      hoodieVariant: product.defaultHoodieVariant || product.variants?.[0]?.code || "",
      hoodieSize: product.defaultHoodieSize || product.sizes?.[0] || "",
      backpackModel: product.defaultBackpackModel || product.models?.[0]?.code || ""
    };
  }

  return { quantity: 0 };
}

function getConfiguredBundleOptions(product, selected) {
  return {
    variant: findByCode(product.variants, selected.hoodieVariant) || product.variants[0],
    size: product.sizes.includes(selected.hoodieSize)
      ? selected.hoodieSize
      : product.defaultHoodieSize,
    model: findByCode(product.models, selected.backpackModel) || product.models?.[0]
  };
}

/**
 * As configurações independentes de um produto (bundle de várias peças ou
 * camiseta personalizada). Aceita o mapa `configurations` novo e cai numa
 * única configuração quando o objeto vem "plano" (uma seleção só).
 */
function configurationsOf(selected) {
  const configurations = selected?.configurations;
  if (configurations && typeof configurations === "object" && !Array.isArray(configurations)) {
    const values = Object.values(configurations);
    if (values.length > 0) return values;
  }
  return [selected || {}];
}

function normalizeQuantity(value) {
  const quantity = Number.parseInt(value, 10);

  if (!Number.isFinite(quantity) || quantity < 0) {
    return 0;
  }

  return Math.min(quantity, 99);
}

function normalizeCode(value, options = [], fallback = "") {
  return findByCode(options, value)?.code || fallback || options[0]?.code || "";
}

function findByCode(options = [], code) {
  return options.find((option) => option.code === code);
}

/**
 * A cor de uma peça de bundle. Quando `piece.colors` traz uma única opção a cor
 * é FIXA (Combo Signature: uma camiseta verde + uma chumbo) e o que o navegador
 * mandar é ignorado; com duas ou mais, vale a escolhida — ou `undefined`.
 */
function pieceColor(piece, code) {
  const colors = piece.colors || [];
  return colors.length === 1 ? colors[0] : findByCode(colors, code);
}

function buildLine(product, quantity, variant = "", variantCode = "", attributes = {}) {
  return {
    productId: product.id,
    productName: product.name,
    variant,
    variantCode,
    quantity,
    unitPriceCents: product.priceCents,
    totalCents: product.priceCents * quantity,
    ...attributes
  };
}
