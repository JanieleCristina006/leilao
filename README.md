# Verzel Leilões

API REST para gerenciamento de leilões, usuários e lotes, construída com NestJS, TypeScript e Prisma ORM.

## Funcionalidades disponíveis

- Cadastro e gerenciamento de usuários.
- Cadastro e gerenciamento de leilões, com validação do período de início e encerramento.
- Cadastro e gerenciamento de lotes vinculados a um leilão.
- Fechamento automático de lotes e liquidação da arrematação.
- Atualização da sala de lances em tempo real via WebSocket.
- Consulta de carteira, depósito simulado e extrato de movimentações.
- Pesquisa de obras de arte na API do Art Institute of Chicago para auxiliar o cadastro de lotes.
- Persistência em PostgreSQL com Prisma ORM.

Além do cadastro, leilões e lotes, a API inclui carteira com depósito simulado, lances com reserva de saldo, atualizações ao vivo, liquidação automática, comprovante público e auditoria encadeada dos lances.

## Tecnologias

- Node.js e npm
- NestJS 11
- TypeScript
- Prisma ORM 7
- PostgreSQL
- `class-validator` e `class-transformer` para validação de entradas

## Pré-requisitos

- Node.js e npm instalados.
- Uma instância PostgreSQL acessível.
- Variáveis de ambiente configuradas no arquivo `.env`, na raiz do projeto.

### Variáveis de ambiente

```dotenv
# Segredo usado para assinar e validar os tokens JWT
JWT_SECRET="cole-aqui-uma-chave-aleatoria-longa"

# Conexão usada pela aplicação NestJS
DATABASE_URL="postgresql://usuario:senha@localhost:5432/verzel_leiloes?schema=public"

# Conexão usada pelos comandos do Prisma CLI
DIRECT_URL="postgresql://usuario:senha@localhost:5432/verzel_leiloes?schema=public"

# Porta HTTP da API; opcional, o padrão é 3000
PORT=3000

# E-mail de contato enviado no User-Agent das consultas ao Art Institute of Chicago
AIC_USER_EMAIL="desenvolvedor@example.com"

# Origem permitida para o WebSocket; opcional em desenvolvimento local
FRONTEND_ORIGIN="http://localhost:5173"
```

`DATABASE_URL` é usada pelo `PrismaService` em tempo de execução. `DIRECT_URL` é lida pelo arquivo de configuração do Prisma CLI. Em desenvolvimento local, ambas podem apontar para a mesma base de dados. Não compartilhe nem versione o arquivo `.env`.

`JWT_SECRET` é obrigatório para iniciar a aplicação. Gere um valor aleatório longo e copie a saída para essa variável. Por exemplo, com Node.js:

```bash
node -e "console.log(require('node:crypto').randomBytes(64).toString('hex'))"
```

O mesmo segredo é usado para assinar e validar tokens, que expiram em 15 dias. Se trocar o segredo, os tokens emitidos anteriormente deixam de funcionar.

## Instalação e execução

Instale as dependências:

```bash
npm install
```

Crie um arquivo `.env` na raiz com as variáveis do exemplo acima. Gere o `JWT_SECRET` conforme indicado na seção de variáveis e substitua os dados de conexão do PostgreSQL pelos valores do seu ambiente.

A configuração do Prisma está em `prisma7.config.ts`, nome diferente do padrão. Por isso, informe esse arquivo ao executar comandos do Prisma.

Aplique as migrações existentes e gere o Prisma Client:

```bash
npx prisma migrate dev --config=./prisma7.config.ts
npx prisma generate --config=./prisma7.config.ts
```

Inicie a API em modo de desenvolvimento:

```bash
npm run start:dev
```

Por padrão, a API fica disponível em `http://localhost:3000`. A variável `PORT` altera essa porta.

O projeto não cria o banco PostgreSQL. Crie uma base local e ajuste `DATABASE_URL` e `DIRECT_URL` antes de aplicar as migrações.

Para compilar e iniciar em modo de produção:

```bash
npm run build
npm run start:prod
```

## Banco de dados e Prisma

- Schema: `prisma/schema.prisma`
- Migrações: `prisma/migrations/`
- Configuração do Prisma CLI: `prisma7.config.ts`
- Saída do Prisma Client: `generated/prisma/`

