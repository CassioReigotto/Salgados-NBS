const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { authenticate, requireAdmin, loginRateLimit, loginAttempts } = require('./auth');
const { validateString, validateUUID, parseCurrencyToCents, formatDBError, VALID_TRANSITIONS } = require('./validators');
const router = express.Router();

const isProd = process.env.NODE_ENV === 'production';
const cookieOpts = { httpOnly: true, secure: isProd, sameSite: 'strict', maxAge: 12 * 60 * 60 * 1000 };

// --- AUTENTICAÇÃO ---
router.post('/auth/login', loginRateLimit, async (req, res) => {
    try {
        const username = validateString(req.body.username, 3, 50, 'Username').toLowerCase();
        const password = validateString(req.body.password, 1, 255, 'Senha');

        const { rows } = await db.query('SELECT * FROM users WHERE username = $1 AND is_active = true', [username]);
        if (rows.length === 0) return res.status(401).json({ error: 'Usuário inválido ou inativo.' });
        
        const valid = await bcrypt.compare(password, rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: 'Senha incorreta.' });

        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        loginAttempts.delete(ip); // Limpa tentativas após sucesso

        const token = jwt.sign({ id: rows[0].id, role: rows[0].role, name: rows[0].name }, process.env.JWT_SECRET, { expiresIn: '12h' });
        res.cookie('token', token, cookieOpts);
        res.json({ message: 'Logado com sucesso' });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

router.post('/auth/logout', (req, res) => {
    res.clearCookie('token', cookieOpts);
    res.json({ message: 'Deslogado' });
});

router.get('/me', authenticate, (req, res) => res.json(req.user));

// --- PRODUTOS ---
router.get('/products', authenticate, async (req, res) => {
    try {
        const { rows } = await db.query('SELECT id, name, price_cents, is_active FROM products ORDER BY is_active DESC, name ASC');
        res.json(rows);
    } catch(e) { res.status(500).json({ error: formatDBError(e) }); }
});

router.post('/products', authenticate, requireAdmin, async (req, res) => {
    try {
        const name = validateString(req.body.name, 2, 100, 'Nome do Produto');
        const priceCents = parseCurrencyToCents(req.body.price);
        await db.query('INSERT INTO products (name, price_cents) VALUES ($1, $2)', [name, priceCents]);
        res.json({ message: 'Produto criado com sucesso.' });
    } catch (e) { res.status(400).json({ error: e.message || formatDBError(e) }); }
});

router.put('/products/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        validateUUID(req.params.id);
        const name = validateString(req.body.name, 2, 100, 'Nome do Produto');
        const priceCents = parseCurrencyToCents(req.body.price);
        const isActive = Boolean(req.body.is_active);
        
        await db.query('UPDATE products SET name=$1, price_cents=$2, is_active=$3 WHERE id=$4', [name, priceCents, isActive, req.params.id]);
        res.json({ message: 'Produto atualizado.' });
    } catch (e) { res.status(400).json({ error: e.message || formatDBError(e) }); }
});

// --- USUÁRIOS (ADMIN) ---
router.get('/users', authenticate, requireAdmin, async (req, res) => {
    try {
        const { rows } = await db.query("SELECT id, name, username, role, is_active FROM users ORDER BY name ASC");
        res.json(rows);
    } catch(e) { res.status(500).json({ error: formatDBError(e) }); }
});

router.post('/users', authenticate, requireAdmin, async (req, res) => {
    try {
        const name = validateString(req.body.name, 2, 100, 'Nome');
        const username = validateString(req.body.username, 3, 50, 'Username').toLowerCase();
        const password = validateString(req.body.password, 6, 255, 'Senha');
        const role = req.body.role === 'ADMIN' ? 'ADMIN' : 'USER';
        
        const hash = await bcrypt.hash(password, 10);
        await db.query('INSERT INTO users (name, username, password_hash, role) VALUES ($1, $2, $3, $4)', [name, username, hash, role]);
        res.json({ message: 'Usuário criado.' });
    } catch (e) { res.status(400).json({ error: formatDBError(e) }); }
});

router.put('/users/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        validateUUID(req.params.id);
        const name = validateString(req.body.name, 2, 100, 'Nome');
        const username = validateString(req.body.username, 3, 50, 'Username').toLowerCase();
        const role = req.body.role === 'ADMIN' ? 'ADMIN' : 'USER';
        const isActive = Boolean(req.body.is_active);

        // Previne auto-rebaixamento/desativação acidental
        if (req.params.id === req.user.id && (role !== 'ADMIN' || !isActive)) {
            throw new Error('Você não pode remover seus próprios privilégios ou desativar sua conta.');
        }

        let query = 'UPDATE users SET name=$1, username=$2, role=$3, is_active=$4';
        let params = [name, username, role, isActive];

        if (req.body.password && req.body.password.trim().length >= 6) {
            const hash = await bcrypt.hash(req.body.password.trim(), 10);
            query += ', password_hash=$5 WHERE id=$6';
            params.push(hash, req.params.id);
        } else {
            query += ' WHERE id=$5';
            params.push(req.params.id);
        }

        await db.query(query, params);
        res.json({ message: 'Usuário atualizado.' });
    } catch (e) { res.status(400).json({ error: formatDBError(e) }); }
});

