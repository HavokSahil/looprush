"""Authentication and static-serving checks through the real HTTP handlers."""
import io
import json
import tempfile
import time
import unittest
from pathlib import Path
from http.cookies import SimpleCookie
import server as s


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        s.init_db(str(Path(self.temp.name) / 'auth.sqlite3'))
        s.sessions.clear(); s.rooms.clear()

    def tearDown(self):
        s.sessions.clear(); s.rooms.clear(); s.db.close(); self.temp.cleanup()

    def request(self, path, data=None, cookie='', marker=True):
        handler = s.Handler.__new__(s.Handler)
        handler.path = path
        payload = json.dumps(data).encode() if data is not None else b''
        handler.headers = {'Cookie': cookie, 'Content-Length': str(len(payload))}
        if marker: handler.headers['X-Looprush'] = '1'
        handler.rfile = io.BytesIO(payload); handler.wfile = io.BytesIO()
        result = {'headers': {}}
        handler.send_response = lambda status: result.update(status=status)
        handler.send_header = lambda name, value: result['headers'].update({name: value})
        handler.end_headers = lambda: None
        (handler.do_GET if data is None else handler.do_POST)()
        body = handler.wfile.getvalue()
        result['body'] = json.loads(body) if result['headers'].get('Content-Type') == 'application/json' else body
        return result

    def register(self, name='Player One'):
        result = self.request('/api/register', {'name': name, 'password': 'password123'})
        self.assertEqual(result['status'], 200)
        return result['body'], result['headers']['Set-Cookie'].split(';')[0]

    def test_session_restore_and_cookie_attributes(self):
        profile, cookie = self.register()
        self.assertNotIn('token', profile)
        self.assertEqual(self.request('/api/session', cookie=cookie)['body'], profile)
        result = self.request('/api/login', {'name': 'Player One', 'password': 'password123'})
        header = result['headers']['Set-Cookie']
        self.assertIn('HttpOnly', header); self.assertIn('SameSite=Strict', header)
        self.assertIn('Path=/', header); self.assertIn(f'Max-Age={s.SESSION_TTL}', header)
        self.assertEqual(self.request('/api/session', cookie=cookie)['status'], 401)

    def test_logout_revokes_cookie_leaves_room_and_saves_run(self):
        profile, cookie = self.register()
        self.request('/api/join', {'room': 'AUTH', 'size': 48, 'delay': 80}, cookie)
        self.request('/api/ready', {}, cookie); self.request('/api/start', {}, cookie)
        room = s.rooms['AUTH']; self.assertIn(profile['id'], room.players)
        result = self.request('/api/logout', {}, cookie)
        self.assertEqual(result['status'], 200); self.assertIn('Max-Age=0', result['headers']['Set-Cookie'])
        self.assertNotIn(profile['id'], room.players); self.assertNotIn(profile['id'], room.members)
        self.assertEqual(s.sql('SELECT COUNT(*) FROM matches').fetchone()[0], 1)
        self.assertEqual(self.request('/api/state', cookie=cookie)['status'], 401)
        self.assertEqual(self.request('/api/input', {'seq': 1, 'dir': 'up'}, cookie)['status'], 401)
        self.assertEqual(self.request('/api/logout', {}, cookie)['status'], 200)
        self.assertEqual(s.sql('SELECT COUNT(*) FROM matches').fetchone()[0], 1)

    def test_canonical_name_and_bad_credentials(self):
        profile, cookie = self.register('Player One')
        self.request('/api/logout', {}, cookie)
        self.assertEqual(self.request('/api/login', {'name': 'player one', 'password': 'password123'})['body']['name'], 'Player One')
        result = self.request('/api/login', {'name': 'Player One', 'password': 'incorrect'})
        self.assertEqual(result['status'], 400); self.assertNotIn('Set-Cookie', result['headers'])
        self.assertEqual(self.request('/api/register', {'name': 'PLAYER ONE', 'password': 'password123'})['status'], 400)

    def test_switch_requires_logout_and_does_not_leak_history(self):
        first, cookie = self.register('First Player')
        room = s.Room('SCORES', 80); s.rooms['SCORES'] = room
        room.enter(first['id'], first['name']); room.join(first['id'], first['name'])
        self.assertEqual(self.request('/api/register', {'name': 'Second Player', 'password': 'password123'}, cookie)['status'], 409)
        self.request('/api/logout', {}, cookie)
        second, second_cookie = self.register('Second Player')
        self.assertNotEqual(first['id'], second['id'])
        self.assertEqual(self.request('/api/lobby', cookie=second_cookie)['body']['history'], [])
        self.assertEqual(self.request('/api/state', cookie=second_cookie)['body'], {'ended': True})

    def test_expiration_and_restart_reject_old_sessions(self):
        _, cookie = self.register()
        token = SimpleCookie(cookie)[s.COOKIE_NAME].value
        s.sessions[token]['expires'] = time.monotonic()-1
        self.assertEqual(self.request('/api/session', cookie=cookie)['status'], 401)
        self.assertNotIn(token, s.sessions)
        _, cookie = self.register('Another Player'); s.sessions.clear()
        result = self.request('/api/session', cookie=cookie)
        self.assertEqual(result['status'], 401); self.assertIn('Max-Age=0', result['headers']['Set-Cookie'])

    def test_write_requests_require_custom_header(self):
        self.assertEqual(self.request('/api/register', {'name': 'Test', 'password': 'password123'}, marker=False)['status'], 403)
        _, cookie = self.register()
        self.assertEqual(self.request('/api/logout', {}, cookie, marker=False)['status'], 403)
        self.assertEqual(self.request('/api/session', cookie=cookie)['status'], 200)

    def test_static_build_and_path_containment(self):
        result = self.request('/')
        self.assertEqual(result['status'], 200)
        self.assertIn(b'/assets/', result['body'])
        self.assertEqual(result['headers']['Cache-Control'], 'no-cache')
        for path in ('/../server.py', '/%2e%2e/server.py', '/data.sqlite3'):
            self.assertEqual(self.request(path)['status'], 404)
        for asset in (s.ROOT/'dist'/'assets').glob('*.js'):
            result = self.request('/assets/'+asset.name)
            self.assertEqual(result['status'], 200)
            self.assertIn('javascript', result['headers']['Content-Type'])

if __name__ == '__main__':
    unittest.main()