Depois de alterar o schema, crie e aplique uma migração em desenvolvimento e regenere o client:

```bash
npx prisma migrate dev --name nome_da_migracao --config=./prisma7.config.ts
npx prisma generate --config=./prisma7.config.ts
```

Em produção, aplique as migrações já criadas com:

```bash
npx prisma migrate deploy --config=./prisma7.config.ts
```

Para inspecionar os dados localmente:

```bash
npx prisma studio --config=./prisma7.config.ts
```

## API HTTP

As rotas não usam um prefixo global. Os corpos das requisições são enviados em JSON. A aplicação registra um `ValidationPipe` global para validar os DTOs.

### Testar com Postman ou Insomnia

Na raiz do projeto está a coleção `rotas-api.postman_collection.json`. Importe esse arquivo pelo menu **Import** do Postman ou do Insomnia. A coleção usa `http://localhost:3000` como endereço padrão; altere a variável `baseUrl` se a API estiver em outra porta.

Antes de testar as rotas de leilões e lotes, aplique as migrações do banco. Para testar as permissões, execute a pasta **1 - Cadastro público**, altere no Prisma Studio os perfis que serão leiloeiros para `AUCTIONEER` e o perfil de administrador para `ADMIN`, e depois execute **2 - Login**. As pastas seguintes usam os tokens e IDs salvos automaticamente pela coleção. O cadastro público cria somente usuários `BIDDER`. Antes dos lances, execute os depósitos simulados na subpasta **Carteira dos licitantes**, dentro da pasta **3 - Rotas públicas e teste do licitante**.

### Mensagem inicial

| Método | Rota | Descrição                                    |
| ------ | ---- | -------------------------------------------- |
| `GET`  | `/`  | Retorna uma mensagem simples de boas-vindas. |

### Usuários

| Método   | Rota         | Descrição                                                                        |
| -------- | ------------ | -------------------------------------------------------------------------------- |
| `POST`   | `/users`     | Cadastra um usuário.                                                             |
| `GET`    | `/users`     | Lista os usuários.                                                               |
| `GET`    | `/users/:id` | Busca um usuário pelo ID.                                                        |
| `PATCH`  | `/users/:id` | Atualiza parcialmente um usuário.                                                |
| `DELETE` | `/users/:id` | Remove um usuário, desde que não haja dados relacionados que impeçam a exclusão. |

Campos para `POST /users`:

- `name`: nome obrigatório.
- `email`: e-mail válido e único.
- `password`: senha com no mínimo 8 caracteres.

O cadastro público sempre cria um licitante (`BIDDER`). O campo `role` não é aceito no corpo. Para desenvolvimento local, crie a conta pelo cadastro e altere seu campo `role` pelo Prisma Studio para `AUCTIONEER` ou `ADMIN`. A API não oferece promoção pública de papel.

Exemplo:

```json
{
  "name": "Ana Silva",
  "email": "ana@example.com",
  "password": "senha-segura"
}
```

### Autenticação e permissões

| Método                      | Rota                                    | Acesso                                                                      |
| --------------------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| `POST`                      | `/auth/login`                           | Público; retorna token JWT.                                                 |
| `GET`                       | `/auth/me`                              | Requer token JWT.                                                           |
| `POST`                      | `/bids`                                 | Requer papel `BIDDER`; registra um lance válido.                            |
| `GET`                       | `/wallet/me`                            | Requer papel `BIDDER` ou `AUCTIONEER`; mostra o saldo da própria carteira.  |
| `GET`                       | `/wallet/me/transactions`               | Requer papel `BIDDER` ou `AUCTIONEER`; mostra o extrato próprio.            |
| `POST`                      | `/wallet/deposits`                      | Requer papel `BIDDER`; faz um depósito simulado.                            |
| `GET`                       | `/users` e `/users/:id`                 | Requer papel `ADMIN`.                                                       |
| `PATCH` / `DELETE`          | `/users/:id`                            | Requer papel `ADMIN`.                                                       |
| `POST` / `PATCH` / `DELETE` | `/auctions` e `/auctions/:id`           | Requer papel `AUCTIONEER`; alterações só no próprio leilão.                 |
| `GET`                       | `/auctions/mine`                        | Requer papel `AUCTIONEER`.                                                  |
| `POST` / `PATCH` / `DELETE` | `/lots` e `/lots/:id`                   | Requer papel `AUCTIONEER`; o lote precisa pertencer a um leilão do usuário. |
| `POST`                      | `/lots/:id/cancel`                      | Requer papel `AUCTIONEER`; só permite cancelar lote sem lances.             |
| `GET`                       | `/lots/mine`                            | Requer papel `AUCTIONEER`.                                                  |
| `GET`                       | `/lots/:id/receipt` e `/lots/:id/audit` | Públicos; comprovante e verificação do histórico de lances.                 |

