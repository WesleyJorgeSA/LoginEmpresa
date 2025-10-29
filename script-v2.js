// Espera o documento HTML carregar antes de rodar o script
document.addEventListener("DOMContentLoaded", () => {

    const API_URL = "http://127.0.0.1:5000";
    let usuarioLogado = null;

    // --- FUNÇÕES DE AJUDA PARA O TOKEN JWT ---
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
            usuarioLogado = JSON.parse(localStorage.getItem("usuario"));
            return usuarioLogado;
        } catch (e) { return null; }
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
        options.credentials = 'include'; // Necessário para CORS

        const response = await fetch(url, options);

        if (response.status === 401 || response.status === 422) { // 401=Não autorizado/Expirado, 422=Token malformado
            limparToken();
            alert("Sua sessão expirou (erro " + response.status + "). Faça login novamente.");
            // Garante que o redirecionamento ocorra mesmo se já estiver em index.html (evita loop)
            if (!window.location.pathname.endsWith('/index.html') && !window.location.pathname.endsWith('/')) {
                 window.location.href = "index.html";
            }
            throw new Error("Sessão inválida"); // Interrompe a execução da função chamadora
        }
        return response;
    }


    // --- Lógica do Formulário de REGISTRO ---
    const registroForm = document.getElementById("registro-form");
    if (registroForm) {
        registroForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const registroMensagem = registroForm.querySelector(".mensagem");
            registroMensagem.textContent = ""; registroMensagem.className = "mensagem";
            const nome = document.getElementById("reg-nome").value;
            const email = document.getElementById("reg-email").value;
            const senha = document.getElementById("reg-senha").value;
            if(!nome || !email || !senha) {
                 registroMensagem.textContent = "Todos os campos são obrigatórios.";
                 registroMensagem.className = "mensagem erro";
                 return;
            }
            try {
                const response = await fetch(`${API_URL}/registrar`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ nome, email, senha }),
                });
                const data = await response.json();
                if (response.ok) {
                    registroMensagem.textContent = data.message + " Você já pode fazer login.";
                    registroMensagem.className = "mensagem sucesso";
                    registroForm.reset();
                } else {
                    registroMensagem.textContent = data.message; registroMensagem.className = "mensagem erro";
                }
            } catch (error) {
                console.error("Erro ao registrar:", error);
                registroMensagem.textContent = "Erro de conexão."; registroMensagem.className = "mensagem erro";
            }
        });
    } // Fim if(registroForm)

    // --- Lógica do Formulário de LOGIN ---
    const loginForm = document.getElementById("login-form");
    if (loginForm) {
        loginForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const loginMensagem = document.getElementById("login-mensagem");
            loginMensagem.textContent = ""; loginMensagem.className = "mensagem";
            const email = document.getElementById("login-email").value;
            const senha = document.getElementById("login-senha").value;
             if(!email || !senha) {
                 loginMensagem.textContent = "Email e senha são obrigatórios.";
                 loginMensagem.className = "mensagem erro";
                 return;
            }
            try {
                const response = await fetch(`${API_URL}/login`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, senha }),
                });
                const data = await response.json();
                if (response.ok) {
                    salvarToken(data.token, data.usuario);
                    const tokenSalvo = getToken(); // Verifica se salvou
                    if (!tokenSalvo) { console.error("FALHA! localStorage não salvou o token."); return; }
                    loginMensagem.textContent = "Login bem-sucedido! Redirecionando...";
                    loginMensagem.className = "mensagem sucesso"; // Mostra msg de sucesso
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
    // Verifica se estamos na página do dashboard
    if (document.getElementById("lista-os-container")) { // Checa por um elemento específico do dashboard

        // --- 1. Proteger a rota e buscar dados iniciais ---
        (async () => {
            usuarioLogado = getUsuario(); // Tenta pegar do localStorage
            const token = getToken();

            if (!token || !usuarioLogado) {
                 console.warn("Token ou usuário não encontrado no localStorage, limpando e redirecionando.");
                 limparToken();
                 // Evita alert se já estiver redirecionando
                 if (!window.location.pathname.endsWith('/index.html') && !window.location.pathname.endsWith('/')) {
                     alert("Acesso negado. Faça login primeiro.");
                     window.location.href = "index.html";
                 }
                 return; // Interrompe a execução
            }

            // Se tem token e usuário local, assume que está logado e carrega o dashboard
            console.log("Usuário carregado do localStorage:", usuarioLogado);
            document.getElementById("info-usuario").textContent = `Logado como: ${usuarioLogado.nome}`;
            inicializarDashboard(); // Chama a função que configura o resto

        })(); // Executa a verificação inicial

        // Função para configurar o resto do dashboard
        function inicializarDashboard() {

            // --- 2. Lógica para "Sair" (Logout) ---
            const logoutButton = document.getElementById("logout-button");
            if (logoutButton) {
                logoutButton.addEventListener("click", (event) => {
                    event.preventDefault();
                    limparToken(); // Apenas limpa localmente com JWT
                    alert("Você saiu do sistema.");
                    window.location.href = "index.html";
                });
            }

            // --- 3. Lógica para CRIAR Nova OS ---
            const osForm = document.getElementById("os-form");
            const osMensagem = document.getElementById("os-mensagem"); // Definido aqui
            if (osForm) {
                osForm.addEventListener("submit", async (event) => {
                    event.preventDefault();
                    osMensagem.textContent = ""; osMensagem.className = "mensagem";
                    const equipamento = document.getElementById("os-equipamento").value;
                    const descricao = document.getElementById("os-descricao").value;
                    if(!equipamento || !descricao) {
                         osMensagem.textContent = "Equipamento e Descrição são obrigatórios.";
                         osMensagem.className = "mensagem erro";
                         return;
                    }
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
            const listaOsContainer = document.getElementById("lista-os-container");
            async function carregarOrdensDeServico() {
                if (!listaOsContainer) return;
                listaOsContainer.innerHTML = "<p>Carregando ordens...</p>"; // Feedback visual
                try {
                    const response = await fetchSeguro(`${API_URL}/ordens`, { method: "GET" });
                    if (!response.ok) { throw new Error(`Falha ao buscar dados: ${response.statusText}`); }
                    const ordens = await response.json();
                    listaOsContainer.innerHTML = "";
                    if (ordens.length === 0) { listaOsContainer.innerHTML = "<p>Nenhuma ordem de serviço registrada.</p>"; return; }
                    ordens.forEach(os => { listaOsContainer.appendChild(criarCardOS(os)); });
                } catch (error) { if (error.message !== "Sessão inválida") {
                    console.error("Erro ao carregar OSs:", error);
                    listaOsContainer.innerHTML = `<p class='mensagem erro'>Erro ao carregar ordens: ${error.message}</p>`;
                }}
            }

            // Função que cria o HTML para um card de OS
            function criarCardOS(os) {
                const osCard = document.createElement("div"); osCard.className = "os-card";
                const criador = os.nome_criador || 'Desconhecido';
                const tecnico = os.nome_tecnico || 'N/A';
                const notasHtml = os.notas_tecnico ? `<p class="os-notas"><b>Notas:</b> ${os.notas_tecnico.replace(/\n/g, '<br>')}</p>` : ''; // Trata quebras de linha
                let botoesHtml = '';
                const usuario = getUsuario();

                if (os.status === 'Aberto') {
                    botoesHtml = `<button class="btn-assumir" data-os-id="${os.id}">Assumir OS</button>`;
                } else if (os.status === 'Em Andamento') {
                    if (usuario && usuario.id === os.tecnico_id) {
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
                const button = event.target.closest("button"); // Pega o botão clicado
                if(!button) return; // Sai se não clicou em um botão

                const osId = button.dataset.osId;
                if (!osId) return;

                button.disabled = true; // Desabilita botão para evitar clique duplo
                const originalText = button.textContent;
                button.textContent = 'Aguarde...';

                try {
                    // --- Ação: ASSUMIR OS ---
                    if (button.classList.contains("btn-assumir")) {
                        if (!confirm(`Deseja assumir a OS #${osId}?`)) {
                             button.disabled = false; button.textContent = originalText; return;
                        }
                        const response = await fetchSeguro(`${API_URL}/ordens/${osId}/atribuir`, { method: "POST" });
                        const data = await response.json();
                        if (response.ok) { alert(data.message); carregarOrdensDeServico(); }
                        else { alert("Erro: " + data.message); button.disabled = false; button.textContent = originalText; }
                    }

                    // --- Ação: CONCLUIR OS (Abrir Modal) ---
                    else if (button.classList.contains("btn-concluir")) {
                        abrirModalConcluir(osId);
                        button.disabled = false; // Reabilita imediatamente, pois o modal vai lidar com isso
                        button.textContent = originalText;
                    }
                    else {
                         button.disabled = false; // Reabilita se não for botão conhecido
                         button.textContent = originalText;
                    }
                } catch (error) {
                    button.disabled = false; // Reabilita em caso de erro
                    button.textContent = originalText;
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
            const modalSubmitButton = modalForm.querySelector('button[type="submit"]'); // Pega o botão submit do modal
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

}); // Fim do DOMContentLoaded