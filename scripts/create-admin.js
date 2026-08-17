require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcrypt');
const { Client } = require('pg');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

async function run() {
    console.log('\n🥟 --- Criação de Administrador ---');
    const name = await ask('Nome completo: ');
    const username = await ask('Username de acesso: ');
    const password = await ask('Senha segura: ');
    
    if (!name || !username || !password || password.length < 6) {
        console.error('❌ Todos os campos são obrigatórios. Senha min. 6 caracteres.');
        process.exit(1);
    }

    const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    
    try {
        await client.connect();
        const hash = await bcrypt.hash(password, 10);
        await client.query(
            "INSERT INTO users (name, username, password_hash, role) VALUES ($1, $2, $3, 'ADMIN')",
            [name.trim(), username.trim().toLowerCase(), hash]
        );
        console.log('✅ Administrador criado com sucesso!');
    } catch (e) {
        if (e.code === '23505') console.error('❌ Erro: Username já existe no banco de dados.');
        else console.error('❌ Erro no banco:', e.message);
    } finally {
        await client.end();
        rl.close();
    }
}
run();