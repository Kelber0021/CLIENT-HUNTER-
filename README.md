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
- Lista com etapa de negociação, observações e exportação CSV. Em produção, os dados ficam no PostgreSQL do Render e são acessados com senha.

## Fontes e limites dos dados

A localização é resolvida pelo Nominatim. A busca principal de estabelecimentos utiliza a API pública do Overpass. Serviços públicos podem ficar lentos ou indisponíveis. Nesse caso, a aplicação consulta uma **amostra de pontos distribuídos pelo raio selecionado**, com aviso explícito na tela. A amostra não garante cobertura de toda a área. O mapa ajusta o enquadramento ao raio pedido.

O percentual exibido nas fichas mede somente a **completude dos campos públicos** (telefone, site, horário e endereço). Não é uma nota de qualidade, popularidade ou chance de compra. Visualizações, avaliações e movimento do Google Maps não estão disponíveis sem integração autorizada com a API do Google; o link na ficha permite conferência manual.

A lista indica claramente quando a avaliação por estrelas não está disponível. Nenhuma nota é simulada. Imagens aparecem somente quando o cadastro público do estabelecimento fornece uma URL compatível.

Sem banco configurado, os dados de prospecção ficam no `localStorage` deste navegador. Com PostgreSQL e senha configurados, a lista é sincronizada entre dispositivos. A preferência visual continua local.

Para uso comercial em escala, configure um provedor de dados com contrato e limites adequados e cache. As instâncias públicas do Overpass são voltadas a uso moderado.

## Publicar no Render

O arquivo `render.yaml` define um serviço web Node e um banco PostgreSQL. No painel do Render, crie um Blueprint conectado a este repositório. Defina `APP_PASSWORD` como uma senha forte quando o Render solicitar. `SESSION_SECRET` é gerado pelo Render e `DATABASE_URL` é associado ao banco. O servidor cria a tabela de oportunidades no primeiro início.

O plano gratuito do PostgreSQL do Render expira após 30 dias. Antes desse prazo, escolha um plano persistente ou exporte os dados. O serviço web gratuito pode adormecer quando fica sem tráfego.

Para testar o servidor localmente após `npm run build`, execute `npm start`. Sem `DATABASE_URL`, a lista usa armazenamento local no navegador.

## Próxima personalização

Definir o que a empresa vende, território principal e perfil de comprador ideal. Com isso, os filtros e a priorização podem passar a refletir sinais reais de aderência comercial.