Envie o token nas rotas protegidas no cabeçalho `Authorization: Bearer <token>`. O papel atual é consultado no banco durante a autenticação de cada requisição.

### Leilões

| Método   | Rota             | Descrição                                              |
| -------- | ---------------- | ------------------------------------------------------ |
| `POST`   | `/auctions`      | Cadastra um leilão.                                    |
| `GET`    | `/auctions`      | Lista os leilões.                                      |
| `GET`    | `/auctions/mine` | Lista os leilões do leiloeiro autenticado.             |
| `GET`    | `/auctions/:id`  | Busca um leilão pelo ID.                               |
| `PATCH`  | `/auctions/:id`  | Atualiza parcialmente um leilão.                       |
| `DELETE` | `/auctions/:id`  | Remove um leilão, desde que não haja lotes vinculados. |

Campos para `POST /auctions`:

- `title`: título obrigatório.
- `startsAt` e `endsAt`: datas obrigatórias em formato ISO 8601.
- `description`: descrição opcional.
- `status`: opcional; valores aceitos: `DRAFT`, `SCHEDULED`, `ACTIVE`, `FINISHED` ou `CANCELLED`.

A data de encerramento precisa ser posterior à data de início.

Exemplo:

```json
{
  "title": "Leilão de arte contemporânea",
  "description": "Seleção de obras contemporâneas.",
  "startsAt": "2026-11-15T18:00:00.000Z",
  "endsAt": "2026-11-15T21:00:00.000Z",
  "status": "SCHEDULED"
}
```

### Lotes

| Método   | Rota                            | Descrição                                                   |
| -------- | ------------------------------- | ----------------------------------------------------------- |
| `GET`    | `/lots/artworks/search?q=texto` | Pesquisa obras de arte externas para auxiliar o cadastro.   |
| `POST`   | `/lots`                         | Cadastra um lote associado a um leilão.                     |
| `GET`    | `/lots`                         | Lista os lotes.                                             |
| `GET`    | `/lots/mine`                    | Lista os lotes do leiloeiro autenticado.                    |
| `GET`    | `/lots/:id`                     | Busca um lote pelo ID.                                      |
| `GET`    | `/lots/:id/receipt`             | Retorna o comprovante público, sem identificar o licitante. |
| `GET`    | `/lots/:id/audit`               | Verifica hashes e mostra o histórico sem IDs de licitantes. |
| `PATCH`  | `/lots/:id`                     | Atualiza parcialmente um lote.                              |
| `DELETE` | `/lots/:id`                     | Remove um lote.                                             |
| `POST`   | `/lots/:id/cancel`              | Cancela o lote se ainda não recebeu lances.                 |

Campos para `POST /lots`:

- `auctionId`: UUID do leilão associado.
- `title`: nome ou título obrigatório.
- `startingBid`: lance inicial numérico, não negativo e com até duas casas decimais.
- `minimumIncrement`: incremento mínimo opcional; padrão `1.00`.
- `description`: descrição opcional.
- `imageUrl`: URL opcional da imagem.
- `externalId`: identificador externo opcional, por exemplo, o ID de uma obra pesquisada.

Exemplo:

```json
{
  "auctionId": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Paisagem com árvores",
  "description": "Obra selecionada para o leilão.",
  "imageUrl": "https://example.com/imagem.jpg",
  "externalId": "12345",
  "startingBid": 1000,
  "minimumIncrement": 1
}
```

### Carteira

Cada licitante tem uma carteira criada no cadastro, inicialmente com saldo zero. Consulte-a com `GET /wallet/me`:

