/**
 * Recorte do mascote do churrasco — remove o fundo creme da arte original e
 * grava uma versão com transparência real (PNG + WebP).
 *
 * Como funciona:
 *  1. Flood fill a partir das bordas, atravessando apenas pixels claros e
 *     próximos do creme do fundo. O traço escuro que contorna o personagem
 *     funciona como barreira, então nada de dentro do lobo é apagado.
 *  2. A borda do recorte recebe alpha proporcional ao escurecimento do pixel
 *     (a faixa de antialiasing entre o creme e o traço preto).
 *  3. Os pixels dessa borda são "descontaminados": desfaz-se a mistura com o
 *     creme, o que elimina o halo bege ao redor do pelo.
 *
 * Uso: node scripts/cutout-lobo.mjs
 * O arquivo original nunca é sobrescrito — ele fica em assets-src/.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../assets-src/lobo-churrasco-original.png');
const OUT_PNG = path.resolve(here, '../public/imgs/lobo-churrasco-transparente.png');
const OUT_WEBP = path.resolve(here, '../public/imgs/lobo-churrasco-transparente.webp');

/* ── Parâmetros do recorte ───────────────────────────────────────────
   FLOOD_MIN_LUM  luminância mínima para o flood fill atravessar um pixel.
                  O traço do desenho é bem mais escuro que isso, então ele
                  segura o preenchimento na silhueta.
   FLOOD_MAX_DIST distância máxima até o creme do fundo. Cobre a fumaça
                  bege, que também é fundo, sem alcançar o pelo do lobo.
   EDGE_*         faixa de luminância usada para calcular o alpha da borda. */
const FLOOD_MIN_LUM = 148;
const FLOOD_MAX_DIST = 165;
const EDGE_LUM_HI = 236; // creme puro → alpha 0
const EDGE_LUM_LO = 70;  // traço escuro → alpha 1
const EDGE_ONLY_BELOW = 205; // acima disso o pixel é arte clara, não antialiasing

/* Borda "macia": onde o recorte encosta em brilho (o clarão da chama, que se
   dissolvia na fumaça) não existe traço para servir de limite, e um corte seco
   deixa um farrapo recortado. Nesses pontos o alpha sobe ao longo de alguns
   pixels, e o brilho volta a terminar em degradê. Bordas escuras — o traço do
   desenho — não entram aqui e continuam nítidas. */
const SOFT_EDGE_MIN_LUM = 140;
const SOFT_EDGE_MIN_WARMTH = 60; // vermelho − azul: separa o fogo do metal claro
const SOFT_EDGE_DEPTH = 26;
/* Ilhas soltas maiores que isto são inspecionadas antes de sumir — abaixo do
   limite são restos de fumaça e faísca que, no fundo preto, viram farrapos. */
const ISLAND_KEEP_MIN_PX = 4000;

/* Vãos fechados onde o fundo aparece por dentro do desenho. O flood fill vindo
   da borda não chega até eles, e a cor sozinha não os distingue das áreas
   claras da arte — o emblema "SI" tem exatamente o mesmo creme. Por isso cada
   vão é apontado por um ponto na arte original (1254×1254). */
const HOLE_SEEDS = [
  [400, 700, 'vão entre o braço esquerdo e o tronco'],
  [830, 780, 'vão entre o braço direito e o tronco'],
  [115, 1108, 'alça esquerda da churrasqueira'],
  [1145, 1097, 'alça direita da churrasqueira'],
];

const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const byte = (n) => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));

