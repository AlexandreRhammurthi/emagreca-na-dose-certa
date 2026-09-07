# Peso V1 — Etapa 1: análise e desenho

Data da análise: 2026-08-08

## A. Estado atual

O projeto é uma aplicação estática em HTML, CSS e JavaScript. A raiz é a fonte de verdade; `public/` é um artefato recriado por `npm run build` e publicado no Cloudflare.

Existe um único cliente Supabase no browser, criado em `js/supabase-config.js` com URL e Publishable Key. Auth e Diário reutilizam esse cliente. A sessão é acompanhada pelo SDK; no logout ou na troca de usuário, o Diário limpa registros, pesos associados e modais do DOM.

O Diário realiza CRUD em `applications` e já integra opcionalmente um peso em `weight_records`. Os testes RLS reais registram aprovação integral para ambas as tabelas: operações próprias permitidas e operações cruzadas bloqueadas para SELECT, SELECT por UUID, INSERT, UPDATE e DELETE.

Esta etapa não alterou aplicação, Supabase, schema, RLS, build ou configuração. O único arquivo criado é este relatório.

## B. Schema confirmado

### `public.weight_records`

| Coluna | Evidência confirmada | Obrigatoriedade/constraint comprovada |
|---|---|---|
| `id` | Identificador retornado pelos INSERTs e usado em SELECT/UPDATE/DELETE exatos; os testes usam UUIDs | Unicidade operacional confirmada; definição formal de PK não está versionada |
| `user_id` | UUID da sessão Supabase usado para ownership | Necessário nos INSERTs validados; FK formal e ação referencial não estão documentadas localmente |
| `record_date` | Data civil enviada como `YYYY-MM-DD` | `NOT NULL` confirmado por erro PostgreSQL `23502` em execução anterior; tipo operacional DATE confirmado |
| `weight_kg` | Valor numérico aceito nos testes e no fluxo atual | Necessário nos INSERTs validados; tipo numeric confirmado operacionalmente; precisão, escala e CHECK de faixa não estão documentados |
| `notes` | Texto aceito e usado como marcador técnico | Presente nos payloads mínimos validados; tipo textual operacional; nulabilidade e limite não estão comprovados pelo DDL |
| `created_at` | Disponível para leitura e ordenação | Tipo, default e nulabilidade não documentados localmente |
| `updated_at` | Coluna existente | Tipo, default, trigger e nulabilidade não documentados localmente |

Não existe migration ou `CREATE TABLE` no repositório. Portanto, não é possível afirmar com segurança detalhes de PK, FK, precisão numeric, defaults ou todos os CHECKs além do que foi exercitado. A lista `requiredInsert` do teste confirma o payload usado com sucesso, mas não substitui o DDL para provar todas as constraints.

### `public.applications`

É a tabela de aplicações realizadas. O Diário usa `id`, `user_id`, `application_date`, `medicine`, `vial_mg`, `vial_ml`, `dose_mg`, `volume_ml`, `units`, `syringe_capacity`, `source`, `calculation_version`, `notes`, `created_at` e `updated_at`. Peso não é armazenado nela.

## C. Como o peso funciona hoje

### Criação junto à aplicação

Depois que o INSERT em `applications` retorna com sucesso, um peso opcional gera outro INSERT em `weight_records`:

```text
user_id    = UUID obtido da sessão
record_date = application_date
weight_kg   = número convertido da entrada pt-BR
notes       = "Peso registrado junto à aplicação"
```

Campo vazio não cria peso. A interface aceita vírgula ou ponto e rejeita zero, negativo e texto.

### Associação temporária

O vínculo V1 não é uma relação de banco. O Diário procura:

```text
record_date = application.application_date
notes = "Peso registrado junto à aplicação"
ORDER BY created_at DESC
LIMIT 1
```

A RLS limita a consulta ao usuário autenticado. O UUID encontrado fica somente em memória.

### Detalhes e edição

- Detalhes consultam o peso associado e mostram o valor ou “Não informado”.
- Edição repete a consulta e preenche o input em formato brasileiro.
- Alterar peso atualiza o `weight_record` pelo UUID encontrado.
- Alterar a data da aplicação atualiza também `record_date`.
- Apagar o peso exclui somente o UUID associado.
- Informar peso sem associação anterior cria novo registro.

