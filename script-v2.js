// Espera o documento HTML carregar antes de rodar o script
document.addEventListener("DOMContentLoaded", () => {

    const API_URL = "http://127.0.0.1:5000";
    let usuarioLogado = null; // Guarda as infos do usuário logado localmente

    // --- FUNÇÕES DE AJUDA PARA O TOKEN JWT ---
    function salvarToken(token, usuario) {
        try {
            localStorage.setItem("token", token.trim());
            // Salva também os dados do usuário para fácil acesso
            localStorage.setItem("usuario", JSON.stringify(usuario));
            usuarioLogado = usuario; // Atualiza a variável local
        } catch (e) { console.error("ERRO CRÍTICO AO SALVAR TOKEN: ", e); }
    }
    function getToken() { return localStorage.getItem("token"); }
    // --- FUNÇÃO GETUSUARIO (ESSENCIAL!) ---
    function getUsuario() {
        // Tenta pegar da variável local primeiro (mais rápido)
        if(usuarioLogado) return usuarioLogado;
        // Se não tem na variável, tenta pegar do localStorage
        try {
            const usuarioJSON = localStorage.getItem("usuario");
            if (usuarioJSON) {
                usuarioLogado = JSON.parse(usuarioJSON);
                return usuarioLogado;
            }
        } catch (e) {
             console.error("Erro ao ler usuário do localStorage:", e);
             localStorage.removeItem("usuario"); // Limpa dado corrompido
             return null;
        }
        return null; // Retorna null se não encontrar
    }
    function limparToken() {
        localStorage.removeItem("token");
        localStorage.removeItem("usuario");
        usuarioLogado = null;
    }

    /**
     * Função reutilizável para fazer requisições seguras COM BEARER
     */
    async function fetchSeguro(url, options = {}) {
        const token = getToken();
        const headers = new Headers(options.headers || {});
        if (options.body && !headers.has('Content-Type')) {
            headers.append("Content-Type", "application/json");
        }
        if (token) {
            headers.append("Authorization", "Bearer " + token); // <-- BEARER AQUI
        }
        options.headers = headers;
        options.credentials = 'include'; // Necessário para CORS com credenciais

        try { // Adicionado Try/Catch genérico para erros de rede
             const response = await fetch(url, options);

             if (response.status === 401 || response.status === 422) {
                 limparToken();
                 // Evita alert se já estiver redirecionando ou na index
                 if (!window.location.pathname.endsWith('/index.html') && !window.location.pathname.endsWith('/')) {
                      alert("Sua sessão expirou (erro " + response.status + "). Faça login novamente.");
                      window.location.href = "index.html";
                 }
                 throw new Error("Sessão inválida"); // Interrompe a execução
             }
             return response;

        } catch (networkError) {
             console.error("Erro de rede no fetchSeguro:", networkError);
             // Lança o erro novamente para que a função chamadora possa tratá-lo
             // ou poderia mostrar uma mensagem genérica aqui
             throw networkError;
        }
    }


    // --- Lógica do Formulário de REGISTRO (Página cadastro.html) ---
    const registroFormPagina = document.getElementById("registro-form"); // ID diferente do admin
    if (registroFormPagina) { // Só roda na pagina cadastro.html
        registroFormPagina.addEventListener("submit", async (event) => {
            event.preventDefault();
            const registroMensagem = registroFormPagina.querySelector(".mensagem");
            registroMensagem.textContent = ""; registroMensagem.className = "mensagem";
            const nome = document.getElementById("reg-nome").value;
            const email = document.getElementById("reg-email").value;
            const senha = document.getElementById("reg-senha").value;
            if(!nome || !email || !senha) { /* ... validação ... */ return; }
            try {
                // Registro público NÃO usa fetchSeguro, pois não precisa de token
                const response = await fetch(`${API_URL}/registrar-publico`, { // Rota pública (se existir) ou admin
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ nome, email, senha }),
                    // ATENÇÃO: Se /registrar agora SÓ aceita Admins, esta parte vai falhar.
                    // Precisamos decidir se o cadastro público ainda existe.
                    // Por ora, vamos assumir que falhará e o admin deve registrar.
                });
                const data = await response.json();
                if (response.ok) {
                    registroMensagem.textContent = data.message + " Aguarde um admin ativar sua conta ou faça login.";
                    registroMensagem.className = "mensagem sucesso";
                    registroFormPagina.reset();
                } else {
                     // Se deu erro 403 (Forbidden), significa que a rota só aceita admin
                     if(response.status === 403) {
                          registroMensagem.textContent = "Erro: Apenas administradores podem registrar novos usuários.";
                     } else {
                          registroMensagem.textContent = data.message;
                     }
                    registroMensagem.className = "mensagem erro";
                }
            } catch (error) {
                console.error("Erro ao registrar (público):", error);
                registroMensagem.textContent = "Erro de conexão."; registroMensagem.className = "mensagem erro";
            }
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
             if(!email || !senha) { /* ... validação ... */ return; }
            try {
                // Login não usa fetchSeguro
                const response = await fetch(`${API_URL}/login`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, senha }),
                });
                const data = await response.json();
                if (response.ok) {
                    salvarToken(data.token, data.usuario); // Salva token E usuário
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
    } // Fim if(loginForm)

    // --- Lógica da Página DASHBOARD ---
    const dashboardContainer = document.getElementById("lista-os-container"); // Elemento do dashboard
    if (dashboardContainer) {

        // --- 1. Proteger a rota e buscar dados iniciais ---
        (async () => {
            usuarioLogado = getUsuario(); // Tenta pegar do localStorage
            const token = getToken();

            if (!token || !usuarioLogado) {
                 limparToken();
                 if (!window.location.pathname.endsWith('/index.html') && !window.location.pathname.endsWith('/')) {
                     alert("Acesso negado. Faça login primeiro.");
                     window.location.href = "index.html";
                 }
                 return; // Interrompe
            }

            // Se tem token e usuário local, carrega o dashboard
            console.log("Usuário carregado:", usuarioLogado);
            document.getElementById("info-usuario").textContent = `Logado como: ${usuarioLogado.nome} (${usuarioLogado.role})`; // Mostra o role
            inicializarDashboard(); // Chama a função que configura o resto

        })(); // Executa a verificação inicial

        // Função para configurar o resto do dashboard
        function inicializarDashboard() {

            // --- 2. Lógica para "Sair" (Logout) ---
            const logoutButton = document.getElementById("logout-button");
            if (logoutButton) {
                logoutButton.addEventListener("click", (event) => {
                    event.preventDefault(); limparToken();
                    alert("Você saiu do sistema."); window.location.href = "index.html";
                });
            }

             // --- MOSTRAR LINK ADMIN (se aplicável) ---
            const linkAdmin = document.getElementById('link-admin'); // Pega o link pelo ID
            // Verifica se o link existe E se o usuário é Admin
            if (linkAdmin && usuarioLogado && usuarioLogado.role === 'Admin') {
                linkAdmin.style.display = 'inline-block'; // Mostra o link
            }


            // --- 3. Lógica para CRIAR Nova OS ---
            const osForm = document.getElementById("os-form");
            const osMensagem = document.getElementById("os-mensagem");
            if (osForm) {
                osForm.addEventListener("submit", async (event) => {
                    event.preventDefault();
                    osMensagem.textContent = ""; osMensagem.className = "mensagem";
                    const equipamento = document.getElementById("os-equipamento").value;
                    const descricao = document.getElementById("os-descricao").value;
                    if(!equipamento || !descricao) { /* ... validação ... */ return; }
                    try {
                        const response = await fetchSeguro(`${API_URL}/ordens`, {
                            method: "POST", body: JSON.stringify({ equipamento, descricao }),
                        });
                        const data = await response.json();
                        if (response.ok) {
                            osMensagem.textContent = data.message; osMensagem.className = "mensagem sucesso";
                            osForm.reset(); carregarOrdensDeServico();
                        } else {
                            osMensagem.textContent = data.message; osMensagem.className = "mensagem erro";
                        }
                    } catch (error) { if (error.message !== "Sessão inválida") {
                        console.error("Erro ao criar OS:", error);
                        osMensagem.textContent = "Erro de conexão."; osMensagem.className = "mensagem erro";
                    }}
                });
            }

            // --- 4. Lógica para LISTAR as OSs ---
            const listaOsContainer = document.getElementById("lista-os-container"); // Já definido fora
            async function carregarOrdensDeServico() {
                if (!listaOsContainer) return;
                listaOsContainer.innerHTML = "<p>Carregando ordens...</p>";
                try {
                    const response = await fetchSeguro(`${API_URL}/ordens`, { method: "GET" });
                    if (!response.ok) { throw new Error(`Falha: ${response.statusText}`); }
                    const ordens = await response.json();
                    listaOsContainer.innerHTML = "";
                    if (ordens.length === 0) { listaOsContainer.innerHTML = "<p>Nenhuma OS registrada.</p>"; return; }
                    ordens.forEach(os => { listaOsContainer.appendChild(criarCardOS(os)); });
                } catch (error) { if (error.message !== "Sessão inválida") {
                    console.error("Erro ao carregar OSs:", error);
                    listaOsContainer.innerHTML = `<p class='mensagem erro'>Erro: ${error.message}</p>`;
                }}
            }

            // Função que cria o HTML para um card de OS
            function criarCardOS(os) {
                const osCard = document.createElement("div"); osCard.className = "os-card";
                const criador = os.nome_criador || 'Desconhecido';
                const tecnico = os.nome_tecnico || 'N/A';
                // Convertendo quebras de linha das notas para <br>
                const notasHtml = os.notas_tecnico ? `<p class="os-notas"><b>Notas:</b> ${os.notas_tecnico.replace(/\n/g, '<br>')}</p>` : '';
                let botoesHtml = '';
                const usuario = getUsuario(); // Pega o usuário logado

                // Lógica para mostrar botões baseada no STATUS e no ROLE
                if (os.status === 'Aberto') {
                    // Só mostra "Assumir" se for Admin ou Técnico
                    if (usuario && (usuario.role === 'Admin' || usuario.role === 'Técnico')) {
                         botoesHtml = `<button class="btn-assumir" data-os-id="${os.id}">Assumir OS</button>`;
                    }
                } else if (os.status === 'Em Andamento') {
                    // Só mostra "Concluir" se for Admin ou (Técnico E for o técnico atribuído)
                    if (usuario && (usuario.role === 'Admin' || (usuario.role === 'Técnico' && usuario.id === os.tecnico_id))) {
                        botoesHtml = `<button class="btn-concluir" data-os-id="${os.id}">Concluir OS</button>`;
                    }
                }

                osCard.innerHTML = `
                    <div class="os-header">
                        <strong>${os.equipamento} (OS #${os.id})</strong>
                        <span class="os-status ${os.status.toLowerCase().replace(' ','-')}">${os.status}</span>
                    </div>
                    <p class="os-descricao">${os.descricao}</p>
                    <div class="os-info"><span><b>Criada por:</b> ${criador}</span><span><b>Em:</b> ${os.data_abertura_formatada || 'N/A'}</span></div>
                    <div class="os-info"><span><b>Técnico:</b> ${tecnico}</span><span><b>Concluída em:</b> ${os.data_conclusao_formatada || 'N/A'}</span></div>
                    ${notasHtml} <div class="os-botoes">${botoesHtml}</div>
                `;
                return osCard;
            }

            // --- 5. Lógica para os botões "Assumir" e "Concluir" ---
            listaOsContainer.addEventListener("click", async (event) => {
                const button = event.target.closest("button"); if(!button) return;
                const osId = button.dataset.osId; if (!osId) return;

                button.disabled = true; const originalText = button.textContent; button.textContent = 'Aguarde...';

                try {
                    // --- Ação: ASSUMIR OS ---
                    if (button.classList.contains("btn-assumir")) {
                        if (!confirm(`Deseja assumir a OS #${osId}?`)) { button.disabled = false; button.textContent = originalText; return; }
                        const response = await fetchSeguro(`${API_URL}/ordens/${osId}/atribuir`, { method: "POST" });
                        const data = await response.json();
                        if (response.ok) { alert(data.message); carregarOrdensDeServico(); }
                        else { alert("Erro: " + data.message); button.disabled = false; button.textContent = originalText; }
                    }
                    // --- Ação: CONCLUIR OS (Abrir Modal) ---
                    else if (button.classList.contains("btn-concluir")) {
                        abrirModalConcluir(osId);
                        button.disabled = false; button.textContent = originalText; // Reabilita, modal controla
                    }
                    else { button.disabled = false; button.textContent = originalText; } // Botão desconhecido
                } catch (error) {
                    button.disabled = false; button.textContent = originalText;
                    if (error.message !== "Sessão inválida") { console.error("Erro na ação:", error); alert("Erro de conexão."); }
                }
            }); // Fim eventListener listaOsContainer

            // --- 6. Lógica do Modal (Popup) ---
            const modal = document.getElementById("modal-concluir");
            const modalForm = document.getElementById("form-concluir");
            const modalCancelar = document.getElementById("modal-cancelar");
            const modalMensagem = document.getElementById("modal-mensagem");
            const modalOsIdSpan = document.getElementById("modal-os-id");
            const modalNotasInput = document.getElementById("modal-notas-tecnico");
            const modalSubmitButton = modalForm.querySelector('button[type="submit"]');
            let osIdParaConcluir = null;
            function abrirModalConcluir(osId) {
                osIdParaConcluir = osId; modalOsIdSpan.textContent = osId;
                modalNotasInput.value = ""; modalMensagem.textContent = ""; modalMensagem.className = "mensagem";
                modalSubmitButton.disabled = false; modalSubmitButton.textContent = 'Concluir OS';
                modal.style.display = "flex";
            }
            function fecharModalConcluir() { modal.style.display = "none"; }
            modalCancelar.addEventListener("click", fecharModalConcluir);
            modalForm.addEventListener("submit", async (event) => {
                event.preventDefault(); const notas = modalNotasInput.value; if (!osIdParaConcluir) return;
                modalSubmitButton.disabled = true; modalSubmitButton.textContent = 'Enviando...';
                modalMensagem.textContent = ""; modalMensagem.className = "mensagem";
                try {
                    const response = await fetchSeguro(`${API_URL}/ordens/${osIdParaConcluir}/concluir`, {
                        method: "POST", body: JSON.stringify({ notas_tecnico: notas })
                    });
                    const data = await response.json();
                    if (response.ok) {
                        alert(data.message); fecharModalConcluir(); carregarOrdensDeServico();
                    } else {
                        modalMensagem.textContent = data.message; modalMensagem.className = "mensagem erro";
                        modalSubmitButton.disabled = false; modalSubmitButton.textContent = 'Concluir OS';
                    }
                } catch (error) {
                    modalSubmitButton.disabled = false; modalSubmitButton.textContent = 'Concluir OS';
                    if (error.message !== "Sessão inválida") {
                        console.error("Erro ao concluir:", error);
                        modalMensagem.textContent = "Erro de conexão."; modalMensagem.className = "mensagem erro";
                    }
                }
            }); // Fim modalForm submit

            // --- 7. Carrega a lista de OSs assim que a página abre ---
            carregarOrdensDeServico();

        } // Fim da função inicializarDashboard

    } // Fim do if (está no dashboard)

    // --- Lógica da Página ADMIN ---
    const adminContainer = document.querySelector('.admin-container'); // Elemento da admin.html
    if (adminContainer) {

        // --- 1. Proteger a Rota e Verificar se é ADMIN ---
        (async () => {
            usuarioLogado = getUsuario(); // Tenta pegar do localStorage
            const token = getToken();

            // Verifica se está logado
            if (!token || !usuarioLogado) {
                limparToken();
                if (!window.location.pathname.endsWith('/index.html') && !window.location.pathname.endsWith('/')) {
                    alert("Acesso negado. Faça login primeiro."); window.location.href = "index.html";
                } return;
            }

            // --- VERIFICAÇÃO DE ADMIN ---
            if (usuarioLogado.role !== 'Admin') {
                alert("Acesso negado. Apenas administradores.");
                window.location.href = "dashboard.html"; // Redireciona para o dashboard
                return;
            }
            // --- FIM DA VERIFICAÇÃO ---

            // Se chegou aqui, é Admin. Carrega a página.
            console.log("Admin logado:", usuarioLogado);
            document.getElementById("info-usuario").textContent = `Admin: ${usuarioLogado.nome}`;
            inicializarAdminPage();

        })(); // Executa a verificação inicial

        // Função para configurar o resto da página admin
        function inicializarAdminPage() {

             // --- Lógica para "Sair" (Logout) ---
            const logoutButton = document.getElementById("logout-button");
            if (logoutButton) {
                logoutButton.addEventListener("click", (event) => {
                    event.preventDefault(); limparToken();
                    alert("Você saiu do sistema."); window.location.href = "index.html";
                });
            }

            // --- Lógica para REGISTRAR Novo Usuário (Admin) ---
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

                    if(!nome || !email || !senha || !role) { /* ... validação ... */ return; }
                    try {
                        // Admin usa fetchSeguro para registrar
                        const response = await fetchSeguro(`${API_URL}/registrar`, {
                            method: "POST",
                            body: JSON.stringify({ nome, email, senha, role }),
                        });
                        const data = await response.json();
                        if (response.ok) {
                            registroMensagemAdmin.textContent = data.message;
                            registroMensagemAdmin.className = "mensagem sucesso";
                            registroFormAdmin.reset();
                            carregarListaUsuarios(); // Atualiza a lista
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
            } // Fim if(registroFormAdmin)

            // --- Lógica para LISTAR Usuários ---
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

                    let tabelaHtml = `<table class="tabela-usuarios"><thead><tr><th>ID</th><th>Nome</th><th>Email</th><th>Papel</th></tr></thead><tbody>`;
                    usuarios.forEach(user => {
                        tabelaHtml += `<tr><td>${user.id}</td><td>${user.nome}</td><td>${user.email}</td><td>${user.role}</td></tr>`;
                    });
                    tabelaHtml += `</tbody></table>`;
                    listaUsuariosContainer.innerHTML = tabelaHtml;

                } catch (error) { if (error.message !== "Sessão inválida") {
                    console.error("Erro ao carregar usuários:", error);
                    listaUsuariosContainer.innerHTML = `<p class='mensagem erro'>Erro: ${error.message}</p>`;
                }}
            } // Fim carregarListaUsuarios

            // Carrega a lista de usuários ao iniciar a página admin
            carregarListaUsuarios();

        } // Fim da função inicializarAdminPage

    } // Fim do if (está na admin.html)

}); // Fim do DOMContentLoaded