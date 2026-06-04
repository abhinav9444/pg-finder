// ═══════════════════════════════════════════════════════════
//  PG Finder — Shared core (db.js)
// ═══════════════════════════════════════════════════════════

// ── Config keys ──────────────────────────────────────────────
const CFG_KEY   = 'pgf_cfg';
const USERS_KEY = 'pgf_users';
const DB_KEY    = 'pgf_db';
const SESS_KEY  = 'pgf_sess';

// ── Amenity definitions ──────────────────────────────────────
const AMENITIES = [
  {id:'laundry',   label:'Laundry',        icon:'👕'},
  {id:'hk',        label:'Housekeeping',   icon:'🧹'},
  {id:'lift',      label:'Lift',           icon:'🛗'},
  {id:'parking',   label:'Parking',        icon:'🚗'},
  {id:'water',     label:'Drinking Water', icon:'💧'},
  {id:'cctv',      label:'CCTV',           icon:'📹'},
  {id:'ac',        label:'AC Rooms',       icon:'❄️'},
  {id:'gym',       label:'Gym',            icon:'🏋️'},
  {id:'power',     label:'Power Backup',   icon:'🔌'},
];

// ── Default admin + sample users (first-run seed) ────────────
function seedUsers() {
  if (localStorage.getItem(USERS_KEY)) return;
  const users = [
    { id:'admin1', username:'admin', password:btoa('Admin@123'), isAdmin:true,  active:true, created:'2025-01-01' },
    { id:'u1',     username:'ravi',  password:btoa('Ravi@123'),  isAdmin:false, active:true, created:'2025-01-01' },
    { id:'u2',     username:'meena', password:btoa('Meena@123'), isAdmin:false, active:true, created:'2025-01-01' },
  ];
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

// ── Config (JSONBin + Cloudinary) ────────────────────────────
function getCfg()       { try{return JSON.parse(localStorage.getItem(CFG_KEY)||'{}')}catch(e){return{}} }
function saveCfg(c)     { localStorage.setItem(CFG_KEY, JSON.stringify(c)) }

// ── User management ──────────────────────────────────────────
function getUsers()     { try{return JSON.parse(localStorage.getItem(USERS_KEY)||'[]')}catch(e){return[]} }
function saveUsers(u)   { localStorage.setItem(USERS_KEY, JSON.stringify(u)) }

function loginUser(username, password) {
  const users = getUsers();
  const user  = users.find(u => u.username === username && u.password === btoa(password) && u.active);
  if (!user) return null;
  const sess  = { userId:user.id, username:user.username, isAdmin:user.isAdmin, ts:Date.now() };
  sessionStorage.setItem(SESS_KEY, JSON.stringify(sess));
  return sess;
}
function getSession()   { try{return JSON.parse(sessionStorage.getItem(SESS_KEY)||'null')}catch(e){return null} }
function logout()       { sessionStorage.removeItem(SESS_KEY); location.href='index.html'; }

// ── DB helpers ────────────────────────────────────────────────
function getDB()        { try{return JSON.parse(localStorage.getItem(DB_KEY)||'[]')}catch(e){return[]} }
function saveDB(data)   { localStorage.setItem(DB_KEY, JSON.stringify(data)); syncToCloud(data); }

// ── JSONBin sync ─────────────────────────────────────────────
async function syncToCloud(data) {
  const cfg = getCfg();
  if (!cfg.jbinKey) return;
  try {
    if (!cfg.binId) {
      const r = await fetch('https://api.jsonbin.io/v3/b', {
        method:'POST',
        headers:{'Content-Type':'application/json','X-Master-Key':cfg.jbinKey,'X-Bin-Name':'PG Finder BLR'},
        body:JSON.stringify({pgs:data})
      });
      const d = await r.json();
      cfg.binId = d.metadata.id;
      saveCfg(cfg);
    } else {
      await fetch(`https://api.jsonbin.io/v3/b/${cfg.binId}`, {
        method:'PUT',
        headers:{'Content-Type':'application/json','X-Master-Key':cfg.jbinKey},
        body:JSON.stringify({pgs:data})
      });
    }
  } catch(e) { console.warn('Cloud sync failed', e); }
}

async function loadFromCloud() {
  const cfg = getCfg();
  if (!cfg.jbinKey || !cfg.binId) return null;
  try {
    const r = await fetch(`https://api.jsonbin.io/v3/b/${cfg.binId}/latest`,
      {headers:{'X-Master-Key':cfg.jbinKey}});
    const d = await r.json();
    const pgs = d.record.pgs || [];
    localStorage.setItem(DB_KEY, JSON.stringify(pgs));
    return pgs;
  } catch(e) { return null; }
}

// ── Cloudinary upload ─────────────────────────────────────────
async function uploadImage(file, onProgress) {
  const cfg = getCfg();
  if (!cfg.cldName || !cfg.preset) {
    // base64 fallback
    return new Promise(res => {
      const r = new FileReader();
      r.onload = e => res(e.target.result);
      r.readAsDataURL(file);
    });
  }
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', cfg.preset);
  fd.append('folder', 'pg_finder_blr');
  const xhr = new XMLHttpRequest();
  return new Promise((res, rej) => {
    xhr.upload.onprogress = e => { if(onProgress && e.lengthComputable) onProgress(e.loaded/e.total); };
    xhr.onload = () => {
      try { const d = JSON.parse(xhr.responseText); res(d.secure_url||''); }
      catch(e) { rej(e); }
    };
    xhr.onerror = () => rej(new Error('Upload failed'));
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${cfg.cldName}/image/upload`);
    xhr.send(fd);
  });
}

// ── Distance calculation ──────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

async function geocodeAddress(input) {
  // Try to extract lat/lng from Google Maps links
  const patterns = [
    /[@/](-?\d+\.\d+),(-?\d+\.\d+)/,
    /q=(-?\d+\.\d+),(-?\d+\.\d+)/,
    /\?q=([^&]+)/
  ];
  for (const p of patterns) {
    const m = input.match(p);
    if (m && m[2]) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  }
  // Nominatim geocode
  try {
    const q = encodeURIComponent(input.includes('Bengaluru')||input.includes('Bangalore') ? input : input+', Bengaluru');
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`);
    const d = await r.json();
    if (d[0]) return { lat: parseFloat(d[0].lat), lon: parseFloat(d[0].lon) };
  } catch(e) {}
  return null;
}

async function getPGCoords(pg) {
  if (pg._lat && pg._lon) return { lat:pg._lat, lon:pg._lon };
  const loc = pg.mapLink || pg.addr;
  if (!loc) return null;
  const c = await geocodeAddress(loc);
  if (c) { pg._lat = c.lat; pg._lon = c.lon; }
  return c;
}

// ── Avg score ─────────────────────────────────────────────────
function avgScore(pg) {
  if (!pg.reviews || !pg.reviews.length) return 0;
  const v = pg.reviews.filter(r => r.score > 0);
  return v.length ? +(v.reduce((a,b) => a+b.score, 0)/v.length).toFixed(1) : 0;
}

// ── Score colour ──────────────────────────────────────────────
function scoreColor(s) {
  if (s >= 8)  return '#10b981';
  if (s >= 6)  return '#f59e0b';
  if (s > 0)   return '#ef4444';
  return '#6b7280';
}

// ── Number format ─────────────────────────────────────────────
function fmt(n) { return n ? Number(n).toLocaleString('en-IN') : '—'; }

// ── Toast helper (expects a #toast element) ───────────────────
function toast(msg, type='') {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id='toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'toast' + (type ? ' '+type : '');
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 3200);
}

