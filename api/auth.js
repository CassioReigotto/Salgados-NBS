const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Sessão expirada ou não autenticada.' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            res.clearCookie('token');
            return res.status(401).json({ error: 'Token inválido.' });
        }
        req.user = user;
        next();
    });
};

const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Acesso negado. Requer privilégios de Administrador.' });
    next();
};

// Rate Limit simples em memória para evitar brute force no login
const loginAttempts = new Map();
const loginRateLimit = (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 minutos
    
    let attempts = loginAttempts.get(ip) || [];
    attempts = attempts.filter(time => now - time < windowMs);
    
    if (attempts.length >= 5) {
        return res.status(429).json({ error: 'Muitas tentativas de login. Aguarde 15 minutos.' });
    }
    
    attempts.push(now);
    loginAttempts.set(ip, attempts);
    next();
};

module.exports = { authenticate, requireAdmin, loginRateLimit, loginAttempts };