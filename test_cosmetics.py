import base64
import struct
import time
import unittest
import zlib
import server as s
import test_auth
from cosmetics import decode_png, PNG_SIGNATURE


def chunk(kind, data):
    return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)


def png(width=128, height=128, extra=b'', pixels=None):
    header=chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,6,0,0,0))
    if pixels is None:pixels=(b'\x00'+b'\x44\xaa\xff\xff'*width)*height
    return PNG_SIGNATURE+header+extra+chunk(b'IDAT',zlib.compress(pixels))+chunk(b'IEND',b'')


def data_url(data):
    return 'data:image/png;base64,'+base64.b64encode(data).decode()


class CosmeticTests(unittest.TestCase):
    setUp=test_auth.AuthTests.setUp
    tearDown=test_auth.AuthTests.tearDown
    request=test_auth.AuthTests.request
    register=test_auth.AuthTests.register

    def test_leaderboard_includes_current_avatars_and_aggregated_results(self):
        first,cookie=self.register('First Friend')
        second,_=self.register('Second Friend')
        avatar=self.request('/api/avatar',{'image':data_url(png())},cookie)['body']['avatar']
        for profile,score,kills in ((first,30,2),(first,40,3),(second,40,4)):
            s.sql('INSERT INTO matches(profile,room,score,kills,seconds,reason,created) VALUES(?,?,?,?,?,?,?)',
                  (profile['id'],'TEST',score,kills,10,'wall',time.time()))
        board=self.request('/api/lobby')['body']['leaderboard']
        self.assertEqual([entry['id'] for entry in board],[first['id'],second['id']])
        self.assertEqual(board[0],dict(id=first['id'],name=first['name'],score=40,kills=5,runs=2,avatar=avatar))
        self.assertIsNone(board[1]['avatar'])
        self.request('/api/avatar',{'image':None},cookie)
        self.assertIsNone(self.request('/api/lobby')['body']['leaderboard'][0]['avatar'])

    def test_avatar_upload_visible_in_room_and_persistent(self):
        profile,cookie=self.register()
        result=self.request('/api/avatar',{'image':data_url(png())},cookie)
        self.assertEqual(result['status'],200)
        url=result['body']['avatar'];self.assertTrue(url.startswith('/api/images/'))
        image=self.request(url);self.assertEqual(image['body'],png())
        self.assertEqual(image['headers']['Content-Type'],'image/png')
        self.assertEqual(image['headers']['X-Content-Type-Options'],'nosniff')
        self.request('/api/join',{'room':'FACES'},cookie)
        self.request('/api/ready',{},cookie);self.request('/api/start',{},cookie)
        snapshot=self.request('/api/state',cookie=cookie)['body']
        self.assertEqual(snapshot['members'][0]['avatar'],url)
        self.assertEqual(snapshot['players'][0]['avatar'],url)
        s.db.close();s.init_db(str(s.Path(self.temp.name)/'auth.sqlite3'))
        self.assertEqual(self.request('/api/session',cookie=cookie)['body']['avatar'],url)
        self.assertEqual(self.request(url)['body'],png())
        self.request('/api/avatar',{'image':None},cookie)
        snapshot=self.request('/api/state',cookie=cookie)['body']
        self.assertIsNone(snapshot['players'][0]['avatar'])
        self.assertIsNone(self.request('/api/session',cookie=cookie)['body']['avatar'])

    def test_avatar_is_owned_by_the_authenticated_profile(self):
        first,cookie=self.register('First Friend')
        second,second_cookie=self.register('Second Friend')
        result=self.request('/api/avatar',{'image':data_url(png()),'profile':second['id']},cookie)
        self.assertIsNotNone(result['body']['avatar'])
        self.assertIsNone(self.request('/api/session',cookie=second_cookie)['body']['avatar'])
        self.assertEqual(self.request('/api/avatar',{'image':data_url(png())})['status'],401)

    def test_global_styles_shared_across_hosts_and_rooms(self):
        host,cookie=self.register('Host Friend');guest,guest_cookie=self.register('Guest Friend')
        result=self.request('/api/powerup',{'kind':'speed','name':'Zoomy Dave','image':data_url(png())},cookie)
        self.assertEqual(result['status'],200)
        image=result['body']['powerups']['speed']['image']
        self.request('/api/join',{'room':'CUSTOM'},cookie)
        self.request('/api/join',{'room':'CUSTOM'},guest_cookie)
        shared=self.request('/api/state',cookie=guest_cookie)['body']['powerups']
        self.assertEqual(shared['speed']['name'],'Zoomy Dave');self.assertEqual(shared['speed']['image'],image)
        self.assertFalse(self.request('/api/powerups',cookie=guest_cookie)['body']['canEdit'])
        self.assertEqual(self.request('/api/powerup',{'kind':'speed','name':'Changed'},guest_cookie)['status'],403)
        third,third_cookie=self.register('Other Host')
        self.request('/api/join',{'room':'OTHER'},third_cookie)
        self.assertEqual(self.request('/api/powerup',{'kind':'speed','name':'Different'},third_cookie)['status'],403)
        self.request('/api/powerup',{'kind':'speed','name':'Turbo Dave'},cookie)
        self.assertEqual(self.request('/api/state',cookie=third_cookie)['body']['powerups']['speed']['name'],'Turbo Dave')
        self.assertEqual(self.request('/api/state',cookie=third_cookie)['body']['powerups']['speed']['image'],image)
        style=self.request('/api/state',cookie=guest_cookie)['body']['powerups']['speed']
        self.assertEqual(style['name'],'Turbo Dave');self.assertEqual(style['image'],image)
        self.request('/api/powerup',{'kind':'speed','name':'Turbo Dave','image':None},cookie)
        self.assertIsNone(self.request('/api/state',cookie=cookie)['body']['powerups']['speed']['image'])
        self.request('/api/powerup',{'kind':'speed','reset':True},cookie)
        self.assertEqual(self.request('/api/state',cookie=cookie)['body']['powerups']['speed']['name'],'Speed')
        # Global appearances survive restart and apply to every host.
        self.request('/api/powerup',{'kind':'radar','name':'Nosy Nick'},cookie)
        self.request('/api/leave',{},cookie)
        s.db.close();s.init_db(str(s.Path(self.temp.name)/'auth.sqlite3'))
        self.request('/api/join',{'room':'NEXT'},cookie)
        self.assertEqual(self.request('/api/state',cookie=cookie)['body']['powerups']['radar']['name'],'Nosy Nick')

    def test_legacy_settings_migrate_once_and_reset_stays_reset(self):
        profile,cookie=self.register()
        s.sql('INSERT INTO powerup_styles VALUES(?,?,?,?)',(profile['id'],'speed','Old Friend',None))
        s.sql("DELETE FROM settings WHERE key='global_cosmetics_migrated'")
        s.db.close();s.init_db(str(s.Path(self.temp.name)/'auth.sqlite3'))
        self.assertEqual(s.powerup_catalog()['speed']['name'],'Old Friend')
        self.request('/api/powerup',{'kind':'speed','reset':True},cookie)
        s.db.close();s.init_db(str(s.Path(self.temp.name)/'auth.sqlite3'))
        self.assertEqual(s.powerup_catalog()['speed']['name'],'Speed')

    def test_invalid_names_and_images_do_not_replace_saved_appearance(self):
        _,cookie=self.register()
        self.request('/api/powerup',{'kind':'shield','name':'Safe Sam','image':data_url(png())},cookie)
        for body in ({'kind':'shield','name':''},{'kind':'shield','name':'x'*33},{'kind':'unknown','name':'Oops'}, {'kind':'shield','name':'Bad','image':'data:image/svg+xml,<svg/>'}):
            self.assertEqual(self.request('/api/powerup',body,cookie)['status'],400)
        style=self.request('/api/powerups',cookie=cookie)['body']['powerups']['shield']
        self.assertEqual(style['name'],'Safe Sam');self.assertIsNotNone(style['image'])
        self.assertEqual(self.request('/api/avatar',{'image':'x'*200000},cookie)['status'],400)
        self.assertEqual(self.request('/api/images/../../server.py')['status'],404)

    def test_png_validation_metadata_stripping_and_bounded_decompression(self):
        metadata=chunk(b'tEXt',b'private comment\x00test')
        self.assertEqual(decode_png(data_url(png(extra=metadata))),png())
        invalid=[b'not png',png(width=256),png()[:-1],png()+b'extra',png(extra=chunk(b'acTL',b'12345678')),png(pixels=b'\x00'*1000000)]
        damaged=bytearray(png());damaged[30]^=1;invalid.append(bytes(damaged))
        for image in invalid:
            with self.subTest(size=len(image)):
                with self.assertRaises(ValueError):decode_png(data_url(image))
        with self.assertRaises(ValueError):decode_png('data:image/png;base64,not base64!')

if __name__=='__main__':unittest.main()
