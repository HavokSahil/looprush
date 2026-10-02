#!/usr/bin/env python3
"""Looprush: dependency-free authoritative LAN territory game."""
import argparse, collections, gzip, itertools, hashlib, hmac, json, math, mimetypes, random, re, secrets, signal, sqlite3, threading, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, unquote
from http.cookies import SimpleCookie, CookieError
from cosmetics import POWERUPS, UPLOAD_BODY_LIMIT, decode_png
ROOT=Path(__file__).parent
N=256; HZ=60; COLORS=['#a3ff12','#38bdf8','#fb7185','#c084fc','#fbbf24','#2dd4bf','#f97316','#818cf8']
DIRS={'up':(0,-1),'down':(0,1),'left':(-1,0),'right':(1,0)}
lock=threading.RLock(); rooms={}; sessions={}; db=None
engine_stop=threading.Event()
SESSION_TTL=7*24*60*60
COOKIE_NAME='looprush_session'

def create_session(uid):
    now=time.monotonic()
    # A profile has one active login. A new login revokes its previous credentials.
    for token,session in list(sessions.items()):
        if session['uid']==uid or session['expires']<=now:sessions.pop(token,None)
    token=secrets.token_urlsafe(32)
    sessions[token]={'uid':uid,'expires':now+SESSION_TTL}
    return token

def sql(query,args=()):
    with lock:
        c=db.execute(query,args); db.commit(); return c

def init_db(path):
    global db
    db=sqlite3.connect(path,check_same_thread=False)
    db.execute('PRAGMA journal_mode=WAL')
    db.executescript('''CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,name TEXT UNIQUE COLLATE NOCASE,salt TEXT,hash TEXT,created INTEGER);
    CREATE TABLE IF NOT EXISTS matches(id INTEGER PRIMARY KEY,profile TEXT,room TEXT,score REAL,kills INTEGER,seconds INTEGER,reason TEXT,created INTEGER);
    CREATE TABLE IF NOT EXISTS images(id TEXT PRIMARY KEY,data BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_looks(profile TEXT PRIMARY KEY,avatar TEXT);
    CREATE TABLE IF NOT EXISTS powerup_styles(profile TEXT,kind TEXT,name TEXT NOT NULL,image TEXT,PRIMARY KEY(profile,kind));
    CREATE TABLE IF NOT EXISTS global_powerup_styles(kind TEXT PRIMARY KEY,name TEXT NOT NULL,image TEXT);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);''')
    if not db.execute("SELECT 1 FROM settings WHERE key='global_cosmetics_migrated'").fetchone():
        db.execute('INSERT OR IGNORE INTO global_powerup_styles SELECT s.kind,s.name,s.image FROM powerup_styles s JOIN profiles p ON p.id=s.profile ORDER BY p.created,p.rowid')
        db.execute("INSERT INTO settings VALUES('global_cosmetics_migrated','1')")
    db.commit()

def image_url(image_id):
    return f'/api/images/{image_id}.png' if image_id else None

def save_image(value):
    if value is None:return None
    png=decode_png(value)
    image_id=hashlib.sha256(png).hexdigest()
    sql('INSERT OR IGNORE INTO images(id,data) VALUES(?,?)',(image_id,png))
    return image_id

def avatar_url(uid):
    row=sql('SELECT avatar FROM profile_looks WHERE profile=?',(uid,)).fetchone()
    return image_url(row[0]) if row else None

def profile_view(uid):
    row=sql('SELECT id,name FROM profiles WHERE id=?',(uid,)).fetchone()
    return dict(id=row[0],name=row[1],avatar=avatar_url(uid)) if row else None

def can_edit_powerups(uid):
    owner=sql('SELECT id FROM profiles ORDER BY created,rowid LIMIT 1').fetchone()
    return bool(uid and owner and uid==owner[0])

def powerup_catalog():
    styles={row[0]:row[1:] for row in sql('SELECT kind,name,image FROM global_powerup_styles').fetchall()}
    return {kind:dict(kind=kind,**base,image=None) | ({'name':styles[kind][0],'image':image_url(styles[kind][1])} if kind in styles else {}) for kind,base in POWERUPS.items()}

