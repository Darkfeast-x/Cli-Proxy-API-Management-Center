#!/usr/bin/env python3
import argparse
import base64
import hashlib
import json
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
AUTH_BASE_URL = "https://auth.openai.com/oauth/authorize"
TOKEN_URL = "https://auth.openai.com/oauth/token"
HOST = "127.0.0.1"
ENTRY_HOST = "0.0.0.0"
DEFAULT_PORT = 1455
ListeningPort = 8888
# DEFAULT_PORT = 8888
SCOPES = "openid email profile offline_access"
SESSION_TTL_SECONDS = 15 * 60


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def pkce_pair() -> tuple[str, str]:
    verifier = b64url(secrets.token_bytes(64))
    challenge = b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    return verifier, challenge


def decode_jwt_payload(token: str) -> dict:
    parts = token.split(".")
    if len(parts) < 2:
        return {}
    payload = parts[1]
    padding = "=" * (-len(payload) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(payload + padding))
    except (ValueError, json.JSONDecodeError):
        return {}


def iso_local(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone().isoformat(timespec="seconds")


def now_iso_local() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def build_redirect_uri(port: int) -> str:
    return f"http://localhost:{port}/auth/callback"


def build_local_root_url(port: int) -> str:
    return f"http://localhost:{port}/"


def build_local_url(port: int, path: str = "/", query: str = "") -> str:
    normalized_path = path if path.startswith("/") else f"/{path}"
    if not normalized_path:
        normalized_path = "/"
    return urllib.parse.urlunparse(("http", f"localhost:{port}", normalized_path, "", query, ""))


def non_default_port_hint(port: int) -> str:
    return (
        f"当前端口为 {port}，不是默认的 {DEFAULT_PORT}。"
        f"如果 {DEFAULT_PORT} 可以登录、这个端口不行，"
        "通常不是本地代码问题，而是 OAuth 服务端只允许默认回调地址。"
    )


def html_page(title: str, body: str) -> bytes:
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f7f5ef;
      --card: rgba(255,255,255,.82);
      --text: #1f2b3a;
      --muted: #5f6b76;
      --accent: #8b6f47;
      --accent-strong: #6e5736;
      --border: rgba(139,111,71,.18);
      --ok-bg: #e8f5ea;
      --ok-text: #166534;
      --err-bg: #fdeaea;
      --err-text: #b42318;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(139,111,71,.14), transparent 34%),
        linear-gradient(180deg, #f9f7f2 0%, var(--bg) 100%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }}
    .card {{
      width: min(720px, 100%);
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 24px;
      box-shadow: 0 22px 70px rgba(38, 34, 28, .12);
      padding: 32px;
      backdrop-filter: blur(10px);
    }}
    h1 {{
      margin: 0 0 16px;
      font-size: 34px;
      line-height: 1.1;
    }}
    p {{
      margin: 0 0 12px;
      color: var(--muted);
      line-height: 1.7;
      font-size: 15px;
    }}
    form {{
      margin-top: 22px;
    }}
    textarea {{
      width: 100%;
      min-height: 132px;
      margin-top: 10px;
      padding: 14px 16px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: rgba(255,255,255,.92);
      color: var(--text);
      font: inherit;
      resize: vertical;
    }}
    .btn {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 180px;
      margin-top: 18px;
      padding: 14px 20px;
      border-radius: 14px;
      border: 0;
      background: var(--accent);
      color: #fff;
      text-decoration: none;
      font-weight: 700;
      box-shadow: 0 12px 30px rgba(139,111,71,.24);
    }}
    .btn:hover {{
      background: var(--accent-strong);
    }}
    .panel {{
      margin-top: 22px;
      padding: 16px 18px;
      border-radius: 16px;
      background: #fff;
      border: 1px dashed var(--border);
    }}
    code {{
      background: rgba(31,43,58,.06);
      padding: 2px 6px;
      border-radius: 8px;
      word-break: break-all;
    }}
    .ok {{
      background: var(--ok-bg);
      color: var(--ok-text);
      border: 1px solid rgba(22,101,52,.14);
    }}
    .err {{
      background: var(--err-bg);
      color: var(--err-text);
      border: 1px solid rgba(180,35,24,.14);
    }}
  </style>
</head>
<body>
  <main class="card">
    {body}
  </main>
</body>
</html>
""".encode("utf-8")


class OAuthApp:
    def __init__(self, output_path: Path, port: int, success_redirect_url: str | None = None):
        self.output_path = output_path.resolve()
        self.port = port
        self.redirect_uri = build_redirect_uri(port)
        self.success_redirect_url = success_redirect_url.strip() if success_redirect_url else None
        self.sessions: dict[str, dict] = {}
        self.lock = threading.Lock()

    def create_session(self) -> str:
        verifier, challenge = pkce_pair()
        state = secrets.token_hex(24)
        now = time.time()
        with self.lock:
            self.sessions[state] = {
                "verifier": verifier,
                "created_at": now,
                "challenge": challenge,
            }
            self._prune_locked(now)
        params = {
            "client_id": CLIENT_ID,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "codex_cli_simplified_flow": "true",
            "id_token_add_organizations": "true",
            "prompt": "login",
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "scope": SCOPES,
            "state": state,
        }
        return f"{AUTH_BASE_URL}?{urllib.parse.urlencode(params)}"

    def pop_session(self, state: str) -> dict | None:
        with self.lock:
            session = self.sessions.pop(state, None)
            self._prune_locked(time.time())
            return session

    def _prune_locked(self, now: float) -> None:
        expired = [
            state
            for state, session in self.sessions.items()
            if now - float(session.get("created_at", 0)) > SESSION_TTL_SECONDS
        ]
        for state in expired:
            self.sessions.pop(state, None)

    def exchange_code(self, code: str, verifier: str) -> dict:
        payload = json.dumps(
            {
                "client_id": CLIENT_ID,
                "code": code,
                "code_verifier": verifier,
                "grant_type": "authorization_code",
                "redirect_uri": self.redirect_uri,
            }
        ).encode("utf-8")
        request = urllib.request.Request(
            TOKEN_URL,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                data = json.loads(raw)
                message = data.get("error", {}).get("message") or raw
            except json.JSONDecodeError:
                message = raw
            detail = message.strip() or f"HTTP {exc.code}"
            raise RuntimeError(
                f"{detail} | client_id={CLIENT_ID} | redirect_uri={self.redirect_uri}"
            ) from exc

    def build_auth_file(self, token_data: dict) -> dict:
        access_token = token_data.get("access_token")
        refresh_token = token_data.get("refresh_token")
        id_token = token_data.get("id_token")
        if not access_token or not refresh_token or not id_token:
            raise RuntimeError("token 响应缺少 access_token / refresh_token / id_token。")

        access_payload = decode_jwt_payload(access_token)
        id_payload = decode_jwt_payload(id_token)
        auth_payload = id_payload.get("https://api.openai.com/auth", {})
        profile_payload = access_payload.get("https://api.openai.com/profile", {})

        account_id = (
            auth_payload.get("chatgpt_account_id")
            or access_payload.get("https://api.openai.com/auth", {}).get("chatgpt_account_id")
            or ""
        )
        email = id_payload.get("email") or profile_payload.get("email") or ""

        exp = access_payload.get("exp")
        if isinstance(exp, (int, float)):
            expired = iso_local(float(exp))
        else:
            expires_in = token_data.get("expires_in")
            if isinstance(expires_in, (int, float)):
                expired = iso_local(time.time() + float(expires_in))
            else:
                expired = now_iso_local()

        return {
            "access_token": access_token,
            "account_id": account_id,
            "disabled": False,
            "email": email,
            "expired": expired,
            "id_token": id_token,
            "last_refresh": now_iso_local(),
            "refresh_token": refresh_token,
            "type": "codex",
        }

    def save_auth_file(self, token_data: dict) -> Path:
        auth_file = self.build_auth_file(token_data)
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        self.output_path.write_text(
            json.dumps(auth_file, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        return self.output_path

    def complete_auth(self, code: str, state: str) -> Path:
        session = self.pop_session(state)
        if not session:
            raise RuntimeError("state 无效或已过期，请重新发起登录。")
        token_data = self.exchange_code(code, session["verifier"])
        return self.save_auth_file(token_data)


def make_handler(app: OAuthApp):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path == "/":
                self.render_home()
                return
            if parsed.path == "/start":
                self.start_login()
                return
            if parsed.path == "/auth/callback":
                self.handle_callback(parsed)
                return
            self.respond(404, html_page("Not Found", "<h1>页面不存在</h1>"))

        def render_home(self) -> None:
            hint_block = ""
            if app.port != DEFAULT_PORT:
                hint_block = f"""
<div class="panel err">
  <p><strong>端口提示</strong></p>
  <p>{non_default_port_hint(app.port)}</p>
</div>
"""
            redirect_block = ""
            if app.success_redirect_url:
                safe_redirect_url = self.escape_html(app.success_redirect_url)
                redirect_block = f"""
<div class="panel">
  <p><strong>登录成功后跳转</strong></p>
  <p><code>{safe_redirect_url}</code></p>
</div>
"""
            body = f"""
<h1>Codex 登录</h1>
<p>它会在本地生成 PKCE、接收回调、换取 token，并把结果保存成 <code>{app.output_path}</code>。</p>
<p>点击下面的按钮后，浏览器会跳转到 OpenAI 登录页。登录成功后，这个窗口会自动显示写入结果。</p>
<a class="btn" href="/start">开始 Codex 登录</a>
<div class="panel">
  <p><strong>回调地址</strong></p>
  <p><code>{app.redirect_uri}</code></p>
  <p><strong>输出文件</strong></p>
  <p><code>{app.output_path}</code></p>
</div>
{redirect_block}
{hint_block}
"""
            self.respond(200, html_page("Codex OAuth 登录", body))

        def start_login(self) -> None:
            auth_url = app.create_session()
            self.send_response(302)
            self.send_header("Location", auth_url)
            self.end_headers()

        def handle_callback(self, parsed: urllib.parse.ParseResult) -> None:
            query = urllib.parse.parse_qs(parsed.query)
            if "error" in query:
                error_text = query.get("error_description", query.get("error", ["未知错误"]))[0]
                hint_html = ""
                if app.port != DEFAULT_PORT:
                    hint_html = f"""
  <p>当前回调地址：<code>{app.redirect_uri}</code></p>
  <p>{non_default_port_hint(app.port)}</p>
"""
                body = f"""
<h1>登录失败</h1>
<div class="panel err">
  <p>{error_text}</p>
{hint_html}
</div>
<a class="btn" href="/">返回首页</a>
"""
                self.respond(400, html_page("登录失败", body))
                return

            code = (query.get("code") or [""])[0].strip()
            state = (query.get("state") or [""])[0].strip()
            if not code or not state:
                body = """
<h1>登录失败</h1>
<div class="panel err">
  <p>回调里缺少 code 或 state。</p>
</div>
<a class="btn" href="/">返回首页</a>
"""
                self.respond(400, html_page("登录失败", body))
                return

            try:
                output_path = app.complete_auth(code, state)
                redirect_block = ""
                if app.success_redirect_url:
                    safe_redirect_url = self.escape_html(app.success_redirect_url)
                    redirect_json = json.dumps(app.success_redirect_url, ensure_ascii=False)
                    redirect_block = f"""
<div class="panel">
  <p>1.2 秒后将自动跳转到你的本地服务：</p>
  <p><code>{safe_redirect_url}</code></p>
</div>
<a class="btn" href="{safe_redirect_url}">前往本地服务</a>
<script>
  setTimeout(function () {{
    window.location.href = {redirect_json};
  }}, 1200);
</script>
"""
                body = f"""
<h1>auth.json 已生成</h1>
<div class="panel ok">
  <p>认证成功，文件已经写入：</p>
  <p><code>{output_path}</code></p>
  <p>{'现在将自动跳转到本地服务。' if app.success_redirect_url else '现在可以关闭这个页面了。'}</p>
</div>
{redirect_block}
<a class="btn" href="/">继续登录其他账号</a>
"""
                self.respond(200, html_page("登录成功", body))
            except Exception as exc:
                body = f"""
<h1>写入失败</h1>
<div class="panel err">
  <p>{self.escape_html(str(exc))}</p>
</div>
<a class="btn" href="/">返回首页</a>
"""
                self.respond(500, html_page("写入失败", body))

        def respond(self, status_code: int, body: bytes) -> None:
            self.send_response(status_code)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt: str, *args) -> None:
            message = fmt % args
            print(f"[{self.log_date_time_string()}] {self.address_string()} {message}")

        @staticmethod
        def escape_html(text: str) -> str:
            return (
                text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace('"', "&quot;")
            )

    return Handler


def make_entry_handler(app: OAuthApp):
    class EntryHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path == "/":
                self.render_home()
                return
            if parsed.path == "/start":
                self.render_start()
                return
            self.respond(404, html_page("Not Found", "<h1>页面不存在</h1>"))

        def do_POST(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path == "/submit-callback":
                self.submit_callback()
                return
            self.respond(404, html_page("Not Found", "<h1>页面不存在</h1>"))

        def render_home(self) -> None:
            body = f"""
<h1>Codex 登录入口</h1>
<p>这个页面可以给局域网中的其他人访问。真正的 OAuth 回调仍然只在本机监听：</p>
<div class="panel">
  <p><strong>局域网入口</strong></p>
  <p><code>{build_local_root_url(ListeningPort)}</code></p>
  <p><strong>本机回调地址</strong></p>
  <p><code>{app.redirect_uri}</code></p>
  <p><strong>输出文件</strong></p>
  <p><code>{app.output_path}</code></p>
</div>
<div class="panel">
  <p><strong>使用方式</strong></p>
  <p>本机浏览器登录：点击下面按钮后会自动走完回调。</p>
  <p>局域网其他浏览器登录：授权完成后如果跳到 <code>localhost:1455</code> 打不开，请复制完整地址栏 URL，再回到本页提交。</p>
</div>
<a class="btn" href="/start">生成授权链接</a>
"""
            self.respond(200, html_page("Codex 登录入口", body))

        def render_start(self, callback_value: str = "", message_block: str = "") -> None:
            auth_url = app.create_session()
            safe_auth_url = self.escape_html(auth_url)
            safe_callback_value = self.escape_html(callback_value)
            body = f"""
<h1>继续 Codex 登录</h1>
<p>先打开下面的授权链接完成 OpenAI 登录。</p>
<a class="btn" href="{safe_auth_url}" target="_blank" rel="noopener noreferrer">打开授权链接</a>
<div class="panel">
  <p><strong>授权链接</strong></p>
  <p><code>{safe_auth_url}</code></p>
</div>
<div class="panel">
  <p><strong>回调 URL 提交</strong></p>
  <p>如果授权结束后浏览器跳到 <code>http://localhost:1455/auth/callback?... </code> 但打不开，请把地址栏里的完整 URL 粘贴到下面。</p>
  <form method="post" action="/submit-callback">
    <textarea name="callback_url" placeholder="http://localhost:1455/auth/callback?code=...&state=...">{safe_callback_value}</textarea>
    <button class="btn" type="submit">提交回调 URL</button>
  </form>
</div>
{message_block}
<a class="btn" href="/">返回首页</a>
"""
            self.respond(200, html_page("继续 Codex 登录", body))

        def submit_callback(self) -> None:
            form = self.read_form()
            callback_url = (form.get("callback_url") or [""])[0].strip()
            if not callback_url:
                message_block = """
<div class="panel err">
  <p>请先粘贴完整的回调 URL。</p>
</div>
"""
                self.render_start(message_block=message_block)
                return

            parsed_callback = urllib.parse.urlparse(callback_url)
            query = urllib.parse.parse_qs(parsed_callback.query)
            if "error" in query:
                error_text = query.get("error_description", query.get("error", ["未知错误"]))[0]
                message_block = f"""
<div class="panel err">
  <p>{self.escape_html(error_text)}</p>
</div>
"""
                self.render_start(callback_value=callback_url, message_block=message_block)
                return

            if parsed_callback.path != "/auth/callback":
                message_block = """
<div class="panel err">
  <p>这不是预期的回调 URL，请确认你粘贴的是跳到 localhost:1455 的完整地址。</p>
</div>
"""
                self.render_start(callback_value=callback_url, message_block=message_block)
                return

            code = (query.get("code") or [""])[0].strip()
            state = (query.get("state") or [""])[0].strip()
            if not code or not state:
                message_block = """
<div class="panel err">
  <p>回调 URL 中缺少 code 或 state。</p>
</div>
"""
                self.render_start(callback_value=callback_url, message_block=message_block)
                return

            try:
                output_path = app.complete_auth(code, state)
                body = f"""
<h1>auth.json 已生成</h1>
<div class="panel ok">
  <p>认证成功，文件已经写入：</p>
  <p><code>{output_path}</code></p>
  <p>现在可以关闭这个页面了。</p>
</div>
<a class="btn" href="/">继续登录其他账号</a>
"""
                self.respond(200, html_page("登录成功", body))
            except Exception as exc:
                message_block = f"""
<div class="panel err">
  <p>{self.escape_html(str(exc))}</p>
</div>
"""
                self.render_start(callback_value=callback_url, message_block=message_block)

        def read_form(self) -> dict[str, list[str]]:
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                content_length = 0
            raw = self.rfile.read(max(content_length, 0)).decode("utf-8", errors="replace")
            return urllib.parse.parse_qs(raw)

        def respond(self, status_code: int, body: bytes) -> None:
            self.send_response(status_code)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt: str, *args) -> None:
            message = fmt % args
            print(f"[{self.log_date_time_string()}] {self.address_string()} {message}")

        @staticmethod
        def escape_html(text: str) -> str:
            return (
                text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace('"', "&quot;")
            )

    return EntryHandler


def start_background_server(server: ThreadingHTTPServer, name: str) -> threading.Thread:
    thread = threading.Thread(target=server.serve_forever, name=name, daemon=True)
    thread.start()
    return thread


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="独立 Codex OAuth 登录工具。登录成功后自动生成 auth.json。"
    )
    parser.add_argument(
        "--output",
        default="auth.json",
        help="输出文件路径，默认写到当前目录下的 auth.json",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"本地监听端口，默认 {DEFAULT_PORT}",
    )
    redirect_group = parser.add_mutually_exclusive_group()
    redirect_group.add_argument(
        "--after-login-url",
        default="",
        help="登录成功后自动跳转到此 URL，例如 http://localhost:8888/",
    )
    redirect_group.add_argument(
        "--after-login-port",
        type=int,
        help="登录成功后自动跳转到本地端口，例如 8888",
    )
    parser.add_argument(
        "--b",
        action="store_true",
        help="启动后自动打开浏览器首页",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not (1 <= args.port <= 65535):
        raise SystemExit("--port 必须在 1 到 65535 之间。")
    if args.after_login_port is not None and not (1 <= args.after_login_port <= 65535):
        raise SystemExit("--after-login-port 必须在 1 到 65535 之间。")
    success_redirect_url = args.after_login_url.strip() or (
        build_local_root_url(args.after_login_port) if args.after_login_port is not None else None
    )
    output_path = Path(args.output)
    app = OAuthApp(
        output_path=output_path,
        port=args.port,
        success_redirect_url=success_redirect_url,
    )
    main_server = ThreadingHTTPServer((HOST, args.port), make_handler(app))
    entry_port = ListeningPort if ListeningPort != args.port else None
    entry_server = None
    if entry_port is not None:
        try:
            entry_server = ThreadingHTTPServer((ENTRY_HOST, entry_port), make_entry_handler(app))
        except OSError as exc:
            raise SystemExit(
                f"入口端口 {entry_port} 启动失败：{exc}。请关闭占用进程，或把 ListeningPort 改成其他端口。"
            ) from exc
        start_background_server(entry_server, f"codex-oauth-entry-{entry_port}")

    local_url = build_local_root_url(args.port)
    browser_url = local_url
    if entry_port is not None:
        browser_url = build_local_root_url(entry_port)
        print(f"局域网入口已启动: {browser_url} (绑定 {ENTRY_HOST}:{entry_port})")
    print(f"独立 Codex OAuth 服务已启动: {local_url}")
    print(f"OAuth 回调地址: {app.redirect_uri}")
    if app.success_redirect_url:
        print(f"登录成功后跳转到: {app.success_redirect_url}")
    if args.port != DEFAULT_PORT:
        print(f"提示: {non_default_port_hint(args.port)}")
    print(f"登录成功后将写入: {app.output_path}")
    print("按 Ctrl+C 退出。")

    if args.b:
        webbrowser.open(browser_url)

    try:
        main_server.serve_forever()
    except KeyboardInterrupt:
        print("\n正在退出...")
    finally:
        main_server.server_close()
        if entry_server is not None:
            entry_server.server_close()


if __name__ == "__main__":
    main()
