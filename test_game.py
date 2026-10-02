import tempfile, unittest, time, io, json
from pathlib import Path
import server as s
class GameTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();s.init_db(str(Path(self.temp.name)/'test.sqlite3'));self.r=s.Room('TEST',150)
        for uid in ('a','b'):s.sql('INSERT INTO profiles VALUES(?,?,?,?,?)',(uid,uid,'salt','hash',0))
    def tearDown(self):s.db.close();self.temp.cleanup()
    def player(self,uid,x,y,d):
        self.r.join(uid,uid);p=self.r.players[uid];p.update(x=x,y=y,dir=d,heading=s.math.atan2(s.DIRS[d][1],s.DIRS[d][0]),progress=1,seen=time.monotonic());return p
    def test_capture_encloses_pocket(self):
        g=[0]*(s.N*s.N);owner=1
        for y in range(5,10):g[y*s.N+5]=owner
        trail=[5*s.N+x for x in range(6,10)]+[y*s.N+9 for y in range(6,10)]+[9*s.N+x for x in range(6,9)]
        s.capture(g,owner,trail);self.assertEqual(g[7*s.N+7],owner);self.assertEqual(g[2*s.N+2],0)
    def test_head_collision_simultaneous(self):
        self.player('a',10,10,'right');self.player('b',12,10,'left');self.r.step(time.monotonic());self.assertEqual(self.r.players,{})
    def test_swap_collision(self):
        self.player('a',10,10,'right');self.player('b',11,10,'left');self.r.step(time.monotonic());self.assertEqual(self.r.players,{})
    def test_trail_shield_and_cut(self):
        a=self.player('a',10,10,'right');b=self.player('b',30,30,'right');b['progress']=0;now=time.monotonic();b['trail'][10*s.N+11]=now+2
        self.r.step(now);self.assertIn('b',self.r.players)
        a.update(x=10,y=10,progress=1);a['trail']={};b['trail'][10*s.N+11]=now-1;self.r.step(now);self.assertNotIn('b',self.r.players);self.assertEqual(a['kills'],1)
    def test_continuous_turn_and_no_reverse(self):
        p=self.player('a',10,10,'right');now=time.monotonic()
        p['pending']=[(now,1,'up',False)];p['progress']=0
        self.r.step(now);self.assertEqual(p['dir'],'up')
        self.assertEqual(p['ack'],1)
        self.assertGreater(p['x'],10);self.assertLess(p['y'],10)
        self.assertGreater(p['heading'],-s.math.pi/2);self.assertLess(p['heading'],0)
        p['pending']=[(now,2,'down',False)]
        self.r.step(now+1/s.HZ);self.assertEqual(p['dir'],'up')
    def test_room_ready_start_and_spectate(self):
        self.r.enter('a','Alice');self.r.enter('b','Bob')
        self.assertEqual(self.r.players,{})
        with self.assertRaises(ValueError):self.r.start('a')
        for m in self.r.members.values():m['ready']=True
        with self.assertRaises(ValueError):self.r.start('b')
        self.r.start('a');self.assertEqual(len(self.r.players),2)
        self.r.remove('a','wall')
        self.assertIn('a',self.r.members);self.assertNotIn('a',self.r.players)
        self.assertEqual(self.r.snapshot()['members'][0]['result']['reason'],'wall')
        self.r.remove('b','wall');self.r.step(time.monotonic())
        self.assertEqual(self.r.phase,'finished')
        for m in self.r.members.values():m['ready']=True
        self.r.start('a');self.assertEqual(len(self.r.players),2)
    def test_sizes_and_fractional_positions(self):
        for n in (48,64,96,192,256,384):
            r=s.Room('SIZE',80,n);r.join('a','Alice')
            p=r.players['a'];p['x']+=.5
            snap=r.snapshot();self.assertEqual(len(snap['grid']),n*n)
            self.assertEqual(snap['players'][0]['x'],p['x'])
            self.assertEqual(snap['unit'],r.unit)
            self.assertEqual(snap['players'][0]['points'],round(sum(v==p['slot'] for v in r.grid)/r.unit**2))
            g=[0]*(n*n)
            trail=[5*n+x for x in range(5,10)]+[9*n+x for x in range(5,10)]+[y*n+5 for y in range(6,9)]+[y*n+9 for y in range(6,9)]
            s.capture(g,1,trail,n);self.assertEqual(g[7*n+7],1);self.assertEqual(g[0],0)
    def test_chat_and_host_transfer(self):
        self.r.enter('a','Alice');self.r.enter('b','Bob')
        self.r.chat('a','Hello!');self.assertEqual(self.r.snapshot()['messages'][0]['text'],'Hello!')
        with self.assertRaises(ValueError):self.r.chat('a','Too soon')
        with self.assertRaises(ValueError):self.r.chat('b','x'*241)
        self.r.leave('a');self.assertEqual(self.r.host,'b')
    def test_compact_grid_round_trip_and_cache_invalidation(self):
        self.r.join('a','Alice')
        snap=self.r.snapshot(compact=True)
        restored=[owner for owner,count in snap['gridRuns'] for _ in range(count)]
        self.assertEqual(restored,self.r.grid)
        self.assertEqual(snap['grid'],[])
        revision=snap['gridRevision']
        self.r.remove('a','left')
        next_snap=self.r.snapshot(compact=True)
        self.assertGreater(next_snap['gridRevision'],revision)
        self.assertEqual(next_snap['gridRuns'],[[0,self.r.n*self.r.n]])
    def test_curved_loop_returns_home_and_captures_territory(self):
        p=self.player('a',80,80,'right');p['progress']=0
        self.r.grid=[0]*(self.r.n*self.r.n)
        for y in range(72,89):
            for x in range(72,89):self.r.grid[y*self.r.n+x]=p['slot']
        self.r.grid_revision+=1
        now=time.monotonic();tick=0
        for direction in ('right','up','left','down'):
            p['pending'].append((now+tick/s.HZ,tick,direction,False))
            for _ in range(60):
                self.r.step(now+tick/s.HZ);tick+=1
        self.assertIn('a',self.r.players)
        self.assertEqual(p['trail'],{})
        self.assertGreater(sum(v==p['slot'] for v in self.r.grid),289)
    def test_disconnect_persists(self):
        p=self.player('a',10,10,'right');p['seen']=time.monotonic()-13;self.r.step(time.monotonic());self.assertNotIn('a',self.r.players);self.assertEqual(s.sql('SELECT reason FROM matches').fetchone()[0],'disconnected')
    def test_restart_retains_results(self):
        self.player('a',10,10,'right');self.r.remove('a','left');s.db.close();s.init_db(str(Path(self.temp.name)/'test.sqlite3'));self.assertEqual(s.sql('SELECT COUNT(*) FROM matches').fetchone()[0],1)
    def test_http_room_lifecycle(self):
        s.rooms.clear();s.sessions.clear();s.sessions.update({t:{'uid':u,'expires':time.monotonic()+3600} for t,u in [('token-a','a'),('token-b','b')]})
        def request(path,body=None,token='token-a'):
            h=s.Handler.__new__(s.Handler);h.path='/api/'+path
            data=json.dumps(body).encode() if body is not None else b''
            h.headers={'Cookie':f'{s.COOKIE_NAME}={token}','X-Looprush':'1','Content-Length':str(len(data))}
            h.rfile=io.BytesIO(data);response=[]
            h.reply=lambda data,status=200:response.append((status,data))
            (h.do_GET if body is None else h.do_POST)()
            self.assertTrue(response);return response[0]
        try:
            self.assertEqual(request('join',{'room':'api','size':48,'delay':80})[0],200)
            self.assertEqual(request('join',{'room':'api'},'token-b')[0],200)
            status,state=request('state');self.assertEqual(state['phase'],'waiting');self.assertEqual(state['n'],48)
            self.assertEqual(request('start',{})[0],400)
            request('ready',{});request('ready',{},'token-b')
            self.assertEqual(request('start',{})[0],200)
            self.assertEqual(request('input',{'seq':1,'dir':'up'})[0],200)
            self.assertEqual(request('state')[1]['players'][0]['lastSeq'],1)
            self.assertEqual(s.rooms['API'].delay,0)
            self.assertLessEqual(s.rooms['API'].players['a']['pending'][0][0],time.monotonic())
            self.assertEqual(request('chat',{'text':'Hello room'})[0],200)
            room=s.rooms['API'];room.remove('a','wall')
            state=request('state')[1];self.assertEqual(state['phase'],'playing')
            self.assertEqual(len(state['players']),1);self.assertEqual(len(state['messages']),1)
            self.assertEqual(request('input',{'seq':2,'dir':'left'})[0],409)
            self.assertEqual(request('leave',{})[0],200)
            self.assertEqual(request('state')[1],{'ended':True})
            self.assertEqual(room.host,'b')
            self.assertEqual(request('chat',[],'token-b')[0],400)
        finally:s.rooms.clear();s.sessions.clear()
    def test_password_hash(self):
        salt='11'*16;self.assertEqual(s.password('password123',salt),s.password('password123',salt));self.assertNotEqual(s.password('password123',salt),s.password('different',salt))
if __name__=='__main__':unittest.main()
