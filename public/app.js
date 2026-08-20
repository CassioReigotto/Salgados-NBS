// --- UTILITÁRIOS ---
const esc = (str) => {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

const formatMoney = (cents) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

const parseCurrencyToCents = (val) => {
    if (!val) return 0;
    const clean = String(val).replace(/[^\d.,]/g, '').replace(',', '.');
    const parsed = parseFloat(clean);
    if (isNaN(parsed) || parsed < 0) return 0;
    return Math.round(parsed * 100);
};

    const statusLabel = (status) => {
    const labels = {
        OPEN: 'Aberto',
        CLOSED: 'Fechado',
        AWAITING_PAYMENT: 'Aguardando pagamento',
        PLACED: 'Pedido realizado',
        RECEIVED: 'Recebido',
        CANCELLED: 'Cancelado',
        PAID: 'Pago',
        PENDING: 'Pendente'
    };

    return labels[status] || status;
};

const app = {
    user: null,
    cart: {},
    products: [],
    
    // --- CONTROLE DE POLLING ---
    POLLING_INTERVAL: 3000,
    pollingTimer: null,
    isPollingActive: false,
    lastSnapshot: null,

    startPolling(fn) {
        this.stopPolling();
        this.pollingTimer = setInterval(async () => {
            // Evita race condition se a internet estiver lenta
            if (this.isPollingActive) return; 
            
            this.isPollingActive = true;
            try {
                await fn();
            } catch(e) {
                console.warn('Polling ignorou um erro temporário:', e.message);
            } finally {
                this.isPollingActive = false;
            }
        }, this.POLLING_INTERVAL);
    },

    stopPolling() {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
        }
        this.isPollingActive = false;
        this.lastSnapshot = null;
    },
    // ---------------------------

    async request(url, options = {}) {
        options.credentials = 'same-origin';
        if (options.body) {
            options.headers = { ...options.headers, 'Content-Type': 'application/json' };
            options.body = JSON.stringify(options.body);
        }
        const res = await fetch(url, options);
        const data = await res.json();
        
        if (res.status === 401) {
            this.renderLogin();
            throw new Error(data.error || 'Não autenticado');
        }
        if (!res.ok) throw new Error(data.error || 'Erro na requisição');
        return data;
    },

    async init() {
        try {
            this.user = await this.request('/api/me');
            document.getElementById('main-header').style.display = 'flex';
            document.getElementById('header-name').innerText = esc(this.user.name);
            if (this.user.role === 'ADMIN') this.renderAdminDashboard();
            else this.renderUserDashboard();
        } catch (e) {
            this.renderLogin();
        }
    },

    async logout() {
        this.stopPolling();
        try { await this.request('/api/auth/logout', { method: 'POST' }); } catch(e){}
        this.user = null;
        document.getElementById('main-header').style.display = 'none';
        this.renderLogin();
    },


    // --- SISTEMA DE MODAL ---
    showModal(title, bodyHtml, onSubmit) {
        document.getElementById('modal-title').innerText = title;
        document.getElementById('modal-body').innerHTML = bodyHtml;
        document.getElementById('modal-error').innerText = '';
        const submitBtn = document.getElementById('modal-submit');
        
        const newBtn = submitBtn.cloneNode(true);
        submitBtn.parentNode.replaceChild(newBtn, submitBtn);
        
        newBtn.onclick = async () => {
            try {
                newBtn.disabled = true;
                document.getElementById('modal-error').innerText = '';
                await onSubmit();
                this.closeModal();
            } catch(e) {
                document.getElementById('modal-error').innerText = e.message;
            } finally {
                newBtn.disabled = false;
            }
        };
        document.getElementById('modal-overlay').style.display = 'flex';
    },

    closeModal() {
        document.getElementById('modal-overlay').style.display = 'none';
    },

    showMessage(title, msg) {
        this.showModal(title, `<p>${esc(msg)}</p>`, () => Promise.resolve());
    },

    // --- AUTENTICAÇÃO ---
    renderLogin() {
    this.stopPolling();

    const html = `
        <div class="login-container">
            <div class="login-card">

                <div class="login-logo">
                    <span class="emoji">🥟</span>
                    <h2>Salgados</h2>
                    <p>Faça login para continuar</p>
                </div>

                <input
                    type="text"
                    id="login-user"
                    placeholder="Usuário"
                    autocomplete="username"
                >

                <input
                    type="password"
                    id="login-pass"
                    placeholder="Senha"
                    autocomplete="current-password"
                >

                <button
                    class="btn-primary"
                    onclick="app.doLogin()"
                >
                    Entrar
                </button>

                <div id="login-error" class="error-text"></div>

            </div>
        </div>
    `;

    document.getElementById('app-container').innerHTML = html;

    // Permite pressionar ENTER para fazer login
    const loginUser = document.getElementById('login-user');
    const loginPass = document.getElementById('login-pass');

    const handleEnter = (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            this.doLogin();
        }
    };

    loginUser.addEventListener('keydown', handleEnter);
    loginPass.addEventListener('keydown', handleEnter);

    loginUser.focus();
},

    async doLogin() {
        const btn = document.querySelector('button');
        btn.disabled = true;
        try {
            await this.request('/api/auth/login', {
                method: 'POST',
                body: { 
                    username: document.getElementById('login-user').value, 
                    password: document.getElementById('login-pass').value 
                }
            });
            this.init();
        } catch (e) { 
            document.getElementById('login-error').innerText = e.message; 
            btn.disabled = false;
        }
    },

    // --- ÁREA DO FUNCIONÁRIO ---
    async renderUserDashboard(isPolling = false) {
        if (!isPolling) {
            this.stopPolling();
            document.getElementById('app-container').innerHTML = '<div class="container">Carregando...</div>';
        }

        try {
            const orders = await this.request('/api/orders');
            
            // Snapshot para evitar recarregar a tela se nada mudou
            const snapshot = JSON.stringify(orders);
            if (isPolling && snapshot === this.lastSnapshot) return;
            this.lastSnapshot = snapshot;

            let html = `<div class="container"><h2>Meus Pedidos</h2><br>`;
            if(orders.length === 0) html += `<p>Nenhum pedido no momento.</p>`;
            
            for (let o of orders) {
                html += `<div class="card flex-between" style="cursor:pointer;" onclick="app.renderOrderUser('${o.id}')">
                    <strong>${esc(o.title)}</strong>
                    <span class="badge ${esc(statusLabel(o.status))}">${esc(statusLabel(o.status))}</span>
                </div>`;
            }
            html += `</div>`;
            document.getElementById('app-container').innerHTML = html;
            
            if (!isPolling) this.startPolling(() => this.renderUserDashboard(true));
        } catch(e) { 
            if (!isPolling) this.showMessage('Erro', e.message); 
            else throw e;
        }
    },

    async renderOrderUser(orderId, isPolling = false) {
        if (!isPolling) {
            this.stopPolling();
            document.getElementById('app-container').innerHTML = '<div class="container">Carregando...</div>';
        }
        
        try {
            const data = await this.request(`/api/orders/${orderId}`);
            const { order, participations } = data;
            const prods = await this.request('/api/products');
            
            // Snapshot inteligente: Compara os dados que vieram do banco
            const snapshot = JSON.stringify({ order, participations, prods });
            if (isPolling && snapshot === this.lastSnapshot) return;
            this.lastSnapshot = snapshot;

            this.products = prods;
            const myOrder = participations[0] || null;
            
            // Se for o primeiro carregamento, reseta o carrinho baseado no banco.
            // Se for polling, mantém o carrinho intacto, apenas adiciona produtos novos zerados.
            if (!isPolling) {
                this.cart = {};
                this.products.forEach(p => this.cart[p.id] = 0);
                if (myOrder && myOrder.status !== 'CANCELLED') {
                    myOrder.items.forEach(i => this.cart[i.product_id] = i.quantity);
                }
            } else {
                this.products.forEach(p => {
                    if (this.cart[p.id] === undefined) this.cart[p.id] = 0;
                });
            }

            const isOpen = order.status === 'OPEN';
            
            let html = `<div class="container">
                <button class="btn-sm btn-secondary" onclick="app.renderUserDashboard()" style="margin-bottom:1rem;">← Voltar</button>
                <div class="card">
                    <h3>${esc(order.title)}</h3>
                    <p style="margin-top:0.5rem">Status: <span class="badge ${esc(statusLabel(order.status))}">${esc(statusLabel(order.status))}</span></p>
                </div>`;

            if (isOpen) {
                html += `<div class="card"><h4>PEDIDO ABERTO</h4><br>`;
                let hasProducts = false;
                this.products.filter(p => p.is_active).forEach(p => {
                    hasProducts = true;
                    html += `
                    <div class="list-item">
                        <div>${esc(p.name)}<br><small class="text-muted">${formatMoney(p.price_cents)}</small></div>
                        <div class="flex-between">
                            <button class="qty-btn" onclick="app.changeQty('${p.id}', -1)">-</button>
                            <span id="qty-${p.id}" style="display:inline-block; width:30px; text-align:center">${this.cart[p.id]}</span>
                            <button class="qty-btn" onclick="app.changeQty('${p.id}', 1)">+</button>
                        </div>
                    </div>`;
                });
                if(!hasProducts) html += `<p>Nenhum produto disponível.</p>`;
                
                html += `<hr>
                <div class="flex-between"><strong>Subtotal:</strong> <span id="user-subtotal">R$ 0,00</span></div>
                <div class="flex-between" style="margin-top:0.5rem"><span class="text-muted">Taxa:</span> <span class="text-muted">Será calculada no fechamento.</span></div>
                <br>
                <button class="btn-primary" onclick="app.confirmParticipation('${order.id}')">CONFIRMAR PEDIDO</button>
                ${myOrder && myOrder.status !== 'CANCELLED' ? `<button class="btn-danger" style="margin-top:0.5rem" onclick="app.cancelParticipation('${order.id}')">Cancelar Pedido</button>` : ''}
                </div>`;
            } else {
                html += `<div class="card"><h4>Seu Pedido</h4>`;
                if (!myOrder || myOrder.status === 'CANCELLED') {
                    html += `<p style="margin-top:1rem">Você não participou ou cancelou sua participação neste pedido.</p>`;
                } else {
                    let sub = 0;
                    myOrder.items.forEach(i => {
                        const totalItem = i.quantity * i.unit_price_cents;
                        sub += totalItem;
                        html += `<div class="list-item">
                            <span>${i.quantity}x ${esc(i.product_name)}</span> 
                            <span>${formatMoney(totalItem)}</span>
                        </div>`;
                    });
                    html += `
                    <hr>
                    <div class="flex-between"><span>Subtotal:</span> <span>${formatMoney(sub)}</span></div>
                    <div class="flex-between" style="margin-top:0.5rem"><span>Taxa de Entrega:</span> <span>${formatMoney(myOrder.applied_delivery_fee_cents)}</span></div>
                    <h3 class="flex-between" style="margin-top:1rem"><span>Total:</span> <span>${formatMoney(sub + myOrder.applied_delivery_fee_cents)}</span></h3>
                    <br>
                    <p>Pagamento: <span class="badge ${esc(statusLabel(myOrder.payment_status))}">${esc(statusLabel(myOrder.payment_status))}</span></p>
                    `;
                }
                html += `</div>`;
            }

            document.getElementById('app-container').innerHTML = html;
            if (isOpen) this.updateSubtotal();

            if (!isPolling) this.startPolling(() => this.renderOrderUser(orderId, true));

        } catch(e) { 
            if (!isPolling) this.showMessage('Erro', e.message); 
            else throw e;
        }
    },

    changeQty(pid, delta) {
        if (this.cart[pid] + delta >= 0) {
            this.cart[pid] += delta;
            // Atualiza o DOM imediatamente sem esperar o polling
            document.getElementById(`qty-${pid}`).innerText = this.cart[pid];
            this.updateSubtotal();
        }
    },

    updateSubtotal() {
        let total = 0;
        this.products.forEach(p => total += (this.cart[p.id] || 0) * p.price_cents);
        const subEl = document.getElementById('user-subtotal');
        if (subEl) subEl.innerText = formatMoney(total);
    },

    async confirmParticipation(orderId) {
    try {
        const items = Object.keys(this.cart)
            .filter(id => this.cart[id] > 0)
            .map(id => ({
                productId: id,
                quantity: this.cart[id]
            }));

        if (items.length === 0) {
            return this.showMessage(
                'Atenção',
                'Selecione pelo menos um item para confirmar o pedido.'
            );
        }

        this.stopPolling();

        await this.request(`/api/orders/${orderId}/participate`, {
            method: 'POST',
            body: { items }
        });

        this.showModal(
            'Sucesso',
            '<p>Pedido confirmado ✓</p>',
            async () => {
                await this.renderUserDashboard();
            }
        );

    } catch(e) {
        this.showMessage('Erro', e.message);
        this.startPolling(() => this.renderOrderUser(orderId, true));
    }
},

    cancelParticipation(orderId) {
        this.showModal('Cancelar Pedido', '<p>Deseja realmente cancelar sua participação neste pedido?</p>', async () => {
            this.stopPolling();
            await this.request(`/api/orders/${orderId}/cancel`, { method: 'POST' });
            this.renderOrderUser(orderId);
        });
    },

    // --- ÁREA DO ADMINISTRADOR ---
    async renderAdminDashboard() {
    this.stopPolling();

    const html = `
        <div class="container-wide">

            <div class="admin-header">
                <h2>Dashboard Administrativo</h2>
                <p>Gerencie pedidos, produtos e usuários.</p>
            </div>

            <div class="admin-stats">

                <div class="stat-card">
                    <div class="stat-icon">📦</div>
                    <div id="admin-stat-orders" class="stat-value">-</div>
                    <div class="stat-label">Pedidos</div>
                </div>

                <div class="stat-card">
                    <div class="stat-icon">👥</div>
                    <div id="admin-stat-users" class="stat-value">-</div>
                    <div class="stat-label">Usuários</div>
                </div>

                <div class="stat-card">
                    <div class="stat-icon">💰</div>
                    <div id="admin-stat-total" class="stat-value">R$ 0,00</div>
                    <div class="stat-label">Arrecadação</div>
                </div>

            </div>

            <div class="admin-actions">

                <button
                    class="btn-primary"
                    onclick="app.adminViewOrders()"
                >
                    📦 Pedidos
                </button>

                <button
                    class="btn-secondary"
                    onclick="app.adminViewProducts()"
                >
                    🥟 Produtos
                </button>

                <button
                    class="btn-secondary"
                    onclick="app.adminViewUsers()"
                >
                    👥 Usuários
                </button>

            </div>

            <div
                id="admin-content"
                style="margin-top: 1.5rem;"
            ></div>

        </div>
    `;

    document.getElementById('app-container').innerHTML = html;

    // Carrega os indicadores sem criar novas APIs
    try {
        const [orders, users] = await Promise.all([
            this.request('/api/orders'),
            this.request('/api/users')
        ]);

        document.getElementById('admin-stat-orders').innerText =
            orders.length;

        document.getElementById('admin-stat-users').innerText =
            users.length;

        // Mantemos a arrecadação como informação complementar.
        // O valor exato continuará sendo calculado no detalhe do pedido.
        document.getElementById('admin-stat-total').innerText =
            '—';

    } catch (e) {
        console.warn('Não foi possível carregar indicadores:', e.message);
    }

    this.adminViewOrders();
},

    // ADMIN: PRODUTOS
    async adminViewProducts(isPolling = false) {
        if (!isPolling) this.stopPolling();
        try {
            const prods = await this.request('/api/products');
            const snapshot = JSON.stringify(prods);
            if (isPolling && snapshot === this.lastSnapshot) return;
            this.lastSnapshot = snapshot;

            let html = `<div class="flex-between"><h3>Produtos</h3><button class="btn-sm btn-primary" onclick="app.adminModalProduct()">+ Novo</button></div><br>`;
            prods.forEach(p => {
                html += `<div class="card flex-between">
                    <div>
                        <strong>${esc(p.name)}</strong> - ${formatMoney(p.price_cents)}<br>
                        <small class="${p.is_active ? 'text-success' : 'text-danger'}">${p.is_active ? 'Ativo' : 'Inativo'}</small>
                    </div>
                    <button class="btn-sm btn-secondary" onclick="app.adminModalProduct('${p.id}', '${esc(p.name)}', ${p.price_cents}, ${p.is_active})">Editar</button>
                </div>`;
            });
            document.getElementById('admin-content').innerHTML = html;
            
            if (!isPolling) this.startPolling(() => this.adminViewProducts(true));
        } catch(e) { if (!isPolling) this.showMessage('Erro', e.message); else throw e; }
    },

    adminModalProduct(id = null, name = '', priceCents = 0, isActive = true) {
        const title = id ? 'Editar Produto' : 'Novo Produto';
        const priceStr = id ? (priceCents / 100).toFixed(2).replace('.', ',') : '';
        const html = `
            <input type="text" id="prod-name" placeholder="Nome" value="${esc(name)}">
            <input type="text" id="prod-price" placeholder="Preço (ex: 9,50)" value="${priceStr}">
            <label><input type="checkbox" id="prod-active" ${isActive ? 'checked' : ''}> Produto Ativo</label>
        `;
        this.showModal(title, html, async () => {
            const body = {
                name: document.getElementById('prod-name').value,
                price: document.getElementById('prod-price').value,
                is_active: document.getElementById('prod-active').checked
            };
            const method = id ? 'PUT' : 'POST';
            const url = id ? `/api/products/${id}` : '/api/products';
            await this.request(url, { method, body });
            this.adminViewProducts(); // Isso fará stopPolling e resetará o render
        });
    },

    // ADMIN: USUÁRIOS
    async adminViewUsers(isPolling = false) {
        if (!isPolling) this.stopPolling();
        try {
            const users = await this.request('/api/users');
            const snapshot = JSON.stringify(users);
            if (isPolling && snapshot === this.lastSnapshot) return;
            this.lastSnapshot = snapshot;

            let html = `<div class="flex-between"><h3>Usuários</h3><button class="btn-sm btn-primary" onclick="app.adminModalUser()">+ Novo</button></div><br>`;
            users.forEach(u => {
                html += `<div class="card flex-between">
                    <div>
                        <strong>${esc(u.name)}</strong> (@${esc(u.username)})<br>
                        <small>${u.role} - ${u.is_active ? 'Ativo' : 'Inativo'}</small>
                    </div>
                    <button class="btn-sm btn-secondary" onclick="app.adminModalUser('${u.id}', '${esc(u.name)}', '${esc(u.username)}', '${u.role}', ${u.is_active})">Editar</button>
                </div>`;
            });
            document.getElementById('admin-content').innerHTML = html;
            
            if (!isPolling) this.startPolling(() => this.adminViewUsers(true));
        } catch(e) { if (!isPolling) this.showMessage('Erro', e.message); else throw e; }
    },

    adminModalUser(id = null, name = '', username = '', role = 'USER', isActive = true) {
        const title = id ? 'Editar Usuário' : 'Novo Usuário';
        const passHolder = id ? 'Nova Senha (vazio p/ manter)' : 'Senha';
        const html = `
            <input type="text" id="usr-name" placeholder="Nome Completo" value="${esc(name)}">
            <input type="text" id="usr-username" placeholder="Username" value="${esc(username)}">
            <input type="password" id="usr-pass" placeholder="${passHolder}">
            <select id="usr-role">
                <option value="USER" ${role === 'USER' ? 'selected' : ''}>Usuário Comum</option>
                <option value="ADMIN" ${role === 'ADMIN' ? 'selected' : ''}>Administrador</option>
            </select>
            <label><input type="checkbox" id="usr-active" ${isActive ? 'checked' : ''}> Conta Ativa</label>
        `;
        this.showModal(title, html, async () => {
            const body = {
                name: document.getElementById('usr-name').value,
                username: document.getElementById('usr-username').value,
                password: document.getElementById('usr-pass').value,
                role: document.getElementById('usr-role').value,
                is_active: document.getElementById('usr-active').checked
            };
            if (!id && body.password.length < 6) throw new Error('A senha deve ter no mínimo 6 caracteres.');
            
            const method = id ? 'PUT' : 'POST';
            const url = id ? `/api/users/${id}` : '/api/users';
            await this.request(url, { method, body });
            this.adminViewUsers();
        });
    },

    // ADMIN: PEDIDOS GERAIS
    async adminViewOrders(isPolling = false) {
        if (!isPolling) this.stopPolling();
        try {
            const orders = await this.request('/api/orders');
            const snapshot = JSON.stringify(orders);
            if (isPolling && snapshot === this.lastSnapshot) return;
            this.lastSnapshot = snapshot;

            let html = `<div class="flex-between"><h3>Pedidos Gerais</h3><button class="btn-sm btn-primary" onclick="app.adminModalOrder()">+ Novo Pedido</button></div><br>`;
            orders.forEach(o => {
                html += `
    <div
        class="card card-hover"
        style="cursor:pointer;"
        onclick="app.adminManageOrder('${o.id}')"
    >
        <div class="flex-between">

            <div>
                <strong>${esc(o.title)}</strong>

                <div class="text-muted" style="margin-top:0.3rem;">
                    Pedido geral
                </div>
            </div>

            <span class="badge ${esc(statusLabel(o.status))}">
                ${esc(statusLabel(o.status))}
            </span>

        </div>
    </div>
`;
            });
            document.getElementById('admin-content').innerHTML = html;
            
            if (!isPolling) this.startPolling(() => this.adminViewOrders(true));
        } catch(e) { if (!isPolling) this.showMessage('Erro', e.message); else throw e; }
    },

    adminModalOrder() {
        const html = `
            <input type="text" id="ord-title" placeholder="Título (ex: Salgados Sexta)">
            <input type="text" id="ord-fee" placeholder="Taxa de Entrega (ex: 10,99)">
        `;
        this.showModal('Novo Pedido', html, async () => {
            const body = {
                title: document.getElementById('ord-title').value,
                delivery_fee: document.getElementById('ord-fee').value
            };
            await this.request('/api/orders', { method: 'POST', body });
            this.adminViewOrders();
        });
    },
