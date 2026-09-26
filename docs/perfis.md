# Perfis e acesso comercial

## Nesta versão

Cada navegador recebe um identificador anônimo em cookie seguro. As oportunidades ficam no PostgreSQL vinculadas a esse identificador. Não há cadastro, senha, cobrança nem sincronização entre dispositivos. Se os cookies forem apagados, o usuário perde o acesso ao perfil anônimo anterior.

## Próxima etapa: contas individuais

1. Criar tabelas `accounts` e `users`, com papel de proprietário e membro. Uma conta representa um cliente pagante; cada usuário pertence a uma conta.
2. Autenticar usuários por um provedor gerenciado ou por credenciais com verificação de e-mail e recuperação de acesso. Não usar uma senha única compartilhada.
3. Trocar o escopo da lista de `profile_id` para `account_id`. Todas as consultas e alterações devem filtrar o identificador da conta no servidor.
4. Depois de entrar, oferecer **vincular este navegador** para mover as oportunidades anônimas para a conta. A migração deve ser transacional e impedir que um perfil seja reivindicado duas vezes.
5. Definir limites e planos no servidor antes de ativar cobrança. O estado da assinatura deve vir de eventos verificados do provedor de pagamento.
6. Adicionar exportação, exclusão da conta, histórico mínimo de alterações e política de retenção antes de vender acesso.

O cookie anônimo desta versão não deve ser tratado como identidade permanente de cliente. O esquema de oportunidades já separa os dados por perfil para permitir a migração posterior.
