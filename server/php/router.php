<?php
// doczi dashboard + REST API on PHP's built-in server. Contract: docs/API.md (same as the
// Node.js and Python servers).
// Usage: php -S 127.0.0.1:4800 server/php/router.php
declare(strict_types=1);

// Never print PHP errors into responses; log them to the console instead.
ini_set('display_errors', '0');
ini_set('log_errors', '1');

// Names, as in lib/names.mjs: the legacy solo-keel names are read until v0.3; the new name wins.
const CONFIG_FILES = ['.doczi.json', '.solo-keel.json']; // second one: legacy
const HOME_DIR = '.doczi';
const LEGACY_HOME_DIR = '.solo-keel';
const MAX_BODY = 65536;
const MAX_DOC = 2097152;
const MAX_REASON = 2000;
const MAX_ANSWER = 4000;
const STATUSES = ['done', 'review', 'doing', 'blocked', 'todo'];
const CSP = "default-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const FILES = [
    '/' => ['index.html', 'text/html; charset=utf-8'],
    '/index.html' => ['index.html', 'text/html; charset=utf-8'],
    '/app.js' => ['app.js', 'text/javascript; charset=utf-8'],
    '/markdown.js' => ['markdown.js', 'text/javascript; charset=utf-8'],
    '/export.js' => ['export.js', 'text/javascript; charset=utf-8'],
    '/theme.js' => ['theme.js', 'text/javascript; charset=utf-8'],
    '/style.css' => ['style.css', 'text/css; charset=utf-8'],
];

$repo = dirname(__DIR__, 2);

final class HttpError extends Exception
{
    public function __construct(public int $status, string $message)
    {
        parent::__construct($message);
    }
}

function send(int $status, string $body, string $type = 'application/json; charset=utf-8', array $extra = []): void
{
    http_response_code($status);
    header('Content-Type: ' . $type);
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header_remove('X-Powered-By');
    foreach ($extra as $name => $value) {
        header("$name: $value");
    }
    echo $body;
}

function sendJson(int $status, $data): void
{
    $json = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    send($status, $json === false ? '{"error":"Server error."}' : $json);
}

function envValue(string $name): string
{
    return (string) (getenv('DOCZI_' . $name) ?: getenv('SOLO_KEEL_' . $name) /* legacy */ ?: '');
}

function userHome(): string
{
    return getenv('HOME') ?: getenv('USERPROFILE') ?: '.';
}

function projects(): array
{
    $home = envValue('HOME');
    $newHome = userHome() . DIRECTORY_SEPARATOR . HOME_DIR;
    // The legacy home only while neither the environment names a home nor ~/.doczi exists.
    $candidates = $home !== '' ? [$home] : (is_dir($newHome) ? [$newHome] : [$newHome, userHome() . DIRECTORY_SEPARATOR . LEGACY_HOME_DIR]);
    $file = null;
    foreach ($candidates as $dir) {
        if (is_file($dir . DIRECTORY_SEPARATOR . 'projects.json')) {
            $file = $dir . DIRECTORY_SEPARATOR . 'projects.json';
            break;
        }
    }
    if ($file === null) {
        return [];
    }
    $data = json_decode((string) file_get_contents($file), true);
    return is_array($data['projects'] ?? null) ? $data['projects'] : [];
}

function isWindows(): bool
{
    return PHP_OS_FAMILY === 'Windows';
}

// Resolve "." and ".." without touching the disk (the file may not exist yet).
function normalizePath(string $path): string
{
    $path = str_replace('\\', '/', $path);
    $prefix = '';
    if (preg_match('#^([A-Za-z]:)?/#', $path, $m)) {
        $prefix = $m[0];
        $path = substr($path, strlen($prefix));
    }
    $parts = [];
    foreach (explode('/', $path) as $part) {
        if ($part === '' || $part === '.') {
            continue;
        }
        if ($part === '..') {
            array_pop($parts);
        } else {
            $parts[] = $part;
        }
    }
    return $prefix . implode('/', $parts);
}

function isWithin(string $root, string $path): bool
{
    $root = rtrim(normalizePath($root), '/') . '/';
    $path = normalizePath($path);
    return isWindows() ? strncasecmp($path, $root, strlen($root)) === 0 : strncmp($path, $root, strlen($root)) === 0;
}

