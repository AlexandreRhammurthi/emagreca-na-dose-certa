# Relatório PDF pessoal V1 — análise e desenho

## Objetivo

Permitir exportação sob solicitação do titular para levar a consulta. O relatório é um resumo dos dados registrados pelo usuário, não laudo, prescrição ou avaliação clínica.

## Conteúdo selecionável

- período do relatório;
- aplicações: data, medicamento, apresentação, dose e quantidade calculada;
- locais confirmados, quando houver;
- peso e gráfico de evolução;
- medidas corporais, quando a Sprint Medidas estiver concluída;
- anotações livres e efeitos relatados, somente se o usuário marcar explicitamente essa opção.

## Anotações e efeitos relatados

Será criada uma etapa específica posterior para texto livre opcional vinculado a uma aplicação, com limite de 500 caracteres, RLS próprio e exclusão em cascade. Não haverá classificação automática, alerta médico, interpretação, compartilhamento ou envio a terceiro.

## Arquitetura recomendada

- Gerar o PDF no navegador após clique explícito, usando dados já autorizados pela sessão do usuário.
- A geração não envia o conteúdo a serviço externo, e-mail, Google ou médico.
- A biblioteca de PDF, se necessária, será empacotada localmente e revisada; não carregar script de CDN no momento da exportação.
- Exibir uma tela de revisão: período, seções incluídas e aviso de que o usuário decide compartilhar o arquivo.

## Segurança

- Não incluir tokens, IDs internos, e-mail, dados de autenticação ou dados de Google Agenda.
- Não gerar automaticamente e não armazenar cópia do PDF no Supabase na V1.
- O arquivo baixado passa a ser responsabilidade do dispositivo do usuário; a interface deixará isso claro antes do download.

## QA obrigatório

1. PDF com e sem registros em cada seção.
2. Dados e gráfico conferem com o histórico exibido na tela.
3. Campos não selecionados não aparecem no arquivo.
4. Notas e efeitos só entram após opt-in específico.
5. Mobile, desktop, acentuação, paginação e contraste legíveis.
6. Nenhuma requisição externa contendo dados do relatório durante a geração.

## Dependências

Depende das sprints de Rodízio, Duração do frasco e Medidas corporais para apresentar seus respectivos dados. Não requer migration própria para o arquivo, apenas a futura decisão sobre anotações/efeitos livres.
