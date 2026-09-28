/** Loader hook compatível com Node 20/22 para trocar a planilha por memória. */
export function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith("/google-sheets.js")) {
    return { url: new URL("./_test_churrasco_fakes/google-sheets.js", import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
