# Publicar a etapa 1 de segurança

Roteiro para hoje à noite, **depois da final do torneio**. A branch é `seguranca-etapa-1`.

O deploy do backend reinicia o servidor no Render. Todos os logins do admin caem, e o placar não pode ser lançado durante os minutos do deploy.

## 0. Antes de começar

1. **Confirme que ninguém está lançando placar.**
2. **Torne o repositório privado ANTES do push.** Os novos códigos de cupom estão no código.
   1. Confira o acesso dos serviços de deploy. No GitHub, abra o menu da sua conta → **Settings** → **Applications** → **Installed GitHub Apps**. Em **Vercel** e em **Render**, a opção **Repository access** precisa incluir `lojaAASIAM` (ou estar em "All repositories").
   2. Mude a visibilidade: abra o repositório → **Settings** → **General** → **Danger Zone** → **Change visibility** → **Private**.

## 1. Conferir a branch

```bash
cd "/home/arthur-zanon/Área de trabalho/Projetos/EcomerceAtletica"
git fetch origin
git checkout seguranca-etapa-1
git log --oneline origin/main..seguranca-etapa-1      # os commits da etapa 1
git merge-base --is-ancestor origin/main seguranca-etapa-1 && echo "ok: dá para fazer fast-forward"
(cd backend && npm run -s test:seguranca && npm run -s test:admin && npm run -s test:torneio)
```

Se o `merge-base` não imprimir "ok", alguém mudou a `main` no GitHub. Pare e me chame.

## 2. Merge e push (sem force)

```bash
git checkout main
git merge --ff-only seguranca-etapa-1
git push origin main
```

O `--ff-only` recusa o merge se a `main` tiver mudado, e o push é um push normal.

## 3. Acompanhar os deploys

### Vercel (site)

Leva cerca de 1 a 2 minutos. São três projetos: `loja-aasiam`, `loja-aasiam-9gsh` e `loja-aasiam-tkah`. Para ver o status:

```bash
gh api repos/ZanonDeAndrade/lojaAASIAM/commits/$(git rev-parse HEAD)/status --jq '.statuses[] | "\(.context) | \(.state)"'
```

Espere os três ficarem `success`. Em 18/10, um push **não gerou deploy nenhum na Vercel**. Se em 5 minutos não aparecer status, abra o projeto na Vercel → **Deployments** → no último deploy da `main`, **⋯ → Redeploy**.

### Render (backend `lojaAASIAM-2`)

Leva vários minutos. No painel, em **Events**, espere **Deploy live**. Depois confirme que o código novo está no ar: o `/api/health` precisa ter o campo `proxy`.

```bash
curl -s https://lojaaasiam-2.onrender.com/api/health | python3 -m json.tool
```

**Só siga para os passos 5 e 6 com o campo `proxy` aparecendo.** Antes disso, o código antigo ainda está no ar, e chamar `/api/test-sheets` gravaria na planilha.

## 4. Medir os saltos do proxy (`TRUST_PROXY_HOPS`)

Sem mandar nenhum `X-Forwarded-For`, rode o comando abaixo de duas redes diferentes, por exemplo casa e 4G:

```bash
curl -s https://lojaaasiam-2.onrender.com/api/health | python3 -c "import json,sys; print(json.load(sys.stdin)['proxy'])"
```

| `xffHops` medido | O que fazer |
|---|---|
| `1` | Nada: o padrão já é `1`. |
| `2` (ou outro número) | No Render, defina `TRUST_PROXY_HOPS` com esse número. Ele reinicia o servidor; depois rode o comando de novo e confira `trustProxyHops`. |
| `0` | Inesperado (o Render sempre repassa o IP). Me chame antes de mudar. |

Teste de conferência: com um IP inventado, o número precisa subir 1. Isso prova que o proxy acrescenta o IP real ao fim da lista.

```bash
curl -s -H "X-Forwarded-For: 1.2.3.4" https://lojaaasiam-2.onrender.com/api/health | python3 -c "import json,sys; print(json.load(sys.stdin)['proxy'])"
```

## 5. Verificações em produção

