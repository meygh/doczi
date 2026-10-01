#!/usr/bin/env python3
"""doczi dashboard + REST API on Python 3 (standard library only).

Contract: docs/API.md (same as the Node.js and PHP servers).
Usage: python3 server/python/server.py [--port 4800]
"""
import argparse
import datetime
import json
import os
import re
import sys
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

REPO = Path(__file__).resolve().parents[2]
VERSION = json.loads((REPO / "package.json").read_text(encoding="utf-8"))["version"]
# Names, as in lib/names.mjs: the legacy solo-keel names are read until v0.3; the new name wins.
CONFIG_FILES = (".doczi.json", ".solo-keel.json")  # second one: legacy
HOME_DIR = ".doczi"
LEGACY_HOME_DIR = ".solo-keel"
MAX_BODY = 64 * 1024
MAX_DOC = 2 * 1024 * 1024
MAX_REASON = 2000
MAX_ANSWER = 4000
STATUSES = ("done", "review", "doing", "blocked", "todo")
DOC_TYPES = re.compile(r"\.(md|markdown|txt)$", re.I)
CSP = "default-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/markdown.js": ("markdown.js", "text/javascript; charset=utf-8"),
    "/export.js": ("export.js", "text/javascript; charset=utf-8"),
    "/i18n.js": ("i18n.js", "text/javascript; charset=utf-8"),
    "/i18n/en.js": ("i18n/en.js", "text/javascript; charset=utf-8"),
    "/i18n/fa.js": ("i18n/fa.js", "text/javascript; charset=utf-8"),
    "/i18n/ar.js": ("i18n/ar.js", "text/javascript; charset=utf-8"),
    "/i18n/de.js": ("i18n/de.js", "text/javascript; charset=utf-8"),
    "/i18n/es.js": ("i18n/es.js", "text/javascript; charset=utf-8"),
    "/i18n/tr.js": ("i18n/tr.js", "text/javascript; charset=utf-8"),
    "/theme.js": ("theme.js", "text/javascript; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
}
STEP_LINE = re.compile(
    r'\{\n\s+"status": ("[a-z]+"),\n\s+"title": ("(?:[^"\\]|\\.)*")(?:,\n\s+"reason": ("(?:[^"\\]|\\.)*"))?\n\s+\}'
)
LOOPBACK = {"127.0.0.1", "::1", "::ffff:127.0.0.1"}


class HttpError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def env(name):
    return os.environ.get("DOCZI_" + name) or os.environ.get("SOLO_KEEL_" + name) or ""  # legacy


def registry_file():
    """The registry to read: the home folder, else the legacy one, but only while neither the
    environment names a home nor ~/.doczi exists."""
    if env("HOME"):
        return Path(env("HOME")) / "projects.json"
    if (Path.home() / HOME_DIR).is_dir():
        return Path.home() / HOME_DIR / "projects.json"
    candidates = [Path.home() / HOME_DIR / "projects.json", Path.home() / LEGACY_HOME_DIR / "projects.json"]
    return next((f for f in candidates if f.is_file()), candidates[0])


def projects():
    try:
        data = json.loads(registry_file().read_text(encoding="utf-8"))
        return data.get("projects", []) if isinstance(data, dict) else []
    except (OSError, ValueError):
        return []


def is_within(root, path):
    try:
        rel = os.path.relpath(path, root)
    except ValueError:  # different drives on Windows
        return False
    return rel != "." and not rel.startswith("..") and not os.path.isabs(rel)


def assert_inside(root, file):
    """Raise unless file (existing or not) really lies inside root and is not itself a symlink."""
    outside = HttpError(404, "That file is not inside the project.")
    root, file = os.path.abspath(root), os.path.abspath(file)
    if not is_within(root, file):
        raise outside
    real_root = os.path.realpath(root)
    parent = os.path.dirname(file)
    while not os.path.exists(parent) and os.path.dirname(parent) != parent:
        parent = os.path.dirname(parent)
    real_parent = os.path.realpath(parent)
    if real_parent != real_root and not is_within(real_root, real_parent):
        raise outside
    if os.path.islink(file):
        raise outside


