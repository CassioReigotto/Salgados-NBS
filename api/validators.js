// Validações de Backend Fortes
const validateString = (str, min, max, name) => {
    if (typeof str !== 'string' || str.trim().length < min || str.trim().length > max) {
        throw new Error(`'${name}' deve ter entre ${min} e ${max} caracteres.`);
    }
    return str.trim();
};

const validateUUID = (uuid) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) {
        throw new Error('Identificador (ID) inválido.');
    }
};

const parseCurrencyToCents = (val) => {
    if (typeof val === 'number') return Math.floor(val);
    if (typeof val !== 'string') throw new Error('Valor financeiro inválido.');
    const clean = val.replace(/[^\d.,]/g, '').replace(',', '.');
    const parsed = parseFloat(clean);
    if (isNaN(parsed) || parsed < 0) throw new Error('Valor monetário inválido.');
    return Math.round(parsed * 100);
};

const formatDBError = (err) => {
    console.error('DB Error:', err);
    if (err.code === '23505') {
        if (err.constraint.includes('users_username_key')) return 'Este username já está em uso.';
        if (err.constraint.includes('user_orders_order_id_user_id_key')) return 'Você já está participando deste pedido.';
    }
    if (err.code === '22P02') return 'Formato de ID inválido no banco de dados.';
    return err.message || 'Erro interno no processamento.';
};

const VALID_TRANSITIONS = {
    'OPEN': ['CLOSED'],
    'CLOSED': ['AWAITING_PAYMENT', 'PLACED'],
    'AWAITING_PAYMENT': ['PLACED'],
    'PLACED': ['RECEIVED'],
    'RECEIVED': []
};

module.exports = { validateString, validateUUID, parseCurrencyToCents, formatDBError, VALID_TRANSITIONS };