```json
{
  "availableBalance": "500.00",
  "committedBalance": "100.00",
  "totalBalance": "600.00"
}
```

`totalBalance` é calculado como saldo disponível mais saldo comprometido. Para testar um depósito, envie `POST /wallet/deposits` com o valor em texto decimal:

```json
{
  "amount": "500.00"
}
```

O depósito é simulado: não movimenta dinheiro real e aumenta somente o saldo disponível. A API registra a operação como `DEPOSIT`. Consulte o extrato com `GET /wallet/me/transactions`; ele mostra depósitos, reservas de lances e liberações, do mais recente para o mais antigo. As rotas usam o usuário do token, então não recebem `profileId` no corpo ou na URL.

### Lances

| Método | Rota    | Acesso                             |
| ------ | ------- | ---------------------------------- |
| `POST` | `/bids` | Requer token JWT e papel `BIDDER`. |

O corpo recebe o ID do lote e o valor como texto decimal para evitar arredondamento de dinheiro:

```json
{
  "lotId": "UUID_DO_LOTE",
  "amount": "100.00"
}
```

O leilão precisa estar `ACTIVE`, dentro do período configurado e o lote precisa estar disponível. O primeiro lance deve ser pelo menos o `startingBid`; os próximos devem superar o maior lance aceito pelo `minimumIncrement`. O líder atual não pode cobrir o próprio lance, mas pode voltar a ofertar depois que outro licitante o superar.

Ao aceitar um lance, a API move o valor do saldo disponível para o comprometido e registra `BID_RESERVATION` no extrato. Quando outro licitante supera o líder, a reserva anterior volta para o saldo disponível e a API registra `BID_RELEASE`. A criação do lance, as alterações de saldo e a atualização de `Lot.currentBid` são feitas na mesma transação. Para testar, faça um depósito simulado para cada licitante antes de enviar lances. A coleção `rotas-api.postman_collection.json` inclui esses pedidos e o fluxo de dois licitantes.

Se um lance válido chegar nos últimos dois minutos do lote, o encerramento daquele lote é prorrogado em mais dois minutos. A nova data é gravada junto com o lance na mesma transação e enviada no evento `bid.updated` da sala ao vivo. Cada novo lance que entrar nos últimos dois minutos do encerramento atualizado pode prorrogar o lote novamente.

O backend verifica os prazos a cada cinco segundos. Quando o lote vence, fecha como `SOLD` se houver um lance aceito ou `UNSOLD` se não houver lances. Para `SOLD`, o sistema debita o valor do saldo comprometido do vencedor, credita o saldo disponível do leiloeiro e grava as duas movimentações. Para ambos os resultados, cria um `AuctionReceipt`; lote sem lances recebe valor final `0.00` e `winnerId` nulo. Quando todos os lotes terminam, o leilão passa para `FINISHED`.

O comprovante pode ser compartilhado por `GET /lots/:id/receipt`. Ele mostra os dados públicos do lote, do leilão e o resultado, sem retornar nome, e-mail ou ID do licitante. Os dados públicos principais ficam em snapshot no comprovante para manter o resultado estável. O campo `sharePath` contém o caminho que pode ser compartilhado junto com o endereço da API.

Cada novo lance aceito recebe uma sequência e um hash SHA-256 ligado ao lance anterior. `GET /lots/:id/audit` recalcula os hashes e compara a sequência, a quantidade e o último hash com os valores registrados no lote e, após o encerramento, com o comprovante. `integrity` retorna `INTACT`, `TAMPERED` ou `INCOMPLETE`; lances anteriores à ativação dessa cadeia aparecem sem hash e deixam o resultado como `INCOMPLETE`. A cadeia detecta alterações que não atualizem os hashes e âncoras correspondentes; para resistir também a alguém que reescreva todos os dados e âncoras diretamente no banco, seria necessário guardar a âncora fora dele.

O leiloeiro dono do lote pode chamar `POST /lots/:id/cancel` antes do fim do prazo. O backend rejeita o cancelamento se o lote já recebeu qualquer lance ou se já foi encerrado; quando o último lote ativo é cancelado, o leilão ativo é finalizado.

