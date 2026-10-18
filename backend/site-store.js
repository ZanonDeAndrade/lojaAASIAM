import { mkdir, readdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createSheetsClient, ensureSheetExists, isGoogleSheetsConfigured, quoteSheetName } from './google-sheets.js';

// Produção usa a mesma planilha do site, em abas exclusivas. O fallback em disco
// serve ao desenvolvimento; em produção sem Sheets exige um volume persistente.
export function createSiteStore({ directory = process.env.SITE_DATA_DIR || './.site-data', sheets = isGoogleSheetsConfigured(), sheetsClient } = {}) {
  let client = sheetsClient;
  const ready = new Map();
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  async function sheet(name) {
    client ||= createSheetsClient();
    if (!ready.has(name)) ready.set(name, ensureSheetExists(client, spreadsheetId, name).catch(error => { ready.delete(name); throw error; }));
    await ready.get(name);
    return quoteSheetName(name);
  }
  async function diskWrite(name, content) {
    await mkdir(directory, { recursive: true });
    const target = path.resolve(directory, name);
    await writeFile(`${target}.tmp`, content, { mode: 0o600 });
    await rename(`${target}.tmp`, target);
  }
  return {
    kind: sheets ? 'Google Sheets' : 'Disco local',
    async readConfig() {
      if (sheets) {
        const name = await sheet('Site Config');
        const response = await client.spreadsheets.values.get({ spreadsheetId, range: `${name}!A1:A20` });
        const json = (response.data.values || []).map(row => row[0] || '').join('');
        return json ? JSON.parse(json) : { revision: 0, config: null };
      }
      try { return JSON.parse(await readFile(path.resolve(directory, 'config.json'), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return { revision: 0, config: null }; throw error; }
    },
    async writeConfig(document) {
      const json = JSON.stringify(document);
      if (json.length > 500000) throw new Error('A configuração excede o limite de 500 KB.');
      if (!sheets) return diskWrite('config.json', json);
      const name = await sheet('Site Config');
      const chunks = Array.from({ length: 20 }, (_, i) => [json.slice(i * 30000, (i + 1) * 30000)]);
      await client.spreadsheets.values.update({ spreadsheetId, range: `${name}!A1:A20`, valueInputOption: 'RAW', requestBody: { values: chunks } });
    },
    // Placares do torneio: documento próprio, salvo a cada partida, sem passar
    // pela revisão da configuração do site.
    async readTournament() {
      if (sheets) {
        const name = await sheet('Torneio Placar');
        const response = await client.spreadsheets.values.get({ spreadsheetId, range: `${name}!A1:A5` });
        const json = (response.data.values || []).map(row => row[0] || '').join('');
        return json ? JSON.parse(json) : null;
      }
      try { return JSON.parse(await readFile(path.resolve(directory, 'torneio.json'), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async writeTournament(document) {
      const json = JSON.stringify(document);
      if (json.length > 150000) throw new Error('Os dados do torneio excedem o limite de 150 KB.');
      if (!sheets) return diskWrite('torneio.json', json);
      const name = await sheet('Torneio Placar');
      const chunks = Array.from({ length: 5 }, (_, i) => [json.slice(i * 30000, (i + 1) * 30000)]);
      await client.spreadsheets.values.update({ spreadsheetId, range: `${name}!A1:A5`, valueInputOption: 'RAW', requestBody: { values: chunks } });
    },
    // Devolve as linhas onde a imagem ficou ({ first, last }), para o índice.
    async writeMedia(id, mime, bytes) {
      if (!sheets) {
        await diskWrite(`${id}.json`, JSON.stringify({ mime, base64: bytes.toString('base64') }));
        return null;
      }
      const name = await sheet('Site Midia');
      const base64 = bytes.toString('base64');
      const values = Array.from({ length: Math.ceil(base64.length / 30000) }, (_, i) => [id, mime, String(i), base64.slice(i * 30000, (i + 1) * 30000)]);
      const response = await client.spreadsheets.values.append({ spreadsheetId, range: `${name}!A:D`, valueInputOption: 'RAW', requestBody: { values } });
      const rows = /![A-Z]+(\d+):[A-Z]+(\d+)$/.exec(response?.data?.updates?.updatedRange || '');
      return rows ? { first: Number(rows[1]), last: Number(rows[2]) } : null;
    },
    // Índice das imagens: lê só as colunas pequenas (id, tipo e parte), nunca o
    // conteúdo. É chamado por timer, não por visitante.
    async listMedia() {
      if (!sheets) {
        try { return new Map((await readdir(directory)).filter(file => /^[a-f0-9]{40}\.json$/.test(file)).map(file => [file.slice(0, 40), null])); }
        catch (error) { if (error.code === 'ENOENT') return new Map(); throw error; }
      }
      const name = await sheet('Site Midia');
      const response = await client.spreadsheets.values.get({ spreadsheetId, range: `${name}!A:C` });
      const start = Number(/![A-Z]+(\d+)/.exec(response.data.range || '')?.[1] || 1);
      const index = new Map();
      (response.data.values || []).forEach((row, i) => {
        if (!/^[a-f0-9]{40}$/.test(row[0] || '')) return;
        const at = start + i;
        const entry = index.get(row[0]);
        if (entry) { entry.first = Math.min(entry.first, at); entry.last = Math.max(entry.last, at); }
        else index.set(row[0], { first: at, last: at });
      });
      return index;
    },
    // Lê só as linhas da imagem indicadas pelo índice; sem elas, não lê nada.
    async readMedia(id, location) {
      if (!sheets) {
        try { const media = JSON.parse(await readFile(path.resolve(directory, `${id}.json`), 'utf8')); return { mime: media.mime, bytes: Buffer.from(media.base64, 'base64') }; }
        catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      }
      if (!location) return null;
      const name = await sheet('Site Midia');
      const response = await client.spreadsheets.values.get({ spreadsheetId, range: `${name}!A${location.first}:D${location.last}` });
      const rows = (response.data.values || []).filter(row => row[0] === id).sort((a, b) => Number(a[2]) - Number(b[2]));
      if (!rows.length) return null;
      return { mime: rows[0][1], bytes: Buffer.from(rows.map(row => row[3] || '').join(''), 'base64') };
    },
  };
}
