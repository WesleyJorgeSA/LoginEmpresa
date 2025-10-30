// Espera o documento HTML carregar antes de rodar o script
document.addEventListener("DOMContentLoaded", () => {

    const API_URL = "";
    let usuarioLogado = null; // Guarda as infos do usuário logado localmente

    // --- CORREÇÃO: Declarar as funções de carregamento no escopo principal ---
    let carregarOrdensDeServico = async (filters = {}) => {};
    let carregarMinhasOrdensDeServico = async (filters = {}) => {};
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
        const criador = os.nome_criador || 'Desconhecido';
        const tecnico = os.nome_tecnico || 'N/A';
        const notasHtml = os.notas_tecnico ? `<p class="os-notas"><b>Notas:</b> ${os.notas_tecnico.replace(/\n/g, '<br>')}</p>` : '';
        let botoesHtml = '';
        const usuario = getUsuario(); 

        if (os.status === 'Aberto') {
            if (usuario && (usuario.role === 'Admin' || usuario.role === 'Técnico')) {
                 botoesHtml = `<button class="btn-assumir" data-os-id="${os.id}">Assumir OS</button>`;
            }
        } else if (os.status === 'Em Andamento') {
            if (usuario && (usuario.role === 'Admin' || (usuario.role === 'Técnico' && usuario.id === os.tecnico_id))) {
                botoesHtml = `<button class="btn-concluir" data-os-id="${os.id}">Concluir OS</button>`;
            }
        }
        
        const statusClass = os.status.toLowerCase().replace(' ','-');
        const prioridade = os.prioridade || 'Baixa';
        const prioridadeClass = prioridade.toLowerCase(); 

        osCard.innerHTML = `
            <div class="os-header">
                <strong>${os.equipamento} (OS #${os.id})</strong>
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

    // --- LÓGICA GLOBAL DO MODAL ---
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
        modalForm.addEventListener("submit", async (event) => {
            event.preventDefault(); 
            const modalNotasInput = document.getElementById("modal-notas-tecnico");
            const modalMensagem = document.getElementById("modal-mensagem");
            const modalSubmitButton = modalForm.querySelector('button[type="submit"]');
            const notas = modalNotasInput.value; 
            
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
    } // <-- CORREÇÃO: Faltava este '}'

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
                    setTimeout(() => { window.location.href = "dashboard.html"; }, 1500);
                } else {
                    loginMensagem.textContent = data.message; loginMensagem.className = "mensagem erro";
                }
            } catch (error) {
                console.error("Erro ao logar:", error);
                loginMensagem.textContent = "Erro de conexão."; loginMensagem.className = "mensagem erro";
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
            
            // Chama a função correta (que foi definida no escopo superior)
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
                
                osForm.addEventListener("submit", async (event) => {
                    event.preventDefault();
                    osMensagem.textContent = ""; osMensagem.className = "mensagem";
                    const equipamento = document.getElementById("os-equipamento").value;
                    const descricao = document.getElementById("os-descricao").value;
                    const prioridade = prioridadeSelect ? prioridadeSelect.value : "Baixa"; 
                    if(!equipamento || !descricao) { return; }
                    try {
                        const response = await fetchSeguro(`${API_URL}/ordens`, {
                            method: "POST", 
                            body: JSON.stringify({ equipamento, descricao, prioridade }),
                        });
                        const data = await response.json();
                        if (response.ok) {
                            osMensagem.textContent = data.message; osMensagem.className = "mensagem sucesso";
                            osForm.reset(); 
                            if(prioridadeSelect) prioridadeSelect.value = "Baixa"; 
                            carregarOrdensDeServico(); 
                        } else {
                            osMensagem.textContent = data.message; osMensagem.className = "mensagem erro";
                        }
                    } catch (error) { if (error.message !== "Sessão inválida") {
                        console.error("Erro ao criar OS:", error);
                        osMensagem.textContent = "Erro de conexão."; osMensagem.className = "mensagem erro";
                    }}
                });
            }

            // Lógica para LISTAR (Todas) as OSs
            const listaOsContainer = document.getElementById("lista-os-container");
            carregarOrdensDeServico = async function(filters = {}) {
                if (!listaOsContainer) return;
                listaOsContainer.innerHTML = "<p>Carregando ordens...</p>";
                
                const params = new URLSearchParams();
                if (filters.equipamento) params.append('equipamento', filters.equipamento);
                if (filters.status && filters.status !== 'Todos') params.append('status', filters.status);
                if (filters.prioridade && filters.prioridade !== 'Todas') params.append('prioridade', filters.prioridade);
                const queryString = params.toString();
                
                try {
                    const response = await fetchSeguro(`${API_URL}/ordens?${queryString}`, { method: "GET" });
                    if (!response.ok) { throw new Error(`Falha: ${response.statusText}`); }
                    const ordens = await response.json();
                    
                    listaOsContainer.innerHTML = "";
                    if (ordens.length === 0) { 
                        listaOsContainer.innerHTML = "<p>Nenhuma OS encontrada com esses filtros.</p>"; 
                        return; 
                    }
                    
                    ordens.forEach(os => { listaOsContainer.appendChild(criarCardOS(os)); });
                } catch (error) { if (error.message !== "Sessão inválida") {
                    console.error("Erro ao carregar OSs:", error);
                    listaOsContainer.innerHTML = `<p class='mensagem erro'>Erro: ${error.message}</p>`;
                }}
            }

            // Lógica para os botões "Assumir" e "Concluir"
            listaOsContainer.addEventListener("click", async (event) => {
                const button = event.target.closest("button"); if(!button) return;
                const osId = button.dataset.osId; if (!osId) return;
                button.disabled = true; const originalText = button.textContent; button.textContent = 'Aguarde...';
                try {
                    if (button.classList.contains("btn-assumir")) {
                        if (!confirm(`Deseja assumir a OS #${osId}?`)) { button.disabled = false; button.textContent = originalText; return; }
                        const response = await fetchSeguro(`${API_URL}/ordens/${osId}/atribuir`, { method: "POST" });
                        const data = await response.json();
                        if (response.ok) { alert(data.message); carregarOrdensDeServico(); } 
                        else { alert("Erro: " + data.message); button.disabled = false; button.textContent = originalText; }
                    }
                    else if (button.classList.contains("btn-concluir")) {
                        abrirModalConcluir(osId, carregarOrdensDeServico); 
                        button.disabled = false; button.textContent = originalText;
                    }
                    else { button.disabled = false; button.textContent = originalText; }
                } catch (error) {
                    button.disabled = false; button.textContent = originalText;
                    if (error.message !== "Sessão inválida") { console.error("Erro na ação:", error); alert("Erro de conexão."); }
                }
            });

            // Carrega a lista de TODAS as OSs (sem filtros) ao iniciar
            carregarOrdensDeServico();
        }
    } // Fim do if (está no dashboard)


    // --- LÓGICA DA PÁGINA "MINHAS OSs" ---
    const minhasOsContainer = document.getElementById("minhas-os-lista-container");
    if (minhasOsContainer) {
        
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
            if (usuarioLogado.role === 'Operador') {
                alert("Acesso negado. Apenas Admins ou Técnicos.");
                window.location.href = "dashboard.html";
                return;
            }
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

                    listaOsContainer.innerHTML = ""; 
                    if (ordens.length === 0) { 
                        listaOsContainer.innerHTML = "<p>Nenhuma OS encontrada com esses filtros.</p>"; 
                        return; 
                    }
                    
                    ordens.forEach(os => { listaOsContainer.appendChild(criarCardOS(os)); }); 
                } catch (error) { if (error.message !== "Sessão inválida") {
                    console.error("Erro ao carregar 'minhas OSs':", error);
                    listaOsContainer.innerHTML = `<p class='mensagem erro'>Erro: ${error.message}</p>`;
                }}
            }

            // Lógica para o botão "Concluir"
            listaOsContainer.addEventListener("click", async (event) => {
                const button = event.target.closest("button.btn-concluir"); 
                if (!button) return;
                const osId = button.dataset.osId; if (!osId) return;
                button.disabled = true; const originalText = button.textContent; button.textContent = 'Aguarde...';
                try {
                    abrirModalConcluir(osId, carregarMinhasOrdensDeServico); 
                    button.disabled = false; button.textContent = originalText;
                } catch (error) {
                    button.disabled = false; button.textContent = originalText;
                    if (error.message !== "Sessão inválida") { console.error("Erro na ação:", error); alert("Erro de conexão."); }
                }
            });

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
                         let botaoExcluirHtml = '';
                         if (adminLogadoId !== null && user.id !== adminLogadoId) {
                             botaoExcluirHtml = `<button class="btn-excluir-usuario" data-user-id="${user.id}" data-user-nome="${user.nome}">Excluir</button>`;
                         } else {
                             botaoExcluirHtml = '(Você)';
                         }
                         tabelaHtml += `<tr><td>${user.id}</td><td>${user.nome}</td><td>${user.email}</td><td>${user.role}</td><td>${botaoExcluirHtml}</td></tr>`;
                     });
                     tabelaHtml += `</tbody></table>`;
                     listaUsuariosContainer.innerHTML = tabelaHtml;
                 } catch (error) { if (error.message !== "Sessão inválida") {
                     console.error("Erro ao carregar usuários:", error);
                     listaUsuariosContainer.innerHTML = `<p class='mensagem erro'>Erro: ${error.message}</p>`;
                 }}
             } 
             
             listaUsuariosContainer.addEventListener('click', async (event) => {
                 const button = event.target.closest("button.btn-excluir-usuario"); 
                 if (!button) return; 
                 const userIdParaExcluir = button.dataset.userId;
                 const userNome = button.dataset.userNome || 'este usuário';
                 if (!confirm(`Tem certeza que deseja excluir ${userNome} (ID: ${userIdParaExcluir})?\n\nATENÇÃO: Esta ação não pode ser desfeita!`)) {
                     return; 
                 }
                 button.disabled = true; button.textContent = 'Excluindo...';
                 const mensagemGeralErro = listaUsuariosContainer.querySelector('.mensagem.erro');
                 if(mensagemGeralErro) mensagemGeralErro.remove(); 
                 try {
                     const response = await fetchSeguro(`${API_URL}/admin/usuarios/${userIdParaExcluir}`, {
                         method: 'DELETE'
                     });
                     const data = await response.json();
                     if (response.ok) {
                         alert(data.message);
                         carregarListaUsuarios(); 
                     } else {
                         alert(`Erro ao excluir: ${data.message}`);
                         button.disabled = false; button.textContent = 'Excluir';
                     }
                 } catch (error) {
                     button.disabled = false; button.textContent = 'Excluir';
                     if (error.message !== "Sessão inválida") {
                          console.error("Erro ao excluir usuário:", error);
                          const pErro = document.createElement('p');
                          pErro.className = 'mensagem erro';
                          pErro.textContent = 'Erro de conexão ao tentar excluir usuário.';
                          listaUsuariosContainer.prepend(pErro);
                     }
                 }
             });
             
             carregarListaUsuarios();
        } 
    } // Fim do if (está na admin.html)

}); // Fim do DOMContentLoaded