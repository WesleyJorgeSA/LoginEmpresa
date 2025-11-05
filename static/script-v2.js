// Espera o documento HTML carregar antes de rodar o script
document.addEventListener("DOMContentLoaded", () => {

    const API_URL = "http://127.0.0.1:5000";
    let usuarioLogado = null; 

    // --- Declarações de Funções de Carregamento (Escopo Global) ---
    let carregarOrdensDeServico = async (filters = {}) => {
        console.warn("Função carregarOrdensDeServico não inicializada (provavelmente não está no dashboard)");
    };
    let carregarMinhasOrdensDeServico = async (filters = {}) => {
        console.warn("Função carregarMinhasOrdensDeServico não inicializada (provavelmente não está na página Minhas OSs)");
    };
    // ------------------------------------------------------------------

    // --- FUNÇÕES DE AJUDA GLOBAIS (JWT) ---
    function salvarToken(token, usuario) {
        try {
            localStorage.setItem("token", token.trim());
            localStorage.setItem("usuario", JSON.stringify(usuario));
            usuarioLogado = usuario;
        } catch (e) { console.error("ERRO CRÍTICO AO SALVAR TOKEN: ", e); }
    }
    function getToken() { return localStorage.getItem("token"); }
    function getUsuario() {
        if(usuarioLogado) return usuarioLogado;
        try {
            const usuarioJSON = localStorage.getItem("usuario");
            if (usuarioJSON) {
                usuarioLogado = JSON.parse(usuarioJSON);
                return usuarioLogado;
            }
        } catch (e) {
             console.error("Erro ao ler usuário do localStorage:", e);
             localStorage.removeItem("usuario"); return null;
        }
        return null;
    }
    function limparToken() {
        localStorage.removeItem("token");
        localStorage.removeItem("usuario");
        usuarioLogado = null;
    }
    async function fetchSeguro(url, options = {}) {
        const token = getToken();
        const headers = new Headers(options.headers || {});
        if (options.body && !headers.has('Content-Type')) {
            headers.append("Content-Type", "application/json");
        }
        if (token) {
            headers.append("Authorization", "Bearer " + token);
        }
        options.headers = headers;
        options.credentials = 'include'; 

        try {
             const response = await fetch(url, options);
             if (response.status === 401 || response.status === 422) {
                 limparToken();
                 if (!window.location.pathname.endsWith('/index.html') && !window.location.pathname.endsWith('/')) {
                      alert("Sua sessão expirou (erro " + response.status + "). Faça login novamente.");
                      window.location.href = "index.html";
                 }
                 throw new Error("Sessão inválida"); 
             }
             return response;
        } catch (networkError) {
             console.error("Erro de rede no fetchSeguro:", networkError);
             throw networkError;
        }
    }
    
    // --- FUNÇÃO GLOBAL DE CRIAR CARD ---
    function criarCardOS(os) {
        const osCard = document.createElement("div"); osCard.className = "os-card";
        const nomeEquipamento = os.equipamento_tag ? `${os.equipamento_tag} - ${os.equipamento_nome}` : '(Equipamento Excluído)';
        const criador = os.nome_criador || 'Desconhecido';
        const tecnico = os.nome_tecnico || 'N/A';
        const botoesHtml = `<a href="ordem.html?id=${os.id}" class="btn-detalhes" data-os-id="${os.id}">Ver Detalhes</a>`;
        const statusClass = os.status.toLowerCase().replace(' ','-');
        const prioridade = os.prioridade || 'Baixa';
        const prioridadeClass = prioridade.toLowerCase(); 
        const notasHtml = os.notas_tecnico ? `<p class="os-notas"><b>Notas:</b> ${os.notas_tecnico.replace(/\n/g, '<br>')}</p>` : '';

        osCard.innerHTML = `
            <div class="os-header">
                <strong>${nomeEquipamento} (OS #${os.id})</strong>
                <div class="os-tags">
                    <span class="os-prioridade ${prioridadeClass}">${prioridade}</span>
                    <span class="os-status ${statusClass}">${os.status}</span>
                </div>
            </div>
            <p class="os-descricao">${os.descricao}</p>
            <div class="os-info"><span><b>Criada por:</b> ${criador}</span><span><b>Em:</b> ${os.data_abertura_formatada || 'N/A'}</span></div>
            <div class="os-info"><span><b>Técnico:</b> ${tecnico}</span><span><b>Concluída em:</b> ${os.data_conclusao_formatada || 'N/A'}</span></div>
            ${notasHtml} <div class="os-botoes">${botoesHtml}</div>
        `;
        return osCard;
    }

    // --- LÓGICA GLOBAL DO MODAL (CONCLUIR OS) ---
    const modal = document.getElementById("modal-concluir");
    let callbackAposConcluir = null; 
    let osIdParaConcluir = null;
    
    function abrirModalConcluir(osId, callback) {
        const modalOsIdSpan = document.getElementById("modal-os-id");
        const modalNotasInput = document.getElementById("modal-notas-tecnico");
        const modalMensagem = document.getElementById("modal-mensagem");
        const modalSubmitButton = modalForm ? modalForm.querySelector('button[type="submit"]') : null;
        if (!modal || !modalOsIdSpan || !modalNotasInput || !modalMensagem || !modalSubmitButton) return; 
        osIdParaConcluir = osId;
        callbackAposConcluir = callback; 
        modalOsIdSpan.textContent = osId;
        modalNotasInput.value = "";
        modalMensagem.textContent = ""; modalMensagem.className = "mensagem";
        modalSubmitButton.disabled = false; modalSubmitButton.textContent = 'Concluir OS';
        modal.style.display = "flex";
    }
    function fecharModalConcluir() { if (modal) modal.style.display = "none"; }
    
    const modalCancelar = document.getElementById("modal-cancelar");
    if (modalCancelar) modalCancelar.addEventListener("click", fecharModalConcluir);
    
    const modalForm = document.getElementById("form-concluir");
    if (modalForm) {
        // Este event listener só é usado pela página ordem.html
        modalForm.addEventListener("submit", async (event) => {
            event.preventDefault(); 
            const modalNotasInput = document.getElementById("modal-notas-tecnico");
            const modalMensagem = document.getElementById("modal-mensagem");
            const modalSubmitButton = modalForm.querySelector('button[type="submit"]');
            const notas = modalNotasInput ? modalNotasInput.value : ''; 
            
            if (!osIdParaConcluir) return;
            
            modalSubmitButton.disabled = true; modalSubmitButton.textContent = 'Enviando...';
            modalMensagem.textContent = ""; modalMensagem.className = "mensagem";
            try {
                const response = await fetchSeguro(`${API_URL}/ordens/${osIdParaConcluir}/concluir`, {
                    method: "POST", body: JSON.stringify({ notas_tecnico: notas })
                });
                const data = await response.json();
                if (response.ok) {
                    alert(data.message); fecharModalConcluir();
                    if(callbackAposConcluir) callbackAposConcluir();
                } else {
                    modalMensagem.textContent = data.message; modalMensagem.className = "mensagem erro";
                    modalSubmitButton.disabled = false; modalSubmitButton.textContent = 'Concluir OS';
                }
            } catch (error) {
                modalSubmitButton.disabled = false; modalSubmitButton.textContent = 'Concluir OS';
                if (error.message !== "Sessão inválida") {
                    console.error("Erro ao concluir OS:", error);
                    modalMensagem.textContent = "Erro de conexão."; modalMensagem.className = "mensagem erro";
                }
            }
        });
    }

    // --- Lógica do Formulário de REGISTRO (Página cadastro.html) ---
    const registroFormPagina = document.getElementById("registro-form");
    if (registroFormPagina) {
        registroFormPagina.addEventListener("submit", (event) => {
             event.preventDefault();
             const registroMensagem = registroFormPagina.querySelector(".mensagem");
             registroMensagem.textContent = "Erro: O registro deve ser feito por um Admin.";
             registroMensagem.className = "mensagem erro";
        });
    }

    // --- Lógica do Formulário de LOGIN ---
    const loginForm = document.getElementById("login-form");
    if (loginForm) {
        loginForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const loginMensagem = document.getElementById("login-mensagem");
            loginMensagem.textContent = ""; loginMensagem.className = "mensagem";
            const email = document.getElementById("login-email").value;
            const senha = document.getElementById("login-senha").value;
             if(!email || !senha) { return; }
            try {
                const response = await fetch(`${API_URL}/login`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, senha }),
                });
                const data = await response.json();
                if (response.ok) {
                    salvarToken(data.token, data.usuario); 
                    const tokenSalvo = getToken();
                    if (!tokenSalvo) { console.error("FALHA! localStorage não salvou o token."); return; }
                    loginMensagem.textContent = "Login bem-sucedido! Redirecionando...";
                    loginMensagem.className = "mensagem sucesso";
                    
                    // --- LÓGICA DE REDIRECIONAMENTO (Email) ---
                    const usuarioLogado = data.usuario; 
                    setTimeout(() => {
                        if (usuarioLogado.role === 'Monitor') {
                            window.location.href = "monitor.html";
                        } else {
                            window.location.href = "dashboard.html";
                        }
                    }, 1500);
                    // --- FIM DA LÓGICA ---
                } else {
                    loginMensagem.textContent = data.message; loginMensagem.className = "mensagem erro";
                }
            } catch (error) {
                console.error("Erro ao logar:", error);
                loginMensagem.textContent = "Erro de conexão."; loginMensagem.className = "mensagem erro";
            }
        });
    }
    
    // --- Lógica do Formulário de LOGIN POR CÓDIGO ---
    const loginCodigoForm = document.getElementById("login-codigo-form");
    if (loginCodigoForm) {
        loginCodigoForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const loginMensagem = document.getElementById("login-codigo-mensagem");
            loginMensagem.textContent = ""; loginMensagem.className = "mensagem";
            const codigo = document.getElementById("codigo-unico").value;
            if(!codigo) { return; }
            
            try {
                const response = await fetch(`${API_URL}/login-codigo`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ codigo_unico: codigo }),
                });
                const data = await response.json();
                
                if (response.ok) {
                    salvarToken(data.token, data.usuario); 
                    const tokenSalvo = getToken();
                    if (!tokenSalvo) { console.error("FALHA! localStorage não salvou o token."); return; }
                    
                    loginMensagem.textContent = "Login bem-sucedido! Redirecionando...";
                    loginMensagem.className = "mensagem sucesso";

                    // --- LÓGICA DE REDIRECIONAMENTO (Código) ---
                    const usuarioLogado = data.usuario; 
                    setTimeout(() => {
                        if (usuarioLogado.role === 'Monitor') {
                            window.location.href = "monitor.html";
                        } else {
                            window.location.href = "dashboard.html";
                        }
                    }, 1500);
                    // --- FIM DA LÓGICA ---
                } else {
                    loginMensagem.textContent = data.message;
                    loginMensagem.className = "mensagem erro";
                }
            } catch (error) {
                console.error("Erro ao logar com código:", error);
                loginMensagem.textContent = "Erro de conexão.";
                loginMensagem.className = "mensagem erro";
            }
        });
    }

    // --- LÓGICA DO FORMULÁRIO DE FILTRO ---
    const filtroForm = document.getElementById("filtro-os-form");
    if (filtroForm) {
        filtroForm.addEventListener("submit", (event) => {
            event.preventDefault(); 
            
            const filters = {
                equipamento: document.getElementById("filtro-equipamento").value,
                status: document.getElementById("filtro-status").value,
                prioridade: document.getElementById("filtro-prioridade").value
            };
            
            if (document.getElementById("lista-os-container")) {
                carregarOrdensDeServico(filters);
            } else if (document.getElementById("minhas-os-lista-container")) {
                carregarMinhasOrdensDeServico(filters);
            }
        });
    }

    // --- Lógica da Página DASHBOARD ---
    const dashboardContainer = document.getElementById("lista-os-container"); 
    if (dashboardContainer) {
        
        (async () => { 
            usuarioLogado = getUsuario(); const token = getToken();
            if (!token || !usuarioLogado) {
                 limparToken();
                 if (!window.location.pathname.endsWith('/index.html') && !window.location.pathname.endsWith('/')) {
                     alert("Acesso negado. Faça login primeiro.");
                     window.location.href = "index.html";
                 }
                 return;
            }
            document.getElementById("info-usuario").textContent = `Logado como: ${usuarioLogado.nome} (${usuarioLogado.role})`;
            inicializarDashboard();
        })(); 

        function inicializarDashboard() {
            const logoutButton = document.getElementById("logout-button");
            if (logoutButton) {
                logoutButton.addEventListener("click", (event) => {
                    event.preventDefault(); limparToken();
                    alert("Você saiu do sistema."); window.location.href = "index.html";
                });
            }

            // MOSTRAR LINKS DE NAVEGAÇÃO
            const linkAdmin = document.getElementById('link-admin');
            const linkMinhasOS = document.getElementById('link-minhas-os');
            if (usuarioLogado) {
                if (linkAdmin && usuarioLogado.role === 'Admin') {
                    linkAdmin.style.display = 'inline-block';
                }
                if (linkMinhasOS && (usuarioLogado.role === 'Admin' || usuarioLogado.role === 'Técnico')) {
                    linkMinhasOS.style.display = 'inline-block';
                }
            }

            // Lógica para CRIAR Nova OS
            const osForm = document.getElementById("os-form");
            const osMensagem = document.getElementById("os-mensagem");
            if (osForm) {
                const prioridadeSelect = document.getElementById("os-prioridade");
                if(prioridadeSelect) prioridadeSelect.value = "Baixa"; 
                
                // Carregar Equipamentos no Dropdown
                const equipamentoSelect = document.getElementById("os-equipamento-select");
                async function carregarEquipamentosDropdown() {
                    if (!equipamentoSelect) return;
                    try {
                        // --- CORREÇÃO: Usa a rota /equipamentos (pública) ---
                        const response = await fetchSeguro(`${API_URL}/equipamentos`, { method: "GET" });
                        if (!response.ok) { throw new Error('Falha ao buscar equipamentos'); }
                        const equipamentos = await response.json();
                        equipamentoSelect.innerHTML = '<option value="">-- Selecione um equipamento --</option>'; 
                        equipamentos.forEach(eq => {
                            const option = document.createElement('option');
                            option.value = eq.id;
                            option.textContent = `${eq.tag} - ${eq.nome_equipamento} (${eq.setor})`;
                            equipamentoSelect.appendChild(option);
                        });
                    } catch (error) {
                         if (error.message !== "Sessão inválida") {
                              console.error("Erro ao carregar dropdown:", error);
                              equipamentoSelect.innerHTML = '<option value="">Erro ao carregar</option>';
                         }
                    }
                }
                carregarEquipamentosDropdown();
                
                osForm.addEventListener("submit", async (event) => {
                    event.preventDefault();
                    osMensagem.textContent = ""; osMensagem.className = "mensagem";
                    const equipamento_id = document.getElementById("os-equipamento-select").value; 
                    const descricao = document.getElementById("os-descricao").value;
                    const prioridade = prioridadeSelect ? prioridadeSelect.value : "Baixa"; 
                    
                    if(!equipamento_id || !descricao) { 
                         osMensagem.textContent = "Equipamento e Descrição são obrigatórios.";
                         osMensagem.className = "mensagem erro";
                         return; 
                    }
                    try {
                        const response = await fetchSeguro(`${API_URL}/ordens`, {
                            method: "POST", 
                            body: JSON.stringify({ equipamento_id, descricao, prioridade }), 
                        });
                        const data = await response.json();
                        
                        // --- LÓGICA DE LOGOUT DO OPERADOR ---
                        if (response.ok) {
                            const usuario = getUsuario();
                            if (usuario && usuario.role === 'Operador') {
                                osMensagem.textContent = data.message + " Logout automático em 3 segundos...";
                                osMensagem.className = "mensagem sucesso";
                                setTimeout(() => {
                                    limparToken(); 
                                    window.location.href = "index.html";
                                }, 3000); 
                            } else {
                                osMensagem.textContent = data.message; 
                                osMensagem.className = "mensagem sucesso";
                                osForm.reset(); 
                                if(prioridadeSelect) prioridadeSelect.value = "Baixa"; 
                                carregarOrdensDeServico(); 
                            }
                        } else {
                            osMensagem.textContent = data.message; osMensagem.className = "mensagem erro";
                        }
                        // --- FIM DA LÓGICA DE LOGOUT ---

                    } catch (error) { if (error.message !== "Sessão inválida") {
                        console.error("Erro ao criar OS:", error);
                        osMensagem.textContent = "Erro de conexão."; osMensagem.className = "mensagem erro";
                    }}
                });
            }

            // Lógica para LISTAR (Todas) as OSs (Simplificada - só ativas)
            const listaOsContainer = document.getElementById("lista-os-container");
            carregarOrdensDeServico = async function(filters = {}) { // Atribui à função global
                // (O filtro está vazio, mas a função do form de filtro chama ela)
                if (!listaOsContainer) return;
                listaOsContainer.innerHTML = "<p>Carregando ordens ativas...</p>";
                
                try {
                    // Rota /ordens (sem filtros) já retorna só as ativas
                    const response = await fetchSeguro(`${API_URL}/ordens`, { method: "GET" }); 
                    if (!response.ok) { throw new Error(`Falha: ${response.statusText}`); }
                    const ordens = await response.json();
                    
                    if (ordens.length === 0) { 
                        listaOsContainer.innerHTML = "<p>Nenhuma Ordem de Serviço ativa no momento.</p>"; 
                        return; 
                    }
                    
                    listaOsContainer.innerHTML = "";
                    ordens.forEach(os => { listaOsContainer.appendChild(criarCardOS(os)); });
                } catch (error) { if (error.message !== "Sessão inválida") {
                    console.error("Erro ao carregar OSs:", error);
                    listaOsContainer.innerHTML = `<p class='mensagem erro'>Erro: ${error.message}</p>`;
                }}
            }

            // Carrega a lista de TODAS as OSs (sem filtros) ao iniciar
            carregarOrdensDeServico();
        }
    } // Fim do if (está no dashboard)


    // --- LÓGICA DA PÁGINA "MINHAS OSs" ---
    const minhasOsContainer = document.getElementById("minhas-os-lista-container");
    if (minhasOsContainer) {
        
        (async () => { 
            usuarioLogado = getUsuario(); const token = getToken();
            if (!token || !usuarioLogado) { /* ... checagem de login ... */ }
            if (usuarioLogado.role === 'Operador') { /* ... checagem de role ... */ }
            document.getElementById("info-usuario").textContent = `Logado como: ${usuarioLogado.nome} (${usuarioLogado.role})`;
            inicializarMinhasOSPage();
        })();

        function inicializarMinhasOSPage() {
            const logoutButton = document.getElementById("logout-button");
            if (logoutButton) {
                logoutButton.addEventListener("click", (event) => {
                    event.preventDefault(); limparToken();
                    alert("Você saiu do sistema."); window.location.href = "index.html";
                });
            }

            const linkAdmin = document.getElementById('link-admin');
            if (linkAdmin && usuarioLogado && usuarioLogado.role === 'Admin') {
                linkAdmin.style.display = 'inline-block';
            }

            // Lógica para LISTAR (Minhas) as OSs
            const listaOsContainer = document.getElementById("minhas-os-lista-container");
            carregarMinhasOrdensDeServico = async function(filters = {}) { 
                if (!listaOsContainer) return;
                listaOsContainer.innerHTML = "<p>Carregando suas ordens...</p>";
                
                const params = new URLSearchParams();
                if (filters.equipamento) params.append('equipamento', filters.equipamento);
                if (filters.status && filters.status !== 'Todos') params.append('status', filters.status);
                if (filters.prioridade && filters.prioridade !== 'Todas') params.append('prioridade', filters.prioridade);
                const queryString = params.toString();
                
                try {
                    const response = await fetchSeguro(`${API_URL}/ordens/minhas?${queryString}`, { method: "GET" }); 
                    if (!response.ok) { throw new Error(`Falha: ${response.statusText}`); }
                    const ordens = await response.json();

                    if (ordens.length === 0) { 
                        listaOsContainer.innerHTML = "<p>Nenhuma OS encontrada com esses filtros.</p>"; 
                        return; 
                    }
                    
                    listaOsContainer.innerHTML = ""; 
                    ordens.forEach(os => { listaOsContainer.appendChild(criarCardOS(os)); }); 
                } catch (error) { if (error.message !== "Sessão inválida") {
                    console.error("Erro ao carregar 'minhas OSs':", error);
                    listaOsContainer.innerHTML = `<p class='mensagem erro'>Erro: ${error.message}</p>`;
                }}
            }

            // (Sem listener de clique, pois o clique leva para ordem.html)
            
            // Carrega a lista de "Minhas OSs" (sem filtros) ao iniciar
            carregarMinhasOrdensDeServico();
        }
    } // Fim do if (está na minhas_os.html)


    // --- Lógica da Página ADMIN ---
    const adminContainer = document.querySelector('.admin-container');
    if (adminContainer) {
        
        (async () => {
            usuarioLogado = getUsuario(); const token = getToken();
            if (!token || !usuarioLogado) {
                limparToken();
                if (!window.location.pathname.endsWith('/index.html') && !window.location.pathname.endsWith('/')) {
                    alert("Acesso negado. Faça login primeiro."); window.location.href = "index.html";
                } return;
            }
            if (usuarioLogado.role !== 'Admin') {
                alert("Acesso negado. Apenas administradores.");
                window.location.href = "dashboard.html"; return;
            }
            console.log("Admin logado:", usuarioLogado);
            document.getElementById("info-usuario").textContent = `Admin: ${usuarioLogado.nome}`;
            inicializarAdminPage();
        })();

        function inicializarAdminPage() {
             const logoutButton = document.getElementById("logout-button");
             if (logoutButton) {
                 logoutButton.addEventListener("click", (event) => {
                     event.preventDefault(); limparToken();
                     alert("Você saiu do sistema."); window.location.href = "index.html";
                 });
             }
             
             // Lógica para REGISTRAR Novo Usuário
             const registroFormAdmin = document.getElementById("registro-form-admin");
             const registroMensagemAdmin = document.getElementById("registro-mensagem");
             if (registroFormAdmin) {
                 registroFormAdmin.addEventListener("submit", async (event) => {
                     event.preventDefault();
                     registroMensagemAdmin.textContent = ""; registroMensagemAdmin.className = "mensagem";
                     const nome = document.getElementById("reg-nome").value;
                     const email = document.getElementById("reg-email").value;
                     const senha = document.getElementById("reg-senha").value;
                     const role = document.getElementById("reg-role").value;
                     if(!nome || !email || !senha || !role) { return; }
                     try {
                         const response = await fetchSeguro(`${API_URL}/registrar`, {
                             method: "POST",
                             body: JSON.stringify({ nome, email, senha, role }),
                         });
                         const data = await response.json();
                         if (response.ok) {
                             registroMensagemAdmin.textContent = data.message;
                             registroMensagemAdmin.className = "mensagem sucesso";
                             registroFormAdmin.reset();
                             carregarListaUsuarios(); 
                         } else {
                             registroMensagemAdmin.textContent = data.message;
                             registroMensagemAdmin.className = "mensagem erro";
                         }
                     } catch (error) { if (error.message !== "Sessão inválida") {
                         console.error("Erro ao registrar (admin):", error);
                         registroMensagemAdmin.textContent = "Erro de conexão.";
                         registroMensagemAdmin.className = "mensagem erro";
                     }}
                 });
             } 
             
             // Lógica para LISTAR Usuários
             const listaUsuariosContainer = document.getElementById("lista-usuarios-container");
             async function carregarListaUsuarios() {
                 if (!listaUsuariosContainer) return;
                 listaUsuariosContainer.innerHTML = "<p>Carregando usuários...</p>";
                 try {
                     const response = await fetchSeguro(`${API_URL}/admin/usuarios`, { method: "GET" });
                     if (!response.ok) { throw new Error(`Falha: ${response.statusText}`); }
                     const usuarios = await response.json();
                     if (usuarios.length === 0) {
                         listaUsuariosContainer.innerHTML = "<p>Nenhum usuário cadastrado.</p>"; return;
                     }
                     const adminLogadoId = usuarioLogado ? usuarioLogado.id : null;
                     let tabelaHtml = `<table class="tabela-usuarios"><thead><tr><th>ID</th><th>Nome</th><th>Email</th><th>Papel</th><th>Ações</th></tr></thead><tbody>`;
                     usuarios.forEach(user => {
                         let acoesHtml = `<button class="btn-editar-usuario" data-user-id="${user.id}" data-user-nome="${user.nome}" data-user-email="${user.email}" data-user-role="${user.role}">Editar</button>`;
                         if (adminLogadoId !== null && user.id !== adminLogadoId) {
                             acoesHtml += `<button class="btn-excluir-usuario" data-user-id="${user.id}" data-user-nome="${user.nome}">Excluir</button>`;
                         } else if (user.id === adminLogadoId) {
                             acoesHtml += ' (Você)';
                         }
                         tabelaHtml += `<tr><td>${user.id}</td><td>${user.nome}</td><td>${user.email}</td><td>${user.role}</td><td>${acoesHtml}</td></tr>`;
                     });
                     tabelaHtml += `</tbody></table>`;
                     listaUsuariosContainer.innerHTML = tabelaHtml;
                 } catch (error) { if (error.message !== "Sessão inválida") {
                     console.error("Erro ao carregar usuários:", error);
                     listaUsuariosContainer.innerHTML = `<p class='mensagem erro'>Erro: ${error.message}</p>`;
                 }}
             } 
             
             // LÓGICA DO MODAL DE EDIÇÃO (Admin)
             const modalEditar = document.getElementById("modal-editar-usuario");
             const modalEditarForm = document.getElementById("form-editar-usuario");
             const modalEditarCancelar = document.getElementById("modal-edit-cancelar");
             const modalEditMensagem = document.getElementById("modal-edit-mensagem");
             
             function abrirModalEditar(user) {
                 if (!modalEditar) return;
                 document.getElementById("modal-edit-userid").textContent = user.id;
                 document.getElementById("modal-edit-id-hidden").value = user.id;
                 document.getElementById("modal-edit-nome").value = user.nome;
                 document.getElementById("modal-edit-email").value = user.email;
                 document.getElementById("modal-edit-role").value = user.role;
                 const selectRole = document.getElementById("modal-edit-role");
                 selectRole.disabled = (usuarioLogado && usuarioLogado.id === user.id);
                 modalEditMensagem.textContent = ""; modalEditMensagem.className = "mensagem";
                 modalEditar.style.display = "flex";
             }
             function fecharModalEditar() { if(modalEditar) modalEditar.style.display = "none"; }
             if(modalEditarCancelar) modalEditarCancelar.addEventListener("click", fecharModalEditar);
             if(modalEditarForm) {
                 modalEditarForm.addEventListener("submit", async (event) => {
                     event.preventDefault();
                     const id = document.getElementById("modal-edit-id-hidden").value;
                     const nome = document.getElementById("modal-edit-nome").value;
                     const email = document.getElementById("modal-edit-email").value;
                     const role = document.getElementById("modal-edit-role").value;
                     const submitButton = modalEditarForm.querySelector('button[type="submit"]');
                     submitButton.disabled = true; submitButton.textContent = "Salvando...";
                     modalEditMensagem.textContent = ""; modalEditMensagem.className = "mensagem";
                     try {
                         const response = await fetchSeguro(`${API_URL}/admin/usuarios/${id}`, {
                             method: 'PUT', body: JSON.stringify({ nome, email, role })
                         });
                         const data = await response.json();
                         if (response.ok) {
                             alert(data.message); fecharModalEditar(); carregarListaUsuarios(); 
                         } else {
                             modalEditMensagem.textContent = data.message; modalEditMensagem.className = "mensagem erro";
                         }
                     } catch (error) {
                         if (error.message !== "Sessão inválida") {
                             console.error("Erro ao editar usuário:", error);
                             modalEditMensagem.textContent = "Erro de conexão."; modalEditMensagem.className = "mensagem erro";
                         }
                     } finally {
                         submitButton.disabled = false; submitButton.textContent = "Salvar Alterações";
                     }
                 });
             }
             
             // Lógica de Ações da Tabela (Editar/Excluir)
             listaUsuariosContainer.addEventListener('click', async (event) => {
                 const button = event.target.closest("button"); 
                 if (!button) return; 
                 if (button.classList.contains('btn-editar-usuario')) {
                     const user = {
                         id: parseInt(button.dataset.userId, 10), 
                         nome: button.dataset.userNome,
                         email: button.dataset.userEmail,
                         role: button.dataset.userRole
                     };
                     abrirModalEditar(user); return; 
                 }
                 if (button.classList.contains('btn-excluir-usuario')) {
                     const userIdParaExcluir = button.dataset.userId;
                     const userNome = button.dataset.userNome || 'este usuário';
                     if (!confirm(`Tem certeza que deseja excluir ${userNome} (ID: ${userIdParaExcluir})?`)) { return; }
                     button.disabled = true; button.textContent = 'Excluindo...';
                     try {
                         const response = await fetchSeguro(`${API_URL}/admin/usuarios/${userIdParaExcluir}`, { method: 'DELETE' });
                         const data = await response.json();
                         if (response.ok) { alert(data.message); carregarListaUsuarios(); } 
                         else { alert(`Erro: ${data.message}`); button.disabled = false; button.textContent = 'Excluir'; }
                     } catch (error) {
                         button.disabled = false; button.textContent = 'Excluir';
                         if (error.message !== "Sessão inválida") {
                              console.error("Erro ao excluir:", error); alert("Erro de conexão.");
                         }
                     }
                 }
             });
             
             // --- INÍCIO DA LÓGICA DE PREVENTIVAS ---
             const formCriarPreventiva = document.getElementById("form-criar-preventiva");
             const prevMensagem = document.getElementById("prev-mensagem");
             
             // Função para carregar equipamentos no dropdown de preventiva
             async function popularEquipamentosPreventiva() {
                 const equipamentoSelect = document.getElementById("prev-equipamento-select");
                 if (!equipamentoSelect) return;
                 try {
                     // Reusa a rota pública de equipamentos
                     const response = await fetchSeguro(`${API_URL}/equipamentos`, { method: "GET" });
                     if (!response.ok) { throw new Error('Falha ao buscar equipamentos'); }
                     const equipamentos = await response.json();
                     equipamentoSelect.innerHTML = '<option value="">-- Selecione um equipamento --</option>'; 
                     equipamentos.forEach(eq => {
                         const option = document.createElement('option');
                         option.value = eq.id;
                         option.textContent = `${eq.tag} - ${eq.nome_equipamento} (${eq.setor})`;
                         equipamentoSelect.appendChild(option);
                     });
                 } catch (error) {
                      if (error.message !== "Sessão inválida") {
                           console.error("Erro ao carregar dropdown de equipamentos:", error);
                           equipamentoSelect.innerHTML = '<option value="">Erro ao carregar</option>';
                      }
                 }
             }
             
             // Função para carregar técnicos no dropdown de preventiva
             async function popularTecnicosPreventiva() {
                 const tecnicoSelect = document.getElementById("prev-tecnico-select");
                 if (!tecnicoSelect) return;
                 try {
                     // Reusa a rota de admin para listar usuários
                     const response = await fetchSeguro(`${API_URL}/admin/usuarios`, { method: "GET" });
                     if (!response.ok) { throw new Error('Falha ao buscar usuários'); }
                     const usuarios = await response.json();
                     
                     tecnicoSelect.innerHTML = '<option value="">-- Nenhum --</option>'; // Opção padrão
                     
                     usuarios.forEach(user => {
                         // Adiciona apenas Técnicos e Admins como opções
                         if (user.role === 'Técnico' || user.role === 'Admin') {
                             const option = document.createElement('option');
                             option.value = user.id;
                             option.textContent = `${user.nome} (${user.role})`;
                             tecnicoSelect.appendChild(option);
                         }
                     });
                 } catch (error) {
                      if (error.message !== "Sessão inválida") {
                           console.error("Erro ao carregar dropdown de técnicos:", error);
                           tecnicoSelect.innerHTML = '<option value="">Erro ao carregar</option>';
                      }
                 }
             }
             
             if (formCriarPreventiva) {
                 // Listener do formulário de preventiva
                 formCriarPreventiva.addEventListener("submit", async (event) => {
                     event.preventDefault();
                     prevMensagem.textContent = ""; prevMensagem.className = "mensagem";
                     const submitButton = formCriarPreventiva.querySelector('button[type="submit"]');

                     const dadosPreventiva = {
                         equipamento_id: document.getElementById("prev-equipamento-select").value,
                         tecnico_id: document.getElementById("prev-tecnico-select").value,
                         descricao: document.getElementById("prev-descricao").value,
                         data_agendamento: document.getElementById("prev-data").value,
                         prioridade: document.getElementById("prev-prioridade").value
                     };

                     // Validação
                     if (!dadosPreventiva.equipamento_id || !dadosPreventiva.descricao || !dadosPreventiva.data_agendamento) {
                         prevMensagem.textContent = "Equipamento, Descrição e Data são obrigatórios.";
                         prevMensagem.className = "mensagem erro";
                         return;
                     }
                     
                     submitButton.disabled = true; submitButton.textContent = "Agendando...";

                     try {
                         const response = await fetchSeguro(`${API_URL}/admin/preventivas`, {
                             method: "POST",
                             body: JSON.stringify(dadosPreventiva),
                         });
                         const data = await response.json();
                         if (response.ok) {
                             prevMensagem.textContent = data.message;
                             prevMensagem.className = "mensagem sucesso";
                             formCriarPreventiva.reset();
                             document.getElementById("prev-prioridade").value = "Média"; // Reseta prioridade
                         } else {
                             prevMensagem.textContent = data.message;
                             prevMensagem.className = "mensagem erro";
                         }
                     } catch (error) { 
                         if (error.message !== "Sessão inválida") {
                             console.error("Erro ao agendar preventiva:", error);
                             prevMensagem.textContent = "Erro de conexão.";
                             prevMensagem.className = "mensagem erro";
                         }
                     } finally {
                         submitButton.disabled = false; submitButton.textContent = "Agendar Preventiva";
                     }
                 });
             }
             // --- FIM DA LÓGICA DE PREVENTIVAS ---

             // LÓGICA DE GERENCIAMENTO DE EQUIPAMENTOS (ADMIN)
             const formCriarEquipamento = document.getElementById("form-criar-equipamento");
             const equipMensagem = document.getElementById("equip-mensagem");
             const listaEquipamentosContainer = document.getElementById("lista-equipamentos-container");
             async function carregarListaEquipamentos() {
                 if (!listaEquipamentosContainer) return;
                 listaEquipamentosContainer.innerHTML = "<p>Carregando...</p>";
                 try {
                     const response = await fetchSeguro(`${API_URL}/admin/equipamentos`, { method: "GET" });
                     if (!response.ok) { throw new Error(`Falha: ${response.statusText}`); }
                     const equipamentos = await response.json();
                     if (equipamentos.length === 0) {
                         listaEquipamentosContainer.innerHTML = "<p>Nenhum equipamento cadastrado.</p>"; return;
                     }
                     let tabelaHtml = `<table class="tabela-usuarios"><thead><tr><th>ID</th><th>TAG</th><th>Nome</th><th>Setor</th><th>Ações</th></tr></thead><tbody>`;
                     equipamentos.forEach(eq => {
                         tabelaHtml += `
                            <tr>
                                <td>${eq.id}</td><td>${eq.tag}</td><td>${eq.nome_equipamento}</td><td>${eq.setor}</td>
                                <td><button class="btn-excluir-equipamento" data-equip-id="${eq.id}" data-equip-tag="${eq.tag}">Excluir</button></td>
                            </tr>`;
                     });
                     tabelaHtml += `</tbody></table>`;
                     listaEquipamentosContainer.innerHTML = tabelaHtml;
                 } catch (error) { if (error.message !== "Sessão inválida") {
                     console.error("Erro ao carregar equipamentos:", error);
                     listaEquipamentosContainer.innerHTML = `<p class='mensagem erro'>Erro: ${error.message}</p>`;
                 }}
             }
             if (formCriarEquipamento) {
                 formCriarEquipamento.addEventListener("submit", async (event) => {
                     event.preventDefault();
                     equipMensagem.textContent = ""; equipMensagem.className = "mensagem";
                     const tag = document.getElementById("equip-tag").value;
                     const nome_equipamento = document.getElementById("equip-nome").value;
                     const setor = document.getElementById("equip-setor").value;
                     try {
                         const response = await fetchSeguro(`${API_URL}/admin/equipamentos`, {
                             method: "POST", body: JSON.stringify({ tag, nome_equipamento, setor }),
                         });
                         const data = await response.json();
                         if (response.ok) {
                             equipMensagem.textContent = data.message; equipMensagem.className = "mensagem sucesso";
                             formCriarEquipamento.reset(); carregarListaEquipamentos(); 
                         } else {
                             equipMensagem.textContent = data.message; equipMensagem.className = "mensagem erro";
                         }
                     } catch (error) { if (error.message !== "Sessão inválida") {
                         console.error("Erro ao criar equipamento:", error);
                         equipMensagem.textContent = "Erro de conexão."; equipMensagem.className = "mensagem erro";
                     }}
                 });
             }
             if(listaEquipamentosContainer) {
                 listaEquipamentosContainer.addEventListener('click', async (event) => {
                     const button = event.target.closest("button.btn-excluir-equipamento");
                     if (!button) return;
                     const equipId = button.dataset.equipId; const equipTag = button.dataset.equipTag || 'equipamento';
                     if (!confirm(`Tem certeza que deseja excluir ${equipTag} (ID: ${equipId})?`)) { return; }
                     button.disabled = true; button.textContent = 'Excluindo...';
                     try {
                         const response = await fetchSeguro(`${API_URL}/admin/equipamentos/${equipId}`, { method: 'DELETE' });
                         const data = await response.json();
                         if (response.ok) { alert(data.message); carregarListaEquipamentos(); }
                         else { alert(`Erro: ${data.message}`); button.disabled = false; button.textContent = 'Excluir'; }
                     } catch (error) {
                         button.disabled = false; button.textContent = 'Excluir';
                         if (error.message !== "Sessão inválida") { console.error("Erro ao excluir equip:", error); alert("Erro de conexão."); }
                     }
                 });
             }
             
             // Carrega tudo ao iniciar a página de admin
             carregarListaUsuarios();
             carregarListaEquipamentos();
             popularEquipamentosPreventiva();
             popularTecnicosPreventiva();
        } 
    } // Fim do if (está na admin.html)


    // --- LÓGICA DA NOVA PÁGINA: ORDEM.HTML ---
    const osDetalheForm = document.getElementById("os-detalhe-form");
    if (osDetalheForm) {
        
        const urlParams = new URLSearchParams(window.location.search);
        const osId = urlParams.get('id'); 
        const osMensagem = document.getElementById("os-detalhe-mensagem");

        const btnImprimir = document.getElementById("btn-imprimir");
        const btnPdfCompras = document.getElementById("btn-pdf-compras");
        const btnAssumirOS = document.getElementById("btn-assumir-os");
        const btnConcluirOS = document.getElementById("btn-concluir-os");
        
        const blocoSolicitacao = document.getElementById("bloco-solicitacao");
        const blocoExecucao = document.getElementById("bloco-execucao");
        const blocoPecas = document.getElementById("bloco-pecas"); 
        
        // --- LÓGICA DE PEÇAS (dentro da página da OS) ---
        const btnAddPeca = document.getElementById('btn-add-peca'); // CORREÇÃO: Pega o Botão
        const listaPecasContainer = document.getElementById("lista-pecas-container");
        const pecaMensagem = document.getElementById("peca-mensagem");

        async function carregarListaPecas(osId) {
            if (!listaPecasContainer) return;
            listaPecasContainer.innerHTML = "<p>Carregando peças...</p>";
            try {
                const response = await fetchSeguro(`${API_URL}/ordens/${osId}/pecas`, { method: 'GET' });
                if (!response.ok) throw new Error("Falha ao buscar peças");
                const pecas = await response.json();
                
                if (pecas.length === 0) {
                    listaPecasContainer.innerHTML = "<p>Nenhuma peça utilizada.</p>"; return;
                }
                
                let tabelaHtml = `<table class="tabela-pecas"><thead><tr><th>Cód.</th><th>Descrição</th><th>Qtd.</th><th class="no-print">Ações</th></tr></thead><tbody>`;
                pecas.forEach(p => {
                    tabelaHtml += `
                        <tr>
                            <td>${p.codigo_peca || 'N/A'}</td>
                            <td>${p.descricao_peca}</td>
                            <td>${p.quantidade}</td>
                            <td class="no-print">
                                <button class="btn-remover-peca" data-peca-id="${p.id}">Remover</button>
                            </td>
                        </tr>
                    `;
                });
                tabelaHtml += `</tbody></table>`;
                listaPecasContainer.innerHTML = tabelaHtml;
                
            } catch (error) {
                 if (error.message !== "Sessão inválida") {
                      console.error("Erro ao carregar peças:", error);
                      listaPecasContainer.innerHTML = "<p class='mensagem erro'>Erro ao carregar peças.</p>";
                 }
            }
        }

        if (btnAddPeca) { // CORREÇÃO: Escuta o CLIQUE no BOTÃO
            btnAddPeca.addEventListener('click', async (event) => {
                event.preventDefault(); 
                pecaMensagem.textContent = ""; pecaMensagem.className = "mensagem";
                
                const dadosPeca = {
                    codigo_peca: document.getElementById('peca-codigo').value,
                    descricao_peca: document.getElementById('peca-descricao').value,
                    quantidade: parseInt(document.getElementById('peca-quantidade').value, 10)
                };
                
                if (!dadosPeca.descricao_peca || !dadosPeca.quantidade || dadosPeca.quantidade <= 0) { // Validação
                     pecaMensagem.textContent = "Descrição e Quantidade (maior que 0) são obrigatórias.";
                     pecaMensagem.className = "mensagem erro"; return;
                }
                
                btnAddPeca.disabled = true; btnAddPeca.textContent = "Adicionando...";
                try {
                     if (!osId) throw new Error("ID da OS não encontrado.");

                     const response = await fetchSeguro(`${API_URL}/ordens/${osId}/pecas`, {
                         method: 'POST',
                         body: JSON.stringify(dadosPeca)
                     });
                     const data = await response.json();
                     if (response.ok) {
                         pecaMensagem.textContent = data.message;
                         pecaMensagem.className = "mensagem sucesso";
                         document.getElementById('peca-codigo').value = '';
                         document.getElementById('peca-descricao').value = '';
                         document.getElementById('peca-quantidade').value = 1; 
                         await carregarListaPecas(osId); 
                     } else {
                         pecaMensagem.textContent = data.message;
                         pecaMensagem.className = "mensagem erro";
                     }
                } catch(error) {
                     if (error.message !== "Sessão inválida") {
                          console.error("Erro ao adicionar peça:", error);
                          pecaMensagem.textContent = "Erro de conexão.";
                          pecaMensagem.className = "mensagem erro";
                     }
                } finally {
                     btnAddPeca.disabled = false; btnAddPeca.textContent = "Adicionar Peça";
                }
            });
        }
        
        if (listaPecasContainer) {
             listaPecasContainer.addEventListener('click', async (event) => {
                 const button = event.target.closest("button.btn-remover-peca");
                 if (!button) return;
                 const pecaId = button.dataset.pecaId;
                 if (!confirm(`Tem certeza que deseja remover esta peça (ID: ${pecaId})?`)) return;
                 button.disabled = true; button.textContent = '...';
                 try {
                     const response = await fetchSeguro(`${API_URL}/ordens/pecas/${pecaId}`, { method: 'DELETE' });
                     const data = await response.json();
                     if (response.ok) {
                         alert(data.message);
                         await carregarListaPecas(osId); 
                     } else {
                         alert(`Erro: ${data.message}`);
                         button.disabled = false; button.textContent = 'Remover';
                     }
                 } catch (error) {
                     button.disabled = false; button.textContent = 'Remover';
                     if (error.message !== "Sessão inválida") {
                          console.error("Erro ao remover peça:", error); alert("Erro de conexão.");
                     }
                 }
             });
        }
        
        // Função para preencher todos os campos da página
        async function carregarDetalhesOS() {
            if (!osId) {
                alert("Nenhuma OS selecionada."); window.location.href = "dashboard.html"; return;
            }
            usuarioLogado = getUsuario();
            if (!usuarioLogado) { return; } 

            try {
                const response = await fetchSeguro(`${API_URL}/ordens/${osId}`, { method: 'GET' });
                if (!response.ok) { throw new Error("OS não encontrada"); }
                const os = await response.json();

                document.getElementById('os-numero').textContent = os.id;
                document.getElementById('nome-maquina').value = os.equipamento_nome || 'N/A';
                document.getElementById('tag-maquina').value = os.equipamento_tag || 'N/A';
                document.getElementById('setor-maquina').value = os.equipamento_setor || 'N/A';
                document.getElementById('causa-solicitacao').value = os.descricao;
                document.getElementById('tipo-solicitacao').value = os.tipo_solicitacao || 'Corretiva';
                if(os.parou_maquina) {
                     document.getElementById('parou-sim').checked = true;
                } else {
                     document.getElementById('parou-nao').checked = true;
                }
                document.getElementById('tecnico-nome').value = os.nome_tecnico || 'N/A';
                document.getElementById('criador-nome').value = os.nome_criador || 'N/A';
                document.getElementById('data-inicio').value = os.data_inicio_fmt || '';
                document.getElementById('hora-inicio').value = os.hora_inicio_fmt || '';
                document.getElementById('data-fim').value = os.data_fim_fmt || '';
                document.getElementById('hora-fim').value = os.hora_fim_fmt || '';
                document.getElementById('notas-servico').value = os.notas_tecnico || '';
                document.getElementById('chk-desligado').checked = os.chk_desligado;
                document.getElementById('chk-epi').checked = os.chk_epi;
                document.getElementById('chk-documento').checked = os.chk_documento;
                document.getElementById('chk-registrar').checked = os.chk_registrar;
                document.getElementById('chk-testes').checked = os.chk_testes;
                document.getElementById('chk-liberacao').checked = os.chk_liberacao;
                
                await carregarListaPecas(osId);

                const isTecnicoAtribuido = (usuarioLogado.id === os.tecnico_id);
                const isAdmin = (usuarioLogado.role === 'Admin');

                // --- LÓGICA DE HABILITAÇÃO MODIFICADA (PARA ADMIN) ---
                const btnAdminSalvar = document.getElementById("btn-admin-salvar");

                if (os.status === 'Concluído') {
                    // Se concluído, Admin pode ver PDF, mas não editar mais nada.
                    btnPdfCompras.style.display = 'inline-block';

                } else if (os.status === 'Em Andamento') {
                    // Se 'Em Andamento', mostra botões de concluir e PDF
                    btnConcluirOS.style.display = 'block';
                    btnPdfCompras.style.display = 'inline-block';

                    // Admin ou Técnico atribuído podem editar
                    if (isAdmin || isTecnicoAtribuido) {
                        blocoSolicitacao.disabled = false;
                        blocoExecucao.disabled = false;
                        blocoPecas.disabled = false;
                    }
                    // Admin vê o botão de salvar
                    if (isAdmin && btnAdminSalvar) {
                        btnAdminSalvar.style.display = 'block';
                    }

                } else if (os.status === 'Aberto') {
                    // Se 'Aberto', Técnico ou Admin podem assumir
                    if (isAdmin || usuarioLogado.role === 'Técnico') {
                        btnAssumirOS.style.display = 'block';
                    }
                    
                    // Admin pode editar *mesmo* se estiver 'Aberto'
                    if (isAdmin) {
                        blocoSolicitacao.disabled = false;
                        blocoExecucao.disabled = false;
                        blocoPecas.disabled = false;
                        if(btnAdminSalvar) btnAdminSalvar.style.display = 'block';
                    }
                }
                // --- FIM DA LÓGICA DE HABILITAÇÃO ---

            } catch (error) {
                 if (error.message !== "Sessão inválida") {
                      console.error("Erro ao carregar detalhes da OS:", error);
                      osMensagem.textContent = "Erro ao carregar dados da OS.";
                      osMensagem.className = "mensagem erro";
                 }
            }
        } 

        // --- Lógica dos Botões da Página ---
        if(btnImprimir) {
            btnImprimir.addEventListener('click', (e) => {
                e.preventDefault();
                document.body.classList.remove('imprimindo-compras'); 
                window.print();
            });
        }
        
        if(btnPdfCompras) {
            btnPdfCompras.addEventListener('click', (e) => {
                e.preventDefault();
                document.body.classList.add('imprimindo-compras'); 
                window.print(); 
                setTimeout(() => {
                     document.body.classList.remove('imprimindo-compras');
                }, 100); 
            });
        }
        
        if(btnAssumirOS) {
            btnAssumirOS.addEventListener('click', async (e) => {
                e.preventDefault();
                if (!confirm(`Deseja assumir a OS #${osId} agora?`)) return;
                btnAssumirOS.disabled = true; btnAssumirOS.textContent = "Assumindo...";
                try {
                    const response = await fetchSeguro(`${API_URL}/ordens/${osId}/atribuir`, { method: "POST" });
                    const data = await response.json();
                    if (response.ok) {
                        alert(data.message);
                        window.location.reload(); 
                    } else {
                        alert("Erro: " + data.message);
                        btnAssumirOS.disabled = false; btnAssumirOS.textContent = "Assumir Ordem de Serviço";
                    }
                } catch (error) {
                    if (error.message !== "Sessão inválida") { 
                         console.error("Erro ao assumir OS:", error); alert("Erro de conexão."); 
                    }
                    btnAssumirOS.disabled = false; btnAssumirOS.textContent = "Assumir Ordem de Serviço";
                }
            });
        }
        
        // --- LISTENER DO BOTÃO "SALVAR (ADMIN)" (COM CORREÇÃO osId) ---
        const btnAdminSalvar = document.getElementById("btn-admin-salvar");
        if(btnAdminSalvar) {
            btnAdminSalvar.addEventListener('click', async (e) => {
                e.preventDefault();
                if (!confirm(`ADMIN: Tem certeza que deseja SALVAR as alterações desta OS? (O status NÃO será alterado).`)) return;

                btnAdminSalvar.disabled = true; btnAdminSalvar.textContent = "Salvando...";
                osMensagem.textContent = ""; osMensagem.className = "mensagem";

                // Coleta os mesmos dados que a função de concluir
                const dadosParaSalvar = {
                    tipo_solicitacao: document.getElementById('tipo-solicitacao').value,
                    parou_maquina: document.getElementById('parou-sim').checked,
                    notas_tecnico: document.getElementById('notas-servico').value,
                    chk_desligado: document.getElementById('chk-desligado').checked,
                    chk_epi: document.getElementById('chk-epi').checked,
                    chk_documento: document.getElementById('chk-documento').checked,
                    chk_registrar: document.getElementById('chk-registrar').checked,
                    chk_testes: document.getElementById('chk-testes').checked,
                    chk_liberacao: document.getElementById('chk-liberacao').checked
                };

                try {
                    // Chama a NOVA rota de admin-update (COM A VARIÁVEL CORRIGIDA "osId")
                    const response = await fetchSeguro(`${API_URL}/ordens/${osId}/admin-update`, {
                        method: 'PUT', // Usamos PUT para atualização
                        body: JSON.stringify(dadosParaSalvar)
                    });
                    const data = await response.json();
                    
                    if (response.ok) {
                        osMensagem.textContent = data.message;
                        osMensagem.className = "mensagem sucesso";
                        // Recarrega os dados para garantir consistência
                        await carregarDetalhesOS(); 
                    } else {
                        osMensagem.textContent = data.message;
                        osMensagem.className = "mensagem erro";
                    }
                } catch (error) {
                    if (error.message !== "Sessão inválida") {
                         console.error("Erro ao salvar (Admin):", error);
                         osMensagem.textContent = "Erro de conexão ao salvar.";
                         osMensagem.className = "mensagem erro";
                    }
                } finally {
                     btnAdminSalvar.disabled = false; btnAdminSalvar.textContent = "Salvar Alterações (Admin)";
                }
            });
        }
        // --- FIM DO LISTENER "SALVAR (ADMIN)" ---

        osDetalheForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!confirm(`Tem certeza que deseja CONCLUIR e fechar a OS #${osId}?`)) return;

            btnConcluirOS.disabled = true; btnConcluirOS.textContent = "Salvando...";
            osMensagem.textContent = ""; osMensagem.className = "mensagem";

            const dadosParaSalvar = {
                tipo_solicitacao: document.getElementById('tipo-solicitacao').value,
                parou_maquina: document.getElementById('parou-sim').checked,
                notas_tecnico: document.getElementById('notas-servico').value,
                chk_desligado: document.getElementById('chk-desligado').checked,
                chk_epi: document.getElementById('chk-epi').checked,
                chk_documento: document.getElementById('chk-documento').checked,
                chk_registrar: document.getElementById('chk-registrar').checked,
                chk_testes: document.getElementById('chk-testes').checked,
                chk_liberacao: document.getElementById('chk-liberacao').checked
            };
            
            try {
                const response = await fetchSeguro(`${API_URL}/ordens/${osId}/concluir`, {
                    method: 'POST',
                    body: JSON.stringify(dadosParaSalvar)
                });
                const data = await response.json();
                
                if (response.ok) {
                    alert(data.message);
                    window.location.reload(); 
                } else {
                    osMensagem.textContent = data.message;
                    osMensagem.className = "mensagem erro";
                    btnConcluirOS.disabled = false; btnConcluirOS.textContent = "Salvar e Concluir OS";
                }
            } catch (error) {
                if (error.message !== "Sessão inválida") {
                     console.error("Erro ao concluir OS:", error);
                     osMensagem.textContent = "Erro de conexão ao salvar.";
                     osMensagem.className = "mensagem erro";
                }
                btnConcluirOS.disabled = false; btnConcluirOS.textContent = "Salvar e Concluir OS";
            }
        });


        // --- Inicialização da Página ---
        (async () => {
            usuarioLogado = getUsuario();
            if (!usuarioLogado) {
                 limparToken();
                 alert("Acesso negado. Faça login.");
                 window.location.href = "index.html";
                 return;
            }
            document.getElementById("info-usuario").textContent = `Logado como: ${usuarioLogado.nome} (${usuarioLogado.role})`;
            
            await carregarDetalhesOS();
        })();
        
    } // Fim do if (está na ordem.html)


    // --- Lógica da Página MONITOR ---
    const monitorContainer = document.getElementById("dashboard-monitor");
    if (monitorContainer) {
        
        (async () => {
            usuarioLogado = getUsuario(); const token = getToken();
            if (!token || !usuarioLogado) {
                limparToken();
                if (!window.location.pathname.endsWith('/index.html') && !window.location.pathname.endsWith('/')) {
                    alert("Acesso negado. Faça login primeiro."); window.location.href = "index.html";
                } return;
            }
            if (usuarioLogado.role !== 'Admin' && usuarioLogado.role !== 'Monitor') {
                alert("Acesso negado. Apenas administradores ou monitores.");
                window.location.href = "dashboard.html"; return;
            }
            console.log("Monitor/Admin logado:", usuarioLogado);
            document.getElementById("info-usuario").textContent = `Usuário: ${usuarioLogado.nome}`;
            inicializarMonitorPage(); 
        })();
        
        function inicializarMonitorPage() {
             const logoutButton = document.getElementById("logout-button");
             if (logoutButton) {
                 logoutButton.addEventListener("click", (event) => {
                     event.preventDefault(); limparToken();
                     alert("Você saiu do sistema."); window.location.href = "index.html";
                 });
             }
             
             carregarGraficoStatus();
             carregarGraficoMaquinas();
             carregarListaManutencao();
             carregarGraficoHorasParadas();
        }
        
        async function carregarGraficoStatus() {
            const ctx = document.getElementById('graficoStatusPizza');
            if (!ctx) return;
            try {
                const response = await fetchSeguro(`${API_URL}/stats/contagem-status`, { method: 'GET' });
                if (!response.ok) throw new Error("Falha ao buscar dados de status");
                const dados = await response.json(); 
                
                const labels = dados.map(d => d.status);
                const totais = dados.map(d => d.total);
                
                const estilosCSS = getComputedStyle(document.body);
                const corAberto = estilosCSS.getPropertyValue('--cor-status-aberto-texto').trim() || '#721c24';
                const corAndamento = estilosCSS.getPropertyValue('--cor-status-andamento-texto').trim() || '#856404';
                const corConcluido = estilosCSS.getPropertyValue('--cor-status-concluido-texto').trim() || '#155724';
                const corOutro = estilosCSS.getPropertyValue('--cor-secundaria').trim() || '#6c757d';

                const cores = labels.map(status => {
                    if (status === 'Aberto') return corAberto;
                    if (status === 'Em Andamento') return corAndamento;
                    if (status === 'Concluído') return corConcluido;
                    return corOutro;
                });

                setTimeout(() => {
                    new Chart(ctx, {
                        type: 'pie', 
                        data: {
                            labels: labels,
                            datasets: [{
                                label: 'Total de OSs',
                                data: totais,
                                backgroundColor: cores,
                                hoverOffset: 4
                            }]
                        },
                        options: {
                            responsive: true,
                            plugins: { legend: { position: 'top', } }
                        }
                    }); 
                }, 10); 
            } catch (error) { if (error.message !== "Sessão inválida") console.error("Erro ao carregar gráfico de status:", error); }
        }

        async function carregarGraficoMaquinas() {
            const ctx = document.getElementById('graficoMaquinasBarra');
            if (!ctx) return;
            try {
                const response = await fetchSeguro(`${API_URL}/stats/os-por-maquina-mes`, { method: 'GET' });
                if (!response.ok) throw new Error("Falha ao buscar dados de máquinas");
                const dados = await response.json(); 
                
                const labels = dados.map(d => d.tag);
                const totais = dados.map(d => d.total_os);

                new Chart(ctx, {
                    type: 'bar', 
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'OSs Abertas este Mês',
                            data: totais,
                            backgroundColor: 'rgba(0, 123, 255, 0.6)', 
                            borderColor: 'var(--cor-primaria)',
                            borderWidth: 1
                        }]
                    },
                    options: {
                        scales: { y: { beginAtZero: true, allowDecimals: false } },
                        plugins: { legend: { display: false } }
                    }
                });
            } catch (error) { if (error.message !== "Sessão inválida") console.error("Erro ao carregar gráfico de máquinas:", error); }
        }

        async function carregarListaManutencao() {
            const container = document.getElementById('lista-em-manutencao');
            if (!container) return;
            try {
                const response = await fetchSeguro(`${API_URL}/stats/em-manutencao`, { method: 'GET' });
                if (!response.ok) throw new Error("Falha ao buscar máquinas em manutenção");
                const dados = await response.json(); 
                
                if (dados.length === 0) {
                    container.innerHTML = "<p>Nenhuma máquina em manutenção no momento.</p>";
                    return;
                }
                
                let tabelaHtml = `<table class="tabela-manutencao"><thead><tr>
                                    <th>Máquina (TAG)</th>
                                    <th>Descrição OS</th>
                                    <th>Técnico</th>
                                  </tr></thead><tbody>`;
                dados.forEach(os => {
                    tabelaHtml += `
                        <tr>
                            <td><strong>${os.tag}</strong><br><small>${os.equipamento_setor}</small></td>
                            <td><a href="ordem.html?id=${os.os_id}">OS #${os.os_id}: ${os.descricao}</a></td>
                            <td>${os.nome_tecnico || 'N/A'}</td>
                        </tr>
                    `;
                });
                tabelaHtml += `</tbody></table>`;
                container.innerHTML = tabelaHtml;

            } catch (error) { if (error.message !== "Sessão inválida") console.error("Erro ao carregar lista em manutenção:", error); }
        }
        
        async function carregarGraficoHorasParadas() {
            const ctx = document.getElementById('graficoHorasParadasBarra');
            if (!ctx) return;
            try {
                const response = await fetchSeguro(`${API_URL}/stats/horas-paradas-mes`, { method: 'GET' });
                if (!response.ok) throw new Error("Falha ao buscar dados de horas paradas");
                const dados = await response.json(); 
                
                const labels = dados.map(d => d.tag);
                const totais = dados.map(d => d.total_horas_paradas);

                new Chart(ctx, {
                    type: 'bar', 
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Horas Paradas (Downtime)',
                            data: totais,
                            backgroundColor: 'rgba(220, 53, 69, 0.6)', 
                            borderColor: 'var(--cor-perigo)',
                            borderWidth: 1
                        }]
                    },
                    options: {
                        scales: {
                            y: { 
                                beginAtZero: true,
                                ticks: {
                                    callback: function(value) {
                                        return value + ' h';
                                    }
                                }
                            }
                        },
                        plugins: { 
                            legend: { display: true }, 
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        let label = context.dataset.label || '';
                                        if (label) { label += ': '; }
                                        if (context.parsed.y !== null) {
                                            label += context.parsed.y + ' horas';
                                        }
                                        return label;
                                    }
                                }
                            }
                        }
                    }
                });
            } catch (error) { if (error.message !== "Sessão inválida") console.error("Erro ao carregar gráfico de horas paradas:", error); }
        }
    } // Fim do if (está na página monitor.html)

}); // Fim do DOMContentLoaded