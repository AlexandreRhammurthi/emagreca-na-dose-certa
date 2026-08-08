# Emagreça na Dose Certa

Aplicação web estática e responsiva para visualização educativa de doses em seringas U-100. O simulador converte uma dose prescrita em miligramas para volume e unidades, usando a concentração exata indicada no rótulo.

> Ferramenta educativa. Não oferece diagnóstico ou prescrição e não substitui orientação médica, farmacêutica ou a bula.

## Arquitetura

O projeto usa HTML, CSS e JavaScript puro, sem framework, bundler, SSR ou servidor Node.js. Os arquivos estáticos podem ser publicados diretamente no Cloudflare Workers/Pages ou em outro serviço de hospedagem estática.

```text
/
├── index.html                 # Interface do simulador e modal de autenticação
├── styles.css                 # Identidade visual, responsividade e modal
├── app.js                     # Cálculo e representação visual da seringa
├── js/
│   ├── supabase-config.js     # Configuração pública e cliente único do Supabase
│   ├── auth.js                # Cadastro, sessão, login, logout e recuperação
│   └── diary.js               # Registro e histórico de aplicações realizadas
└── README.md
```

## Configuração do Supabase

Edite `js/supabase-config.js` e substitua os dois valores marcados:

```js
const SUPABASE_URL = 'https://jxfjsleqwfjrkcxcqpvw.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_...';
```

O Project URL já está configurado. A Publishable Key ainda precisa ser copiada do painel; não foi encontrada uma chave válida no repositório ou no ambiente durante a sprint Auth V1.1.

Esses valores são públicos e próprios para aplicações client-side. Encontre-os em **Supabase Dashboard > Project Settings > API**.

Pode estar no cliente:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

Nunca pode estar no cliente ou no repositório:

- Secret Key (`sb_secret_...`)
- chave `service_role`
- senha do banco
- JWT secret

A segurança dos dados depende de Supabase Auth, JWT da sessão e políticas RLS. Este projeto não altera schema, tabelas, triggers ou políticas e não insere manualmente em `public.profiles`.

## Redirects de autenticação

No Supabase, abra **Authentication > URL Configuration** e configure a Site URL e as Redirect URLs dos ambientes utilizados. Inclua, conforme aplicável:

```text
https://emagrecanadosecerta.com.br/**
https://emagreca-na-dose-certa.arbandeira.workers.dev/**
http://localhost:8000/**
```

O código gera `emailRedirectTo` e `redirectTo` com a origem e o caminho atuais (`window.location.origin + window.location.pathname`), permitindo desenvolvimento e produção sem fixar um único domínio.

## Autenticação

O projeto carrega `@supabase/supabase-js` v2 pelo CDN oficial indicado na documentação do Supabase e cria uma única instância do cliente.

### Cadastro

O formulário valida nome, e-mail, senha e confirmação. O cadastro chama `signUp` e envia somente o nome como metadata:

```js
options: { data: { display_name: nome } }
```

O front-end não grava em `public.profiles`; o trigger existente no banco é responsável por criar o perfil. Se a confirmação de e-mail estiver ativa e não houver sessão no retorno, a interface pede que o usuário confirme o cadastro pelo e-mail.

### Login e sessão

O login usa `signInWithPassword`. A sessão é restaurada com `getSession`, acompanhada por `onAuthStateChange` e persistida pelo comportamento oficial do SDK. Nenhum JWT ou refresh token é copiado manualmente para outro armazenamento.

O header exibe **Entrar / Criar conta** sem sessão e **nome / Sair** com sessão. O nome vem primeiro de `user_metadata.display_name`, com fallback para a parte do e-mail anterior a `@`.

### Logout

O botão **Sair** usa `signOut` e volta a interface ao estado desautenticado. Ele não exclui conta, perfil ou qualquer registro.

## Diário

O simulador continua disponível sem autenticação. Depois de uma simulação válida, o botão **Salvar no meu diário** permite que uma pessoa autenticada confirme a data, revise os dados calculados e inclua uma observação opcional antes do registro.

Os dados são armazenados em `public.applications` usando exclusivamente o cliente Supabase já autenticado e as políticas RLS existentes. O Diário carrega até os 50 registros mais recentes, permite visualizar detalhes, editar os campos-base e excluir uma aplicação mediante confirmação.

Ao editar apresentação, dose ou seringa, volume e UI são recalculados pela mesma função pura usada pelo simulador. Campos derivados não são editados isoladamente. Datas são tratadas como datas civis no formato exigido pelo banco, sem conversão UTC.

O Diário representa somente aplicações realizadas. Planejamento futuro, recorrência, calendário e notificações devem permanecer em estruturas separadas e não fazem parte de `applications`.

### Recuperação completa de senha

1. O usuário informa o e-mail em **Esqueci minha senha**.
2. `resetPasswordForEmail` envia um link com retorno à página atual.
3. A resposta visual é neutra e não revela se a conta existe.
4. No retorno, o evento `PASSWORD_RECOVERY` abre o formulário de nova senha.
5. O formulário valida a confirmação e chama `updateUser({ password })`.
6. Após o sucesso, os campos são limpos e os parâmetros de recuperação são removidos da URL.

## Desenvolvimento

A raiz do projeto é a única fonte de verdade da aplicação:

```text
/
├── index.html
├── styles.css
├── app.js
└── js/
    ├── auth.js
    ├── diary.js
    └── supabase-config.js
```

Gere a saída pública com:

```powershell
npm run build
```

O comando limpa e recria `public/` usando uma allowlist, verifica padrões de credenciais privilegiadas e confirma por SHA-256 que source e saída são idênticos. A pasta `public/` é um artefato de build e não deve ser versionada.

**Nunca edite arquivos diretamente em `public/`.** Qualquer alteração nessa pasta será descartada no próximo build. Faça toda correção na raiz e execute novamente `npm run build`.

## Execução local

Não abra o HTML diretamente por `file://`, pois os redirects de autenticação precisam de uma origem HTTP válida. Na raiz do projeto, execute:

```powershell
npm run build
python -m http.server 8000 --directory public
```

Acesse `http://localhost:8000` e confirme que essa origem está autorizada nas Redirect URLs do Supabase.

## Publicação

O Cloudflare publica exclusivamente o conteúdo gerado em `public/`, conforme `wrangler.jsonc`. O fluxo recomendado é:

```text
Build command: npm run build
Deploy command: npx wrangler deploy --assets ./public/
Root directory: /
```

Também é possível executar localmente `npm run deploy`, que sempre faz o build antes do Wrangler. Após publicar, mantenha a URL final nas Redirect URLs do Supabase.

## Regras de segurança

- Senhas são enviadas somente ao Supabase Auth e limpas dos formulários após as operações.
- A aplicação não registra senhas, sessão, JWT ou refresh token no console.
- Dados de usuário são inseridos no DOM com `textContent`.
- Não há `eval`, execução dinâmica, chave administrativa ou cliente Auth paralelo.
- Mensagens técnicas do backend são traduzidas para respostas amigáveis em português.
- Operações assíncronas desabilitam o formulário para evitar submissões duplicadas.
