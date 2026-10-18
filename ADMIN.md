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
- Torneio: nome, banner, textos, abas, valor e prazo das inscrições, premiação, regulamento da página, URL de um novo PDF, grupos, equipes, jogadores, horários, confrontos e vagas do chaveamento.
- Eventos: textos, banners, datas e horários exibidos, local e cardápio. Esses campos de apresentação não alteram os prazos e preços de cobrança dos churrascos, que continuam em `shared/churrasco-eventos.js`.

Os dados de apresentação e regras publicados estão em uma configuração compartilhada. Os valores iniciais ficam em `backend/shared/site-defaults.js`. Não há edição de credenciais de pagamento, chaves privadas, código JavaScript ou regras de autenticação pelo painel.

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

As seções também podem ser abertas diretamente, por exemplo `/admin?section=appearance`. O login continua obrigatório.

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