// --- PEDIDOS GERAIS ---
router.get('/orders', authenticate, async (req, res) => {
    try {
        let q = 'SELECT * FROM orders ORDER BY created_at DESC';
        let params = [];
        if (req.user.role !== 'ADMIN') {
            q = `SELECT DISTINCT o.* FROM orders o 
                 LEFT JOIN user_orders uo ON o.id = uo.order_id AND uo.user_id = $1 
                 WHERE o.status = 'OPEN' OR uo.id IS NOT NULL 
                 ORDER BY o.created_at DESC`;
            params = [req.user.id];
        }
        const { rows } = await db.query(q, params);
        res.json(rows);
    } catch(e) { res.status(500).json({ error: formatDBError(e) }); }
});

router.post('/orders', authenticate, requireAdmin, async (req, res) => {
    try {
        const title = validateString(req.body.title, 3, 100, 'Título');
        const feeCents = parseCurrencyToCents(req.body.delivery_fee);
        await db.query('INSERT INTO orders (title, delivery_fee_cents) VALUES ($1, $2)', [title, feeCents]);
        res.json({ message: 'Pedido geral aberto.' });
    } catch (e) { res.status(400).json({ error: formatDBError(e) }); }
});

router.get('/orders/:id', authenticate, async (req, res) => {
    try {
        validateUUID(req.params.id);
        const { rows: orderRows } = await db.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
        if (orderRows.length === 0) return res.status(404).json({ error: 'Pedido não encontrado.' });
        const order = orderRows[0];

        let participations = [];
        if (req.user.role === 'ADMIN') {
            const pRes = await db.query(`
                SELECT uo.*, u.name as user_name FROM user_orders uo 
                JOIN users u ON u.id = uo.user_id 
                WHERE uo.order_id = $1 ORDER BY uo.created_at ASC
            `, [order.id]);
            participations = pRes.rows;
        } else {
            const pRes = await db.query('SELECT * FROM user_orders WHERE order_id = $1 AND user_id = $2', [order.id, req.user.id]);
            participations = pRes.rows;
        }

        for (let p of participations) {
            const iRes = await db.query(`
                SELECT uoi.*, pr.name as product_name 
                FROM user_order_items uoi 
                JOIN products pr ON pr.id = uoi.product_id 
                WHERE uoi.user_order_id = $1
            `, [p.id]);
            p.items = iRes.rows;
        }

        res.json({ order, participations });
    } catch (e) { res.status(400).json({ error: formatDBError(e) }); }
});

// --- ADMIN MÁQUINA DE ESTADOS DO PEDIDO ---
router.patch('/orders/:id/status', authenticate, requireAdmin, async (req, res) => {
    const client = await db.getPool().connect();
    try {
        validateUUID(req.params.id);
        const newStatus = req.body.status;
        
        await client.query('BEGIN');
        const currentOrder = await client.query('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (currentOrder.rows.length === 0) throw new Error('Pedido não encontrado.');
        
        const currentStatus = currentOrder.rows[0].status;
        const allowedNext = VALID_TRANSITIONS[currentStatus] || [];
        
        if (!allowedNext.includes(newStatus)) {
            throw new Error(`Transição inválida: de ${currentStatus} para ${newStatus}.`);
        }

        await client.query('UPDATE orders SET status = $1 WHERE id = $2', [newStatus, req.params.id]);
        await client.query('COMMIT');
        res.json({ message: `Status avançado para ${newStatus}.` });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: e.message || formatDBError(e) });
    } finally {
        client.release();
    }
});

// --- ADMIN MUDANÇA DE PAGAMENTO INDIVIDUAL ---
router.patch('/user-orders/:id/payment', authenticate, requireAdmin, async (req, res) => {
    try {
        validateUUID(req.params.id);
        const { payment_status } = req.body;
        if (!['PENDING', 'PAID'].includes(payment_status)) throw new Error('Status de pagamento inválido.');
        
        // Verifica se o pedido geral permite pagamento (não pode ser OPEN)
        const orderCheck = await db.query(`
            SELECT o.status FROM orders o 
            JOIN user_orders uo ON uo.order_id = o.id 
            WHERE uo.id = $1
        `, [req.params.id]);
        
        if (orderCheck.rows.length === 0) throw new Error('Registro não encontrado.');
        if (orderCheck.rows[0].status === 'OPEN') throw new Error('O pedido ainda está aberto. Feche-o primeiro.');

        await db.query('UPDATE user_orders SET payment_status = $1 WHERE id = $2', [payment_status, req.params.id]);
        res.json({ message: 'Pagamento atualizado.' });
    } catch (e) { res.status(400).json({ error: e.message || formatDBError(e) }); }
});