def password(p,s): return hashlib.scrypt(p.encode(),salt=bytes.fromhex(s),n=16384,r=8,p=1).hex()

def capture(grid,owner,trail,n=None):
    N=n or math.isqrt(len(grid))
    # Flood exterior; owned cells and trail form the barrier. All bounded pockets fill.
    barrier={i for i,v in enumerate(grid) if v==owner}|set(trail)
    outside=set(); todo=collections.deque()
    for i in range(N):
        for k in (i,(N-1)*N+i,i*N,i*N+N-1):
            if k not in barrier and k not in outside: outside.add(k); todo.append(k)
    while todo:
        k=todo.popleft(); x=k%N; y=k//N
        for dx,dy in DIRS.values():
            xx=x+dx; yy=y+dy; j=yy*N+xx
            if 0<=xx<N and 0<=yy<N and j not in outside and j not in barrier: outside.add(j); todo.append(j)
    for i in range(N*N):
        if i not in outside: grid[i]=owner

def heart_patch(cx,cy,unit):
    # Implicit heart curve rasterized at gameplay resolution; area stays close
    # to the old square starting patch while leaving a clear point below.
    scale=2.45*unit
    cells=[]
    for dy in range(-math.ceil(1.25*scale),math.floor(.75*scale)+1):
        for dx in range(-math.ceil(1.15*scale),math.ceil(1.15*scale)+1):
            x=dx/scale;y=-dy/scale
            if (x*x+y*y-1)**3-x*x*y**3<=0:
                cells.append((cx+dx,cy+dy))
    return cells

