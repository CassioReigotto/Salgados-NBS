# 🥟 Sistema de Pedidos de Salgados (MVP Seguro)

Um sistema monolítico limpo focado em confiabilidade, sem dependências de frameworks complexos, rodando em Vanilla JS, Node.js + Express e PostgreSQL.

## ⚙️ Passo a Passo para Configurar o Supabase
1. Crie uma conta no [Supabase](https://supabase.com) e inicie um novo projeto.
2. Acesse a barra lateral, vá em **SQL Editor** e crie uma nova query.
3. Copie todo o conteúdo do arquivo `database/init.sql`, cole no editor e clique em **RUN**.
4. Acesse **Project Settings > Database**, role até "Connection string" (aba URI) e copie o link gerado (lembre-se de substituir `[YOUR-PASSWORD]` pela senha do banco que você definiu na criação do projeto).

## 💻 Passo a Passo para Rodar Localmente
1. Certifique-se de ter o Node.js instalado (v18+).
2. Clone ou extraia esta pasta localmente e abra um terminal na raiz.
3. Rode o comando para instalar as dependências:
   ```bash
   npm install