// Throws unless $file (existing or not) really lies inside $root and is not itself a symlink.
function assertInside(string $root, string $file): void
{
    $outside = new HttpError(404, 'That file is not inside the project.');
    if (!isWithin($root, $file)) {
        throw $outside;
    }
    $realRoot = realpath($root);
    $dir = dirname($file);
    while (!file_exists($dir) && dirname($dir) !== $dir) {
        $dir = dirname($dir);
    }
    $realDir = realpath($dir);
    if ($realRoot === false || $realDir === false) {
        throw $outside;
    }
    if (normalizePath($realDir) !== normalizePath($realRoot) && !isWithin($realRoot, $realDir)) {
        throw $outside;
    }
    if (is_link($file)) {
        throw $outside;
    }
}

// The progress file of a registered project, or null when it has none or it points outside.
function progressPath(array $project): ?string
{
    $root = normalizePath((string) ($project['path'] ?? ''));
    $rel = 'docs/progress/milestones.json';
    $configFile = null;
    foreach (CONFIG_FILES as $name) {
        if (is_file($root . '/' . $name)) {
            $configFile = $root . '/' . $name;
            break;
        }
    }
    if ($configFile !== null) {
        $config = json_decode(preg_replace('/^\xEF\xBB\xBF/', '', (string) file_get_contents($configFile)), true);
        if (is_array($config) && is_string($config['progress'] ?? null)) {
            $rel = $config['progress'];
        }
    }
    $isAbsolute = (bool) preg_match('#^([A-Za-z]:)?[/\\\\]#', $rel);
    $full = normalizePath($isAbsolute ? $rel : $root . '/' . $rel);
    if (!isWithin($root, $full)) {
        return null;
    }
    try {
        assertInside($root, $full);
    } catch (HttpError $e) {
        return null;
    }
    return $full;
}

function findProject(string $id): array
{
    foreach (projects() as $p) {
        if (($p['id'] ?? null) === $id) {
            $path = progressPath($p);
            if ($path === null || !is_file($path)) {
                throw new HttpError(404, "Project \"$id\" has no progress file yet.");
            }
            return [normalizePath((string) $p['path']), $path];
        }
    }
    throw new HttpError(404, "No project \"$id\".");
}

function readProgressFile(string $path): object
{
    $data = json_decode(preg_replace('/^\xEF\xBB\xBF/', '', (string) file_get_contents($path)));
    if (!is_object($data) || !is_array($data->milestones ?? null)) {
        throw new HttpError(500, 'The progress file is not valid.');
    }
    return $data;
}

// Two-space JSON like JSON.stringify(data, null, 2), with each plain step on one line.
function formatProgress($data): string
{
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $json = preg_replace_callback('/^( +)/m', fn ($m) => str_repeat(' ', intdiv(strlen($m[1]), 2)), $json);
    $json = preg_replace_callback(
        '/\{\n\s+"status": ("[a-z]+"),\n\s+"title": ("(?:[^"\\\\]|\\\\.)*")(?:,\n\s+"reason": ("(?:[^"\\\\]|\\\\.)*"))?\n\s+\}/',
        fn ($m) => '{ "status": ' . $m[1] . ', "title": ' . $m[2] . (isset($m[3]) && $m[3] !== '' ? ', "reason": ' . $m[3] : '') . ' }',
        $json
    );
    return $json . "\n";
}

// An exclusive, randomly named temp file, then rename over the target.
function writeAtomic(string $root, string $path, string $text): void
{
    assertInside($root, $path);
    $tmp = $path . '.' . bin2hex(random_bytes(8)) . '.tmp';
    $fh = fopen($tmp, 'x');
    if ($fh === false) {
        throw new HttpError(500, 'Could not write the progress file.');
    }
    fwrite($fh, $text);
    fclose($fh);
    if (!rename($tmp, $path)) {
        @unlink($tmp);
        throw new HttpError(500, 'Could not replace the progress file.');
    }
}

function jsonBody(int $port): array
{
    if (!preg_match('#^application/json\b#i', $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '')) {
        throw new HttpError(415, 'Send JSON (Content-Type: application/json).');
    }
    $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
    if ($origin !== null && !in_array($origin, ["http://127.0.0.1:$port", "http://localhost:$port"], true)) {
        throw new HttpError(403, 'Cross-site requests are not allowed.');
    }
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > MAX_BODY) {
        throw new HttpError(413, 'The request body is too large.');
    }
    $text = (string) file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
    if (strlen($text) > MAX_BODY) {
        throw new HttpError(413, 'The request body is too large.');
    }
    $body = json_decode($text, true);
    if (!is_array($body)) {
        throw new HttpError(400, 'The body is not valid JSON.');
    }
    return $body;
}