```bash
API=https://lojaaasiam-2.onrender.com

# Rotas removidas: devem responder 404
for r in "POST /api/webhooks/infinitepay" "POST /api/usar-cupom" "GET /api/test-sheets" "GET /api/test-planilha-pedido"; do
  set -- $r; printf "%-34s %s\n" "$r" "$(curl -s -o /dev/null -w '%{http_code}' -X $1 -H 'Content-Type: application/json' $([ $1 = POST ] && echo '-d {}') "$API$2")"
done

# Escrita sem token: deve responder 401
for r in "POST /api/admin/config" "POST /api/admin/media" "POST /api/admin/torneio/partidas/A01" "GET /api/admin/torneio"; do
  set -- $r; printf "%-34s %s\n" "$r" "$(curl -s -o /dev/null -w '%{http_code}' -X $1 -H 'Content-Type: application/json' $([ $1 = POST ] && echo '-d {}') "$API$2")"
done

# Sem X-Powered-By (deve imprimir 0)
curl -sI "$API/api/health" | grep -ci x-powered-by

# Cupons de R$ 1 removidos: deve responder {"valido":false,"motivo":"invalido"}
curl -s -X POST -H 'Content-Type: application/json' -d '{"codigo":"1REAL"}' "$API/api/validar-cupom"; echo

# Churrasco do AMF encerrado: deve responder 403 "Inscrições encerradas em 12/09 às 23h59."
curl -s -X POST -H 'Content-Type: application/json' -d '{"name":"Teste Verificacao","phone":"(51) 98888-7777","email":"verificacao@exemplo.com","course":"Direito"}' "$API/api/churrasco/checkout"; echo
```

### Bloqueio do login

Faça este teste **só depois** de confirmar `TRUST_PROXY_HOPS` no passo 4. Ele bloqueia o **seu IP** por 15 minutos, então rode de uma rede que os organizadores não estejam usando.

```bash
for i in $(seq 1 11); do curl -s -o /dev/null -w '%{http_code} ' -X POST -H 'Content-Type: application/json' -d '{"username":"teste","password":"senha-errada"}' "$API/api/admin/login"; done; echo
```

O esperado é dez `401` seguidos de um `429`. Depois, de outra rede (4G), entre no `/admin` normalmente: o login deve funcionar.

### No navegador

- https://www.aasiam.com.br/, `/torneio-rocket-league`, `/churrasco-semana-academica` e `/admin` abrem normalmente.
- A página do torneio mostra o placar ("Atualiza sozinho").

## 6. Cupons

1. Abra o `cupons-novos.txt`, que fica na raiz do projeto, fora do git.
2. Distribua os códigos novos. Depois, apague o arquivo.
3. Na aba **Cupons** da planilha, marque as 11 linhas antigas (as que têm nomes de pessoas) como **Ativo = Não**.
4. As 11 linhas novas são criadas sozinhas na primeira validação de um cupom pessoal no site.
5. **Só reabra a loja depois disso.**

## 7. Variáveis do Render (fazer depois do deploy)

Cada mudança de variável reinicia o servidor e derruba os logins do admin.

| Variável | Ação |
|---|---|
| `TRUST_PROXY_HOPS` | Definir **só se** o `xffHops` medido for diferente de `1`. |
| `ENABLE_TEST_COUPON` | Remover. O código não lê mais essa variável. |
| `NODE_ENV` | Confirmar que existe com o valor `production`. |
| `ADMIN_USERNAME` | Trocar `admin` por um nome próprio. |
| `ADMIN_PASSWORD` | Trocar por uma senha aleatória com 16 caracteres ou mais. |
| `RATE_LIMIT_DISABLED` | **Não** definir. É só para emergência: com `true`, todos os limites desligam (útil se pessoas legítimas forem bloqueadas por erro de saltos). Remova assim que corrigir. |

Para depois de 24/10 (churrasco da Semana SI): definir `CHURRASCO_TOKEN_SECRET`, `ROCKET_TOKEN_SECRET` e `COMPROVANTE_SIGNING_SECRET` dedicados, sem quebrar os comprovantes já emitidos. Para a semana: `NODE_VERSION` 22.

## 8. Se algo der errado

O jeito mais rápido é voltar ao deploy anterior nos painéis:

- **Render:** Deploys → deploy anterior → **Rollback**.
- **Vercel:** Deployments → deploy anterior da `main` → **⋯ → Promote to Production** (Instant Rollback).

Depois, para alinhar o código, reverta os commits da etapa 1 (sem reescrever histórico):

```bash
git revert --no-edit fbc27c0..main
git push origin main
```