// --- RESUMO DO PEDIDO PARA COPIAR ---
    async copyOrderSummary(orderId, compact = false) {
        try {
            const data = await this.request(`/api/orders/${orderId}`);
            const { order, participations } = data;

            const participantes = participations.filter(
                p => p.status !== 'CANCELLED'
            );

            if (participantes.length === 0) {
                return this.showMessage(
                    'Atenção',
                    'Não existem participantes neste pedido.'
                );
            }

            let texto = '';

            if (compact) {
                // ==========================================
                // VERSÃO CURTA - COBRANÇA
                // ==========================================

                texto += `🍴 ${order.title}\n\n`;

                let totalGeral = 0;

                participantes.forEach(p => {
                    let subtotal = 0;

                    p.items.forEach(i => {
                        subtotal += i.quantity * i.unit_price_cents;
                    });

                    const total = subtotal + p.applied_delivery_fee_cents;
                    totalGeral += total;

                    texto += `${p.user_name} — ${formatMoney(total)}\n`;
                });

                texto += `\n`;
                texto += `💰 Total: ${formatMoney(totalGeral)}`;

            } else {
                // ==========================================
                // VERSÃO COMPLETA
                // ==========================================

                texto += `📦 ${order.title}\n`;
                texto += `\n`;

                let totalSalgados = 0;
                let totalTaxas = 0;
                let totalGeral = 0;

                participantes.forEach(p => {
                    let subtotal = 0;

                    texto += `👤 ${p.user_name}\n`;

                    p.items.forEach(i => {
                        const totalItem =
                            i.quantity * i.unit_price_cents;

                        subtotal += totalItem;

                        texto +=
                            `  ${i.quantity}x ${i.product_name} - ${formatMoney(totalItem)}\n`;
                    });

                    const taxa = p.applied_delivery_fee_cents;
                    const total = subtotal + taxa;

                    totalSalgados += subtotal;
                    totalTaxas += taxa;
                    totalGeral += total;

                    texto +=
                        `  Taxa: ${formatMoney(taxa)}\n`;

                    texto +=
                        `  TOTAL: ${formatMoney(total)}\n`;

                    texto += `\n`;
                });

                texto += `━━━━━━━━━━━━━━━━━━\n`;
                texto += `🍴 Salgados: ${formatMoney(totalSalgados)}\n`;
                texto += `🚚 Entrega: ${formatMoney(totalTaxas)}\n`;
                texto += `💰 TOTAL GERAL: ${formatMoney(totalGeral)}`;
            }

            await navigator.clipboard.writeText(texto);

            this.showMessage(
                'Copiado!',
                compact
                    ? 'Resumo de cobrança copiado para a área de transferência.'
                    : 'Resumo completo copiado para a área de transferência.'
            );

        } catch (e) {
            this.showMessage(
                'Erro',
                'Não foi possível copiar o resumo: ' + e.message
            );
        }
    },
    // ADMIN: DETALHE DO PEDIDO
    async adminManageOrder(orderId, isPolling = false) {
        if (!isPolling) this.stopPolling();
        try {
            const data = await this.request(`/api/orders/${orderId}`);
            const snapshot = JSON.stringify(data);
            if (isPolling && snapshot === this.lastSnapshot) return;
            this.lastSnapshot = snapshot;

            const { order, participations } = data;
            
            let html = `<button class="btn-sm btn-secondary" onclick="app.adminViewOrders()" style="margin-bottom:1rem;">← Voltar</button>`;
            
            html += `<div class="card">
                <h3>PEDIDO: ${esc(order.title)}</h3><br>
                <p>Status: <span class="badge ${esc(statusLabel(order.status))}">${esc(statusLabel(order.status))}</span></p>
                <p style="margin-top:0.5rem">Taxa Informada: ${formatMoney(order.delivery_fee_cents)}</p>
            </div>`;

            if (order.status === 'OPEN') {
                html += `<button class="btn-danger" style="margin-bottom:1rem; padding:1rem;" onclick="app.adminCloseOrder('${order.id}')">FECHAR PEDIDO E CALCULAR RATEIO</button>`;
            } else {

    if (order.status === 'CLOSED' ||
        order.status === 'AWAITING_PAYMENT' ||
        order.status === 'PLACED' ||
        order.status === 'RECEIVED') {

        html += `
            <div class="card" style="margin-bottom:1rem;">
                <h4>📋 Resumo do Pedido</h4>

                <p class="text-muted" style="margin:0.5rem 0 1rem;">
                    Copie as informações do pedido para enviar no grupo.
                </p>

                <div class="grid">
                    <button
                        class="btn-primary"
                        onclick="app.copyOrderSummary('${order.id}', false)"
                    >
                        📋 Copiar Resumo Completo
                    </button>

                    <button
                        class="btn-secondary"
                        onclick="app.copyOrderSummary('${order.id}', true)"
                    >
                        💰 Copiar Cobrança
                    </button>
                </div>
            </div>
        `;
    }

    html += `<div class="grid" style="margin-bottom:1rem">
        <button class="${order.status === 'CLOSED' ? 'btn-primary' : 'btn-secondary'}" ${order.status !== 'CLOSED' ? 'disabled' : ''} onclick="app.adminChangeStatus('${order.id}', 'AWAITING_PAYMENT')">Aguardar Pagamento</button>

        <button class="${order.status === 'AWAITING_PAYMENT' ? 'btn-primary' : 'btn-secondary'}" ${order.status !== 'AWAITING_PAYMENT' ? 'disabled' : ''} onclick="app.adminChangeStatus('${order.id}', 'PLACED')">Realizado no Fornecedor</button>

        <button class="${order.status === 'PLACED' ? 'btn-success' : 'btn-secondary'}" ${order.status !== 'PLACED' ? 'disabled' : ''} onclick="app.adminChangeStatus('${order.id}', 'RECEIVED')">Recebido ✅</button>
    </div>`;
}

            html += `<h4>Participantes</h4><br>`;
            
            let totalSalgados = 0;
            let totalTaxas = 0;
            let participantesValidos = 0;

            participations.forEach(p => {
                if (p.status === 'CANCELLED') return;
                participantesValidos++;
                
                let sub = 0;
                let itensStr = p.items.map(i => {
                    sub += i.quantity * i.unit_price_cents;
                    return `${i.quantity}x ${esc(i.product_name)}`;
                }).join(', ');
                
                totalSalgados += sub;
                totalTaxas += p.applied_delivery_fee_cents;
                let totalInd = sub + p.applied_delivery_fee_cents;

                html += `<div class="card">
                    <div class="flex-between">
                        <strong>${esc(p.user_name)}</strong>
                        <span style="font-weight:bold">${formatMoney(totalInd)}</span>
                    </div>
                    <div class="text-muted" style="margin:0.5rem 0">${itensStr}</div>
                    
                    <div class="flex-between text-muted">
                        <small>Salgados: ${formatMoney(sub)}</small>
                        <small>Taxa: ${order.status === 'OPEN' ? 'Aguardando fechamento' : formatMoney(p.applied_delivery_fee_cents)}</small>
                    </div>
                    <hr>
                    <div class="flex-between">
                        <span class="badge ${esc(p.payment_status)}">${esc(p.payment_status)}</span>
                        ${order.status !== 'OPEN' ? `<button class="btn-sm btn-secondary" onclick="app.adminTogglePayment('${p.id}', '${p.payment_status}', '${order.id}')">Alterar Pagto</button>` : ''}
                    </div>
                </div>`;
            });

            if (participantesValidos === 0) {
                html += `<p>Nenhum participante confirmado.</p>`;
            } else {
                html += `<div class="card" style="background:#e0f2fe; border-color:#bae6fd;">
                    <h3>RESUMO FINAL</h3><br>
                    <div class="flex-between"><span>Total Salgados:</span> <span>${formatMoney(totalSalgados)}</span></div>
                    <div class="flex-between"><span>Total Taxas Rateadas:</span> <span>${formatMoney(totalTaxas)}</span></div>
                    <hr>
                    <div class="flex-between"><h3>ARRECADAÇÃO TOTAL:</h3> <h3>${formatMoney(totalSalgados + totalTaxas)}</h3></div>
                </div>`;
            }

            document.getElementById('admin-content').innerHTML = html;
            
            if (!isPolling) this.startPolling(() => this.adminManageOrder(orderId, true));
        } catch(e) { if (!isPolling) this.showMessage('Erro', e.message); else throw e; }
    },

    adminCloseOrder(orderId) {
        this.showModal('Fechar Pedido', '<p>Atenção! Isso trancará os pedidos dos funcionários e fará o cálculo exato do rateio de entrega com base no número final de participantes. Deseja continuar?</p>', async () => {
            this.stopPolling();
            await this.request(`/api/orders/${orderId}/close`, { method: 'POST' });
            this.adminManageOrder(orderId);
        });
    },

    adminChangeStatus(orderId, newStatus) {
        this.showModal('Avançar Status', `<p>Deseja avançar o pedido para o status <strong>${newStatus}</strong>?</p>`, async () => {
            this.stopPolling();
            await this.request(`/api/orders/${orderId}/status`, { method: 'PATCH', body: { status: newStatus } });
            this.adminManageOrder(orderId);
        });
    },

    adminTogglePayment(userOrderId, currentStatus, orderId) {
        const nextStatus = currentStatus === 'PAID' ? 'PENDING' : 'PAID';
        this.showModal('Atualizar Pagamento', `<p>Marcar pagamento como <strong>${nextStatus}</strong>?</p>`, async () => {
            this.stopPolling();
            await this.request(`/api/user-orders/${userOrderId}/payment`, { method: 'PATCH', body: { payment_status: nextStatus } });
            this.adminManageOrder(orderId);
        });
    }
};

window.onload = () => app.init();
