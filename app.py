# --- Imports ---
from flask import Flask, request, jsonify, session, render_template, send_from_directory
from flask_bcrypt import Bcrypt
from flask_cors import CORS
import mysql.connector
import mysql.connector.errors
from datetime import datetime
from dateutil.relativedelta import relativedelta
from datetime import timedelta
import os
from functools import wraps # Import no topo

# --- Importar Flask-Session ---
from flask_session import Session
# --- Importar JWT ---
# Importamos get_jwt_identity (para ler a ID:Role) e get_jwt (para ler claims extras se precisarmos no futuro)
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required, JWTManager, get_jwt

# --- Configuração ---
app = Flask(__name__)
bcrypt = Bcrypt(app)
# Configuração CORS mais permissiva para rede local
CORS(app, supports_credentials=True,
     origins="*",
     allow_headers=["Authorization", "Content-Type"],
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    )
# ATENÇÃO: origins="*" só é seguro em redes locais confiáveis

# --- Configuração da Sessão (necessária para Flask-Session, mesmo usando JWT) ---
app.config["SECRET_KEY"] = "sua_chave_secreta_principal_aqui" # MUDE ISSO PARA ALGO SEGURO!
app.config["SESSION_TYPE"] = "filesystem"
if not os.path.exists("flask_session"):
    os.makedirs("flask_session")
app.config["SESSION_FILE_DIR"] = "./flask_session"
app.config["SESSION_COOKIE_SAMESITE"] = "None"
app.config["SESSION_COOKIE_SECURE"] = False # Mude para True em produção (HTTPS)
Session(app)

# --- Configuração do JWT (crachá) ---
app.config["JWT_SECRET_KEY"] = app.config["SECRET_KEY"] # Reutiliza a chave secreta
app.config["JWT_TOKEN_LOCATION"] = ["headers"]
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(hours=1)
# NÃO definimos JWT_HEADER_TYPE, para usar o padrão "Bearer"
jwt = JWTManager(app)

# Configura os dados de conexão com o seu banco MySQL
db_config = { 'host': 'localhost', 'user': 'root', 'password': '', 'database': 'empresa_db' }

# --- Função Auxiliar para Conectar ---
def get_db_connection():
    try: return mysql.connector.connect(**db_config)
    except mysql.connector.Error as err:
        print(f"Erro ao conectar ao MySQL: {err}"); return None

# --- Decorador de Permissão (usando ID:Role na identidade) ---
def require_role(allowed_roles):
    """ Decorator factory para exigir papéis específicos (lê de 'ID:Role') """
    def decorator(fn):
        @wraps(fn)
        @jwt_required() # Garante que está logado antes de verificar o papel
        def wrapper(*args, **kwargs):
            identity_data = get_jwt_identity() # Pega a string "ID:Role"
            user_role = "" # Valor padrão
            user_id_str = None # Para guardar o ID extraído
            try:
                parts = identity_data.split(':', 1)
                if len(parts) == 2:
                    user_id_str, user_role = parts
                else:
                    print(f"--- DEBUG ERRO: Formato de identidade inválido: '{identity_data}'")
            except (ValueError, AttributeError):
                print(f"--- DEBUG ERRO: Não foi possível processar a identidade: '{identity_data}'")

            # Adiciona o ID do usuário aos kwargs da função decorada (opcional, mas útil)
            kwargs['current_user_id'] = user_id_str

            print(f"--- DEBUG: Verificando permissão. Token Role='{user_role}', Permitidos={allowed_roles}")

            allowed_roles_lower = [role.lower() for role in allowed_roles]

            if not user_role or user_role.lower() not in allowed_roles_lower:
                print(f"--- DEBUG: Acesso NEGADO para Role='{user_role}'")
                return jsonify(message=f"Acesso negado. Requer papel: {', '.join(allowed_roles)}"), 403

            print(f"--- DEBUG: Acesso PERMITIDO para Role='{user_role}' (ID: {user_id_str})")
            return fn(*args, **kwargs)
        return wrapper
    return decorator

# Criamos decoradores específicos
admin_required = require_role(["Admin"])
tecnico_required = require_role(["Técnico"])
admin_or_tecnico_required = require_role(["Admin", "Técnico"])
monitor_ou_admin_required = require_role(["Admin", "Monitor"])

# --- ROTAS PARA SERVIR O FRONTEND ---

# Rota principal para o login (index.html)
@app.route('/')
def serve_index():
    return render_template('index.html')

# Rota para servir outros arquivos HTML
@app.route('/<path:filename>.html')
def serve_html(filename):
    # Verifica se o template existe para evitar erros
    template_path = f"{filename}.html"
    if os.path.exists(os.path.join(app.template_folder, template_path)):
         return render_template(template_path)
    else:
         # Pode retornar um erro 404 customizado ou redirecionar
         return "Página não encontrada", 404

# Rota para servir arquivos estáticos (CSS, JS)
@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory('static', filename)

# --- FIM DAS ROTAS FRONTEND ---

# --- Rotas (Endpoints) ---

@app.route("/")
def home():
    return "Nosso backend está no ar!"

