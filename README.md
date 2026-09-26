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
- Lista salva no navegador, com etapa de negociação, observações e exportação CSV.

## Fontes e limites dos dados

A localização é resolvida pelo Nominatim. A busca principal de estabelecimentos utiliza a API pública do Overpass. Serviços públicos podem ficar lentos ou indisponíveis. Nesse caso, a aplicação usa a API principal do OpenStreetMap para obter **uma amostra central** da área, com aviso explícito na tela. Essa amostra não cobre todo o raio selecionado.

O percentual exibido nas fichas mede somente a **completude dos campos públicos** (telefone, site, horário e endereço). Não é uma nota de qualidade, popularidade ou chance de compra. Visualizações, avaliações e movimento do Google Maps não estão disponíveis sem integração autorizada com a API do Google; o link na ficha permite conferência manual.

A lista indica claramente quando a avaliação por estrelas não está disponível. Nenhuma nota é simulada. Imagens aparecem somente quando o cadastro público do estabelecimento fornece uma URL compatível.

Dados de prospecção e preferência visual ficam no `localStorage` deste navegador. Não há conta de usuário ou sincronização entre dispositivos nesta versão.

Para uso comercial em escala, configure um provedor de dados com contrato e limites adequados, cache e backend persistente. As instâncias públicas do Overpass são voltadas a uso moderado.

## Próxima personalização

Definir o que a empresa vende, território principal e perfil de comprador ideal. Com isso, os filtros e a priorização podem passar a refletir sinais reais de aderência comercial.
