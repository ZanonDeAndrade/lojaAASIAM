import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Mantém as variáveis do ambiente como prioridade e carrega o arquivo do
// backend mesmo quando o processo é iniciado pela raiz do repositório.
dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)), quiet: true });
dotenv.config({ quiet: true });
