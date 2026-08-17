const express = require('express');
const cookieParser = require('cookie-parser');
const routes = require('./routes');

const app = express();
// Limita tamanho do body para segurança adicional contra payloads grandes
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Rotas backend
app.use('/api', routes);

// Middleware global de erro
app.use((err, req, res, next) => {
    console.error('Unhandled Error:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
});

if (process.env.NODE_ENV !== 'production') {
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`🚀 Backend rodando na porta ${port}`));
}
module.exports = app;