// ── Seed on load ─────────────────────────────────────────────
seedUsers();

// ── Sample data seed ─────────────────────────────────────────
function seedSampleData() {
  if (localStorage.getItem(DB_KEY)) return;
  const sample = [
    {id:'pg1',name:'Sri Sai PG',gender:'Male',addr:'42, 5th Cross, Koramangala 4th Block, Bengaluru - 560034',
     mapLink:'https://maps.google.com/?q=12.9352,77.6245',owner:'Ramesh Kumar',phone:'9876543210',email:'',
     r1:9500,r2:7000,r3:5500,deposit:18000,maint:500,elec:'Per unit metered',food:'Separate — veg only',foodAmt:2500,wifi:'Included in rent',
     laundry:true,hk:true,lift:true,parking:false,water:true,cctv:true,ac:false,gym:false,power:true,
     reviews:[{text:'Clean rooms, friendly staff, good food',score:8},{text:'Well managed, responsive owner',score:7.5},{text:'Good location near metro',score:8}],
     foodQ:'Tasty South Indian food, timely service. Breakfast and dinner included.',clean:'Well maintained bathrooms, rooms cleaned daily.',
     imgs:{amenity:[],food:[],infra:[]},added:'2025-01-15',updated:'2025-06-01'},
    {id:'pg2',name:'Green Valley PG',gender:'Female',addr:'18, 2nd Main, HSR Layout Sector 2, Bengaluru - 560102',
     mapLink:'https://maps.google.com/?q=12.9116,77.6389',owner:'Priya Sharma',phone:'8765432109',email:'priya@greenvalley.in',
     r1:12000,r2:8500,r3:0,deposit:20000,maint:0,elec:'Included in rent',food:'Included in rent',foodAmt:0,wifi:'Included in rent',
     laundry:true,hk:true,lift:true,parking:true,water:true,cctv:true,ac:true,gym:true,power:true,
     reviews:[{text:'Safe and clean, great warden',score:9},{text:'Best PG in HSR, highly recommend',score:9},{text:'Food variety is excellent',score:8},{text:'WiFi is fast and reliable',score:8.5},{text:'Security is top notch',score:9}],
     foodQ:'Variety of dishes, breakfast & dinner. Separate veg and non-veg.',clean:'Spotless common areas, housekeeping daily.',
     imgs:{amenity:[],food:[],infra:[]},added:'2025-02-10',updated:'2025-05-28'},
    {id:'pg3',name:'Comfort Stay PG',gender:'Co-ed',addr:'99, 1st Floor, Indiranagar 100 Feet Road, Bengaluru - 560038',
     mapLink:'https://maps.google.com/?q=12.9784,77.6408',owner:'Suresh Nair',phone:'7654321098',email:'',
     r1:11000,r2:8000,r3:6000,deposit:15000,maint:300,elec:'Fixed monthly',food:'Not provided',foodAmt:0,wifi:'Separate charge',
     laundry:false,hk:false,lift:false,parking:true,water:true,cctv:true,ac:false,gym:false,power:false,
     reviews:[{text:'Okay locality, parking available',score:6},{text:'Rooms are decent but maintenance slow',score:6.5}],
     foodQ:'No food — nearby restaurants available.',clean:'Rooms need better cleaning. Common areas okay.',
     imgs:{amenity:[],food:[],infra:[]},added:'2025-03-05',updated:'2025-06-01'},
  ];
  localStorage.setItem(DB_KEY, JSON.stringify(sample));
}
seedSampleData();
