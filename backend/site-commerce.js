import { configureCatalog } from './shared/products.js';
import { configureRocketRules } from './shared/site-rules.js';

export function applySiteCommerce(config) {
  if (config?.store) configureCatalog(config.store);
  if (config?.rocket?.registration) configureRocketRules(config.rocket.registration);
}
