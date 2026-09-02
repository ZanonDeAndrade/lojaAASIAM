import { PRODUCT_BY_ID, PRODUCTS } from "./products.js";

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
                `${variant.code}-${size}`
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

export function getProduct(productId) {
  return PRODUCT_BY_ID[productId];
}

export function centsToAmount(cents) {
  return Number((Math.max(0, cents) / 100).toFixed(2));
}

function createEmptyProductSelection(product) {
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

function buildLine(product, quantity, variant = "", variantCode = "") {
  return {
    productId: product.id,
    productName: product.name,
    variant,
    variantCode,
    quantity,
    unitPriceCents: product.priceCents,
    totalCents: product.priceCents * quantity
  };
}