def progress_path(project):
    """The progress file of a registered project, or None when it points outside the project."""
    root = os.path.abspath(project["path"])
    rel = "docs/progress/milestones.json"
    try:
        name = next((n for n in CONFIG_FILES if Path(root, n).is_file()), CONFIG_FILES[0])
        config = json.loads(Path(root, name).read_text(encoding="utf-8-sig"))
        if isinstance(config, dict) and isinstance(config.get("progress"), str):
            rel = config["progress"]
    except (OSError, ValueError):
        pass
    full = os.path.abspath(os.path.join(root, rel))
    try:
        assert_inside(root, full)
    except HttpError:
        return None
    return full


def find_project(project_id):
    for p in projects():
        if p.get("id") == project_id:
            path = progress_path(p)
            if path is None or not os.path.isfile(path):
                raise HttpError(404, f'Project "{project_id}" has no progress file yet.')
            return os.path.abspath(p["path"]), path
    raise HttpError(404, f'No project "{project_id}".')


def read_progress(path):
    data = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict) or not isinstance(data.get("milestones"), list):
        raise HttpError(500, "The progress file is not valid.")
    return data


def format_progress(data):
    """Two-space JSON like JSON.stringify(data, null, 2), with each plain step on one line."""
    text = json.dumps(data, indent=2, ensure_ascii=False)

    def one_line(m):
        reason = f', "reason": {m.group(3)}' if m.group(3) else ""
        return '{ "status": ' + m.group(1) + ', "title": ' + m.group(2) + reason + " }"

    return STEP_LINE.sub(one_line, text) + "\n"


def write_atomic(root, path, text):
    """An exclusive, randomly named temp file, then replace the target."""
    assert_inside(root, path)
    try:
        mode = os.stat(path).st_mode & 0o777
    except OSError:
        mode = 0o644
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=os.path.basename(path) + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        os.chmod(tmp, mode)  # mkstemp creates 0600 files; keep the file's own mode
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


STALE_SECONDS = 30


def change_locked(root, path, change):
    """Read, change and write the progress file while holding its lock.

    Same protocol as the Node.js and PHP servers: an exclusive "<file>.lock" holding a random
    token, a short wait (DOCZI_LOCK_TIMEOUT_MS, default 5 s) and a 30 s stale limit.
    """
    lock = path + ".lock"
    token = f"{os.getpid()} {os.urandom(8).hex()}"
    deadline = time.monotonic() + int(env("LOCK_TIMEOUT_MS") or 5000) / 1000
    while True:
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(token)
            break
        except FileExistsError:
            try:
                age = time.time() - os.lstat(lock).st_mtime
            except FileNotFoundError:
                continue  # released meanwhile
            if age > STALE_SECONDS:
                try:
                    os.unlink(lock)
                except FileNotFoundError:
                    pass
                continue
            if time.monotonic() >= deadline:
                raise HttpError(503, "Another change to the progress file is in progress; try again in a moment.")
            time.sleep(0.025)
    try:
        data = read_progress(path)
        change(data)
        data["updated"] = today()
        text = format_progress(data)
        write_atomic(root, path, text)
        return text
    finally:
        # Remove only our own lock: after a stale break it may belong to someone else.
        try:
            with open(lock, encoding="utf-8") as fh:
                mine = fh.read() == token
            if mine:
                os.unlink(lock)
        except OSError:
            pass


def linked_docs(data):
    lists = [data.get("docs")]
    for m in data.get("milestones", []):
        lists.append(m.get("docs"))
        lists.extend(t.get("docs") for t in m.get("tasks", []))
    paths = set()
    for items in lists:
        if not isinstance(items, list):
            continue
        for d in items:
            p = d if isinstance(d, str) else (d.get("path") if isinstance(d, dict) else None)
            if isinstance(p, str) and p.strip():
                paths.add(re.sub(r"^\./", "", p.split("#")[0].strip().replace("\\", "/")))
    return paths