class Room:
    def __init__(self,name,delay=0,n=256):
        self.n=n; self.unit=4 if n>=192 else 1; N=n
        self.members={}; self.host=None; self.phase="waiting"; self.messages=[]; self.message_id=0
        self.name=name; self.delay=0; self.grid=[0]*(N*N); self.players={}; self.pickups=[]; self.tick=0; self.grid_revision=0; self.grid_cache_revision=-1; self.started=time.monotonic(); self.last_spawn=0
    def enter(self,uid,name):
        if len(self.members)>=16: raise ValueError('Room is full')
        self.members[uid]=dict(id=uid,name=name,avatar=avatar_url(uid),ready=False,seen=time.monotonic(),result=None,last_chat=0)
        if self.host is None:self.host=uid
    def leave(self,uid):
        self.remove(uid,'left'); self.members.pop(uid,None)
        if self.host==uid:self.host=next(iter(self.members),None)
    def start(self,uid):
        if uid!=self.host:raise ValueError('Only the host can start')
        if self.phase=='playing':raise ValueError('Match is already running')
        if not self.members or not all(m['ready'] for m in self.members.values()):raise ValueError('Everyone must be ready')
        if len(self.members)>8:raise ValueError('At most 8 players can start a match')
        self.grid=[0]*(self.n*self.n); self.grid_revision+=1; self.pickups=[]
        for member in self.members.values():
            member['result']=None
            self.join(member['id'],member['name'])
        self.phase='playing'
    def chat(self,uid,text):
        text=str(text).strip()
        if not text or len(text)>240:raise ValueError('Message must be 1–240 characters')
        now=time.monotonic(); member=self.members[uid]
        if now-member['last_chat']<0.6:raise ValueError('Please wait a moment')
        member['last_chat']=now; self.message_id+=1
        self.messages.append(dict(id=self.message_id,name=member['name'],text=text))
        self.messages=self.messages[-80:]
    def join(self,uid,name):
        N=self.n
        if uid in self.players: raise ValueError('Already playing in this room')
        if len(self.players)>=8: raise ValueError('Room is full (8 players)')
        slot=next(s for s in range(1,9) if all(p['slot']!=s for p in self.players.values()))
        margin=round(5*self.unit); spacing=round(8*self.unit)
        candidates=[]
        for y in range(margin,N-margin,spacing):
            for x in range(margin,N-margin,spacing):
                patch=heart_patch(x,y,self.unit)
                if all(0<=xx<N and 0<=yy<N and not self.grid[yy*N+xx] for xx,yy in patch) and all(abs(p['x']-x)+abs(p['y']-y)>spacing for p in self.players.values()):
                    candidates.append((x,y))
        if not candidates: raise ValueError('No free spawn. Try a new room.')
        x,y=random.choice(candidates)
        patch=heart_patch(x,y,self.unit)
        for xx,yy in patch:self.grid[yy*N+xx]=slot
        self.grid_revision+=1
        self.players[uid]=dict(id=uid,name=name,avatar=avatar_url(uid),slot=slot,x=x,y=y,dir='right',heading=0,target_heading=0,turn=None,trail={},effects={},pending=[],last_seq=-1,ack=-1,progress=0,kills=0,peak=len(patch)/(N*N)*100,born=time.monotonic(),seen=time.monotonic(),cooldown=0,rtt=0)
    def remove(self,uid,reason):
        p=self.players.pop(uid,None)
        if not p:return
        sql('INSERT INTO matches(profile,room,score,kills,seconds,reason,created) VALUES(?,?,?,?,?,?,?)',(uid,self.name,round(p['peak'],2),p['kills'],int(time.monotonic()-p['born']),reason,int(time.time())))
        if uid in self.members:self.members[uid]['result']=dict(score=round(p['peak'],2),kills=p['kills'],reason=reason)
        self.grid=[0 if v==p['slot'] else v for v in self.grid];self.grid_revision+=1
    def step(self,now):
        N=self.n
        self.tick+=1
        for uid,m in list(self.members.items()):
            if now-m['seen']>20:self.leave(uid)
        if self.members and self.phase!='playing':return
        for uid,p in list(self.players.items()):
            if now-p['seen']>12: self.remove(uid,'disconnected')
        # Apply received inputs on the next simulation tick, without an artificial delay.
        for p in self.players.values():
            while p['pending'] and p['pending'][0][0]<=now:
                _,seq,d,ability=p['pending'].pop(0); p['ack']=seq
                if isinstance(d,(float,int)) and not isinstance(d,bool):
                    target=float(d)
                    delta=(target-p['heading']+math.pi)%(2*math.pi)-math.pi
                    if abs(delta)<math.pi*.8:p['target_heading']=target
                elif d and DIRS[d]!=tuple(-v for v in DIRS[p['dir']]):
                    p['dir']=d;p['target_heading']=math.atan2(DIRS[d][1],DIRS[d][0])
                if ability and now>=p['cooldown'] and not p['trail']:
                    # Teleport is a safe-home dash: visit every cell, no skipped collisions.
                    p['effects']['dash']=now+0.18; p['cooldown']=now+12
            speed=6*self.unit*(1.6 if p['effects'].get('speed',0)>now else 1)*(0.55 if p['effects'].get('slow',0)>now else 1)*(4 if p['effects'].get('dash',0)>now else 1)
            p['speed']=speed; p['progress']+=speed/HZ
        # Resolve each substep from a snapshot, avoiding insertion-order advantages.
        for _ in range(64):
            moving={uid:p for uid,p in self.players.items() if p['progress']>0.000001}
            if not moving:break
            proposals={}; victims={}; killers={}
            for uid,p in moving.items():
                travel=min(.25,p['progress']);p['progress']-=travel
                target=p['target_heading']
                delta=(target-p['heading']+math.pi)%(2*math.pi)-math.pi
                max_turn=8*travel/p['speed']
                p['heading']+=max(-max_turn,min(max_turn,delta))
                x=p['x']+math.cos(p['heading'])*travel;y=p['y']+math.sin(p['heading'])*travel
                proposals[uid]=(x,y)
                if not (-.5<=x<N-.5 and -.5<=y<N-.5): victims[uid]='wall'; continue
                k=math.floor(y+.5)*N+math.floor(x+.5)
                previous=math.floor(p['y']+.5)*N+math.floor(p['x']+.5)
                if k==previous:continue
                if k in p['trail']: victims[uid]='self trail'
                for other,q in self.players.items():
                    if other!=uid and k in q['trail'] and q['trail'][k]<=now:
                        victims[other]='trail cut'; killers.setdefault(other,set()).add(uid)
            ids=list(proposals)
            for a in range(len(ids)):
                u=ids[a]
                for v in self.players:
                    if v==u: continue
                    dest=proposals.get(v,(self.players[v]['x'],self.players[v]['y']))
                    cell=lambda pos:(math.floor(pos[0]+.5),math.floor(pos[1]+.5))
                    swap=cell(proposals[u])==cell((self.players[v]['x'],self.players[v]['y'])) and cell(dest)==cell((self.players[u]['x'],self.players[u]['y']))
                    if math.dist(proposals[u],dest)<.75*self.unit or cell(proposals[u])==cell(dest) or swap: victims[u]=victims[v]='head collision'
            for dead,ks in killers.items():
                for uid in ks:
                    if uid not in victims and uid in self.players:self.players[uid]['kills']+=1/len(ks)
            for uid,reason in victims.items():self.remove(uid,reason)
            closers=[]
            for uid,(x,y) in proposals.items():
                if uid not in self.players:continue
                p=self.players[uid];previous=math.floor(p['y']+.5)*N+math.floor(p['x']+.5)
                p['x']=x;p['y']=y;k=math.floor(y+.5)*N+math.floor(x+.5)
                if k==previous:continue
                if self.grid[k]==p['slot']:
                    if p['trail']:closers.append(uid)
                else:p['trail'][k]=now+3 if p['effects'].get('shield',0)>now else now
                for item in list(self.pickups):
                    if math.hypot(item['x']-x,item['y']-y)<=self.unit:
                        self.pickups.remove(item); kind=item['kind']
                        if kind=='frost':
                            for q in self.players.values():
                                if q!=p and abs(q['x']-x)+abs(q['y']-y)<=14*self.unit:q['effects']['slow']=now+3
                        elif kind=='teleport':p['cooldown']=0
                        else:p['effects'][kind]=now+({'speed':5,'shield':5,'radar':10}[kind])
            # Simultaneous claims: contested new cells stay neutral rather than first player winning.
            claims={}
            for uid in closers:
                p=self.players[uid]; copy=self.grid[:];capture(copy,p['slot'],p['trail'],N)
                for k,v in enumerate(copy):
                    if v==p['slot'] and v!=self.grid[k]:claims.setdefault(k,set()).add(v)
                p['trail']={}
            if claims:self.grid_revision+=1
            for k,owners in claims.items():self.grid[k]=next(iter(owners)) if len(owners)==1 else 0
        if self.members and self.phase=='playing' and not self.players:
            self.phase='finished'
            for m in self.members.values():m['ready']=False
        counts=self.grid_data()[0]
        for p in self.players.values():p['peak']=max(p['peak'],counts[p['slot']]/(N*N)*100)
        if now-self.last_spawn>3 and len(self.pickups)<18:
            self.last_spawn=now
            occupied={math.floor(p['y']+.5)*N+math.floor(p['x']+.5) for p in self.players.values()}|{k for p in self.players.values() for k in p['trail']}
            pickup_cells={i['y']*N+i['x'] for i in self.pickups}
            for _ in range(256):
                k=random.randrange(N*N)
                if not self.grid[k] and k not in occupied and k not in pickup_cells:
                    self.pickups.append(dict(x=k%N,y=k//N,kind=random.choice(['speed','shield','frost','teleport','radar'])))
                    break
    def grid_data(self):
        if self.grid_cache_revision!=self.grid_revision:
            self.grid_counts=collections.Counter(self.grid)
            self.grid_runs=[[owner,sum(1 for _ in cells)] for owner,cells in itertools.groupby(self.grid)]
            self.grid_cache_revision=self.grid_revision
        return self.grid_counts,self.grid_runs
    def snapshot(self,compact=False):
        N=self.n
        now=time.monotonic(); counts,runs=self.grid_data()
        return dict(room=self.name,n=N,unit=self.unit,powerups=powerup_catalog(),phase=self.phase,host=self.host,members=[{k:v for k,v in m.items() if k not in ('seen','last_chat')} for m in self.members.values()],messages=self.messages,time=now,tick=self.tick,delay=0,grid=[] if compact else self.grid,gridRuns=runs if compact else None,gridRevision=self.grid_revision,pickups=self.pickups,players=[dict(id=p['id'],name=p['name'],avatar=p.get('avatar'),slot=p['slot'],x=p['x'],y=p['y'],dir=p['dir'],heading=p['heading'],speed=p.get('speed',6*self.unit),trail=[[k,round(max(0,t-now),2)] for k,t in p['trail'].items()],effects={k:round(t-now,1) for k,t in p['effects'].items() if t>now},cooldown=round(max(0,p['cooldown']-now),1),score=round(counts[p['slot']]/(N*N)*100,2),points=round(counts[p['slot']]/self.unit**2)+round(p['kills']*100),kills=p['kills'],lastSeq=p['last_seq'],ack=p['ack'],rtt=p['rtt']) for p in self.players.values()])

def engine():
    deadline=time.monotonic()
    while not engine_stop.is_set():
        deadline+=1/HZ
        with lock:
            now=time.monotonic()
            for name,r in list(rooms.items()):
                r.step(now)
                if not r.members and not r.players and now-r.started>60:del rooms[name]
        engine_stop.wait(max(0,deadline-time.monotonic()))
        if time.monotonic()-deadline>0.2:deadline=time.monotonic()

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*a):pass
    def reply(self,data,status=200,cookie=None):
        body=json.dumps(data,separators=(',',':')).encode()
        compressed=len(body)>2048 and 'gzip' in self.headers.get('Accept-Encoding','')
        if compressed:body=gzip.compress(body,compresslevel=1)
        self.send_response(status)
        self.send_header('Content-Type','application/json')
        self.send_header('Vary','Accept-Encoding')
        if compressed:self.send_header('Content-Encoding','gzip')
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store')
        if cookie is not None:self.send_header('Set-Cookie',cookie)
        self.end_headers();self.wfile.write(body)
    def cookie(self,token='',clear=False):
        return f'{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={0 if clear else SESSION_TTL}'
    def token(self):
        try:
            cookie=SimpleCookie();cookie.load(self.headers.get('Cookie',''))
            return cookie[COOKIE_NAME].value if COOKIE_NAME in cookie else ''
        except CookieError:return ''
    def user(self):
        token=self.token();session=sessions.get(token)
        if not session:return None
        if session['expires']<=time.monotonic():
            sessions.pop(token,None);return None
        return session['uid']
    def do_GET(self):
        path=urlparse(self.path).path
        if path=='/api/session':
            with lock:
                uid=self.user()
                if not uid:return self.reply({'error':'Sign in to continue'},401,cookie=self.cookie(clear=True))
                profile=profile_view(uid)
                if not profile:return self.reply({'error':'Profile no longer exists'},401,cookie=self.cookie(clear=True))
                return self.reply(profile)
        if path=='/api/powerups':
            with lock:
                uid=self.user()
                return self.reply(dict(powerups=powerup_catalog(),canEdit=can_edit_powerups(uid)))
        if path.startswith('/api/images/'):
            match=re.fullmatch(r'/api/images/([a-f0-9]{64})\.png',path)
            with lock:
                row=sql('SELECT data FROM images WHERE id=?',(match[1],)).fetchone() if match else None
            if not row:return self.reply({'error':'Image not found'},404)
            content=row[0];self.send_response(200)
            self.send_header('Content-Type','image/png');self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Cache-Control','public, max-age=31536000, immutable')
            self.send_header('Content-Length',str(len(content)));self.end_headers();self.wfile.write(content)
            return
        if path=='/api/state':
            with lock:
                uid=self.user()
                if not uid:return self.reply({'error':'Sign in'},401)
                room=next((r for r in rooms.values() if uid in r.members),None)
                if room:
                    room.members[uid]['seen']=time.monotonic()
                    if uid in room.players:room.players[uid]['seen']=time.monotonic()
                return self.reply(room.snapshot(compact=True) if room else {'ended':True})
        if path=='/api/lobby':
            with lock:
                board=[dict(id=r[0],name=r[1],score=r[2],kills=r[3],runs=r[4],avatar=image_url(r[5])) for r in sql('SELECT p.id,p.name,MAX(m.score),SUM(m.kills),COUNT(m.id),l.avatar FROM profiles p JOIN matches m ON p.id=m.profile LEFT JOIN profile_looks l ON l.profile=p.id GROUP BY p.id ORDER BY MAX(m.score) DESC,SUM(m.kills) DESC,p.name ASC LIMIT 20').fetchall()]
                uid=self.user(); history=[]
                if uid:history=[dict(score=r[0],kills=r[1],reason=r[2],created=r[3]) for r in sql('SELECT score,kills,reason,created FROM matches WHERE profile=? ORDER BY id DESC LIMIT 10',(uid,)).fetchall()]
                return self.reply(dict(rooms=[dict(name=r.name,players=len(r.members),delay=r.delay,n=r.n,phase=r.phase) for r in rooms.values()],leaderboard=board,history=history))
        if path=='/api/ping':return self.reply({'ok':True})
        static_root=(ROOT/'dist').resolve()
        file=(static_root/('index.html' if path=='/' else unquote(path).lstrip('/'))).resolve()
        if not file.is_relative_to(static_root) or not file.is_file():
            return self.reply({'error':'Not found. Run npm run build if the frontend is missing.'},404)
        content=file.read_bytes();self.send_response(200)
        self.send_header('Content-Type',mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
        self.send_header('Cache-Control','no-cache' if file.name=='index.html' else 'public, max-age=31536000, immutable')
        self.send_header('Content-Length',str(len(content)));self.end_headers();self.wfile.write(content)
    def do_POST(self):
        try:
            # Cross-origin forms cannot supply this header; no CORS permission is granted.
            if self.headers.get('X-Looprush')!='1':return self.reply({'error':'Invalid request origin'},403)
            path=urlparse(self.path).path
            if path in ('/api/avatar','/api/powerup'):
                with lock:
                    if not self.user():return self.reply({'error':'Sign in again'},401)
            size=int(self.headers.get('Content-Length',0))
            if not 0<=size<=(UPLOAD_BODY_LIMIT if path in ('/api/avatar','/api/powerup') else 4096):raise ValueError('Request too large')
            data=json.loads(self.rfile.read(size));path=urlparse(self.path).path
            if not isinstance(data,dict):raise ValueError('Expected a JSON object')
            with lock:
                if path=='/api/logout':
                    uid=self.user()
                    if uid:
                        for room in rooms.values():
                            if uid in room.members:room.leave(uid)
                    sessions.pop(self.token(),None)
                    return self.reply({'ok':True},cookie=self.cookie(clear=True))
                if path in ('/api/register','/api/login'):
                    if self.user():return self.reply({'error':'Log out before switching accounts'},409)
                    name=str(data.get('name','')).strip();pw=str(data.get('password',''))
                    if not re.fullmatch(r'[A-Za-z0-9_ -]{3,20}',name) or not 8<=len(pw)<=128:raise ValueError('Use a 3–20 character name and an 8–128 character password')
                    row=sql('SELECT id,salt,hash FROM profiles WHERE name=?',(name,)).fetchone()
                    if path.endswith('register'):
                        if row:raise ValueError('Name already taken')
                        uid=secrets.token_hex(12);salt=secrets.token_hex(16);sql('INSERT INTO profiles VALUES(?,?,?,?,?)',(uid,name,salt,password(pw,salt),int(time.time())))
                    else:
                        if not row or not hmac.compare_digest(password(pw,row[1]),row[2]):raise ValueError('Incorrect name or password')
                        uid=row[0]
                        name=sql('SELECT name FROM profiles WHERE id=?',(uid,)).fetchone()[0]
                    token=create_session(uid)
                    return self.reply(profile_view(uid),cookie=self.cookie(token))
                uid=self.user()
                if not uid:return self.reply({'error':'Sign in again'},401)
                r=next((r for r in rooms.values() if uid in r.members),None)
                if path=='/api/avatar':
                    if 'image' not in data:raise ValueError('Choose a face image or remove the current one')
                    image_id=save_image(data['image'])
                    sql('INSERT OR REPLACE INTO profile_looks(profile,avatar) VALUES(?,?)',(uid,image_id))
                    for room in rooms.values():
                        if uid in room.members:room.members[uid]['avatar']=image_url(image_id)
                        if uid in room.players:room.players[uid]['avatar']=image_url(image_id)
                    return self.reply(profile_view(uid))
                if path=='/api/powerup':
                    if not can_edit_powerups(uid):return self.reply({'error':'Only the server owner can customize global power-ups'},403)
                    kind=data.get('kind')
                    if kind not in POWERUPS:raise ValueError('Unknown power-up')
                    if data.get('reset'):
                        sql('DELETE FROM global_powerup_styles WHERE kind=?',(kind,))
                    else:
                        name=data.get('name')
                        if not isinstance(name,str) or not 1<=len(name.strip())<=32 or any(ord(c)<32 for c in name):raise ValueError('Choose a name of 1–32 characters')
                        current=powerup_catalog()[kind]
                        image_id=save_image(data['image']) if 'image' in data else (current['image'].split('/')[-1][:-4] if current['image'] else None)
                        sql('INSERT OR REPLACE INTO global_powerup_styles(kind,name,image) VALUES(?,?,?)',(kind,name.strip(),image_id))
                    return self.reply(dict(powerups=powerup_catalog(),canEdit=True))
                if path=='/api/join':
                    name=str(data.get('room','')).strip().upper()
                    if not re.fullmatch(r'[A-Z0-9-]{3,16}',name):raise ValueError('Room codes: 3–16 letters, digits, or hyphens')
                    if r:raise ValueError('Leave current room first')
                    if name not in rooms:
                        if len(rooms)>=32:raise ValueError('Room limit reached')
                        n=int(data.get('size',256))
                        if n not in (48,64,96,192,256,384):raise ValueError('Choose 192, 256, or 384 cells')
                        rooms[name]=Room(name,0,n)
                    name_db=sql('SELECT name FROM profiles WHERE id=?',(uid,)).fetchone()[0];rooms[name].enter(uid,name_db);return self.reply({'ok':True})
                if path=='/api/leave':
                    if r:r.leave(uid)
                    return self.reply({'ok':True})
                if path in ('/api/ready','/api/start','/api/chat'):
                    if not r:raise ValueError('Join a room first')
                    if path=='/api/ready':
                        if r.phase=='playing':raise ValueError('Match is in progress')
                        r.members[uid]['ready']=not r.members[uid]['ready']
                    elif path=='/api/start':r.start(uid)
                    else:r.chat(uid,data.get('text',''))
                    return self.reply({'ok':True})
                if path=='/api/input':
                    if not r or uid not in r.players:return self.reply({'error':'Not playing'},409)
                    p=r.players[uid];seq=int(data.get('seq',0));d=data.get('dir');ability=bool(data.get('ability',False))
                    if isinstance(d,bool) or (d not in DIRS and d is not None and (not isinstance(d,(float,int)) or not math.isfinite(d) or abs(d)>math.pi)):raise ValueError('Invalid direction')
                    if seq<=p['last_seq']:return self.reply({'ok':True})
                    if len(p['pending'])>=20:raise ValueError('Too many pending inputs')
                    p['last_seq']=seq;p['pending'].append((time.monotonic(),seq,d,ability));p['seen']=time.monotonic();p['rtt']=max(0,min(2000,int(data.get('rtt',0))))
                    return self.reply({'ok':True})
                return self.reply({'error':'Not found'},404)
        except (ValueError,TypeError,KeyError,json.JSONDecodeError) as e:self.reply({'error':str(e)},400)
        except sqlite3.Error:self.reply({'error':'Database error'},500)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--host',default='127.0.0.1');ap.add_argument('--port',type=int,default=8000);ap.add_argument('--db',default=str(ROOT/'data.sqlite3'));args=ap.parse_args();init_db(args.db)
    def stop(signum,frame):raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,stop)
    engine_stop.clear()
    simulation=threading.Thread(target=engine,daemon=True)
    simulation.start()
    try:
        with ThreadingHTTPServer((args.host,args.port),Handler) as httpd:
            print(f'Looprush → http://{args.host}:{args.port}',flush=True)
            httpd.serve_forever()
    except KeyboardInterrupt:pass
    finally:
        engine_stop.set()
        simulation.join()
        with lock:
            for r in rooms.values():
                for uid in list(r.players):r.remove(uid,'server stopped')
        db.close()
if __name__=='__main__':main()