function shortText($value, int $max): bool
{
    $length = fn (string $s) => function_exists('mb_strlen') ? mb_strlen($s) : strlen($s);
    return is_string($value) && trim($value) !== '' && $length($value) <= $max;
}

function patchStep(string $id, int $port): void
{
    $body = jsonBody($port);
    foreach (['milestone', 'task', 'step'] as $key) {
        if (!is_int($body[$key] ?? null)) {
            throw new HttpError(400, 'Send milestone, task and step as numbers and the step\'s title.');
        }
    }
    if (!is_string($body['title'] ?? null)) {
        throw new HttpError(400, 'Send milestone, task and step as numbers and the step\'s title.');
    }
    $status = $body['status'] ?? null;
    if (!in_array($status, STATUSES, true)) {
        throw new HttpError(400, 'Status must be one of: ' . implode(', ', STATUSES) . '.');
    }
    if ($status === 'blocked' && !shortText($body['reason'] ?? null, MAX_REASON)) {
        throw new HttpError(400, 'A blocked step needs a reason (up to ' . MAX_REASON . ' characters).');
    }

    [$root, $path] = findProject($id);
    send(200, changeLocked($root, $path, function (object $data) use ($body, $status): void {
        $step = $data->milestones[$body['milestone']]->tasks[$body['task']]->steps[$body['step']] ?? null;
        if (!is_object($step)) {
            throw new HttpError(404, 'There is no step at that position.');
        }
        if (($step->title ?? null) !== $body['title']) {
            throw new HttpError(409, 'The list changed since you loaded it. Reload and try again.');
        }
        $step->status = $status;
        if ($status === 'blocked') {
            $step->reason = trim($body['reason']);
        } else {
            unset($step->reason);
        }
    }));
}

// Read, change and write the progress file while holding its lock, using the same protocol
// as the Node.js and Python servers: an exclusive "<file>.lock" with a random token, a short
// wait (DOCZI_LOCK_TIMEOUT_MS, default 5 s) and a 30 s stale limit.
function changeLocked(string $root, string $path, callable $change): string
{
    $lock = $path . '.lock';
    $token = getmypid() . ' ' . bin2hex(random_bytes(8));
    $deadline = microtime(true) + ((int) (envValue('LOCK_TIMEOUT_MS') ?: 5000)) / 1000;
    while (true) {
        $fh = @fopen($lock, 'x');
        if ($fh !== false) {
            fwrite($fh, $token);
            fclose($fh);
            break;
        }
        clearstatcache(true, $lock);
        $mtime = @filemtime($lock);
        if ($mtime === false) {
            continue; // released meanwhile
        }
        if (time() - $mtime > 30) {
            @unlink($lock);
            continue;
        }
        if (microtime(true) >= $deadline) {
            throw new HttpError(503, 'Another change to the progress file is in progress; try again in a moment.');
        }
        usleep(25000);
    }
    try {
        $data = readProgressFile($path);
        $change($data);
        $data->updated = gmdate('Y-m-d');
        $text = formatProgress($data);
        writeAtomic($root, $path, $text);
        return $text;
    } finally {
        // Remove only our own lock: after a stale break it may belong to someone else.
        if (@file_get_contents($lock) === $token) {
            @unlink($lock);
        }
    }
}

function patchQuestion(string $id, int $port): void
{
    $body = jsonBody($port);
    foreach (['milestone', 'task', 'question'] as $key) {
        if (!is_int($body[$key] ?? null)) {
            throw new HttpError(400, 'Send milestone, task and question as numbers and the question\'s text.');
        }
    }
    if (!is_string($body['q'] ?? null)) {
        throw new HttpError(400, 'Send milestone, task and question as numbers and the question\'s text.');
    }
    if (!shortText($body['answer'] ?? null, MAX_ANSWER)) {
        throw new HttpError(400, 'An answer needs some text (up to ' . MAX_ANSWER . ' characters).');
    }
    [$root, $path] = findProject($id);
    send(200, changeLocked($root, $path, function (object $data) use ($body): void {
        $question = $data->milestones[$body['milestone']]->tasks[$body['task']]->questions[$body['question']] ?? null;
        if (!is_object($question)) {
            throw new HttpError(404, 'There is no question at that position.');
        }
        if (($question->q ?? null) !== $body['q']) {
            throw new HttpError(409, 'The list changed since you loaded it. Reload and try again.');
        }
        $question->a = trim($body['answer']);
        unset($question->by); // answered by the user
    }));
}

