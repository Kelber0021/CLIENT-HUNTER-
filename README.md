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
- Mapa interativo com estabelecimentos públicos do OpenStreetMap.
- Lista compacta com imagem pública do local quando cadastrada no OpenStreetMap ou Wikimedia Commons.
- Ficha do local com telefone, site, horário, fonte e link de verificação no Google Maps.
- Lista com etapa de negociação, observações e exportação CSV. Em produção, os dados ficam no PostgreSQL do Render em um perfil anônimo associado a este navegador.

## Fontes e limites dos dados

A localização é resolvida pelo Nominatim. A busca principal de estabelecimentos utiliza a API pública do Overpass. Serviços públicos podem ficar lentos ou indisponíveis. Nesse caso, a aplicação consulta uma **amostra de pontos distribuídos pelo raio selecionado**, com aviso explícito na tela. A amostra não garante cobertura de toda a área. O mapa ajusta o enquadramento ao raio pedido.

O percentual exibido nas fichas mede somente a **completude dos campos públicos** (telefone, site, horário e endereço). Não é uma nota de qualidade, popularidade ou chance de compra. Visualizações e movimento do Google Maps não são fornecidos pela busca. Avaliações aparecem apenas na lista Google Places quando a integração estiver configurada; o link na ficha do OpenStreetMap permite conferência manual.

A lista indica claramente quando a avaliação por estrelas não está disponível. Nenhuma nota é simulada. Imagens aparecem somente quando o cadastro público do estabelecimento fornece uma URL compatível.

Sem banco configurado, os dados de prospecção ficam no `localStorage` deste navegador. Com PostgreSQL, cada navegador recebe um perfil anônimo separado, identificado por cookie seguro. A lista não é sincronizada entre dispositivos nesta etapa. A preferência visual continua local. Limpar os cookies perde o acesso a esse perfil anônimo; contas individuais e recuperação de acesso ficam para a próxima etapa.

Para uso comercial em escala, configure um provedor de dados com contrato e limites adequados e cache. As instâncias públicas do Overpass são voltadas a uso moderado.

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