### Limpeza de sessão

Os mapas de aplicações e pesos associados são apagados no recarregamento do histórico, logout e troca de usuário. Uma busca iniciada por um usuário não reabre modal depois que a sessão muda.

## D. Limitações atuais

1. Data + texto não formam uma chave única.
2. Duas aplicações no mesmo dia podem resolver para o mesmo peso mais recente.
3. Mais de um peso marcado no mesmo dia torna os registros anteriores inacessíveis pelo vínculo do Diário.
4. Alterar ou reutilizar exatamente o texto marcador quebra ou cria associações acidentais.
5. `notes` mistura conteúdo do usuário com metadado técnico de origem.
6. Não existe transação única entre INSERT/UPDATE de aplicação e peso; pode ocorrer sucesso parcial.
7. Excluir uma aplicação não implica excluir o peso, pois não há FK comprovada.
8. O Diário consulta peso sob demanda; ainda não existe histórico independente.
9. A ausência do DDL versionado dificulta confirmar constraints e planejar migrations reproduzíveis.

## E. Arquitetura proposta

### Escopo mínimo sem alteração de schema

Criar uma área autenticada “Meu Peso” usando o mesmo `window.supabaseClient`:

- SELECT inicial limitado, ordenado por `record_date DESC` e `created_at DESC`.
- INSERT manual com `user_id` obtido pelo SDK, data civil, peso numérico e observação.
- UPDATE por `id`, solicitando o registro retornado.
- DELETE por `id` após confirmação.
- Estados loading, vazio, sucesso e erro.
- Cache em memória limpo em logout/troca de usuário.

Arquiteturalmente, recomenda-se um módulo separado `js/weight.js`. Ele deve compartilhar helpers de data/formatação quando útil, mas não depender de detalhes internos do formulário de aplicações.

### Origem sem schema novo

- Registro junto à aplicação: `notes` exatamente igual ao marcador reservado.
- Registro manual: qualquer observação diferente do marcador; vazio deve ser enviado como string vazia se a constraint real exigir `notes`.
- A UI deve impedir que uma observação manual seja exatamente igual ao marcador reservado.
- A lista deriva um badge “Junto à aplicação” somente desse valor exato; os demais são “Manual”.

Essa solução é compatível com o schema atual, mas continua sendo uma convenção frágil.

## F. UX proposta

### Meu Peso

- Título “Meu Peso”.
- Botão primário “Registrar peso”.
- Lista mobile first com data, peso em kg, origem e uma linha curta de observação.
- Ordenação mais recente primeiro.
- Ação “Ver detalhes” ou menu com Editar/Excluir, mantendo distância segura entre ações destrutivas.

### Formulário

- Data do registro, sugerindo hoje e permitindo datas passadas.
- Peso em kg, aceitando decimal brasileiro.
- Observação opcional com limite visual coerente após confirmação do schema.
- Cancelar e Salvar com double-submit bloqueado.

### Estados

- Loading: “Carregando seu histórico de peso...”.
- Vazio: “Você ainda não registrou seu peso.” + “Registrar peso”.
- Erro: mensagem amigável e ação para tentar novamente.
- Sucesso: toast após retorno positivo do Supabase.

Não incluir gráfico, meta, dashboard ou interpretações clínicas na V1.

## G. Integração com Diário

A lista “Meu Peso” deve incluir cada linha de `weight_records` uma única vez, inclusive pesos criados junto às aplicações. Não deve duplicar dados copiando-os para outra tabela ou criando um segundo registro de exibição.

Para preservar a associação atual:

- registros com o marcador recebem badge “Junto à aplicação”;
- a observação técnica não deve ser exibida como se fosse uma nota escrita pelo usuário;
- editar data/observação de um registro vinculado diretamente em “Meu Peso” pode quebrar a associação.

