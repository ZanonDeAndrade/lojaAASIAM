export const PAGE_ICONS = ['gamepad', 'flame', 'trophy', 'calendar', 'ticket', 'users', 'star', 'heart', 'music', 'flag', 'gift', 'globe', 'image', 'none'];
export function pageName(config, key) { return config.navigation[key].label.trim() || (key === 'rocket' ? 'Botão 1' : 'Botão 2'); }
export function pageIcon(config, key) { return config.navigation[key].icon || (key === 'rocket' ? 'gamepad' : 'flame'); }
export function linkedEventId(config) { return config.navigation.churrasco.eventId || (config.navigation.churrasco.href.split('?')[0].replace(/\/$/, '') === '/churrasco' ? 'amf-games-2026' : 'semana-si-2026'); }
export function pageSettings(config, key) {
  const legacy = key === 'rocket' ? config.rocket : config.events[linkedEventId(config)];
  return { mode: key === 'rocket' ? 'competition' : 'event', subtitle: key === 'rocket' ? legacy.subtitle : legacy.subtitulo, description: key === 'rocket' ? legacy.aboutDescription : '', banner: key === 'rocket' ? legacy.banner : legacy.banner?.src || '', bannerAlt: key === 'rocket' ? legacy.bannerAlt : legacy.banner?.alt || '', sections: [], showAbout: true, showPrizes: true, showRegistration: true, showSchedule: true, showRegulation: true, ...config.navigation[key].page };
}
// O nome do botão é a única fonte de título da página vinculada. Compatível
// com configurações antigas: ícone e conteúdo livre continuam opcionais.
export function synchronizePages(input) {
  const config = structuredClone(input);
  config.navigation.churrasco.eventId = linkedEventId(config);
  config.rocket.title = pageName(config, 'rocket');
  for (const key of ['rocket', 'churrasco']) {
    const bannerId = key === 'rocket' ? 'torneio-rocket-league' : 'churrasco-semana-academica';
    for (const banner of config.home.banners) if (banner.id === bannerId) { banner.titulo = pageName(config, key); banner.href = config.navigation[key].href; }
  }
  const event = config.events[linkedEventId(config)];
  if (event) { event.titulo = pageName(config, 'churrasco'); event.tituloDaAba = `${event.titulo} | ${config.brand.name}`; }
  for (const key of ['rocket', 'churrasco']) {
    const page = config.navigation[key].page;
    if (!page) continue;
    if (key === 'rocket') {
      if ('subtitle' in page) config.rocket.subtitle = page.subtitle;
      if ('description' in page) config.rocket.aboutDescription = page.description;
      if ('banner' in page) config.rocket.banner = page.banner;
      if ('bannerAlt' in page) config.rocket.bannerAlt = page.bannerAlt;
    } else if (event) {
      if ('subtitle' in page) event.subtitulo = page.subtitle;
      if ('banner' in page) event.banner = page.banner ? { ...(event.banner || { largura: 1600, altura: 600 }), src: page.banner, alt: page.bannerAlt || '' } : null;
    }
  }
  return config;
}
