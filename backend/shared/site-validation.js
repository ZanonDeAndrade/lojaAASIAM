import { SITE_DEFAULTS } from './site-defaults.js';
import { PAGE_ICONS } from './page-settings.js';

const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const safeUrl = value => typeof value === 'string' && (value === '' || (/^\/(?!\/)/.test(value) && !/[\\\u0000-\u001f]/.test(value)) || /^https:\/\/[^\s\\]+$/i.test(value) || /^imgs\/[A-Za-z0-9_./-]+$/.test(value));
export function validateSiteConfig(config) {
  if (!plain(config)) return 'Configuração inválida.';
  for (const [key, value] of Object.entries(SITE_DEFAULTS)) {
    if (!(key in config) || (Array.isArray(value) ? !Array.isArray(config[key]) : !plain(config[key]))) return `Seção inválida: ${key}.`;
  }
  if (Object.keys(config).some(key => !(key in SITE_DEFAULTS))) return 'Seção desconhecida.';
  let count = 0;
  function visit(value, key = '', depth = 0) {
    if (++count > 30000 || depth > 15) throw new Error('Configuração muito complexa.');
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Campo não permitido.');
    if (typeof value === 'string') {
      if (value.length > 20000) throw new Error(`Texto muito longo: ${key}.`);
      if (['src', 'href', 'logo', 'fallback', 'webp', 'regulationUrl', 'image', 'coverImage'].includes(key) && !safeUrl(value)) throw new Error(`Endereço inválido: ${key}. Use um caminho do site ou HTTPS.`);
      if (['accent', 'accentHover', 'background', 'panel', 'muted', 'swatch', 'border'].includes(key) && !/^#[a-f0-9]{6}$/i.test(value)) throw new Error(`Cor inválida: ${key}.`);
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value) || Math.abs(value) > 10000000) throw new Error(`Número inválido: ${key}.`);
      if (/Cents$/.test(key) && (!Number.isInteger(value) || value < 0)) throw new Error(`Valor inválido: ${key}.`);
    } else if (Array.isArray(value)) {
      if (value.length > 500) throw new Error(`Lista muito longa: ${key}.`);
      value.forEach(item => visit(item, key === 'images' ? 'image' : '', depth + 1));
    } else if (plain(value)) {
      Object.entries(value).forEach(([child, item]) => visit(item, child, depth + 1));
    } else if (value !== null && typeof value !== 'boolean') throw new Error(`Campo inválido: ${key}.`);
  }
  function shape(value, baseline, location) {
    if (baseline === null) return;
    if (Array.isArray(baseline)) {
      if (!Array.isArray(value)) throw new Error(`Lista inválida: ${location}.`);
      if (baseline.length) value.forEach((item, i) => {
        const model = baseline.find(example => plain(example) && example.id && example.id === item?.id) || baseline[i % baseline.length];
        shape(item, model, `${location}[${i + 1}]`);
      });
    } else if (plain(baseline)) {
      if (!plain(value)) throw new Error(`Seção inválida: ${location}.`);
      for (const [key, child] of Object.entries(baseline)) {
        // A estrutura de blocos do regulamento e de jogos aceita variações.
        if (location.includes('.regulation') || location.includes('.matches') || location.includes('.products')) continue;
        if (!(key in value)) throw new Error(`Campo ausente: ${location}.${key}.`);
        shape(value[key], child, `${location}.${key}`);
      }
    } else if (typeof value !== typeof baseline) throw new Error(`Tipo inválido: ${location}.`);
  }
  try {
    visit(config);
    shape(config, SITE_DEFAULTS, 'site');
    for (const key of ['rocket', 'churrasco']) {
      const button = config.navigation[key];
      const path = button.href.split(/[?#]/)[0].replace(/\/$/, '') || '/';
      if (button.href.startsWith('/') && (['/', '/admin', '/checkout', '/carrinho'].includes(path) || path.startsWith('/api/'))) throw new Error('Escolha um endereço de página que não seja reservado à loja ou ao admin.');
      if (button.eventId !== undefined && !['amf-games-2026', 'semana-si-2026'].includes(button.eventId)) throw new Error('Página de inscrições inválida.');
      if (button.icon !== undefined && !PAGE_ICONS.includes(button.icon)) throw new Error('Escolha um ícone válido para o botão.');
      if (button.page !== undefined) {
        const page = button.page;
        if (!plain(page) || !['custom', key === 'rocket' ? 'competition' : 'event'].includes(page.mode) || !Array.isArray(page.sections)) throw new Error('Configuração da página inválida.');
        for (const field of ['subtitle', 'description', 'banner', 'bannerAlt']) if (typeof page[field] !== 'string') throw new Error('Preencha os textos e a imagem da página.');
        if (!safeUrl(page.banner)) throw new Error('Imagem da página inválida.');
        for (const field of ['showAbout', 'showPrizes', 'showRegistration', 'showSchedule', 'showRegulation']) if (field in page && typeof page[field] !== 'boolean') throw new Error('Visibilidade de seção inválida.');
        const ids = new Set();
        for (const section of page.sections) {
          if (!plain(section) || typeof section.id !== 'string' || !section.id || ids.has(section.id)) throw new Error('Seção de página inválida ou repetida.');
          ids.add(section.id);
          for (const field of ['title', 'text', 'image', 'imageAlt', 'buttonLabel', 'buttonHref']) if (typeof section[field] !== 'string') throw new Error('Preencha o conteúdo da seção.');
          if (!safeUrl(section.image) || !safeUrl(section.buttonHref) || typeof section.visible !== 'boolean') throw new Error('Link, imagem ou visibilidade da seção inválidos.');
        }
      }
    }
    if (config.navigation.rocket.href === config.navigation.churrasco.href) throw new Error('Cada botão deve ter um endereço de página diferente.');
    for (const key of ['light', 'dark', 'rocket', 'churrasco']) for (const color of Object.values(config.appearance[key])) if (!/^#[a-f0-9]{6}$/i.test(color)) throw new Error('Use cores no formato hexadecimal de seis dígitos.');
    if (!['Archivo', 'Arial', 'Georgia', 'system'].includes(config.appearance.font) || !['light', 'dark'].includes(config.appearance.defaultTheme) || config.appearance.radius < 0 || config.appearance.radius > 100) throw new Error('Fonte, tema ou arredondamento inválido.');
    const registration = config.rocket.registration;
    if (!registration || typeof registration.enabled !== 'boolean' || !Number.isInteger(registration.amountCents) || registration.amountCents < 100 || !Number.isFinite(Date.parse(registration.deadline)) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(registration.deadline)) throw new Error('Configure valor e prazo de inscrição do torneio com fuso explícito (ex.: -03:00).');
    const ids = new Set();
    if (config.store.products.length !== SITE_DEFAULTS.store.products.length) throw new Error('Mantenha os produtos cadastrados; use a opção de ocultar ou esgotar.');
    for (const product of config.store.products) {
      const original = SITE_DEFAULTS.store.products.find(item => item.id === product.id);
      if (!original || ids.has(product.id) || product.kind !== original.kind) throw new Error('Identificador ou tipo de produto inválido.');
      ids.add(product.id);
      shape(product, original, `produto-${product.id}`);
      if (['soldOut', 'hidden'].some(key => key in product && typeof product[key] !== 'boolean')) throw new Error('A visibilidade e o estoque devem ser verdadeiros ou falsos.');
      if (!Number.isInteger(product.priceCents) || product.priceCents < 1 || typeof product.name !== 'string' || !product.name.trim() || !Array.isArray(product.images) || product.images.some(src => typeof src !== 'string' || !safeUrl(src))) throw new Error('Nome, preço ou imagens de produto inválidos.');
    }
    const teams = new Set();
    const groupIds = new Set();
    for (const group of config.rocket.groups) {
      if (typeof group.id !== 'string' || !group.id || groupIds.has(group.id) || !Array.isArray(group.teams)) throw new Error('Grupo inválido ou repetido.');
      groupIds.add(group.id);
      for (const team of group.teams) {
        if (typeof team.id !== 'string' || !team.id || teams.has(team.id) || typeof team.name !== 'string' || !team.name.trim() || !Array.isArray(team.players) || team.players.some(player => typeof player !== 'string')) throw new Error('Equipe inválida ou repetida.');
        teams.add(team.id);
      }
    }
    for (const match of config.rocket.schedule.matches) {
      if (!match.id || !Array.isArray(match.teams || match.placeholders) || (match.teams || match.placeholders).length !== 2 || match.teams?.some(id => !teams.has(id)) || (match.teams && match.teams[0] === match.teams[1])) throw new Error('Confronto inválido. Selecione duas equipes cadastradas.');
      if (typeof match.time !== 'string' || typeof match.stage !== 'string' || typeof match.format !== 'string') throw new Error('Horário ou fase do confronto inválidos.');
    }
    if (config.rocket.rounds.length !== 3 || config.rocket.rounds.some((round, index) => !Array.isArray(round.matches) || round.matches.length !== [4, 2, 1][index] || round.matches.some(match => !Array.isArray(match.sides) || match.sides.length !== 2))) throw new Error('O chaveamento deve ter quatro quartas, duas semifinais e uma final.');
    for (const section of config.rocket.regulation) {
      if (!plain(section) || typeof section.title !== 'string' || (section.paragraphs && (!Array.isArray(section.paragraphs) || section.paragraphs.some(text => typeof text !== 'string'))) || (section.items && (!Array.isArray(section.items) || section.items.some(item => !plain(item) || typeof item.label !== 'string' || typeof item.text !== 'string' || (item.list && (!Array.isArray(item.list) || item.list.some(text => typeof text !== 'string'))))))) throw new Error('Seção ou item do regulamento inválido.');
    }
    for (const round of config.rocket.rounds) if (typeof round.name !== 'string' || typeof round.format !== 'string' || round.matches.some(match => typeof match.id !== 'string' || match.sides.some(side => typeof side !== 'string'))) throw new Error('Nome, formato ou vagas do chaveamento inválidos.');
    if (config.home.banners.some(banner => !banner.id || !banner.src || !banner.href || !(banner.largura > 0) || !(banner.altura > 0))) throw new Error('Preencha as imagens, links e dimensões dos banners.');
    if (config.home.interval < 2000 || config.home.interval > 60000) throw new Error('O intervalo dos banners deve ficar entre 2000 e 60000 ms.');
    if (config.media.some(media => !plain(media) || !safeUrl(media.src) || !['contain', 'cover', 'fill', 'none', 'scale-down'].includes(media.fit) || !Number.isFinite(media.scale) || media.scale < 0.1 || media.scale > 3 || !Number.isFinite(media.radius) || media.radius < 0 || media.radius > 200 || typeof media.position !== 'string' || !/^[\w% .-]{1,60}$/.test(media.position))) throw new Error('Ajuste de imagem inválido.');
    return null;
  } catch (error) { return error.message; }
}