// Document paths the progress file links (project, milestones, tasks), without "#anchor".
function linkedDocs(object $data): array
{
    $lists = [$data->docs ?? null];
    foreach ($data->milestones as $m) {
        $lists[] = $m->docs ?? null;
        foreach ($m->tasks ?? [] as $t) {
            $lists[] = $t->docs ?? null;
        }
    }
    $paths = [];
    foreach ($lists as $list) {
        if (!is_array($list)) {
            continue;
        }
        foreach ($list as $d) {
            $p = is_string($d) ? $d : ($d->path ?? null);
            if (is_string($p) && trim($p) !== '') {
                $p = preg_replace('#^\./#', '', str_replace('\\', '/', trim(explode('#', $p)[0])));
                $paths[$p] = true;
            }
        }
    }
    return $paths;
}

function getDoc(string $id, string $wanted): void
{
    $notFound = new HttpError(404, 'That document is not linked from this project\'s progress file.');
    $rel = preg_replace('#^\./#', '', str_replace('\\', '/', trim(explode('#', $wanted)[0])));
    if ($rel === '' || str_contains($rel, ':') || !preg_match('/\.(md|markdown|txt)$/i', $rel)) {
        throw $notFound;
    }
    [$root, $path] = findProject($id);
    if (!isset(linkedDocs(readProgressFile($path))[$rel])) {
        throw $notFound;
    }
    $file = normalizePath($root . '/' . $rel);
    try {
        assertInside($root, $file);
    } catch (HttpError $e) {
        throw $notFound;
    }
    if (!is_file($file)) {
        throw new HttpError(404, "The linked document $rel does not exist.");
    }
    if (filesize($file) > MAX_DOC) {
        throw new HttpError(413, 'That document is larger than 2 MiB.');
    }
    $text = preg_replace('/^\xEF\xBB\xBF/', '', (string) file_get_contents($file));
    sendJson(200, ['path' => $rel, 'text' => $text]);
}

set_exception_handler(function (Throwable $e): void {
    error_log((string) $e);
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
    }
    echo '{"error":"Server error; see the server console."}';
});

$port = (int) ($_SERVER['SERVER_PORT'] ?? 0);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$route = rawurldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');

try {
    if (!in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)) {
        throw new HttpError(403, 'Only this computer may connect.');
    }
    $host = $_SERVER['HTTP_HOST'] ?? '';
    if (!in_array($host, ["127.0.0.1:$port", "localhost:$port"], true)) {
        throw new HttpError(403, 'Unknown host.');
    }
    if ($method === 'GET' && isset(FILES[$route])) {
        [$file, $type] = FILES[$route];
        send(200, (string) file_get_contents($repo . '/web/' . $file), $type, str_starts_with($type, 'text/html') ? ['Content-Security-Policy' => CSP] : []);
    } elseif ($method === 'GET' && $route === '/api/health') {
        $version = json_decode((string) file_get_contents($repo . '/package.json'), true)['version'] ?? '';
        sendJson(200, ['ok' => true, 'runtime' => 'php', 'version' => $version]);
    } elseif ($method === 'GET' && $route === '/api/projects') {
        $list = [];
        foreach (projects() as $p) {
            $path = progressPath($p);
            $list[] = ['id' => $p['id'], 'name' => $p['name'], 'hasProgress' => $path !== null && is_file($path)];
        }
        sendJson(200, ['projects' => $list]);
    } elseif ($method === 'GET' && preg_match('#^/api/projects/([^/]+)/progress$#', $route, $m)) {
        [, $path] = findProject($m[1]);
        send(200, (string) file_get_contents($path));
    } elseif ($method === 'GET' && preg_match('#^/api/projects/([^/]+)/docs$#', $route, $m)) {
        getDoc($m[1], (string) ($_GET['path'] ?? ''));
    } elseif ($method === 'PATCH' && preg_match('#^/api/projects/([^/]+)/steps$#', $route, $m)) {
        patchStep($m[1], $port);
    } elseif ($method === 'PATCH' && preg_match('#^/api/projects/([^/]+)/questions$#', $route, $m)) {
        patchQuestion($m[1], $port);
    } else {
        throw new HttpError(404, 'Not found.');
    }
} catch (HttpError $e) {
    sendJson($e->status, ['error' => $e->getMessage()]);
} catch (Throwable $e) {
    error_log((string) $e);
    sendJson(500, ['error' => 'Server error; see the server console.']);
}