def is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def short_text(value, limit):
    return isinstance(value, str) and value.strip() != "" and len(value) <= limit


def today():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")


class Handler(BaseHTTPRequestHandler):
    server_version = "doczi"
    sys_version = ""
    timeout = 15

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.command, self.path))

    def send(self, status, body, content_type="application/json; charset=utf-8", extra=None):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for name, value in (extra or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, status, data):
        self.send(status, json.dumps(data, ensure_ascii=False, separators=(",", ":")))

    def allowed_hosts(self):
        port = self.server.server_address[1]
        return {f"127.0.0.1:{port}", f"localhost:{port}"}

    def json_body(self):
        if not re.match(r"application/json\b", self.headers.get("Content-Type", ""), re.I):
            raise HttpError(415, "Send JSON (Content-Type: application/json).")
        origin = self.headers.get("Origin")
        if origin is not None and origin not in {f"http://{h}" for h in self.allowed_hosts()}:
            raise HttpError(403, "Cross-site requests are not allowed.")
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise HttpError(400, "Bad Content-Length.")
        if length < 0:
            raise HttpError(400, "Bad Content-Length.")
        if length > MAX_BODY:
            # Read (a bounded amount of) the body so the client sees the 413 instead of a reset.
            remaining = min(length, 1024 * 1024)
            while remaining > 0:
                chunk = self.rfile.read(min(remaining, 65536))
                if not chunk:
                    break
                remaining -= len(chunk)
            self.close_connection = True
            raise HttpError(413, "The request body is too large.")
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise HttpError(400, "The body is not valid JSON.")
        if not isinstance(body, dict):
            raise HttpError(400, "The body is not valid JSON.")
        return body

    def handle_any(self, method):
        try:
            if self.client_address[0] not in LOOPBACK:
                raise HttpError(403, "Only this computer may connect.")
            if self.headers.get("Host", "") not in self.allowed_hosts():
                raise HttpError(403, "Unknown host.")
            url = urlsplit(self.path)
            route = unquote(url.path)
            if method == "GET" and route in FILES:
                name, ctype = FILES[route]
                extra = {"Content-Security-Policy": CSP} if ctype.startswith("text/html") else None
                return self.send(200, (REPO / "web" / name).read_bytes(), ctype, extra)
            if method == "GET" and route == "/api/health":
                return self.send_json(200, {"ok": True, "runtime": "python", "version": VERSION})
            if method == "GET" and route == "/api/projects":
                items = []
                for p in projects():
                    path = progress_path(p)
                    items.append({"id": p["id"], "name": p["name"], "hasProgress": bool(path and os.path.isfile(path))})
                return self.send_json(200, {"projects": items})
            m = re.fullmatch(r"/api/projects/([^/]+)/progress", route)
            if method == "GET" and m:
                _, path = find_project(m.group(1))
                return self.send(200, Path(path).read_bytes())
            m = re.fullmatch(r"/api/projects/([^/]+)/docs", route)
            if method == "GET" and m:
                wanted = parse_qs(url.query).get("path", [""])[0]
                return self.get_doc(m.group(1), wanted)
            m = re.fullmatch(r"/api/projects/([^/]+)/steps", route)
            if method == "PATCH" and m:
                return self.patch_step(m.group(1))
            m = re.fullmatch(r"/api/projects/([^/]+)/questions", route)
            if method == "PATCH" and m:
                return self.patch_question(m.group(1))
            raise HttpError(404, "Not found.")
        except HttpError as e:
            self.send_json(e.status, {"error": str(e)})
        except Exception as e:  # keep serving; details stay in the console
            sys.stderr.write(f"error: {e!r}\n")
            self.send_json(500, {"error": "Server error; see the server console."})

    def patch_step(self, project_id):
        body = self.json_body()
        if not all(is_int(body.get(k)) for k in ("milestone", "task", "step")) or not isinstance(body.get("title"), str):
            raise HttpError(400, "Send milestone, task and step as numbers and the step's title.")
        status = body.get("status")
        if status not in STATUSES:
            raise HttpError(400, "Status must be one of: " + ", ".join(STATUSES) + ".")
        if status == "blocked" and not short_text(body.get("reason"), MAX_REASON):
            raise HttpError(400, f"A blocked step needs a reason (up to {MAX_REASON} characters).")

        root, path = find_project(project_id)

        def change(data):
            try:
                if min(body["milestone"], body["task"], body["step"]) < 0:
                    raise IndexError
                step = data["milestones"][body["milestone"]]["tasks"][body["task"]]["steps"][body["step"]]
            except (IndexError, KeyError, TypeError):
                raise HttpError(404, "There is no step at that position.")
            if step.get("title") != body["title"]:
                raise HttpError(409, "The list changed since you loaded it. Reload and try again.")
            step["status"] = status
            if status == "blocked":
                step["reason"] = body["reason"].strip()
            else:
                step.pop("reason", None)

        self.send(200, change_locked(root, path, change))

    def patch_question(self, project_id):
        body = self.json_body()
        if not all(is_int(body.get(k)) for k in ("milestone", "task", "question")) or not isinstance(body.get("q"), str):
            raise HttpError(400, "Send milestone, task and question as numbers and the question's text.")
        if not short_text(body.get("answer"), MAX_ANSWER):
            raise HttpError(400, f"An answer needs some text (up to {MAX_ANSWER} characters).")
        root, path = find_project(project_id)

        def change(data):
            try:
                if min(body["milestone"], body["task"], body["question"]) < 0:
                    raise IndexError
                question = data["milestones"][body["milestone"]]["tasks"][body["task"]]["questions"][body["question"]]
            except (IndexError, KeyError, TypeError):
                raise HttpError(404, "There is no question at that position.")
            if question.get("q") != body["q"]:
                raise HttpError(409, "The list changed since you loaded it. Reload and try again.")
            question["a"] = body["answer"].strip()
            question.pop("by", None)  # answered by the user

        self.send(200, change_locked(root, path, change))

    def get_doc(self, project_id, wanted):
        not_found = HttpError(404, "That document is not linked from this project's progress file.")
        rel = re.sub(r"^\./", "", wanted.split("#")[0].strip().replace("\\", "/"))
        if not rel or ":" in rel or not DOC_TYPES.search(rel):
            raise not_found
        root, path = find_project(project_id)
        if rel not in linked_docs(read_progress(path)):
            raise not_found
        file = os.path.abspath(os.path.join(root, rel))
        try:
            assert_inside(root, file)
        except HttpError:
            raise not_found
        if not os.path.isfile(file):
            raise HttpError(404, f"The linked document {rel} does not exist.")
        if os.path.getsize(file) > MAX_DOC:
            raise HttpError(413, "That document is larger than 2 MiB.")
        text = Path(file).read_text(encoding="utf-8-sig", errors="replace")
        self.send_json(200, {"path": rel, "text": text})

    def do_GET(self):
        self.handle_any("GET")

    def do_PATCH(self):
        self.handle_any("PATCH")

    def do_POST(self):
        self.handle_any("POST")

    def do_PUT(self):
        self.handle_any("PUT")

    def do_DELETE(self):
        self.handle_any("DELETE")


def main():
    for stream in (sys.stdout, sys.stderr):  # Windows consoles default to a legacy code page
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="doczi dashboard and API")
    parser.add_argument("--port", type=int, default=int(env("PORT") or 4800))
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"doczi dashboard (Python {sys.version.split()[0]}) at http://localhost:{args.port}/ - stop with Ctrl+C.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
