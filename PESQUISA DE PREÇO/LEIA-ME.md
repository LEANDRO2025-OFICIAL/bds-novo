# Banco de Preços LS

Sistema local de pesquisa de preços em contratações públicas, com análise conforme a
**Lei 14.133/2021 (art. 23)** e a **IN SEGES/ME 65/2021 (arts. 5º e 6º)**.

## Como usar

1. Dê dois cliques em **`INICIAR.cmd`** (ou rode `npm start`). O navegador abre em http://localhost:5600.
2. Na primeira vez, o sistema baixa os catálogos oficiais (≈ 15 mil materiais e 3 mil serviços, ~15 s).
3. Crie uma **pesquisa** (objeto, processo, órgão) → adicione **itens** → em cada item:
   1. busque o material/serviço no catálogo oficial (nome genérico, ex.: "tinta impressora");
   2. busque os **preços praticados** (padrão: últimos 12 meses; filtre por UF e palavras-chave);
   3. selecione as compras compatíveis e adicione como **amostras**;
   4. escolha o **método** (média, mediana, menor ou automático) e, se quiser, um **critério objetivo**
      de exclusão; desconsidere manualmente o que não for compatível (com justificativa obrigatória).
4. Gere o **Mapa de preços** (imprimir/salvar PDF) ou **exporte CSV** (abre no Excel).

## Fontes