O extrato do vencedor recebe uma movimentação `AUCTION_PAYMENT`; o do leiloeiro recebe `AUCTION_EARNING`. O leiloeiro pode consultar o próprio saldo e extrato, mas não pode usar o depósito simulado de licitante.

#### Pesquisa de obras

A rota `/lots/artworks/search` consulta a API pública do Art Institute of Chicago. Informe o parâmetro `q` com o nome da obra ou do artista. A consulta externa solicita até 12 resultados; a aplicação retorna somente os itens que possuem imagem, incluindo título, artista, data, técnica, ID externo e URL da imagem.

A consulta depende de acesso à internet. Se a API externa estiver indisponível ou responder com erro, a rota retorna `503 Service Unavailable`.

### Validação e erros

- `400 Bad Request`: dados inválidos, depósito zerado/negativo, lance abaixo do mínimo, tentativa de cobrir o próprio lance ou saldo insuficiente.
- `404 Not Found`: recurso solicitado ou carteira não encontrado.
- `409 Conflict`: leilão fechado ou sem leiloeiro responsável, lote indisponível, e-mail duplicado, conflito concorrente ou tentativa de excluir registros relacionados.
- `422 Unprocessable Entity`: usuário sem carteira ao tentar registrar um lance.
- `503 Service Unavailable`: falha na consulta à API de obras de arte.

Os IDs dos modelos do banco são UUIDs. A validação dos campos de entrada é definida nos DTOs de cada módulo. Campos não declarados nos DTOs são rejeitados. Rotas protegidas retornam `401 Unauthorized` sem token válido e `403 Forbidden` quando o papel não tem permissão. O formato de retorno pode variar: algumas operações incluem uma mensagem junto ao registro; outras retornam diretamente o resultado do Prisma.

## Modelo de dados

O schema define as seguintes entidades principais:

- **Profile**: perfil de usuário, com e-mail único e papel (`AUCTIONEER`, `BIDDER` ou `ADMIN`).
- **Auction**: leilão com período, situação e vários lotes.
- **Lot**: item pertencente a um leilão, com lance inicial, lance atual, situação e encerramento próprio.
- **Bid**: lance associado a um lote e ao perfil que o realizou.
- **Wallet** e **WalletTransaction**: carteira do perfil e histórico de movimentações.
- **AuctionReceipt**: comprovante do resultado de um lote.
- **Bid**: cada lance novo guarda sequência e hashes para a auditoria pública.
- **AuditLog**: registro de auditoria com dados e hashes dos eventos.

O login usa JWT. O papel do perfil é verificado em cada requisição protegida. O cadastro público cria apenas licitantes; leiloeiros e administradores precisam ser provisionados fora desse cadastro. Leilões antigos sem `auctioneerId` não podem ser alterados ou receber novos lances até terem um leiloeiro vinculado; lotes com lances desses leilões também não podem ser liquidados sem um recebedor definido.

## Estrutura do projeto

```text
src/
├── app/          # Módulo e rota inicial da aplicação
├── users/        # Rotas, DTOs e serviço de usuários
├── auctions/     # Rotas, DTOs e serviço de leilões
├── lots/         # Rotas, DTOs e serviço de lotes
├── bids/         # Rota e serviço de lances
└── prisma/       # PrismaModule e PrismaService

prisma/
├── migrations/   # Migrações do banco
└── schema.prisma # Modelos e enums

generated/prisma/ # Prisma Client gerado
```

## Scripts disponíveis

| Comando               | Descrição                                                 |
| --------------------- | --------------------------------------------------------- |
| `npm run start`       | Inicia a aplicação.                                       |
| `npm run start:dev`   | Inicia em modo de desenvolvimento com recarga automática. |
| `npm run start:debug` | Inicia em modo de depuração.                              |
| `npm run build`       | Compila a aplicação.                                      |
| `npm run start:prod`  | Inicia a versão compilada.                                |
| `npm run test`        | Executa os testes unitários.                              |
| `npm run test:e2e`    | Executa os testes de ponta a ponta.                       |
| `npm run test:cov`    | Executa os testes com cobertura.                          |

### Testes unitários

Gere o Prisma Client se ainda não fez isso no passo de configuração e execute a suíte:

