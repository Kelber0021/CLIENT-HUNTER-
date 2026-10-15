# Client Hunter

Aplicação de prospecção territorial para encontrar estabelecimentos, investigar sinais públicos de presença digital e organizar oportunidades comerciais.

## Rodar no computador

```bash
npm install
npm run dev
```

Abra `http://localhost:5173`. Para verificar a compilação: `npm run build`.

## O que já funciona

- Páginas de visão geral, exploração territorial e lista de prospecção.
- Modos claro e escuro, com preferência salva no navegador.
- Busca por localização, segmento e raio de 1 a 15 km.
- Botão **Usar minha localização**, que solicita a permissão do navegador apenas quando acionado; também é possível pesquisar qualquer cidade, bairro ou endereço manualmente.
- Mapa interativo com estabelecimentos públicos do OpenStreetMap, colorido por segmento. Grupos de locais mostram, no anel, a mistura de segmentos daquele ponto.
- Resultados chegam aos poucos durante a busca (radar no mapa, contagem ao vivo e botão para parar). Ao arrastar o mapa, **Buscar nesta área** refaz a busca no novo ponto.
- Filtros por segmento (com contagem), por texto e ordenação; a lista carrega em lotes de 60 para não travar com milhares de locais.
- Lista compacta com imagem pública do local quando cadastrada no OpenStreetMap ou Wikimedia Commons, e os canais de contato disponíveis.
- Ficha do local com telefone, WhatsApp, Instagram, site, e-mail, horário, fonte e link de verificação no Google Maps. O WhatsApp só aparece quando o cadastro informa ou quando o telefone é de celular brasileiro.
- Lista com etapa de negociação, observações e exportação CSV. Em produção, os dados ficam no PostgreSQL do Render em um perfil anônimo associado a este navegador.

Animações: entrada da visão geral e contadores com GSAP (`src/motion.tsx`); o restante usa CSS (`src/refresh.css`). Quem prefere menos movimento no sistema recebe a interface sem animações.

