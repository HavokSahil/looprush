"""Run inside the built image with an empty writable /data directory."""
import base64
import http.cookiejar
import json
import os
import re
import shutil
import sqlite3
import struct
import subprocess
import time
import urllib.error
import urllib.request
import zlib

BASE = 'http://127.0.0.1:8000'
DB = '/data/smoke.sqlite3'
assert os.getuid() == 10001, 'Runtime must run as the application user'
assert shutil.which('node') is None, 'Node must stay in the frontend build stage'
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(path, data=None):
    payload = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(BASE + path, data=payload, headers={'Content-Type': 'application/json', 'X-Looprush': '1'})
    with client.open(req, timeout=3) as response:
        body = response.read()
        return json.loads(body) if response.headers.get_content_type() == 'application/json' else body


def start():
    process = subprocess.Popen(['python', 'server.py', '--host', '127.0.0.1', '--db', DB])
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError('Server exited before becoming ready')
        try:
            request('/api/ping')
            return process
        except (OSError, urllib.error.URLError):
            time.sleep(.05)
    process.terminate(); process.wait(timeout=5)
    raise AssertionError('Server did not become ready')


def stop(process):
    process.terminate()  # The same SIGTERM used by docker stop.
    assert process.wait(timeout=10) == 0, 'SIGTERM must shut down cleanly'


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)


png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB',128,128,8,6,0,0,0))
png += chunk(b'IDAT',zlib.compress((b'\x00'+b'\x40\x80\xff\xff'*128)*128)) + chunk(b'IEND',b'')
image = 'data:image/png;base64,' + base64.b64encode(png).decode()
process = start()
try:
    html = request('/').decode()
    asset = re.search(r'src="(/assets/[^"]+\.js)"', html)[1]
    assert request(asset), 'Built frontend assets must be served'
    profile = request('/api/register', {'name': 'Docker Smoke', 'password': 'smoke-password-123'})
    avatar = request('/api/avatar', {'image': image})['avatar']
    assert request(avatar) == png
    request('/api/powerup', {'kind':'speed', 'name':'Docker Booster', 'image':image})
    request('/api/join', {'room':'SMOKE', 'size':48, 'delay':80})
    request('/api/ready', {})
    request('/api/start', {})
    assert request('/api/state')['players'], 'There must be an active run before shutdown'
finally:
    stop(process)

with sqlite3.connect(DB) as db:
    assert db.execute('SELECT reason FROM matches').fetchone()[0] == 'server stopped'

process = start()
try:
    request('/api/login', {'name':'Docker Smoke', 'password':'smoke-password-123'})
    assert request('/api/session')['avatar'] == avatar
    assert request('/api/powerups')['powerups']['speed']['name'] == 'Docker Booster'
    assert request('/api/lobby')['history'][0]['reason'] == 'server stopped'
finally:
    stop(process)
print('Docker smoke test passed: non-root runtime, frontend, uploads, persistence, and graceful SIGTERM.')
