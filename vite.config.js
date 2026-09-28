import frontendConfig from './frontend/vite.config.js';

// A Vercel está vinculada à raiz deste monorepo. Mantemos o app em
// `frontend/`, mas fazemos o comando configurado no painel (`vite build`)
// encontrar as dependências, a configuração e o diretório público corretos.
export default {
	...frontendConfig,
	root: 'frontend',
};