async function main() {
  const { data, info } = await sharp(SRC)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: W, height: H, channels: C } = info;
  const at = (x, y) => (y * W + x) * C;

  // Cor do fundo: mediana das quatro quinas, imune a um pixel estranho.
  const corners = [
    [2, 2],
    [W - 3, 2],
    [2, H - 3],
    [W - 3, H - 3],
  ].map(([x, y]) => {
    const i = at(x, y);
    return [data[i], data[i + 1], data[i + 2]];
  });
  const bg = [0, 1, 2].map((ch) => {
    const vals = corners.map((c) => c[ch]).sort((a, b) => a - b);
    return Math.round((vals[1] + vals[2]) / 2);
  });

  const distToBg = (r, g, b) =>
    Math.hypot(r - bg[0], g - bg[1], b - bg[2]);

  /* ── 1. Flood fill a partir de todas as bordas ── */
  const isBg = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let head = 0;
  let tail = 0;

  const floodable = (x, y) => {
    const i = at(x, y);
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    return luminance(r, g, b) >= FLOOD_MIN_LUM && distToBg(r, g, b) <= FLOOD_MAX_DIST;
  };

  const push = (x, y) => {
    const p = y * W + x;
    if (isBg[p]) return;
    if (!floodable(x, y)) return;
    isBg[p] = 1;
    queue[tail++] = p;
  };

  for (let x = 0; x < W; x++) {
    push(x, 0);
    push(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    push(0, y);
    push(W - 1, y);
  }

  while (head < tail) {
    const p = queue[head++];
    const x = p % W;
    const y = (p / W) | 0;
    if (x > 0) push(x - 1, y);
    if (x < W - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < H - 1) push(x, y + 1);
  }

  /* ── 2. Vãos fechados (axilas, alças da churrasqueira) ──
     A fila do flood fill já está vazia: basta semear e drenar de novo. */
  let holePixels = 0;
  for (const [sx, sy, descricao] of HOLE_SEEDS) {
    if (isBg[sy * W + sx]) continue;
    if (!floodable(sx, sy)) {
      console.warn(`[cutout] semente não caiu no fundo, ignorada: ${descricao}`);
      continue;
    }
    push(sx, sy);
    while (head < tail) {
      const p = queue[head++];
      holePixels++;
      const x = p % W;
      const y = (p / W) | 0;
      if (x > 0) push(x - 1, y);
      if (x < W - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1);
      if (y < H - 1) push(x, y + 1);
    }
  }

  /* ── 3. Bolsões de fumaça presos entre as chamas ──
     O flood fill não alcança a fumaça cercada por fogo. Cada ilha restante é
     avaliada isolada: fumaça é clara e pouco saturada; chama é laranja forte
     e fica. A maior ilha é sempre o personagem. */
  const label = new Int32Array(W * H).fill(-1);
  const islands = [];

  for (let start = 0; start < W * H; start++) {
    if (isBg[start] || label[start] !== -1) continue;
    const id = islands.length;
    label[start] = id;
    let qh = 0;
    let qt = 0;
    queue[qt++] = start;
    const pixels = [];
    const sats = [];
    let lumSum = 0;

    while (qh < qt) {
      const p = queue[qh++];
      pixels.push(p);
      const i = p * C;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      lumSum += luminance(r, g, b);
      sats.push(Math.max(r, g, b) - Math.min(r, g, b));

      const x = p % W;
      const y = (p / W) | 0;
      const neighbours = [
        x > 0 ? p - 1 : -1,
        x < W - 1 ? p + 1 : -1,
        y > 0 ? p - W : -1,
        y < H - 1 ? p + W : -1,
      ];
      for (const n of neighbours) {
        if (n < 0 || isBg[n] || label[n] !== -1) continue;
        label[n] = id;
        queue[qt++] = n;
      }
    }

    sats.sort((a, b) => a - b);
    islands.push({
      id,
      pixels,
      meanLum: lumSum / pixels.length,
      satP95: sats[Math.min(sats.length - 1, Math.floor(sats.length * 0.95))],
    });
  }

  const main = islands.reduce((a, b) => (b.pixels.length > a.pixels.length ? b : a));
  let smokeIslands = 0;
  let smokePixels = 0;
  for (const island of islands) {
    if (island === main || island.pixels.length >= ISLAND_KEEP_MIN_PX) continue;
    smokeIslands++;
    smokePixels += island.pixels.length;
    for (const p of island.pixels) isBg[p] = 1;
  }

  /* ── 4. Degradê nas bordas de brilho ── */
  const softDepth = new Int16Array(W * H).fill(-1);
  {
    let qh = 0;
    let qt = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (isBg[p]) continue;
        const i = p * C;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        // Só o clarão quente entra: as alças cromadas da churrasqueira são
        // claras mas neutras, e precisam continuar com a borda firme.
        if (luminance(r, g, b) < SOFT_EDGE_MIN_LUM) continue;
        if (r - b < SOFT_EDGE_MIN_WARMTH) continue;

        const encostaNoFundo =
          (x > 0 && isBg[p - 1]) ||
          (x < W - 1 && isBg[p + 1]) ||
          (y > 0 && isBg[p - W]) ||
          (y < H - 1 && isBg[p + W]);
        if (!encostaNoFundo) continue;

        softDepth[p] = 0;
        queue[qt++] = p;
      }
    }

    while (qh < qt) {
      const p = queue[qh++];
      const d = softDepth[p];
      if (d >= SOFT_EDGE_DEPTH) continue;
      const x = p % W;
      const y = (p / W) | 0;
      const vizinhos = [
        x > 0 ? p - 1 : -1,
        x < W - 1 ? p + 1 : -1,
        y > 0 ? p - W : -1,
        y < H - 1 ? p + W : -1,
      ];
      for (const n of vizinhos) {
        if (n < 0 || isBg[n] || softDepth[n] !== -1) continue;
        softDepth[n] = d + 1;
        queue[qt++] = n;
      }
    }
  }

  /* ── 5. Alpha + descontaminação na borda ── */
  const out = Buffer.alloc(W * H * 4);

  const hasBgNeighbor = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (isBg[ny * W + nx]) return true;
      }
    }
    return false;
  };

  let kept = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const i = at(x, y);
      const o = p * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      if (isBg[p]) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
        continue;
      }

      const lum = luminance(r, g, b);
      let alpha = 1;

      if (lum < EDGE_ONLY_BELOW && hasBgNeighbor(x, y)) {
        alpha = clamp01((EDGE_LUM_HI - lum) / (EDGE_LUM_HI - EDGE_LUM_LO));
      }

      const profundidade = softDepth[p];
      if (profundidade >= 0) {
        alpha = Math.min(alpha, profundidade / SOFT_EDGE_DEPTH);
      }

      if (alpha >= 0.996) {
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = 255;
      } else if (alpha <= 0.004) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
      } else {
        // C = a·F + (1-a)·bg  →  F = (C - (1-a)·bg) / a
        const inv = 1 - alpha;
        out[o] = byte((r - inv * bg[0]) / alpha);
        out[o + 1] = byte((g - inv * bg[1]) / alpha);
        out[o + 2] = byte((b - inv * bg[2]) / alpha);
        out[o + 3] = Math.round(alpha * 255);
      }
      kept++;
    }
  }

  const raw = { raw: { width: W, height: H, channels: 4 } };

  // Sobra de fundo nas quinas some no trim; o conteúdo fica colado nas bordas.
  const trimmed = await sharp(out, raw).trim({ threshold: 1 }).png().toBuffer();
  const meta = await sharp(trimmed).metadata();

  await sharp(trimmed).png({ compressionLevel: 9, palette: true, quality: 92 }).toFile(OUT_PNG);
  await sharp(trimmed).webp({ quality: 88, alphaQuality: 100, effort: 6 }).toFile(OUT_WEBP);

  const pct = ((kept / (W * H)) * 100).toFixed(1);
  console.log(`[cutout] fundo detectado: rgb(${bg.join(', ')})`);
  console.log(`[cutout] ${holePixels} px de vãos fechados removidos`);
  console.log(`[cutout] ${smokeIslands} ilha(s) de fumaça removida(s) (${smokePixels} px)`);
  console.log(`[cutout] ${pct}% dos pixels preservados · recorte final ${meta.width}×${meta.height}`);
  console.log(`[cutout] ${path.relative(process.cwd(), OUT_PNG)}`);
  console.log(`[cutout] ${path.relative(process.cwd(), OUT_WEBP)}`);
}

main().catch((err) => {
  console.error('[cutout] falhou:', err.message);
  process.exitCode = 1;
});