Recomendação para a implementação sem migration: em registros marcados, permitir edição do valor do peso em “Meu Peso”, mas direcionar a alteração de data para a edição da aplicação correspondente quando ela puder ser identificada sem ambiguidade. Como a identificação atual pode ser ambígua, a opção mais segura é bloquear a edição independente de data/observação desses registros e explicar que foram registrados pelo Diário. A exclusão do peso pode continuar disponível com confirmação; depois disso o Diário mostrará “Não informado”.

Registros manuais podem ter data, peso e observação editados normalmente.

## H. Segurança

- RLS de `weight_records` está aprovada para A→A, A→B, B→B e B→A.
- Usar somente Publishable Key e sessão oficial do usuário.
- Nunca utilizar `service_role`, Secret Key ou token manual.
- `user_id` deve vir de `auth.getUser()`/sessão, nunca do formulário, DOM, querystring ou e-mail.
- SELECT não precisa receber `user_id` da UI; a RLS filtra ownership.
- UPDATE e DELETE devem usar UUID do registro retornado pelo backend e depender da RLS.
- Dados de observação devem ser renderizados com `textContent`/`createElement`.
- Histórico e caches devem ser apagados no logout ou troca de usuário.

## I. Necessidade ou não de mudança de schema

### Para a Peso V1 mínima

Não é obrigatório alterar schema. O CRUD independente pode usar as sete colunas atuais e a convenção do marcador.

### Para associação tecnicamente correta

Uma mudança de schema é recomendada antes de evoluir integrações complexas. Opção preferível:

```text
weight_records.application_id UUID NULL
weight_records.source         TEXT ou enum controlado
```

- `application_id` criaria vínculo inequívoco com `applications.id`.
- `source` distinguiria `manual` de `application` sem ocupar `notes`.
- A FK, índice, regra de exclusão e policies precisariam ser desenhados e testados em sprint própria.
- Seria necessária migration dos registros existentes com tratamento explícito de ambiguidades por data.

Nenhuma dessas alterações deve ser executada silenciosamente. A V1 pode começar sem migration, desde que aceite as limitações documentadas.

## J. Arquivos que seriam alterados na próxima etapa

Provável escopo:

- `index.html` — navegação, área “Meu Peso” e modais.
- `styles.css` — cards, formulários, estados e responsividade.
- `js/weight.js` — CRUD e sessão do histórico de peso.
- `js/diary.js` — somente integração necessária com helpers/origem, evitando reescrever o Diário.
- `scripts/build.mjs` — inclusão explícita de `js/weight.js` na allowlist.
- `README.md` — documentação funcional.
- `PESO_V1_LOG.md` — relatório da implementação, se solicitado.

`app.js`, `js/auth.js`, `js/supabase-config.js`, `package.json` e `wrangler.jsonc` não deveriam precisar de alteração para a versão mínima.

## K. Riscos

- Associação errada quando houver múltiplos eventos no mesmo dia.
- Usuário alterar o marcador técnico e perder o vínculo visual.
- Sucesso parcial entre operações em duas tabelas.
- Duplicidade se Diário e Meu Peso criarem registros separados para o mesmo evento.
- Paginação ausente causar crescimento ilimitado; aplicar limite inicial.
- Datas civis sofrerem conversão UTC; manter `YYYY-MM-DD` sem criar Date para persistência.
- Decimais pt-BR serem enviados como texto; converter para Number.
- Cache do usuário A permanecer após login do usuário B; limpar por evento de sessão.
- Exclusão acidental; exigir confirmação e retorno do UUID.
- Supor constraints não documentadas; validar DDL antes de qualquer migration.

## L. Recomendação final

Implementar Peso V1 inicialmente sem mudança de schema, com CRUD completo para registros manuais e uma única lista que também mostre os pesos vindos do Diário. Reservar o marcador atual como metadado temporário e restringir a edição de data/observação dos registros vinculados para não romper a associação.

Antes de gráficos, metas, dashboard ou integrações mais profundas, versionar o DDL real e planejar `application_id` + `source` em uma migration separada, acompanhada por nova validação RLS. Essa evolução elimina ambiguidades e permite que Diário e Peso compartilhem o mesmo registro com vínculo confiável.

Fluxo futuro permanece:

```text
source na raiz
  ↓
npm run build
  ↓
public/ gerada pela allowlist
  ↓
Cloudflare
```
