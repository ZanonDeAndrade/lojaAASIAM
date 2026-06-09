/**
 * Otimização de imagens com sharp.
 *
 * - generateWebp(dir): cria uma versão .webp ao lado de cada PNG/JPG
 *   (usada como <source> principal no <picture>; o PNG fica de fallback).
 * - compressRaster(dir): recomprime os PNG/JPG no próprio lugar mantendo
 *   qualidade visual (usada no build, sobre a pasta dist/).
 *
 * Rodar direto (`node scripts/optimize-images.mjs`) gera os .webp dentro de
 * public/ — esses arquivos são versionados para funcionarem também em dev.
 * O vite.config.js reaproveita estas funções no build para comprimir o dist/.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import sharp from 'sharp';

const RASTER_RE = /\.(png|jpe?g)$/i;
const WEBP_QUALITY = 80;
const PNG_QUALITY = 85; // 80–85: comprime mantendo qualidade visual
const JPG_QUALITY = 82;

async function walk(dir) {
	const out = [];
	let entries;
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await walk(full)));
		else if (RASTER_RE.test(entry.name)) out.push(full);
	}
	return out;
}

async function isStale(src, dest) {
	try {
		const [s, d] = await Promise.all([fs.stat(src), fs.stat(dest)]);
		return s.mtimeMs > d.mtimeMs;
	} catch {
		return true; // dest não existe
	}
}

/** Gera um .webp ao lado de cada imagem raster em `dir`. */
export async function generateWebp(dir) {
	const files = await walk(dir);
	let created = 0;
	for (const src of files) {
		const dest = src.replace(RASTER_RE, '.webp');
		if (!(await isStale(src, dest))) continue;
		try {
			await sharp(src).webp({ quality: WEBP_QUALITY, effort: 5 }).toFile(dest);
			created++;
		} catch (err) {
			console.warn(`[webp] falhou em ${src}: ${err.message}`);
		}
	}
	return { total: files.length, created };
}

/** Recomprime PNG/JPG no próprio lugar (usado sobre o dist/ no build). */
export async function compressRaster(dir) {
	const files = await walk(dir);
	let done = 0;
	for (const src of files) {
		try {
			const isPng = /\.png$/i.test(src);
			const pipeline = sharp(src);
			const buf = await (isPng
				? pipeline.png({ quality: PNG_QUALITY, compressionLevel: 9, effort: 8, palette: true })
				: pipeline.jpeg({ quality: JPG_QUALITY, mozjpeg: true })
			).toBuffer();
			const tmp = `${src}.${process.pid}.tmp`;
			await fs.writeFile(tmp, buf);
			await fs.rename(tmp, src);
			done++;
		} catch (err) {
			console.warn(`[compress] falhou em ${src}: ${err.message}`);
		}
	}
	return { total: files.length, done };
}

// Execução direta: gera os .webp dentro de public/.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const publicDir = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		'..',
		'public',
	);
	const r = await generateWebp(publicDir);
	console.log(`[optimize-images] WebP: ${r.created} gerado(s) de ${r.total} imagem(ns) em public/.`);
}
