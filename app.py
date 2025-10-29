# --- Imports ---
from flask import Flask, request, jsonify, session, render_template, send_from_directory
from flask_bcrypt import Bcrypt
from flask_cors import CORS
import mysql.connector
import mysql.connector.errors
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
CORS(app, supports_credentials=True, origins="*", allow_headers=["Authorization", "Content-Type"])
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

# --- ROTA: Listar Ordens de Serviço (Protegida por JWT) ---
@app.route("/ordens", methods=["GET"])
@jwt_required() # Usa o protetor padrão JWT
def listar_ordens(): # Não precisa mais de current_user_id aqui
    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor(dictionary=True)
        sql = """ SELECT os.*, u_criador.nome AS nome_criador, u_tecnico.nome AS nome_tecnico,
                    DATE_FORMAT(os.data_abertura, '%d/%m/%Y %H:%i') AS data_abertura_formatada,
                    DATE_FORMAT(os.data_conclusao, '%d/%m/%Y %H:%i') AS data_conclusao_formatada
                  FROM ordens_servico os
                  LEFT JOIN usuarios u_criador ON os.usuario_id = u_criador.id
                  LEFT JOIN usuarios u_tecnico ON os.tecnico_id = u_tecnico.id
                  ORDER BY CASE WHEN os.status = 'Aberto' THEN 1 WHEN os.status = 'Em Andamento' THEN 2 ELSE 3 END, os.data_abertura DESC """
        cursor.execute(sql); ordens = cursor.fetchall()
        return jsonify(ordens), 200
    except AssertionError as msg: return jsonify({"message": str(msg)}), 500
    except Exception as e: print(f"Erro ao listar ordens: {e}"); return jsonify({"message": "Erro ao listar ordens."}), 500
    finally:
         if cursor: cursor.close()
         if conn: conn.close()

# --- ROTA: Criar Ordem de Serviço (Protegida por JWT e Role) ---
@app.route("/ordens", methods=["POST"])
# @jwt_required() # O require_role já inclui jwt_required
@require_role(["Admin", "Técnico", "Operador"]) # Todos podem criar
def criar_ordem(current_user_id): # Recebe o ID do decorador
    # usuario_id_logado = get_jwt_identity().split(':', 1)[0] # Pega o ID da identidade combinada
    usuario_id_logado_str = current_user_id # Usa o ID passado pelo decorador

    dados = request.get_json(); equipamento = dados.get('equipamento'); descricao = dados.get('descricao')
    if not equipamento or not descricao: return jsonify({"message": "Equipamento e descrição obrigatórios."}), 400
    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor()
        sql = "INSERT INTO ordens_servico (equipamento, descricao, usuario_id) VALUES (%s, %s, %s)"
        # Converte o ID de string para int antes de inserir no banco, se a coluna for INT
        try:
             user_id_int = int(usuario_id_logado_str)
        except (ValueError, TypeError):
             print(f"Erro ao converter ID '{usuario_id_logado_str}' para int ao criar OS")
             return jsonify({"message": "ID de usuário inválido no token."}), 400

        valores = (equipamento, descricao, user_id_int) # Usa o ID convertido
        cursor.execute(sql, valores); conn.commit()
        return jsonify({"message": "Ordem de serviço criada com sucesso!"}), 201
    except AssertionError as msg: return jsonify({"message": str(msg)}), 500
    except Exception as e: print(f"Erro ao criar ordem: {e}"); return jsonify({"message": "Erro ao criar ordem."}), 500
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

# --- ROTA: Técnico conclui uma OS (Protegida por JWT e Role) ---
@app.route("/ordens/<int:os_id>/concluir", methods=["POST"])
@admin_or_tecnico_required # Garante que só Admin/Técnico tentem
def concluir_os(os_id, current_user_id): # Recebe o ID do decorador
    tecnico_id_logado_str = current_user_id
    dados = request.get_json(); notas = dados.get('notas_tecnico')
    if notas is None: return jsonify({"message": "O campo 'notas_tecnico' é obrigatório."}), 400
    conn = cursor = None
    try:
        conn = get_db_connection(); assert conn is not None, "Falha na conexão DB"
        cursor = conn.cursor(dictionary=True)
        sql_check = "SELECT status, tecnico_id FROM ordens_servico WHERE id = %s"; cursor.execute(sql_check, (os_id,))
        os_info = cursor.fetchone()
        if not os_info: return jsonify({"message": f"OS #{os_id} não encontrada."}), 404
        if os_info['status'] != 'Em Andamento': return jsonify({"message": f"OS #{os_id} não está 'Em Andamento'."}), 400

        # Compara o ID (string) do token com o ID (convertido para string) do banco
        tecnico_atribuido_db_str = str(os_info['tecnico_id']) if os_info['tecnico_id'] is not None else None
        if tecnico_atribuido_db_str != tecnico_id_logado_str:
             return jsonify({"message": "Você não é o técnico atribuído."}), 403

        sql_update = "UPDATE ordens_servico SET status = 'Concluído', notas_tecnico = %s, data_conclusao = NOW() WHERE id = %s"
        valores = (notas, os_id); cursor.execute(sql_update, valores); conn.commit()
        return jsonify({"message": f"OS #{os_id} concluída com sucesso."}), 200
    except AssertionError as msg: return jsonify({"message": str(msg)}), 500
    except Exception as e: print(f"Erro ao concluir OS: {e}"); return jsonify({"message": "Erro ao concluir OS."}), 500
    finally:
         if cursor: cursor.close()
         if conn: conn.close()

# --- Roda o servidor ---
if __name__ == "__main__":
    app.run(debug=True, port=5000, use_reloader=False) # Mantido reloader=False