// --- FLUXO DO FUNCIONÁRIO (CONCORRÊNCIA SEGURA) ---
router.post('/orders/:id/participate', authenticate, async (req, res) => {
    const client = await db.getPool().connect();
    try {
        validateUUID(req.params.id);
        const { items } = req.body;
        if (!Array.isArray(items) || items.length === 0) throw new Error('O pedido não pode estar vazio.');

        await client.query('BEGIN');
        
        const orderCheck = await client.query('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (orderCheck.rows.length === 0 || orderCheck.rows[0].status !== 'OPEN') {
            throw new Error('Pedido não existe ou já foi fechado.');
        }

        // Filtra e valida quantidades
        const validItems = items.filter(i => parseInt(i.quantity) > 0);
        if (validItems.length === 0) throw new Error('Nenhum salgado selecionado. Cancele o pedido se não quiser participar.');

        let userOrderId;
        const uoCheck = await client.query('SELECT id FROM user_orders WHERE order_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        
        if (uoCheck.rows.length > 0) {
            userOrderId = uoCheck.rows[0].id;
            await client.query("UPDATE user_orders SET status = 'CONFIRMED' WHERE id = $1", [userOrderId]);
            await client.query('DELETE FROM user_order_items WHERE user_order_id = $1', [userOrderId]);
        } else {
            const uoInsert = await client.query(
                "INSERT INTO user_orders (order_id, user_id, status) VALUES ($1, $2, 'CONFIRMED') RETURNING id",
                [req.params.id, req.user.id]
            );
            userOrderId = uoInsert.rows[0].id;
        }

        // Insere buscando preços REAIS do banco
        for (let item of validItems) {
            validateUUID(item.productId);
            const qty = parseInt(item.quantity);
            const prodRes = await client.query('SELECT price_cents FROM products WHERE id = $1 AND is_active = true', [item.productId]);
            if (prodRes.rows.length === 0) throw new Error('Um dos produtos selecionados não está disponível.');
            
            await client.query(
                'INSERT INTO user_order_items (user_order_id, product_id, quantity, unit_price_cents) VALUES ($1, $2, $3, $4)',
                [userOrderId, item.productId, qty, prodRes.rows[0].price_cents]
            );
        }

        await client.query('COMMIT');
        res.json({ message: 'Pedido salvo com sucesso!' });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: e.message || formatDBError(e) });
    } finally {
        client.release();
    }
});

router.post('/orders/:id/cancel', authenticate, async (req, res) => {
    const client = await db.getPool().connect();
    try {
        validateUUID(req.params.id);
        await client.query('BEGIN');
        const orderCheck = await client.query('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (orderCheck.rows.length === 0 || orderCheck.rows[0].status !== 'OPEN') throw new Error('O pedido não está aberto para cancelamento.');

        await client.query("UPDATE user_orders SET status = 'CANCELLED' WHERE order_id = $1 AND user_id = $2", [req.params.id, req.user.id]);
        await client.query('COMMIT');
        res.json({ message: 'Pedido cancelado.' });
    } catch(e) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: e.message || formatDBError(e) });
    } finally {
        client.release();
    }
});

// --- FECHAMENTO E RATEIO (ADMIN) ---
router.post('/orders/:id/close', authenticate, requireAdmin, async (req, res) => {
    const client = await db.getPool().connect();
    try {
        validateUUID(req.params.id);
        await client.query('BEGIN');
        
        const orderRes = await client.query('SELECT delivery_fee_cents, status FROM orders WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (orderRes.rows.length === 0) throw new Error('Pedido não encontrado.');
        if (orderRes.rows[0].status !== 'OPEN') throw new Error('O pedido já está fechado.');
        
        const totalFee = parseInt(orderRes.rows[0].delivery_fee_cents);

        // Somente pedidos confirmados dividem a taxa
        const participantsRes = await client.query(
            "SELECT id FROM user_orders WHERE order_id = $1 AND status = 'CONFIRMED' ORDER BY created_at ASC FOR UPDATE", 
            [req.params.id]
        );
        
        const numParticipants = participantsRes.rows.length;
        if (numParticipants > 0) {
            const baseFee = Math.floor(totalFee / numParticipants);
            let remainder = totalFee % numParticipants;

            // Rateio determinístico exato
            for (let i = 0; i < numParticipants; i++) {
                const appliedFee = baseFee + (remainder > 0 ? 1 : 0);
                remainder--;
                await client.query('UPDATE user_orders SET applied_delivery_fee_cents = $1 WHERE id = $2', [appliedFee, participantsRes.rows[i].id]);
            }
        }

        await client.query("UPDATE orders SET status = 'CLOSED' WHERE id = $1", [req.params.id]);
        await client.query('COMMIT');
        res.json({ message: 'Pedido fechado! O rateio da taxa foi calculado com sucesso.' });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: e.message || formatDBError(e) });
    } finally {
        client.release();
    }
});

module.exports = router;