import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { generateWebp, compressRaster } from "./scripts/optimize-images.mjs";

/**
 * Otimiza as imagens do build: comprime PNG/JPG (qualidade 80–85) e gera
 * versões WebP de cada imagem dentro do dist/, depois que o bundle é escrito.
 * Em dev as imagens .webp já versionadas em public/ são servidas como estão.
 */
function imageOptimizerPlugin() {
  return {
    name: "aasiam-image-optimizer",
    apply: "build",
    async closeBundle() {
      const distImgs = path.resolve(__dirname, "dist");
      // WebP primeiro: recomprimir os PNG antes deixaria os .webp já
      // versionados em public/ "desatualizados" e eles seriam regerados a
      // partir do PNG comprimido, perdendo qualidade sem motivo.
      const webp = await generateWebp(distImgs);
      const compressed = await compressRaster(distImgs);
      console.log(
        `[image-optimizer] ${compressed.done} imagem(ns) comprimida(s), ${webp.created} WebP no dist/.`
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), imageOptimizerPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": "http://localhost:3333"
    }
  }
});
