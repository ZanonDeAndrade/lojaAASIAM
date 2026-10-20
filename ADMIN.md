# Painel administrativo

O endereço é **`/admin`** (por exemplo, `https://www.aasiam.com.br/admin`). Não existe link para ele na navegação pública. A rota entrega apenas o login; ler as configurações administrativas, publicar e enviar imagens exige uma sessão válida no backend. A página também envia `noindex, nofollow, noarchive` na Vercel.

## Ativação no Render

Configure somente no **backend**, sem prefixo `VITE_`:

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=coloque-aqui-uma-senha-exclusiva-com-pelo-menos-12-caracteres
```

A senha acima é um exemplo. A senha inicial solicitada foi configurada no `.env` local do backend, ignorado pelo Git. Em produção, defina `ADMIN_USERNAME` e `ADMIN_PASSWORD` no Render e faça o deploy do backend e frontend. Sem senha configurada, o login fica desabilitado. O `ADMIN_TOKEN` antigo dos cupons é independente deste login.

O frontend continua usando `VITE_API_URL` para chegar ao backend. O CORS aceita o header `Authorization`. As sessões duram quatro horas, ficam só na memória do navegador e do servidor e são invalidadas ao sair; recarregar o painel ou reiniciar o backend exige novo login. Há limite de tentativas de login e a senha é verificada com `scrypt`.

## Configurações disponíveis

- Identidade: nome, logo, título no navegador, descrição, rodapé e créditos.
- Aparência: cores nos temas claro e escuro, cores do torneio e churrasco, fonte e arredondamento.
- Navegação: nomes das categorias, nomes dos botões de eventos, links e visibilidade.
- Banners: adicionar, remover, ordenar, enviar imagens, descrições acessíveis, links, dimensões, prioridade por data e intervalo do carrossel.
- Imagens: upload PNG/JPEG/WebP/GIF de até 3 MB. Na seção Ajustes de imagens, use a mesma URL da imagem para definir enquadramento, posição, zoom, proporção, descrição e bordas.
- Loja: abrir/encerrar, editar os produtos existentes, preços, descrições, imagens, capas, categorias, tamanhos, variações e estoque. Os identificadores e tipos dos produtos são preservados para manter a compatibilidade dos pedidos. Produtos ocultos também ficam indisponíveis no checkout.
- Torneio: nome, banner, textos, abas, valor e prazo das inscrições, premiação, regulamento da página, URL de um novo PDF e textos da tabela (data, regra de classificação e observações). Placares, equipes e chaveamento ficam em **Placar do torneio**.
- Eventos: textos, banners, datas e horários exibidos, local e cardápio. Esses campos de apresentação não alteram os prazos e preços de cobrança dos churrascos, que continuam em `shared/churrasco-eventos.js`.

Os dados de apresentação e regras publicados estão em uma configuração compartilhada. Os valores iniciais ficam em `backend/shared/site-defaults.js`. Não há edição de credenciais de pagamento, chaves privadas, código JavaScript ou regras de autenticação pelo painel.

## Placar do torneio (placares da Copa AASIAM)

É a primeira seção do menu (`/admin?section=placar`) e a que abre depois do login. Diferente das outras, **não usa Publicar alterações**: cada placar é salvo na hora e a página `/torneio-rocket-league` busca os dados sozinha a cada 20 segundos.

- **Grupo A, B e C**: classificação calculada e as partidas do grupo. Em cada partida, preencha os gols, escolha o status (A jogar, Ao vivo ou Encerrado) e toque em **Salvar**. **Zerar** volta a partida para "A jogar". Só partidas encerradas contam na tabela.
- **Mata-mata**: formato das quartas (MD3 por padrão) e da disputa de 3º lugar (MD3 ou MD5), confrontos das quartas (com **Sugerir pela classificação** depois dos 26 jogos dos grupos) e as séries. Nas séries MD3/MD5, lance cada jogo na sua linha (Jogo 1, Jogo 2…) com placar e status próprios e clique em **Salvar jogos**. O placar da série (ex.: 2 × 1) é calculado pelos jogos encerrados; quando alguém chega a 2 vitórias (MD3) ou 3 (MD5), os jogos restantes ficam como **Não necessário** e o vencedor avança sozinho. **Zerar** limpa todos os jogos da série. A disputa de 3º lugar (presencial) recebe sozinha os perdedores das semifinais e não depende da final; o pódio do site mostra campeão e vice pela final e o 3º lugar por essa disputa. Uma série salva antes, sem placar por jogo, mantém o valor e mostra o aviso "Série lançada sem placar por jogo" até os jogos serem preenchidos.
- **Equipes**: nomes e jogadores. Jogadores só aparecem no site quando preenchidos.
- Empates que pontos, saldo, gols marcados e confronto direto não resolvem aparecem no painel para definir a ordem do sorteio.

Validações: sem gols negativos, sem empate em partida ou jogo encerrado, o Jogo N só começa ou encerra depois do Jogo N-1 encerrado e nada é lançado depois que a série está decidida. Os dados ficam na aba **Torneio Placar** da planilha (ou `torneio.json` em `.site-data` no desenvolvimento). A tabela oficial dos jogos está em `backend/shared/rocket-tournament.js`; o teste `npm run test:torneio` confere a tabela, a classificação, as séries jogo a jogo e a API.

## Editar e publicar

### Uma área própria para cada botão

O menu do admin tem duas áreas de página, identificadas pelo nome e pelo ícone configurados para cada botão. Seus endereços diretos são `/admin?section=page-1` e `/admin?section=page-2`.

Cada área reúne:

- **Nome e ícone**: uma única fonte de nome para botão, título público, título no navegador e identificação no admin; escolha de ícones e visibilidade do atalho.
- **Conteúdo da página**: abertura, subtítulo, descrição, banner e seções ordenáveis com texto, imagem e botão de ação.
- **Aparência**: paleta da página correspondente.
- **Recursos da página**: os grupos, jogos, premiação, regulamento ou informações de inscrição já existentes, quando o formato com recursos está selecionado.

Escolha **Página livre** para usar qualquer assunto, sem formulários ou textos fixos dos formatos anteriores. O conteúdo livre também pode ser acrescentado aos formatos com recursos. Trocar de formato preserva os dados anteriores. Os identificadores internos e as rotas de pagamento continuam compatíveis com as inscrições existentes.

Os nomes dos banners de entrada vinculados às duas páginas também acompanham os botões. Textos autorais, imagens e PDFs devem ser editados quando o assunto mudar; renomear uma página não reescreve o conteúdo dessas imagens ou documentos.

A interface é organizada por tarefa. Em **Aparência**, selecione a página e ajuste as amostras de cor com uma prévia lateral. Os nomes das duas páginas de eventos acompanham automaticamente os textos configurados em **Barra de navegação**. Cada botão tem seu cartão com nome, destino e visibilidade.

Em **Loja e produtos**, busque e selecione um produto para editar seus detalhes. Os banners têm miniaturas e controles de ordem. A página do torneio tem abas para apresentação, inscrições, grupos, jogos, premiação e regulamento; os grupos oferecem edição direta dos nomes de equipes e jogadores. A data de encerramento das inscrições usa um seletor de data e hora de Brasília.

As seções também podem ser abertas diretamente, por exemplo `/admin?section=appearance`. O login continua obrigatório e, ao entrar, o painel abre em Placar do torneio.

Quando um deploy novo é publicado com o painel aberto, aparece o aviso "Há uma versão nova do painel publicada". Recarregue a página e entre de novo para usar a versão atual.

1. Entre em `/admin`.
2. Escolha uma seção e edite os campos. Listas possuem botões para adicionar, remover e ordenar quando isso é compatível com o cadastro.
3. Use **Prévia** e selecione a página. A prévia usa as alterações em memória e bloqueia compras e inscrições.
4. Clique em **Publicar alterações** para gravar no servidor. As próximas visitas carregam a configuração publicada, sem novo build.

Se outra sessão publicar enquanto você edita, o servidor recusa a revisão antiga. O editor mantém as alterações para conferência; descartar recarrega a versão atual. Fechar a página com alterações pendentes mostra a confirmação nativa do navegador.

A taxa de inscrição e o prazo do torneio são aplicados no backend. Os pagamentos já criados mantêm o valor registrado na inscrição, mesmo depois de alterar a taxa. Atualize também as menções em textos livres e o PDF do regulamento quando alterar regras ou valores.

## Persistência

Quando o Google Sheets do projeto está configurado, o painel usa duas abas exclusivas da mesma planilha:

- **Site Config**: configuração publicada, revisão e data da atualização. A escrita é feita numa única operação, com blocos de texto para respeitar o limite por célula.
- **Site Midia**: imagens enviadas, com conteúdo em blocos e identificadores aleatórios. As URLs são servidas pelo backend e não dependem do disco temporário do Render.

As mesmas credenciais já usadas pelo backend precisam de permissão de edição na planilha. Não é necessário criar um novo serviço. O armazenamento foi preparado para o backend de instância única do projeto; se adicionar múltiplas instâncias, substitua a fila local por um banco com transações antes de permitir edições concorrentes.

Sem Google Sheets, o desenvolvimento usa `backend/.site-data` (ou `.site-data` se iniciado pela raiz), ignorado pelo Git. Para usar disco em produção, defina `SITE_DATA_DIR` apontando para um volume persistente. Disco efêmero perde as publicações ao reiniciar; prefira a planilha já integrada ao projeto.

## Validação

```powershell
cd backend
npm run test:admin
```

O teste usa um diretório temporário e um servidor isolado, sem acessar a planilha ou os pagamentos reais. Verifica login, autorização, logout, bloqueio de login não configurado, limite de tentativas, persistência, conflito de revisão, rejeição de URLs inseguras, aplicação de preços e upload/leitura de imagens.