Produzido pela [Binary Labs](https://binary-labs.onrender.com).

## Fontes e limites dos dados

A busca de endereços passa pelo servidor (`/api/geocode`), que consulta o Nominatim respeitando a política de uso: no máximo uma requisição por segundo para todo o site e cache de 24 horas por termo.

Os estabelecimentos vêm do OpenStreetMap e são consultados **pelo servidor** (`/api/places`) na API Overpass. O mapa do mundo é dividido em blocos fixos de 0,05° (cerca de 5,5 km). Cada bloco é baixado uma vez, com todos os segmentos, e fica em cache por **7 dias** (memória e, em produção, PostgreSQL). Buscas repetidas ou vizinhas reaproveitam os blocos e respondem em menos de um segundo. Blocos novos levam de 30 s a 2 min, porque os servidores públicos do Overpass costumam estar sobrecarregados. Os resultados chegam aos poucos, bloco a bloco.

Quando um espelho do Overpass recusa ou falha, o servidor passa para outro (overpass-api.de, lz4, z, private.coffee, kumi). Se todos estiverem ocupados, ele espera com intervalos crescentes (2, 4, 8 e 16 s). Áreas que estouram o tempo limite são divididas em partes menores. Respostas com erro de execução do Overpass nunca são tratadas como completas. No máximo duas consultas ao Overpass rodam ao mesmo tempo para todo o site, e uma consulta em andamento é compartilhada entre visitantes que pedem a mesma área.

A cobertura é a do próprio OpenStreetMap: locais com nome marcados como comércio, alimentação, saúde (inclusive `healthcare=*`), beleza, academias, hospedagem, automotivo (postos, lava-jatos, oficinas), cursos livres, escritórios, bancos e ofícios (`craft`). Negócios não cadastrados no OSM não aparecem. A data da base usada é informada em `dataTimestamp`.

Somente quando nenhum bloco pode ser carregado (espelhos indisponíveis por cerca de 4 minutos e nada em cache) o servidor recorre a uma **amostra de pontos** da API do OpenStreetMap, marcada como parcial (`sampled: true`). A amostra não cobre todo o raio.

O percentual exibido nas fichas mede somente a **completude dos campos públicos** (telefone, site, horário e endereço). Não é uma nota de qualidade, popularidade ou chance de compra. Visualizações e movimento do Google Maps não são fornecidos pela busca. Avaliações aparecem apenas na lista Google Places quando a integração estiver configurada; o link na ficha do OpenStreetMap permite conferência manual.

Nenhuma nota por estrelas é simulada: avaliações só aparecem na lista do Google Places. Imagens aparecem somente quando o cadastro público do estabelecimento fornece uma URL compatível.

Sem banco configurado, os dados de prospecção ficam no `localStorage` deste navegador. Com PostgreSQL, cada navegador recebe um perfil anônimo separado, identificado por cookie seguro válido por 365 dias e renovado a cada visita. A lista não é sincronizada entre dispositivos nesta etapa. A preferência visual continua local. Limpar os cookies perde o acesso a esse perfil anônimo; contas individuais e recuperação de acesso ficam para a próxima etapa.

Para uso comercial em escala, use uma instância própria do Overpass (variável `OVERPASS_URLS`) ou um provedor de dados com contrato. As instâncias públicas são voltadas a uso moderado.

## API do servidor

- `GET /api/places?lat=-3.73&lon=-38.53&radius=3&category=all`: raio inteiro em km (1 a 15); `category` é `all`, `restaurant`, `cafe`, `beauty`, `health`, `fitness`, `hotel`, `auto`, `education`, `office` ou `shop`. A resposta é NDJSON (um JSON por linha, com gzip quando aceito), nesta ordem: `start` (`tiles`, `cached`), lotes `leads` (já filtrados por segmento e distância, sem repetição; `from` = `cache`, `overpass` ou `sample`), mensagens `status` para o usuário e, por fim, uma linha `done` (`count`, `complete`, `sampled`, `elapsedMs`, `dataTimestamp`) ou `error`. Parâmetros inválidos retornam 400; mais de 12 buscas por minuto por visitante, 429.
- Cada local traz `id`, `name`, `category`, `categoryKey`, `address`, `city`, `lat`, `lon`, contatos quando existem (`phone`, `website`, `email`, `instagram`, `whatsapp`, `facebook`, `openingHours`), `osmUrl`, `source` e um subconjunto de `tags`.
- `GET /api/geocode?q=Aldeota, Fortaleza`: até 5 resultados `{ lat, lon, label, type }`. Retorna 400 se `q` tiver menos de 2 ou mais de 200 caracteres e 502 se o Nominatim falhar.
- `GET /api/health`: estado do servidor, do banco e do cache de blocos.
- `/api/session` e `/api/leads`: perfil anônimo e lista de oportunidades (exigem PostgreSQL). Ao salvar, o servidor guarda apenas os campos conhecidos do local.
- `GET /api/osm-sample`: amostra antiga, mantida por compatibilidade.

`OVERPASS_URLS` (opcional, separada por vírgulas) substitui a lista de espelhos do Overpass. A tabela `osm_tile_cache` é criada quando o servidor inicia, e linhas com mais de 30 dias são apagadas a cada início. Em `npm run dev`, as mesmas rotas funcionam com cache só em memória.

## Publicar no Render

### Fonte opcional Google Places

Defina `GOOGLE_MAPS_API_KEY` como variável secreta no serviço web do Render (ou no ambiente local antes de iniciar o servidor). Habilite a Places API (New) e o faturamento no projeto Google Cloud. A chave fica somente no servidor; nunca use o prefixo `VITE_` para ela. Restrinja a chave à Places API no Google Cloud e defina cotas e alertas de faturamento. Para exibir os resultados em um mapa Google dentro do site, habilite também a Maps JavaScript API e configure **outra chave**, `VITE_GOOGLE_MAPS_BROWSER_KEY`, restrita aos domínios do site por referenciador HTTP e à Maps JavaScript API. Essa segunda chave é incluída no código público do navegador e precisa dessas restrições. Sem as chaves, o app continua com a busca OpenStreetMap; com apenas a chave do servidor, os resultados Google aparecem em uma lista com links para o Google Maps.

`GET /api/google-places/status` informa `{ available, source, maxResultsPerSearch }` sem revelar a chave. `GET /api/google-places?lat=-2.53&lng=-44.30&radius=5000&segment=restaurant` faz uma busca Nearby Search (New), com raio **em metros** (100–15000) e segmento `all`, `restaurant`, `cafe`, `shop`, `beauty`, `health`, `fitness`, `hotel` ou `office`. A resposta traz até 20 itens por consulta com `{ id, name, category, address, lat, lon, rating, userRatingCount, googleMapsUrl, source }` e `coverage.partial: true`. O servidor limita chamadas a 4 por minuto por visitante, 30 por minuto e 300 por dia por instância; configure também cotas no Google Cloud porque reinícios e múltiplas instâncias reiniciam esses contadores.

O conteúdo Google é exibido numa lista separada e, quando configurado, no mapa Google. Não deve ser salvo no banco, exportado como oportunidade nem colocado no mapa OpenStreetMap. O `place_id` é a exceção de armazenamento nas políticas do Google. O site precisa exibir a atribuição Google e oferecer Termos de Uso e Política de Privacidade públicos antes de ativar comercialmente a integração. Fotos exigem tratamento adicional de atribuições e não são solicitadas nesta versão. Nearby Search retorna no máximo 20 locais por chamada, portanto não representa todos os negócios do raio.

Documentação oficial: [Nearby Search (New)](https://developers.google.com/maps/documentation/places/web-service/nearby-search), [políticas e atribuições](https://developers.google.com/maps/documentation/places/web-service/policies), [tipos de local](https://developers.google.com/maps/documentation/places/web-service/place-types).

O arquivo `render.yaml` define um serviço web Node e um banco PostgreSQL. No painel do Render, crie um Blueprint conectado a este repositório. `SESSION_SECRET` é gerado pelo Render e `DATABASE_URL` é associado ao banco. O servidor cria a tabela de oportunidades no primeiro início.

O plano gratuito do PostgreSQL do Render expira após 30 dias. Antes desse prazo, escolha um plano persistente ou exporte os dados. O serviço web gratuito pode adormecer quando fica sem tráfego.

Para testar o servidor localmente após `npm run build`, execute `npm start`. Sem `DATABASE_URL`, a lista usa armazenamento local no navegador.

## Próxima personalização

Definir o que a empresa vende, território principal e perfil de comprador ideal. Com isso, os filtros e a priorização podem passar a refletir sinais reais de aderência comercial.