```bash
npx prisma generate --config=./prisma7.config.ts
npm test -- --runInBand
```

Os testes unitários usam mocks do Prisma e não abrem conexão com PostgreSQL. Eles cobrem regras de lances, reservas e depósitos da carteira, autorização por papel, liquidação, comprovante público, integridade da auditoria e cancelamento de lote. Já `npm run test:e2e` sobe a aplicação completa e precisa de banco e configuração válidos.

## Comportamentos conhecidos

- O cadastro público sempre cria `BIDDER`. Para demonstração local, crie usuários por esse cadastro e altere o papel no Prisma Studio para `AUCTIONEER` ou `ADMIN`.
- O depósito da carteira é simulado e não movimenta dinheiro real. O valor fica comprometido enquanto o licitante lidera; um lance superado libera a reserva anterior.
- Um lance recebido nos dois minutos finais prorroga o lote por mais dois minutos. O backend verifica o encerramento a cada cinco segundos; a contagem regressiva exibida pelo frontend é apenas visual.
- Ao encerrar um lote com lance, o sistema liquida o valor reservado para o leiloeiro. Sem lances, fecha como `UNSOLD`, com valor final `0.00` e sem vencedor.
- O comprovante e a auditoria são públicos e não expõem nome, e-mail ou ID do licitante. Lances antigos sem os campos da cadeia de hashes podem ser reportados como `INCOMPLETE`.
- A cadeia de hashes detecta alterações que não atualizem também a cadeia e as âncoras registradas no banco. Ela não protege contra alguém que consiga reescrever todos esses dados diretamente no próprio banco.
- A busca de obras depende da API externa do Art Institute of Chicago e de acesso à internet. Para o WebSocket do frontend, configure `FRONTEND_ORIGIN` com a origem correta.

## Documentação externa

- [NestJS](https://docs.nestjs.com/)
- [Prisma ORM](https://www.prisma.io/docs/orm/)
- [PostgreSQL](https://www.postgresql.org/docs/)
- [Art Institute of Chicago API](https://api.artic.edu/docs/)

## Sala ao vivo via WebSocket

O backend usa Socket.IO para enviar atualizações da sala sem recarregar a página. O cliente precisa conectar usando o token JWT recebido em `POST /auth/login` e esperar pelo evento `live.ready` antes de entrar em um lote.

Instale `socket.io-client` no projeto do frontend e conecte ao mesmo endereço da API:

```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: { token: accessToken },
});

socket.on('live.ready', () => {
  socket.emit('lot.join', { lotId });
});

socket.on('lot.snapshot', (snapshot) => {
  // Estado inicial: lote, últimos 50 lances, liderança e horário do servidor.
});

socket.on('bid.updated', (event) => {
  // Atualize o lance atual e acrescente o lance ao histórico.
});

socket.on('leadership.updated', (event) => {
  // event.isLeading indica se o usuário conectado está liderando este lote.
});
```

Os eventos enviados pelo servidor são:

- `live.ready`: a conexão foi autenticada.
- `lot.snapshot`: dados atuais do lote, os últimos 50 lances e se o usuário está na liderança.
- `bid.updated`: novo lance aceito, valor atual e `endsAt`.
- `leadership.updated`: aviso privado para o usuário que assumiu ou perdeu a liderança.
- `lot.closed`: lote encerrado como `SOLD` ou `UNSOLD`, com valor final.
- `lot.result`: aviso privado ao vencedor da arrematação.
- `live.error`: erro ao entrar na sala ou carregar o estado.

Para sair de uma sala sem encerrar a conexão, envie `socket.emit('lot.leave', { lotId })`. O cronômetro deve contar localmente até o `endsAt` recebido pelo servidor; ele não deve ser usado para validar lances. O `startsAt` é do leilão e, ao criar um lote, o `endsAt` inicial é copiado do leilão. Depois, cada lote pode ter seu próprio horário de encerramento por causa do anti-sniping. O servidor confere esses horários ao processar `POST /bids`.

Configure `FRONTEND_ORIGIN` com a origem permitida do frontend, por exemplo `http://localhost:5173`. Em produção, defina explicitamente as origens permitidas; várias origens podem ser separadas por vírgula.