- **API de Dados Abertos do Compras.gov.br** — módulos Material, Serviço e Pesquisa de Preço
  (https://dadosabertos.compras.gov.br). Dados públicos, sem login.
- **PNCP** (https://pncp.gov.br) — itens de contratações de todas as esferas, buscados por palavras-chave.
- Cotações de fornecedores, sites e outros portais podem ser lançadas manualmente (art. 5º, III a V)
  ou importadas de planilha CSV (ver abaixo).

## Integração com portais de compras

O pedido foi integrar ComprasGov, PNCP, Portal de Compras Públicas, BLL, BNC, Licitanet e Licitar Digital.
O que existe de fato, sem exagero:

| Fonte | Como entra no sistema | Consulta direta? |
|---|---|---|
| Compras.gov.br | API de Dados Abertos (por código CATMAT/CATSER) | **Sim** |
| PNCP | APIs públicas do PNCP (por palavras-chave) | **Sim** |
| Portal de Compras Públicas | Pelo que o portal publica no PNCP | Não — via PNCP |
| BLL Compras | Pelo que o portal publica no PNCP | Não — via PNCP |
| BNC | Pelo que o portal publica no PNCP | Não — via PNCP |
| Licitanet | Pelo que o portal publica no PNCP | Não — via PNCP |
| Licitar Digital | Pelo que o portal publica no PNCP | Não — via PNCP |

**Integração direta** quer dizer que o sistema chama a API pública da fonte e normaliza a resposta:
só Compras.gov.br e PNCP. **Via PNCP** quer dizer que o sistema não fala com o portal; como a Lei
14.133/2021 (art. 174) obriga a publicação das contratações no PNCP, os preços dos portais privados
chegam pela consulta ao PNCP e são reconhecidos pelo **portal de origem**. Não há conector direto para
os portais privados: não há API pública documentada que tenha podido ser conferida, e o sistema não
raspa área logada nem contorna captcha ou termos de uso.

**Portal de origem.** Cada preço guarda o portal em que a contratação ocorreu (coluna na lista de
amostras e no resultado da consulta, filtro por portal, coluna no CSV e menção no anexo do mapa A4).
Para o PNCP, a classificação usa o link do sistema de origem (`linkSistemaOrigem`) e o nome de quem
publicou (`usuarioNome`) da contratação, comparados com a tabela de domínios e nomes em
`server/portal-origem.mjs` — um único lugar, fácil de editar. Sem pista reconhecida, o preço fica como
**"PNCP — origem não identificada"**. Amostras gravadas antes desta versão foram classificadas pela fonte
e pelo link guardados (as do PNCP ficam "não identificadas": o sistema de origem não era guardado).

**Cobertura.** A tela do item, a da pesquisa e o resultado de cada consulta mostram quantas amostras
vieram de cada portal (inclusive os zeros) e quantas não têm origem identificável. É a medida honesta de
quanto dos portais privados está de fato coberto. O mapa A4 traz a mesma contagem.

**Contrato de fonte.** `server/fontes.mjs` define a interface única (buscar por código/descrição →
amostras normalizadas com portal de origem) e o registro das sete fontes, com o estado de cada uma
(também em `GET /api/fontes` e no quadro "Fontes e portais" da tela do item).

### O que NÃO foi verificado contra as APIs reais

O ambiente em que esta parte foi desenvolvida não alcançava pncp.gov.br, compras.gov.br nem os portais
privados (bloqueio de rede). Portanto:

- A chamada que lê `linkSistemaOrigem`/`usuarioNome`
  (`/api/consulta/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}`) segue o contrato publicado do PNCP, mas
  **não foi conferida ao vivo**. Ela é opcional: se falhar ou vier sem esses campos, o preço entra igual,
  como "origem não identificada". Os testes usam valores ilustrativos, não respostas capturadas.
- **Os domínios e nomes da tabela de portais não foram conferidos** contra o que o PNCP de fato devolve.
  Se a cobertura mostrar muitas amostras "não identificadas", abra algumas no PNCP, veja o link do sistema
  de origem e acrescente o domínio em `server/portal-origem.mjs`.
- Nenhuma API dos portais privados foi consultada. Busca, itens e resultados do PNCP e a API do
  Compras.gov.br foram conferidos ao vivo em outubro de 2026, em versões anteriores.

### Importar planilha CSV (rota de fuga)

Para preços que você exportou de qualquer portal (inclusive dos privados), na tela do item abra
**"Importar planilha CSV de preços"**:

1. Escolha o arquivo e o **portal de origem** dos preços.
2. Clique em **Conferir arquivo**: nada é gravado; aparece o relatório com as colunas reconhecidas, as
   linhas válidas e cada linha com erro (número da linha do arquivo e o motivo).
3. Clique em **Importar linhas válidas**. Linhas com erro nunca entram. Reimportar o mesmo arquivo não
   duplica amostras.

Formato: primeira linha com os nomes das colunas; obrigatória **Preço unitário** (ou "Valor unitário");
reconhecidas também Data, Órgão, UF, Município, Fornecedor, CNPJ/CPF, Marca, Descrição, Unidade,
Quantidade, Link, Objeto e Portal de origem (que, se preenchida, vale para a linha). Separador `;`, `,`
ou tabulação; decimais com vírgula ("R$ 1.234,56"); datas DD/MM/AAAA; UTF-8 ou o padrão do Excel em
português. Planilhas `.xlsx` devem ser salvas antes como CSV. Máximo de 1.000 linhas e cerca de 900 kB por
arquivo. O CSV exportado por este próprio sistema também pode ser reimportado (as linhas RESUMO são puladas).
Os cabeçalhos aceitos ficam em `server/importacao.mjs` (constante `COLUNAS`).

## Inicialização e portas

| Como inicia | Porta | Login | Para quê |
| --- | --- | --- | --- |
| `INICIAR.cmd` ou `npm start` | **5600** | desligado | uso local, só neste computador (`127.0.0.1`) |
| `PUBLICAR.cmd` / `SERVIDOR-PUBLICADO.cmd` | **5601** | obrigatório (`usuarios.txt`) | acesso da equipe pelo Tailscale Funnel |
| Render | definida pelo Render (`PORT`) | obrigatório (`USUARIOS`) | hospedagem na nuvem |

- As duas portas podem ficar ligadas ao mesmo tempo e usam o mesmo banco de dados.
- O `INICIAR.cmd` confere a porta antes de subir: se o sistema já estiver aberto, só abre o navegador;
  se a porta estiver com outro programa, avisa e não inicia nada. Para usar outra porta:
  `set PORT=5700` antes de chamar o `INICIAR.cmd` (ou `PORT=5700 npm start` no Linux/macOS).
- Sem login configurado, o servidor só atende o próprio computador e recusa pedidos vindos de túnel/proxy.
- Para encerrar, feche a janela do servidor (ou Ctrl+C).

## Dados, backup e restauração

Tudo fica em `data/pesquisa-precos.db` (SQLite) neste computador. A pasta `data/` não vai para o Git.

**Backup automático.** O sistema grava uma cópia íntegra em `data/backups/pesquisa-precos-AAAAMMDD-HHMMSS.db`
antes de gerar o mapa, exportar CSV, excluir pesquisa e excluir itens em lote (no máximo uma cópia por minuto).
Nas exclusões, se a cópia falhar, nada é apagado. Ficam guardadas as 20 cópias mais recentes
(`BACKUP_RETENCAO`). O rodapé da tela mostra o último backup e tem o botão **Fazer backup agora**.

**Cópia externa.** As cópias automáticas ficam no mesmo disco; copie de tempos em tempos um arquivo de
`data/backups/` para pendrive, rede ou nuvem (ou aponte `BACKUP_DIR` para uma pasta sincronizada).
Não copie o `pesquisa-precos.db` "cru" com o sistema aberto: use os arquivos de `data/backups/`.

**Restaurar.**

1. Feche o servidor (janela do `INICIAR.cmd` e, se houver, o publicado na porta 5601).
2. Em `data/`, renomeie o `pesquisa-precos.db` atual (ex.: `pesquisa-precos-antigo.db`) e apague, se
   existirem, `pesquisa-precos.db-wal` e `pesquisa-precos.db-shm`.
3. Copie o backup escolhido de `data/backups/` para `data/` e renomeie para `pesquisa-precos.db`.
4. Abra o `INICIAR.cmd` e confira as pesquisas.

## Variáveis de ambiente

Todas são opcionais no uso local. O arquivo `.env.example` traz a lista comentada; o servidor **não** lê
`.env` sozinho — defina as variáveis no sistema, no painel do Render ou rode
`node --env-file=.env server/server.mjs`.

| Variável | Padrão | Função |
| --- | --- | --- |
| `PORT` | `5600` | porta HTTP |
| `HOST` | `127.0.0.1` | interface de rede (`0.0.0.0` no Render) |
| `DB_PATH` | `data/pesquisa-precos.db` | arquivo do banco SQLite |
| `BACKUP_DIR` | pasta `backups` ao lado do banco | onde gravar os backups |
| `BACKUP_RETENCAO` | `20` | quantos backups manter |
| `USUARIOS` | vazio | equipe: `nome:senha;outro:senha` (8+ caracteres); liga o login |
| `USUARIOS_ARQUIVO` | vazio | arquivo com `nome:senha` por linha (usado pelo `PUBLICAR.cmd`) |
| `FUSO_HORARIO` | fuso do computador | fuso da data de emissão do mapa (ex.: `America/Campo_Grande`) |
| `ABRIR_NAVEGADOR` | vazio | `1` abre o navegador quando o servidor fica pronto |
| `CACHE_TTL_HORAS` | `24` | validade do cache das consultas às APIs |
| `CACHE_RETENCAO_DIAS` | `30` | limpeza do cache antigo |
| `API_TENTATIVAS` | `4` | tentativas por consulta às APIs oficiais |
| `API_TIMEOUT_MS` | `45000` | tempo limite de cada tentativa |
| `API_ESPERA_BASE_MS` | `800` | espera inicial entre tentativas (cresce a cada nova tentativa) |

## Requisitos

Node.js 22.13 ou superior (usa o SQLite nativo do Node). Sem outras dependências.

## Testes

`npm test` — 171 testes (estatística e exclusão de discrepantes, clientes das APIs, portal de origem,
contrato de fontes, importação de CSV, integração HTTP, backup, CSV, mapa, inicialização, login e segurança).

## Publicar grátis a partir deste computador (Tailscale Funnel)

Gera um link fixo `https://<computador>.<rede>.ts.net` enquanto este computador estiver ligado.

1. Instale o Tailscale (https://tailscale.com/download/windows) e entre com sua conta Google ou GitHub.
2. Dê dois cliques em **`PUBLICAR.cmd`**. Na primeira vez ele abre o `usuarios.txt`: cadastre a
   equipe, um por linha, `nome:senha` (8+ caracteres). Esse arquivo fica só neste computador.
3. Rode `PUBLICAR.cmd` de novo. Se o Tailscale pedir para ativar o Funnel, abra o link que ele mostrar
   e confirme. O endereço público aparece na janela.
4. Para tirar do ar, feche a janela. O uso local (`INICIAR.cmd`) segue funcionando sem login, e o
   servidor recusa qualquer acesso vindo de túnel quando o login está desligado.

### Ligar sozinho com o Windows

- A tarefa agendada **"Banco de Precos LS"** roda `iniciar-oculto.vbs` 30 s após o logon, que sobe
  `SERVIDOR-PUBLICADO.cmd` sem janela (porta 5601, login obrigatório; log em `%TEMP%\banco-precos-publicado.log`).
- O Funnel fica fixo no Tailscale: `tailscale funnel --bg --https=443 5601` → `https://<computador>.<rede>.ts.net/`.
- Tirar do ar: `tailscale funnel --https=443 off`. Desligar o início automático:
  `Unregister-ScheduledTask -TaskName "Banco de Precos LS"` (PowerShell).
- O computador não pode hibernar/suspender; senão o link cai até ele acordar.

## Publicar na internet (Render)

O arquivo `render.yaml` já descreve o serviço. Publicado, o sistema **exige login**; sem a variável
`USUARIOS` ele se recusa a iniciar.

1. Crie conta em https://render.com e conecte sua conta do GitHub.
2. **New → Blueprint** → escolha o repositório `banco-de-precos-ls`.
3. Quando pedir `USUARIOS`, informe a equipe no formato `nome:senha;outro:senha`
   (senhas com 8+ caracteres). Para incluir/remover alguém, edite essa variável em
   **Environment** e salve — o serviço reinicia e todos fazem login de novo.
4. Confirme. Em ~3 minutos o endereço `https://banco-de-precos-ls.onrender.com` (ou parecido) fica no ar.
   O catálogo oficial é baixado sozinho na primeira inicialização.

Custo: plano Starter (≈ US$ 7/mês) + disco de 1 GB (≈ US$ 0,25/mês). Os dados ficam no disco
`/var/data`; o Render faz snapshot diário dele.

O `render.yaml` já define `FUSO_HORARIO=America/Campo_Grande` (o servidor do Render roda em UTC); ajuste
se o órgão estiver em outro fuso, senão a data de emissão do mapa sai com o horário errado.

## Checklist de deploy

Antes de publicar (Tailscale ou Render):

- [ ] `npm test` passa.
- [ ] Node 22.13+ no computador/servidor (`node -v`).
- [ ] Usuários cadastrados com senha de 8+ caracteres (`usuarios.txt` ou variável `USUARIOS`);
      nada disso no Git.
- [ ] `DB_PATH` aponta para disco persistente (no Render: `/var/data/pesquisa-precos.db`).
- [ ] Backup recente copiado para fora do computador.

Depois de publicar:

- [ ] O endereço abre a tela de login e uma janela anônima **não** entra sem senha.
- [ ] O selo do catálogo no topo mostra o catálogo carregado (ou use **Baixar catálogo**).
- [ ] Uma busca real de preços devolve resultados do Compras.gov.br e do PNCP.
- [ ] Gerar o mapa de uma pesquisa e salvar em PDF (A4 paisagem, cabeçalho, rodapé e numeração).
- [ ] Exportar CSV e abrir no Excel (acentos corretos).
- [ ] O rodapé mostra o backup criado por essas operações.
- [ ] Tailscale: o computador não suspende/hiberna e a tarefa agendada sobe o servidor após reiniciar.