# --- Rota de Cadastro ---
@app.route("/registrar", methods=["POST"])
@admin_required # <-- SÓ ADMIN PODE REGISTRAR AGORA
def registrar(current_user_id): # Recebe o ID do admin logado (embora não usemos aqui)
    dados = request.get_json()
    email = dados.get('email')
    senha_texto_puro = dados.get('senha')
    nome = dados.get('nome')
    # --- NOVO: Pega o role do request, com padrão 'Operador' ---
    role = dados.get('role', 'Operador').strip().capitalize() # Pega, limpa espaços e capitaliza

    # Validação simples do role (opcional mas recomendado)
    allowed_roles_list = ['Admin', 'Técnico', 'Operador']
    if role not in allowed_roles_list:
        return jsonify({"message": f"Papel inválido. Permitidos: {', '.join(allowed_roles_list)}"}), 400

    if not email or not senha_texto_puro or not nome:
        return jsonify({"message": "Nome, email e senha são obrigatórios."}), 400

    senha_hash = bcrypt.generate_password_hash(senha_texto_puro).decode('utf-8')
    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor()
        # --- MUDANÇA AQUI: Incluir 'role' no INSERT ---
        sql = "INSERT INTO usuarios (email, senha_hash, nome, role) VALUES (%s, %s, %s, %s)"
        valores = (email, senha_hash, nome, role) # <-- role adicionado
        cursor.execute(sql, valores); conn.commit()
        return jsonify({"message": f"Usuário {nome} registrado com sucesso como {role}!"}), 201
    except mysql.connector.Error as err:
        if err.errno == 1062: return jsonify({"message": "Este email já está cadastrado."}), 409
        print(f"Erro DB registro: {err}")
        return jsonify({"message": f"Erro de banco de dados no registro."}), 500
    except AssertionError as msg: return jsonify({"message": str(msg)}), 500
    except Exception as e: print(f"Erro registro: {e}"); return jsonify({"message": "Erro interno no registro."}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

# --- ROTA: Permissão OPTIONS para /stats/* ---
@app.route("/stats/<path:path>", methods=["OPTIONS"])
def handle_options_stats(path):
    response = app.make_default_options_response()
    allowed_headers = request.headers.get("Access-Control-Request-Headers")
    if allowed_headers:
         response.headers.add("Access-Control-Allow-Headers", allowed_headers)
    response.headers.add("Access-Control-Allow-Methods", "GET, OPTIONS")
    return response

# --- Rota 1: Contagem de OS por Status (Gráfico de Pizza) ---
@app.route("/stats/contagem-status", methods=["GET"])
@monitor_ou_admin_required # Protegido
def stats_contagem_status(current_user_id):
    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor(dictionary=True)
        # Conta todas as OSs e agrupa por status
        sql = "SELECT status, COUNT(*) as total FROM ordens_servico GROUP BY status"
        cursor.execute(sql)
        dados = cursor.fetchall() # Retorna ex: [{"status": "Aberto", "total": 5}, ...]
        return jsonify(dados), 200
    except Exception as e:
        print(f"Erro em stats_contagem_status: {e}")
        return jsonify({"message": "Erro ao buscar estatísticas de status."}), 500
    finally:
         if cursor: cursor.close()
         if conn: conn.close()

# --- Rota 2: OSs abertas este mês por máquina (Gráfico de Barras) ---
@app.route("/stats/os-por-maquina-mes", methods=["GET"])
@monitor_ou_admin_required # Protegido
def stats_os_por_maquina_mes(current_user_id):
    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor(dictionary=True)

        # Pega o primeiro e último dia do mês atual
        hoje = datetime.now()
        primeiro_dia_mes = hoje.strftime('%Y-%m-01 00:00:00')
        # (Calcula o próximo mês e subtrai 1 dia - complexo)
        # Forma mais fácil:
        # Filtra por Mês e Ano atuais

        sql = """
            SELECT 
                eq.tag, 
                COUNT(os.id) AS total_os
            FROM equipamentos eq
            LEFT JOIN ordens_servico os ON eq.id = os.equipamento_id
            WHERE 
                MONTH(os.data_abertura) = MONTH(CURRENT_DATE())
                AND YEAR(os.data_abertura) = YEAR(CURRENT_DATE())
            GROUP BY eq.id, eq.tag
            ORDER BY total_os DESC
            LIMIT 10;
        """ # Limita às 10 máquinas com mais OSs

        cursor.execute(sql)
        dados = cursor.fetchall()
        return jsonify(dados), 200
    except Exception as e:
        print(f"Erro em stats_os_por_maquina_mes: {e}")
        return jsonify({"message": "Erro ao buscar estatísticas por máquina."}), 500
    finally:
         if cursor: cursor.close()
         if conn: conn.close()

# --- Rota 3: Lista de máquinas em manutenção (Lista simples) ---
@app.route("/stats/em-manutencao", methods=["GET"])
@monitor_ou_admin_required # Protegido
def stats_em_manutencao(current_user_id):
    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor(dictionary=True)
        sql = """
            SELECT 
                eq.tag, eq.nome_equipamento, eq.setor,
                u_tecnico.nome as nome_tecnico,
                os.id as os_id, os.descricao
            FROM ordens_servico os
            JOIN equipamentos eq ON os.equipamento_id = eq.id
            LEFT JOIN usuarios u_tecnico ON os.tecnico_id = u_tecnico.id
            WHERE os.status = 'Em Andamento'
        """
        cursor.execute(sql)
        dados = cursor.fetchall()
        return jsonify(dados), 200
    except Exception as e:
        print(f"Erro em stats_em_manutencao: {e}")
        return jsonify({"message": "Erro ao buscar máquinas em manutenção."}), 500
    finally:
         if cursor: cursor.close()
         if conn: conn.close()

         # --- Rota 4: Horas Paradas por Máquina (Este Mês) ---
@app.route("/stats/horas-paradas-mes", methods=["GET"])
@monitor_ou_admin_required # Protegido
def stats_horas_paradas_mes(current_user_id):
    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor(dictionary=True)

        # Este SQL calcula o total de horas paradas (downtime)
        # para todas as OSs CONCLUÍDAS no mês e ano atuais.
        sql = """
            SELECT 
                eq.tag,
                SUM(
                    TIMESTAMPDIFF(MINUTE, os.data_abertura, os.data_conclusao)
                ) / 60.0 AS total_horas_paradas
            FROM ordens_servico os
            JOIN equipamentos eq ON os.equipamento_id = eq.id
            WHERE 
                os.status = 'Concluído'
                AND MONTH(os.data_conclusao) = MONTH(CURRENT_DATE())
                AND YEAR(os.data_conclusao) = YEAR(CURRENT_DATE())
            GROUP BY eq.id, eq.tag
            ORDER BY total_horas_paradas DESC;
        """
        # Usamos TIMESTAMPDIFF(MINUTE, ...) / 60.0 para obter as horas com decimais (ex: 1.5 horas)

        cursor.execute(sql)
        dados = cursor.fetchall()
        # Arredonda os resultados para 2 casas decimais
        for item in dados:
            item['total_horas_paradas'] = round(item['total_horas_paradas'], 2)

        return jsonify(dados), 200
    except Exception as e:
        print(f"Erro em stats_horas_paradas_mes: {e}")
        return jsonify({"message": "Erro ao buscar estatísticas de horas paradas."}), 500
    finally:
         if cursor: cursor.close()
         if conn: conn.close()

# --- NOVA ROTA: Listar todos os usuários (SÓ ADMIN) ---
@app.route("/admin/usuarios", methods=["GET"])
@admin_required # Protegido!
def listar_usuarios(current_user_id):
    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor(dictionary=True)
        # Seleciona todos os usuários, EXCETO a senha_hash
        sql = "SELECT id, email, nome, role FROM usuarios ORDER BY nome ASC"
        cursor.execute(sql)
        usuarios = cursor.fetchall()
        return jsonify(usuarios), 200
    except AssertionError as msg: return jsonify({"message": str(msg)}), 500
    except Exception as e: print(f"Erro ao listar usuários: {e}"); return jsonify({"message": "Erro ao listar usuários."}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

# --- NOVAS ROTAS: CRUD de Equipamentos (SÓ ADMIN) ---

@app.route("/admin/equipamentos", methods=["GET"])
@admin_required
def listar_equipamentos(current_user_id):
    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor(dictionary=True)
        sql = "SELECT * FROM equipamentos ORDER BY setor, tag ASC"
        cursor.execute(sql)
        equipamentos = cursor.fetchall()
        return jsonify(equipamentos), 200
    except Exception as e:
        print(f"Erro ao listar equipamentos: {e}"); return jsonify({"message": "Erro ao listar equipamentos."}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

@app.route("/admin/equipamentos", methods=["POST"])
@admin_required
def criar_equipamento(current_user_id):
    dados = request.get_json()
    tag = dados.get('tag')
    nome = dados.get('nome_equipamento')
    setor = dados.get('setor')

    if not tag or not nome or not setor:
        return jsonify({"message": "Tag, Nome do Equipamento e Setor são obrigatórios."}), 400

    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor()
        sql = "INSERT INTO equipamentos (tag, nome_equipamento, setor) VALUES (%s, %s, %s)"
        valores = (tag, nome, setor)
        cursor.execute(sql, valores); conn.commit()
        return jsonify({"message": f"Equipamento {tag} criado com sucesso!"}), 201
    except mysql.connector.Error as err:
         if err.errno == 1062: # Tag duplicada
             return jsonify({"message": "Erro: Esta TAG já está cadastrada."}), 409
         print(f"Erro DB ao criar equipamento: {err}")
         return jsonify({"message": "Erro de banco de dados."}), 500
    except Exception as e:
        print(f"Erro ao criar equipamento: {e}"); return jsonify({"message": "Erro interno."}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

@app.route("/admin/equipamentos/<int:equip_id>", methods=["DELETE"])
@admin_required
def excluir_equipamento(current_user_id, equip_id):
    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor()
        # A regra ON DELETE SET NULL cuidará das OSs existentes
        sql = "DELETE FROM equipamentos WHERE id = %s"
        cursor.execute(sql, (equip_id,))
        if cursor.rowcount == 0:
            return jsonify({"message": "Equipamento não encontrado."}), 404
        conn.commit()
        return jsonify({"message": "Equipamento excluído com sucesso."}), 200
    except Exception as e:
        print(f"Erro ao excluir equipamento: {e}"); return jsonify({"message": "Erro interno ao excluir."}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

# --- FIM DAS ROTAS DE EQUIPAMENTOS ---

# --- NOVA ROTA: Excluir um usuário (SÓ ADMIN) ---
@app.route("/admin/usuarios/<int:usuario_id_para_excluir>", methods=["DELETE"])
@admin_required # Protegido!
def excluir_usuario(current_user_id, usuario_id_para_excluir): # Recebe ID do admin e ID a excluir
    # current_user_id vem do nosso decorador require_role

    # --- REGRA DE SEGURANÇA: Admin não pode se excluir ---
    if str(usuario_id_para_excluir) == current_user_id:
        return jsonify({"message": "Você não pode excluir a si mesmo."}), 403 # Forbidden

    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor()

        # --- CUIDADO: O que fazer com as OSs do usuário excluído? ---
        # Opção 1 (Atual): As FOREIGN KEYs estão 'ON DELETE SET NULL'.
        # Isso significa que ao excluir o usuário, os campos 'usuario_id' e 'tecnico_id'
        # nas ordens_servico relacionadas a ele se tornarão NULL (Desconhecido).
        # Esta é geralmente a abordagem mais segura para não perder dados históricos.

        # Opção 2 (Mais complexa, não implementada aqui): Impedir a exclusão se o
        # usuário tiver OSs importantes, ou reatribuí-las.

        # Executa a exclusão
        sql = "DELETE FROM usuarios WHERE id = %s"
        valores = (usuario_id_para_excluir,)
        cursor.execute(sql, valores)

        # Verifica se alguma linha foi realmente excluída
        if cursor.rowcount == 0:
            return jsonify({"message": "Usuário não encontrado."}), 404 # Not Found

        conn.commit() # Salva a exclusão
        return jsonify({"message": f"Usuário ID {usuario_id_para_excluir} excluído com sucesso."}), 200

    except AssertionError as msg: return jsonify({"message": str(msg)}), 500
    except mysql.connector.Error as db_err:
         # Pode dar erro se houver outras restrições de chave estrangeira no futuro
         print(f"Erro DB ao excluir usuário: {db_err}")
         return jsonify({"message": "Erro no banco de dados ao excluir usuário. Verifique se ele não está referenciado em outras tabelas."}), 500
    except Exception as e:
        print(f"Erro ao excluir usuário: {e}")
        return jsonify({"message": "Erro interno ao excluir usuário."}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

        # --- NOVA ROTA: Editar um usuário (SÓ ADMIN) ---
@app.route("/admin/usuarios/<int:usuario_id_para_editar>", methods=["PUT"])
@admin_required
def editar_usuario(current_user_id, usuario_id_para_editar):
    # current_user_id é o ID do Admin logado (vem do decorador)

    dados = request.get_json()
    nome = dados.get('nome')
    email = dados.get('email')
    role = dados.get('role')

    if not nome or not email or not role:
        return jsonify({"message": "Nome, email e papel são obrigatórios."}), 400

    # Validação do role
    allowed_roles_list = ['Admin', 'Técnico', 'Operador']
    if role not in allowed_roles_list:
        return jsonify({"message": "Papel inválido."}), 400

    # --- REGRA DE SEGURANÇA: Admin não pode rebaixar a si mesmo ---
    if str(usuario_id_para_editar) == current_user_id and role != 'Admin':
        return jsonify({"message": "Você não pode remover seu próprio status de Admin."}), 403

    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor()

        # Atualiza o usuário no banco
        sql = "UPDATE usuarios SET nome = %s, email = %s, role = %s WHERE id = %s"
        valores = (nome, email, role, usuario_id_para_editar)
        cursor.execute(sql, valores)

        if cursor.rowcount == 0:
            return jsonify({"message": "Usuário não encontrado."}), 404

        conn.commit()
        return jsonify({"message": f"Usuário {nome} (ID: {usuario_id_para_editar}) atualizado com sucesso."}), 200

    except AssertionError as msg: return jsonify({"message": str(msg)}), 500
    except mysql.connector.Error as db_err:
         # Erro 1062 é para 'Entrada Duplicada' (email já existe)
         if db_err.errno == 1062:
             return jsonify({"message": "Erro: Este email já está em uso por outro usuário."}), 409
         print(f"Erro DB ao editar usuário: {db_err}")
         return jsonify({"message": "Erro no banco de dados ao editar usuário."}), 500
    except Exception as e:
        print(f"Erro ao editar usuário: {e}")
        return jsonify({"message": "Erro interno ao editar usuário."}), 500
    finally:
        if cursor: cursor.close()
        if conn: conn.close()

# --- ROTA DE LOGIN (JWT com ID:Role na identidade) ---
@app.route("/login", methods=["POST"])
def login():
    dados = request.get_json(); email = dados.get('email'); senha_texto_puro = dados.get('senha')
    if not email or not senha_texto_puro: return jsonify({"message": "Email e senha são obrigatórios."}), 400
    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor(dictionary=True)
        # Pede o role na query do banco
        sql = "SELECT id, email, nome, role, senha_hash FROM usuarios WHERE email = %s";
        cursor.execute(sql, (email,))
        usuario = cursor.fetchone()

        if not usuario: return jsonify({"message": "Email ou senha inválidos."}), 401

        if bcrypt.check_password_hash(usuario['senha_hash'], senha_texto_puro):
            user_id_str = str(usuario['id'])
            # Garante que role não seja None antes de criar a identidade
            user_role = usuario.get('role', 'Operador') # Padrão 'Operador' se for nulo/vazio no DB
            if not user_role: # Segurança extra
                user_role = 'Operador'

            print(f"--- DEBUG LOGIN: Lendo do DB Role='{user_role}' para ID={user_id_str}")

            # Cria a identidade combinada "ID:Role"
            identity_data = f"{user_id_str}:{user_role}"
            access_token = create_access_token(identity=identity_data) # Sem additional_claims

            print(f"--- DEBUG LOGIN: Token criado com identity='{identity_data}'")

            session.clear() # Limpa qualquer sessão antiga do Flask-Session
            return jsonify(
                message="Login bem-sucedido!",
                token=access_token,
                usuario={ # Envia os dados corretos para o frontend
                    "id": usuario['id'],
                    "nome": usuario['nome'],
                    "email": usuario['email'],
                    "role": user_role
                }
            ), 200
        else: return jsonify({"message": "Email ou senha inválidos."}), 401
    except AssertionError as msg: return jsonify({"message": str(msg)}), 500
    except Exception as e: print(f"Erro no login: {e}"); return jsonify({"message": "Erro interno no login."}), 500
    finally:
         if cursor: cursor.close()
         if conn: conn.close()

# --- NOVA ROTA: LOGIN POR CÓDIGO ÚNICO ---
@app.route("/login-codigo", methods=["POST"])
def login_por_codigo():
    dados = request.get_json()
    codigo = dados.get('codigo_unico')

    if not codigo:
        return jsonify({"message": "Código único é obrigatório."}), 400

    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor(dictionary=True)

        # Procura o usuário pelo código único
        sql = "SELECT id, email, nome, role, senha_hash FROM usuarios WHERE codigo_unico = %s"
        cursor.execute(sql, (codigo,))
        usuario = cursor.fetchone()

        # Se não achou o usuário com esse código
        if not usuario:
            return jsonify({"message": "Código único inválido."}), 401

        # --- SUCESSO! ---
        # Encontrou o usuário. Vamos criar o token da mesma forma que o login normal.
        user_id_str = str(usuario['id'])
        user_role = usuario.get('role', 'Operador')
        if not user_role: user_role = 'Operador'

        identity_data = f"{user_id_str}:{user_role}"
        access_token = create_access_token(identity=identity_data)

        print(f"--- DEBUG LOGIN (CÓDIGO): Token criado com identity='{identity_data}'")

        session.clear() # Limpa sessão antiga do Flask
        return jsonify(
            message="Login bem-sucedido!",
            token=access_token,
            usuario={
                "id": usuario['id'],
                "nome": usuario['nome'],
                "email": usuario['email'],
                "role": user_role
            }
        ), 200

    except AssertionError as msg: return jsonify({"message": str(msg)}), 500
    except Exception as e:
        print(f"Erro no login por código: {e}")
        return jsonify({"message": "Erro interno no login por código."}), 500
    finally:
         if cursor: cursor.close()
         if conn: conn.close()

# --- ROTA DE LOGOUT ---
@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"message": "Logout solicitado. Remova o token JWT."}), 200

# --- ROTA: Permissão OPTIONS para /ordens ---
# (Necessária porque a requisição GET /ordens tem o header Authorization)
@app.route("/ordens", methods=["OPTIONS"])
def handle_options_ordens():
    response = app.make_default_options_response()
    allowed_headers = request.headers.get("Access-Control-Request-Headers")
    if allowed_headers:
         response.headers.add("Access-Control-Allow-Headers", allowed_headers)
    response.headers.add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    return response

# --- ROTA: Listar Ordens de Serviço (MODIFICADA para OSs ATIVAS) ---
@app.route("/ordens", methods=["GET"])
@require_role(["Admin", "Técnico", "Operador", "Monitor"])
def listar_ordens(current_user_id):
    conn = cursor = None
    try:
        # --- LÓGICA DE FILTRO REMOVIDA ---
        # (Não lê mais request.args)

        base_sql = """
            SELECT 
                os.*, 
                u_criador.nome AS nome_criador, u_tecnico.nome AS nome_tecnico,
                eq.tag AS equipamento_tag, eq.nome_equipamento AS equipamento_nome, eq.setor AS equipamento_setor,
                DATE_FORMAT(os.data_abertura, '%d/%m/%Y %H:%i') AS data_abertura_formatada,
                DATE_FORMAT(os.data_conclusao, '%d/%m/%Y %H:%i') AS data_conclusao_formatada
            FROM ordens_servico os
            LEFT JOIN usuarios u_criador ON os.usuario_id = u_criador.id
            LEFT JOIN usuarios u_tecnico ON os.tecnico_id = u_tecnico.id
            LEFT JOIN equipamentos eq ON os.equipamento_id = eq.id
        """

        # --- FILTRO FIXO ADICIONADO ---
        # Mostra apenas OSs que NÃO estão 'Concluído'
        where_clause = " WHERE os.status != %s"
        params = ('Concluído',)
        # --- FIM DA MUDANÇA ---

        # Monta a query final
        final_sql = base_sql + where_clause

        final_sql += """
            ORDER BY 
                CASE WHEN os.status = 'Aberto' THEN 1 WHEN os.status = 'Em Andamento' THEN 2 ELSE 3 END,
                CASE WHEN os.prioridade = 'Alta' THEN 1 WHEN os.prioridade = 'Média' THEN 2 ELSE 3 END,
                os.data_abertura DESC
        """

        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor(dictionary=True)

        cursor.execute(final_sql, params) # Executa com os parâmetros
        ordens = cursor.fetchall()
        return jsonify(ordens), 200

    except AssertionError as msg: return jsonify({"message": str(msg)}), 500
    except Exception as e: print(f"Erro ao listar ordens: {e}"); return jsonify({"message": "Erro ao listar ordens."}), 500
    finally:
         if cursor: cursor.close()
         if conn: conn.close()

# --- ROTA: Permissão OPTIONS para /ordens/<id> ---
@app.route("/ordens/<int:os_id>", methods=["OPTIONS"])
def handle_options_os_detalhes(os_id):
    response = app.make_default_options_response()
    allowed_headers = request.headers.get("Access-Control-Request-Headers")
    if allowed_headers:
         response.headers.add("Access-Control-Allow-Headers", allowed_headers)
    # Permite GET (para buscar) e PUT (para atualizar detalhes)
    response.headers.add("Access-Control-Allow-Methods", "GET, PUT, OPTIONS") 
    return response

# --- NOVA ROTA: Buscar UMA OS específica por ID ---
@app.route("/ordens/<int:os_id>", methods=["GET"])
@jwt_required() # Protegida
def get_os_detalhes(os_id):
    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor(dictionary=True)

        # Usamos o mesmo SQL de listagem, mas com WHERE id = %s
        sql = """
            SELECT 
                os.*, 
                u_criador.nome AS nome_criador, 
                u_tecnico.nome AS nome_tecnico,
                eq.tag AS equipamento_tag,
                eq.nome_equipamento AS equipamento_nome,
                eq.setor AS equipamento_setor,
                DATE_FORMAT(os.data_abertura, '%d/%m/%Y %H:%i') AS data_abertura_formatada,
                DATE_FORMAT(os.data_conclusao, '%d/%m/%Y %H:%i') AS data_conclusao_formatada,
                -- Adiciona data/hora de início e fim da manutenção (se existirem)
                DATE_FORMAT(os.data_abertura, '%Y-%m-%d') AS data_inicio_fmt, -- Para o campo Data Início
                DATE_FORMAT(os.data_abertura, '%H:%i') AS hora_inicio_fmt, -- Para o campo Hora Início
                DATE_FORMAT(os.data_conclusao, '%Y-%m-%d') AS data_fim_fmt, -- Para o campo Data Fim
                DATE_FORMAT(os.data_conclusao, '%H:%i') AS hora_fim_fmt -- Para o campo Hora Fim
            FROM ordens_servico os
            LEFT JOIN usuarios u_criador ON os.usuario_id = u_criador.id
            LEFT JOIN usuarios u_tecnico ON os.tecnico_id = u_tecnico.id
            LEFT JOIN equipamentos eq ON os.equipamento_id = eq.id
            WHERE os.id = %s -- Busca por UM ID específico
        """
        cursor.execute(sql, (os_id,))
        ordem = cursor.fetchone() # Pega apenas um resultado

        if not ordem:
            return jsonify({"message": "Ordem de Serviço não encontrada."}), 404

        return jsonify(ordem), 200

    except AssertionError as msg: return jsonify({"message": str(msg)}), 500
    except Exception as e: print(f"Erro ao buscar OS {os_id}: {e}"); return jsonify({"message": "Erro ao buscar OS."}), 500
    finally:
         if cursor: cursor.close()
         if conn: conn.close()

# --- NOVA ROTA: Permissão OPTIONS para /ordens/minhas ---
@app.route("/ordens/minhas", methods=["OPTIONS"])
def handle_options_minhas_os():
    """Responde ao pedido de permissão CORS (preflight)"""
    response = app.make_default_options_response()
    allowed_headers = request.headers.get("Access-Control-Request-Headers")
    if allowed_headers:
         response.headers.add("Access-Control-Allow-Headers", allowed_headers)
    response.headers.add("Access-Control-Allow-Methods", "GET, OPTIONS")
    return response

# --- NOVA ROTA: Listar APENAS as OSs do técnico logado (MODIFICADA para Filtros) ---
@app.route("/ordens/minhas", methods=["GET"])
@admin_or_tecnico_required
def listar_minhas_ordens(current_user_id):
    tecnico_id_logado_str = current_user_id
    conn = cursor = None
    try:
        # Pega os filtros da URL
        status = request.args.get('status')
        prioridade = request.args.get('prioridade')
        equipamento = request.args.get('equipamento')

        base_sql = """
            SELECT
                os.*, 
                u_criador.nome AS nome_criador, 
                u_tecnico.nome AS nome_tecnico,

                -- NOVOS CAMPOS DO EQUIPAMENTO --
                eq.tag AS equipamento_tag,
                eq.nome_equipamento AS equipamento_nome,
                eq.setor AS equipamento_setor,

                DATE_FORMAT(os.data_abertura, '%d/%m/%Y %H:%i') AS data_abertura_formatada,
                DATE_FORMAT(os.data_conclusao, '%d/%m/%Y %H:%i') AS data_conclusao_formatada
            FROM ordens_servico os
            LEFT JOIN usuarios u_criador ON os.usuario_id = u_criador.id
            LEFT JOIN usuarios u_tecnico ON os.tecnico_id = u_tecnico.id
            LEFT JOIN equipamentos eq ON os.equipamento_id = eq.id -- NOVO JOIN
        """

        # --- Lógica de Filtro Dinâmico e Seguro ---
        where_clauses = []
        params = [] # Lista para guardar os valores

        # Filtro OBRIGATÓRIO: Tem que ser do técnico logado
        where_clauses.append("os.tecnico_id = %s")
        try:
            tecnico_id_int = int(tecnico_id_logado_str)
            params.append(tecnico_id_int)
        except (ValueError, TypeError):
             return jsonify({"message": "ID de usuário inválido no token."}), 400

        # Filtros Opcionais
        if status and status != 'Todos':
            where_clauses.append("os.status = %s")
            params.append(status)

        if prioridade and prioridade != 'Todas':
            where_clauses.append("os.prioridade = %s")
            params.append(prioridade)

        if equipamento:
            where_clauses.append("os.equipamento LIKE %s")
            params.append(f"%{equipamento}%")

        # Monta a query final
        final_sql = base_sql + " WHERE " + " AND ".join(where_clauses)

        final_sql += """
            ORDER BY 
                CASE WHEN os.status = 'Em Andamento' THEN 1 WHEN os.status = 'Concluído' THEN 2 ELSE 3 END,
                CASE WHEN os.prioridade = 'Alta' THEN 1 WHEN os.prioridade = 'Média' THEN 2 ELSE 3 END,
                os.data_abertura DESC
        """
        # --- Fim da Lógica de Filtro ---

        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor(dictionary=True)

        cursor.execute(final_sql, tuple(params)) # Executa com os parâmetros
        ordens = cursor.fetchall()
        return jsonify(ordens), 200

    except AssertionError as msg: return jsonify({"message": str(msg)}), 500
    except Exception as e: print(f"Erro ao listar 'minhas ordens': {e}"); return jsonify({"message": "Erro ao listar 'minhas ordens'."}), 500
    finally:
         if cursor: cursor.close()
         if conn: conn.close()        
# --- ROTA: Criar Ordem de Serviço (CORRIGIDA para equipamento_id) ---
@app.route("/ordens", methods=["POST"])
@require_role(["Admin", "Técnico", "Operador"])
def criar_ordem(current_user_id):
    usuario_id_logado_str = current_user_id
    dados = request.get_json()

    # --- Pega o ID do equipamento (e não o nome) ---
    equipamento_id = dados.get('equipamento_id') # Recebe o ID

    descricao = dados.get('descricao')
    prioridade = dados.get('prioridade', 'Baixa')

    # Verifica se o equipamento_id foi enviado
    if not equipamento_id or not descricao: 
        return jsonify({"message": "Equipamento e descrição são obrigatórios."}), 400

    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor()

        # --- SQL CORRETO ---
        # Insere o equipamento_id na coluna equipamento_id
        sql = """
            INSERT INTO ordens_servico 
            (equipamento_id, descricao, usuario_id, prioridade) 
            VALUES (%s, %s, %s, %s)
        """
        # --- FIM DO SQL CORRETO ---

        # Converte os IDs (que vêm como string) para INT
        try:
             user_id_int = int(usuario_id_logado_str)
             equip_id_int = int(equipamento_id) 
        except (ValueError, TypeError):
             return jsonify({"message": "ID de usuário ou equipamento inválido."}), 400

        # 4 valores para 4 colunas
        valores = (equip_id_int, descricao, user_id_int, prioridade)

        cursor.execute(sql, valores); conn.commit()
        return jsonify({"message": "Ordem de serviço criada com sucesso!"}), 201

    except AssertionError as msg: 
        return jsonify({"message": str(msg)}), 500
    except Exception as e: 
        print(f"Erro ao criar ordem: {e}") # Isso vai imprimir o erro 1054
        return jsonify({"message": f"Erro interno ao criar ordem: {e}"}), 500
    finally:
         if cursor: cursor.close()
         if conn: conn.close()

# --- ROTA: Permissão OPTIONS para ações ---
@app.route("/ordens/<int:os_id>/atribuir", methods=["OPTIONS"])
@app.route("/ordens/<int:os_id>/concluir", methods=["OPTIONS"])
def handle_options_os_actions(os_id):
    response = app.make_default_options_response()
    allowed_headers = request.headers.get("Access-Control-Request-Headers")
    if allowed_headers:
         response.headers.add("Access-Control-Allow-Headers", allowed_headers)
    # Garante que POST seja permitido
    response.headers.add("Access-Control-Allow-Methods", "POST, OPTIONS")
    return response

# --- ROTA: Técnico se atribui a uma OS (Protegida por JWT e Role) ---
@app.route("/ordens/<int:os_id>/atribuir", methods=["POST"])
@admin_or_tecnico_required # Só Admin ou Técnico podem se atribuir
def atribuir_os(os_id, current_user_id): # Recebe o ID do decorador
    tecnico_id_logado_str = current_user_id
    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor()
        sql = "UPDATE ordens_servico SET tecnico_id = %s, status = 'Em Andamento' WHERE id = %s AND status = 'Aberto'"
        try:
             tecnico_id_int = int(tecnico_id_logado_str)
        except (ValueError, TypeError):
             print(f"Erro ao converter ID '{tecnico_id_logado_str}' para int ao atribuir OS")
             return jsonify({"message": "ID de usuário inválido no token."}), 400

        valores = (tecnico_id_int, os_id); cursor.execute(sql, valores)
        if cursor.rowcount == 0: return jsonify({"message": "OS não encontrada ou não está 'Aberta'."}), 404
        conn.commit()
        return jsonify({"message": f"OS #{os_id} atribuída a você."}), 200
    except AssertionError as msg: return jsonify({"message": str(msg)}), 500
    except Exception as e: print(f"Erro ao atribuir OS: {e}"); return jsonify({"message": "Erro ao atribuir OS."}), 500
    finally:
         if cursor: cursor.close()
         if conn: conn.close()

# --- ROTA: Técnico conclui uma OS (MODIFICADA para Checklist) ---
@app.route("/ordens/<int:os_id>/concluir", methods=["POST"])
@admin_or_tecnico_required
def concluir_os(os_id, current_user_id):
    tecnico_id_logado_str = current_user_id
    dados = request.get_json()

    # --- NOVOS DADOS VINDOS DO FORMULÁRIO ---
    notas = dados.get('notas_tecnico')
    tipo_solicitacao = dados.get('tipo_solicitacao', 'Corretiva') # Padrão Corretiva
    parou_maquina = bool(dados.get('parou_maquina', False)) # Converte para Booleano

    # Pega os 6 itens do checklist (convertendo para booleano)
    chk_desligado = bool(dados.get('chk_desligado', False))
    chk_epi = bool(dados.get('chk_epi', False))
    chk_documento = bool(dados.get('chk_documento', False))
    chk_registrar = bool(dados.get('chk_registrar', False))
    chk_testes = bool(dados.get('chk_testes', False))
    chk_liberacao = bool(dados.get('chk_liberacao', False))
    # --- FIM DOS NOVOS DADOS ---

    if notas is None: # Mantemos a nota de serviço como obrigatória
        return jsonify({"message": "O campo 'Descrição do Serviço Realizado' (notas_tecnico) é obrigatório."}), 400

    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor(dictionary=True)

        # Verifica se o técnico pode concluir (lógica existente)
        sql_check = "SELECT status, tecnico_id FROM ordens_servico WHERE id = %s"; cursor.execute(sql_check, (os_id,))
        os_info = cursor.fetchone()
        if not os_info: return jsonify({"message": f"OS #{os_id} não encontrada."}), 404
        if os_info['status'] != 'Em Andamento': return jsonify({"message": f"OS #{os_id} não está 'Em Andamento'."}), 400
        tecnico_atribuido_db_str = str(os_info['tecnico_id']) if os_info['tecnico_id'] is not None else None
        user_role = get_jwt_identity().split(':', 1)[1]
        if user_role == 'Técnico' and tecnico_atribuido_db_str != tecnico_id_logado_str:
             return jsonify({"message": "Você não é o técnico atribuído."}), 403

        # --- SQL ATUALIZADO PARA SALVAR TUDO ---
        sql_update = """
            UPDATE ordens_servico 
            SET 
                status = 'Concluído', 
                notas_tecnico = %s, 
                data_conclusao = NOW(),
                tipo_solicitacao = %s,
                parou_maquina = %s,
                chk_desligado = %s,
                chk_epi = %s,
                chk_documento = %s,
                chk_registrar = %s,
                chk_testes = %s,
                chk_liberacao = %s
            WHERE id = %s
        """
        valores = (
            notas, tipo_solicitacao, parou_maquina,
            chk_desligado, chk_epi, chk_documento, chk_registrar, chk_testes, chk_liberacao,
            os_id
        )
        cursor.execute(sql_update, valores); conn.commit()
        return jsonify({"message": f"OS #{os_id} concluída com sucesso."}), 200

    except AssertionError as msg: return jsonify({"message": str(msg)}), 500
    except Exception as e: print(f"Erro ao concluir OS: {e}"); return jsonify({"message": "Erro ao concluir OS."}), 500
    finally:
         if cursor: cursor.close()
         if conn: conn.close()

         # --- NOVA ROTA: Listar equipamentos (PARA TODOS OS USUÁRIOS LOGADOS) ---

# --- INÍCIO DA NOVA ROTA (ADICIONAR) ---

# --- ROTA: Permissão OPTIONS para admin-update ---
@app.route("/ordens/<int:os_id>/admin-update", methods=["OPTIONS"])
def handle_options_os_admin_update(os_id):
    response = app.make_default_options_response()
    allowed_headers = request.headers.get("Access-Control-Request-Headers")
    if allowed_headers:
         response.headers.add("Access-Control-Allow-Headers", allowed_headers)
    response.headers.add("Access-Control-Allow-Methods", "PUT, OPTIONS")
    return response

# --- ROTA: Admin atualiza CADASTRADO da OS (sem mudar status) ---
@app.route("/ordens/<int:os_id>/admin-update", methods=["PUT"])
@admin_required # Apenas Admin pode usar
def admin_update_os(os_id, current_user_id):
    dados = request.get_json()

    # Pega todos os dados do formulário (similar à rota /concluir)
    notas = dados.get('notas_tecnico')
    tipo_solicitacao = dados.get('tipo_solicitacao')
    parou_maquina = bool(dados.get('parou_maquina', False))
    chk_desligado = bool(dados.get('chk_desligado', False))
    chk_epi = bool(dados.get('chk_epi', False))
    chk_documento = bool(dados.get('chk_documento', False))
    chk_registrar = bool(dados.get('chk_registrar', False))
    chk_testes = bool(dados.get('chk_testes', False))
    chk_liberacao = bool(dados.get('chk_liberacao', False))

    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor(dictionary=True)

        # Verifica se a OS existe
        sql_check = "SELECT id FROM ordens_servico WHERE id = %s"; cursor.execute(sql_check, (os_id,))
        if not cursor.fetchone():
            return jsonify({"message": f"OS #{os_id} não encontrada."}), 404

        # SQL de ATUALIZAÇÃO (sem alterar status ou data_conclusao)
        sql_update = """
            UPDATE ordens_servico 
            SET 
                notas_tecnico = %s, 
                tipo_solicitacao = %s,
                parou_maquina = %s,
                chk_desligado = %s,
                chk_epi = %s,
                chk_documento = %s,
                chk_registrar = %s,
                chk_testes = %s,
                chk_liberacao = %s
            WHERE id = %s
        """
        valores = (
            notas, tipo_solicitacao, parou_maquina,
            chk_desligado, chk_epi, chk_documento, chk_registrar, chk_testes, chk_liberacao,
            os_id
        )
        cursor.execute(sql_update, valores); conn.commit()
        return jsonify({"message": f"OS #{os_id} atualizada pelo Admin."}), 200

    except AssertionError as msg: return jsonify({"message": str(msg)}), 500
    except Exception as e: print(f"Erro no admin_update_os: {e}"); return jsonify({"message": "Erro ao atualizar OS."}), 500
    finally:
         if cursor: cursor.close()
         if conn: conn.close()

# --- FIM DA NOVA ROTA ---

# --- ROTA: Permissão OPTIONS para /admin/preventivas ---
@app.route("/admin/preventivas", methods=["OPTIONS"])
def handle_options_preventivas():
    response = app.make_default_options_response()
    allowed_headers = request.headers.get("Access-Control-Request-Headers")
    if allowed_headers:
         response.headers.add("Access-Control-Allow-Headers", allowed_headers)
    response.headers.add("Access-Control-Allow-Methods", "POST, OPTIONS")
    return response

# --- ROTA: Admin cria uma OS Preventiva Agendada ---
@app.route("/admin/preventivas", methods=["POST"])
@admin_required # Apenas Admin pode usar
def criar_preventiva(current_user_id):
    dados = request.get_json()
    
    equipamento_id = dados.get('equipamento_id')
    tecnico_id = dados.get('tecnico_id') # Técnico que fará o serviço
    descricao = dados.get('descricao')
    data_agendamento = dados.get('data_agendamento') # Data futura
    prioridade = dados.get('prioridade', 'Média')

    if not equipamento_id or not descricao or not data_agendamento:
        return jsonify({"message": "Equipamento, Descrição e Data são obrigatórios."}), 400

    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor()

        # Criamos a OS já com status "Aberto", tipo "Preventiva",
        # com a data de abertura no futuro e técnico já atribuído.
        sql = """
            INSERT INTO ordens_servico 
            (
                equipamento_id, descricao, usuario_id, prioridade, 
                tecnico_id, data_abertura, status, tipo_solicitacao
            ) 
            VALUES (%s, %s, %s, %s, %s, %s, 'Aberto', 'Preventiva')
        """
        
        # Converte o ID do técnico para int, se ele foi fornecido
        tecnico_id_int = None
        if tecnico_id:
            try:
                tecnico_id_int = int(tecnico_id)
            except (ValueError, TypeError):
                pass # Deixa como None se for inválido

        valores = (
            int(equipamento_id), descricao, int(current_user_id), prioridade,
            tecnico_id_int, data_agendamento,
        )

        cursor.execute(sql, valores); conn.commit()
        return jsonify({"message": "OS Preventiva agendada com sucesso!"}), 201

    except AssertionError as msg: return jsonify({"message": str(msg)}), 500
    except Exception as e: 
        print(f"Erro ao criar preventiva: {e}")
        return jsonify({"message": "Erro interno ao agendar OS."}), 500
    finally:
         if cursor: cursor.close()
         if conn: conn.close()

# --- FIM DA NOVA ROTA ---

@app.route("/equipamentos", methods=["GET"])
@jwt_required() # Qualquer usuário logado (Admin, Técnico, Operador) pode ver a lista
def listar_equipamentos_publico(): # Não precisa do 'current_user_id'
    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor(dictionary=True)
        sql = "SELECT id, tag, nome_equipamento, setor FROM equipamentos ORDER BY setor, tag ASC"
        cursor.execute(sql)
        equipamentos = cursor.fetchall()
        return jsonify(equipamentos), 200
    except Exception as e:
        print(f"Erro ao listar equipamentos (público): {e}"); return jsonify({"message": "Erro ao listar equipamentos."}), 500
    finally:
         if cursor: cursor.close()
         if conn: conn.close()

# --- Rota: Listar Usuários (SÓ ADMIN) ---
@app.route("/admin/usuarios", methods=["GET"])

# --- ROTA: Permissão OPTIONS para /ordens/<id>/pecas ---
@app.route("/ordens/<int:os_id>/pecas", methods=["OPTIONS"])
def handle_options_os_pecas(os_id):
    response = app.make_default_options_response()
    allowed_headers = request.headers.get("Access-Control-Request-Headers")
    if allowed_headers:
         response.headers.add("Access-Control-Allow-Headers", allowed_headers)
    response.headers.add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    return response

# --- ROTA: Listar todas as peças de UMA OS ---
@app.route("/ordens/<int:os_id>/pecas", methods=["GET"])
@jwt_required()
def listar_pecas_os(os_id):
    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor(dictionary=True)
        sql = "SELECT * FROM pecas_utilizadas WHERE ordem_servico_id = %s"
        cursor.execute(sql, (os_id,))
        pecas = cursor.fetchall()
        return jsonify(pecas), 200
    except AssertionError as msg: return jsonify({"message": str(msg)}), 500
    except Exception as e:
        print(f"Erro ao listar peças: {e}"); return jsonify({"message": "Erro ao listar peças."}), 500
    finally:
         if cursor: cursor.close()
         if conn: conn.close()

# --- ROTA: Adicionar uma peça a UMA OS ---
@app.route("/ordens/<int:os_id>/pecas", methods=["POST"])
@admin_or_tecnico_required # Só Admin/Técnico podem adicionar peças
def adicionar_peca_os(os_id, current_user_id):
    dados = request.get_json()
    codigo = dados.get('codigo_peca')
    descricao = dados.get('descricao_peca')
    try:
        quantidade = int(dados.get('quantidade', 1))
    except ValueError:
        return jsonify({"message": "Quantidade deve ser um número."}), 400

    if not descricao:
        return jsonify({"message": "Descrição da peça é obrigatória."}), 400

    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor()
        sql = """
            INSERT INTO pecas_utilizadas 
            (ordem_servico_id, codigo_peca, descricao_peca, quantidade) 
            VALUES (%s, %s, %s, %s)
        """
        valores = (os_id, codigo, descricao, quantidade)
        cursor.execute(sql, valores); conn.commit()

        # Pega o ID da peça que acabamos de inserir (opcional, mas bom para o frontend)
        novo_id_peca = cursor.lastrowid 

        return jsonify({
            "message": "Peça adicionada com sucesso!",
            "nova_peca_id": novo_id_peca
        }), 201

    except AssertionError as msg: return jsonify({"message": str(msg)}), 500
    except Exception as e:
        print(f"Erro ao adicionar peça: {e}"); return jsonify({"message": "Erro ao adicionar peça."}), 500
    finally:
         if cursor: cursor.close()
         if conn: conn.close()

# --- ROTA: Permissão OPTIONS para /ordens/pecas/<id> ---
@app.route("/ordens/pecas/<int:peca_id>", methods=["OPTIONS"])
def handle_options_peca_delete(peca_id):
    response = app.make_default_options_response()
    allowed_headers = request.headers.get("Access-Control-Request-Headers")
    if allowed_headers:
         response.headers.add("Access-Control-Allow-Headers", allowed_headers)
    response.headers.add("Access-Control-Allow-Methods", "DELETE, OPTIONS")
    return response

# --- ROTA: Excluir uma peça de uma OS ---
@app.route("/ordens/pecas/<int:peca_id>", methods=["DELETE"])
@admin_or_tecnico_required
def excluir_peca_os(peca_id, current_user_id):
    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor()
        sql = "DELETE FROM pecas_utilizadas WHERE id = %s"
        cursor.execute(sql, (peca_id,))
        if cursor.rowcount == 0:
            return jsonify({"message": "Peça não encontrada."}), 404
        conn.commit()
        return jsonify({"message": "Peça removida com sucesso."}), 200
    except AssertionError as msg: return jsonify({"message": str(msg)}), 500
    except Exception as e:
        print(f"Erro ao excluir peça: {e}"); return jsonify({"message": "Erro ao excluir peça."}), 500
    finally:
         if cursor: cursor.close()
         if conn: conn.close()

# --- Roda o servidor ---
if __name__ == "__main__":
    app.run(debug=True, port=5000, use_reloader=False) # Mantido reloader=False