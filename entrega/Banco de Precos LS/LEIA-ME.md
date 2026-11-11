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
- Cotações de fornecedores, sites e outros portais podem ser lançadas manualmente (art. 5º, III a V).

## Dados

Tudo fica em `data/pesquisa-precos.db` (SQLite) neste computador. Faça cópia de segurança desse arquivo.

## Requisitos

Node.js 22.13 ou superior (usa o SQLite nativo do Node). Sem outras dependências.

## Testes

`npm test` — 36 testes (cálculos, clientes das APIs, integração HTTP, login, segurança).

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
