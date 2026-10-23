'use strict';
// QuickMart server – zero dependencies (Node 18+). Run: node server.js
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
try{for(const l of fs.readFileSync(path.join(__dirname,'.env'),'utf8').split('\n')){const m=l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);if(m&&!process.env[m[1]]&&m[2])process.env[m[1]]=m[2]}}catch{}
const PORT=+process.env.PORT||3000,PROD=process.env.NODE_ENV==='production';
const FILE=process.env.DB_FILE||path.join(__dirname,'db.json'),PUB=path.join(__dirname,'public');
const S=[["Premium Wheat Atta 5kg","Groceries","Everyday Mills",285,320,4.5,40,"🌾",1,"Stone-ground whole wheat",5],["Fresh Tomatoes 1kg","Fruits & veg","Farm Direct",40,55,4.2,120,"🍅",1,"Farm fresh, sorted daily",0],["Toned Milk 1L","Dairy & bakery","Dairy Fresh",64,68,4.6,60,"🥛",1,"Pasteurised, 1 litre pack",0],["Whole Wheat Bread","Dairy & bakery","Baker’s Basket",45,50,4.3,25,"🍞",1,"Baked fresh every morning",5],["Bananas 1 dozen","Fruits & veg","Farm Direct",60,80,4.4,80,"🍌",1,"Naturally ripened",0],["Herbal Face Wash","Personal care","Veda Naturals",179,249,4.1,35,"🧴",0,"Neem and tulsi, 100ml",18],["Non-stick Tawa 28cm","Home & kitchen","CookWell",649,999,4.3,22,"🍳",0,"Induction friendly",18],["5G Smartphone 8/128GB","Mobiles","Nexa",14999,18999,4.4,15,"📱",0,"6.6\" display, 50MP camera",18],["Wireless Earbuds","Electronics","SoundPeak",1299,2999,4.0,50,"🎧",0,"30 hrs playback, ANC",18],["Laptop 14\" i5 16GB","Electronics","Compute Co",46990,58990,4.5,8,"💻",0,"512GB SSD, 1.4 kg",18],["Men’s Denim Jacket","Fashion","UrbanThread",1799,3299,4.2,30,"🧥",0,"Classic casual wear",12],["Women’s Casual Sneakers","Footwear","StrideLab",1499,2499,4.3,44,"👟",0,"Stylish and comfortable",12],["Mystery Novel Paperback","Books","PageTurn",249,399,4.7,70,"📚",0,"Bestselling thriller",0],["Building Blocks 200pc","Toys","PlayNest",599,899,4.5,26,"🧱",0,"Ages 5 and up",12],["Yoga Mat 6mm","Sports","FitForm",499,899,4.2,0,"🧘",0,"Anti-slip, extra thick",12],["Mixer Grinder 750W","Appliances","HomeMate",2899,4499,4.4,12,"🔌",0,"3 jars, 2-year warranty",18]];
const seed=()=>({meta:{secret:crypto.randomBytes(32).toString('hex')},users:[],sessions:[],otps:[],orders:[],
 coupons:{WELCOME10:{pct:10,max:150,first:true}},
 stores:[{id:1,name:"Patna Central",pincodes:["800001"],km:2.4,open:[7,23]},{id:2,name:"Patna Boring Road",pincodes:["800020"],km:3.1,open:[7,23]}],
 products:S.map((a,i)=>({id:i+1,sku:'QM'+String(i+1).padStart(4,'0'),name:a[0],cat:a[1],brand:a[2],price:a[3],mrp:a[4],rating:a[5],rev:(i*379)%1900+120,stock:a[6],icon:a[7],quick:!!a[8],desc:a[9],gst:a[10],active:true})) });
let db=null;try{db=JSON.parse(fs.readFileSync(FILE,'utf8'))}catch{}
if(!db){db=seed();save()}
function save(){fs.writeFileSync(FILE+'.tmp',JSON.stringify(db));fs.renameSync(FILE+'.tmp',FILE)}
const SECRET=process.env.AUTH_SECRET||db.meta.secret,devCodes=new Map(),DEV_SHOW=!PROD&&!process.env.TWILIO_SID&&process.env.DEV_SHOW_OTP!=='0',pending=new Map(),hits=new Map();
const hmac=x=>crypto.createHmac('sha256',SECRET).update(x).digest('hex');
const eq=(a,b)=>a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const hashPw=(p,s=crypto.randomBytes(16).toString('hex'))=>s+':'+crypto.scryptSync(p,s,64).toString('hex');
const checkPw=(p,h)=>{const[s]=h.split(':');return eq(hashPw(p,s),h)};
class E extends Error{constructor(c,m){super(m);this.c=c}}
function limit(k,max,ms){const n=Date.now(),h=hits.get(k)||{c:0,t:n};if(n-h.t>ms){h.c=0;h.t=n}h.c++;hits.set(k,h);if(h.c>max)throw new E(429,'Too many attempts. Please try again later.')}
function parseId(s){s=String(s||'').trim();const d=s.replace(/[\s-]/g,'').replace(/^(\+91|91|0)(?=\d{10}$)/,'');if(/^[6-9]\d{9}$/.test(d))return{kind:'phone',v:d};if(/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(s)&&s.length<=120)return{kind:'email',v:s.toLowerCase()};return null}
const findUser=p=>db.users.find(u=>p.kind==='phone'?u.phone===p.v:u.email===p.v);
const mask=p=>'+91 ••••••'+p.slice(-4);
async function deliver(phone,code){
  const{TWILIO_SID:sid,TWILIO_TOKEN:tok,TWILIO_FROM:from}=process.env;
  if(!sid||!tok||!from){console.log(`[DEV MODE – no SMS provider] OTP for +91${phone}: ${code}`);return'console'}
  const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(sid+':'+tok).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({To:'+91'+phone,From:from,Body:`${code} is your QuickMart OTP. Valid for 5 minutes. Do not share it with anyone.`})});
  if(!r.ok)throw new E(502,'Could not send OTP right now. Please try again.');return'sms'}
async function sendOtp(phone,purpose){
  const old=db.otps.find(o=>o.phone===phone&&o.purpose===purpose);if(old&&Date.now()-old.sent<30000)throw new E(429,'Please wait 30 seconds before requesting another OTP.');
  const code=String(crypto.randomInt(100000,1000000));const ch=await deliver(phone,code);if(DEV_SHOW&&ch==='console')devCodes.set(phone,code);
  db.otps=db.otps.filter(o=>!(o.phone===phone&&o.purpose===purpose)&&o.exp>Date.now());
  db.otps.push({phone,purpose,h:hmac(phone+purpose+code),exp:Date.now()+3e5,tries:0,sent:Date.now()});save();return ch}
function checkOtp(phone,purpose,code){
  const o=db.otps.find(o=>o.phone===phone&&o.purpose===purpose);if(!o||o.exp<Date.now())throw new E(400,'OTP expired. Please request a new one.');
  if(++o.tries>5){db.otps=db.otps.filter(x=>x!==o);save();throw new E(429,'Too many wrong attempts. Request a new OTP.')}
  if(!/^\d{6}$/.test(String(code))||!eq(o.h,hmac(phone+purpose+code))){save();throw new E(400,'Incorrect OTP.')}
  db.otps=db.otps.filter(x=>x!==o);save()}
function session(res,u){const t=crypto.randomBytes(32).toString('hex');db.sessions=db.sessions.filter(s=>s.exp>Date.now());db.sessions.push({h:hmac(t),uid:u.id,exp:Date.now()+30*864e5});save();
  res.setHeader('Set-Cookie',`bp_sid=${t}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${30*86400}${PROD?'; Secure':''}`)}
function authed(req){const m=/(?:^|;\s*)bp_sid=([a-f0-9]{64})/.exec(req.headers.cookie||'');if(!m)return null;const h=hmac(m[1]),s=db.sessions.find(s=>s.h===h&&s.exp>Date.now());return s?db.users.find(u=>u.id===s.uid):null}
const pub=u=>({id:u.id,name:u.name,phone:u.phone,email:u.email,addresses:u.addresses,cart:u.cart,wish:u.wish,role:u.role||'customer',status:u.status||'active',profile:u.profile||null});
function addr(a,u){a=a||{};const g=(k,n,x)=>{const v=String(a[k]??'').trim();if(v.length<n||v.length>x)throw new E(400,`Invalid ${k}`);return v};
  if(!/^\d{6}$/.test(String(a.pincode||'')))throw new E(400,'Enter a valid 6-digit pincode');
  return{id:crypto.randomUUID(),name:String(a.name||u.name).trim().slice(0,60)||u.name,phone:u.phone,line1:g('line1',3,120),city:g('city',2,60),state:g('state',2,60),pincode:String(a.pincode)}}
function price(items,code,u){
  if(!Array.isArray(items)||!items.length||items.length>40)throw new E(400,'Cart is empty');
  const L=items.map(i=>{const p=db.products.find(p=>p.id===i.id&&live(p));const q=i.qty;if(!p||!Number.isInteger(q)||q<1||q>20)throw new E(400,'Invalid cart item');return{p,q}});
  const sub=L.reduce((a,{p,q})=>a+p.price*q,0);let disc=0;
  if(code){const c=db.coupons[String(code).toUpperCase()];if(!c)throw new E(400,'Invalid coupon code');if(c.first&&u&&db.orders.some(o=>o.userId===u.id))throw new E(400,'This coupon is only for your first order');disc=Math.min(Math.floor(sub*c.pct/100),c.max)}
  const tax=L.reduce((a,{p,q})=>{const g=p.price*q,n=g-Math.floor(disc*g/sub);return a+Math.round(n*p.gst/(100+p.gst))},0),fee=sub-disc>=499?0:49;
  return{L,subtotal:sub,discount:disc,tax,deliveryFee:fee,total:sub-disc+fee}}
const ist=()=>+new Date().toLocaleString('en-GB',{timeZone:'Asia/Kolkata',hour:'numeric',hour12:false})%24;
const R={};const route=(m,p,f)=>R[m+' '+p]=f;
route('GET','/api/products',()=>db.products.filter(live).map(({gst,...p})=>p));
route('GET','/api/serviceability',(q,b,u,req,res,url)=>{const pin=url.searchParams.get('pincode')||'';if(!/^\d{6}$/.test(pin))throw new E(400,'Enter a valid 6-digit pincode');
  const s=db.stores.find(s=>s.pincodes.includes(pin));if(!s)return{serviceable:false,reason:'Quick delivery is not available for this pincode yet.'};
  const h=ist();if(h<s.open[0]||h>=s.open[1])return{serviceable:false,reason:`${s.name} is closed now (opens ${s.open[0]}:00).`};
  const load=Math.min(10,db.orders.filter(o=>o.storeId===s.id&&o.status==='PLACED').length),e=8+Math.round(s.km*4)+load;return{serviceable:true,store:s.name,etaMin:e,etaMax:e+10}});
route('POST','/api/quote',(q,b,u)=>{const r=price(b.items,b.coupon,u);return{subtotal:r.subtotal,discount:r.discount,tax:r.tax,deliveryFee:r.deliveryFee,total:r.total}});
route('POST','/api/auth/check',(ip,b)=>{limit('chk'+ip,40,6e4);const p=parseId(b.id);if(!p)throw new E(400,'Enter a valid 10-digit mobile number or email');const u=findUser(p),want=['seller','rider'].includes(b.role)?b.role:'customer',have=u&&(u.role||'customer');if(u&&have!=='admin'&&have!==want)throw new E(409,`This number is registered as a ${have}. Please use the ${have} login.`);return{exists:!!u,kind:p.kind,masked:u?mask(u.phone):null,role:have||want}});
route('POST','/api/auth/otp/send',async(ip,b)=>{limit('os'+ip,15,6e5);const p=parseId(b.id),u=p&&findUser(p);if(!u)throw new E(404,'Account not found');limit('op'+u.phone,5,6e5);const channel=await sendOtp(u.phone,'login');return{channel,masked:mask(u.phone),dev:devCodes.get(u.phone)}});
route('POST','/api/auth/otp/verify',(ip,b,_,req,res)=>{limit('ov'+ip,20,6e5);const p=parseId(b.id),u=p&&findUser(p);if(!u)throw new E(404,'Account not found');checkOtp(u.phone,'login',b.code);session(res,u);return{user:pub(u)}});
route('POST','/api/auth/password',(ip,b,_,req,res)=>{limit('pw'+ip,15,9e5);const p=parseId(b.id),u=p&&findUser(p);limit('pu'+(p?p.v:'x'),8,9e5);if(!u||!checkPw(String(b.password||''),u.pw))throw new E(401,'Incorrect mobile/email or password');session(res,u);return{user:pub(u)}});
route('POST','/api/auth/register',async(ip,b)=>{limit('rg'+ip,10,6e5);const ph=parseId(b.phone),em=parseId(b.email),name=String(b.name||'').trim(),pw=String(b.password||'');
  if(!ph||ph.kind!=='phone')throw new E(400,'Enter a valid 10-digit mobile number');if(!em||em.kind!=='email')throw new E(400,'Enter a valid email');if(name.length<2||name.length>60)throw new E(400,'Enter your full name');if(pw.length<8||pw.length>100)throw new E(400,'Password must be at least 8 characters');
  if(findUser(ph))throw new E(409,'This mobile number is already registered. Please login.');if(findUser(em))throw new E(409,'This email is already registered. Please login.');
  const tmp={id:'x',name,phone:ph.v};const a=b.address&&b.address.line1?addr(b.address,tmp):null;const role=['seller','rider'].includes(b.role)?b.role:'customer',profile=roleProfile(role,b,tmp,a);limit('op'+ph.v,5,6e5);const ch=await sendOtp(ph.v,'register');
  pending.set(ph.v,{name,email:em.v,pw:hashPw(pw),a,role,profile,exp:Date.now()+6e5});return{channel:ch,masked:mask(ph.v),dev:devCodes.get(ph.v)}});
route('POST','/api/auth/register/verify',(ip,b,_,req,res)=>{limit('rv'+ip,20,6e5);const ph=parseId(b.phone),d=ph&&pending.get(ph.v);if(!d||d.exp<Date.now())throw new E(400,'Session expired. Please register again.');checkOtp(ph.v,'register',b.code);
  const u={id:crypto.randomUUID(),name:d.name,phone:ph.v,email:d.email,pw:d.pw,addresses:d.a?[d.a]:[],cart:[],wish:[],role:d.role,status:d.role==='customer'?'active':'pending',profile:d.profile,created:Date.now()};db.users.push(u);pending.delete(ph.v);save();session(res,u);return{user:pub(u)}});
route('POST','/api/auth/logout',(ip,b,u,req,res)=>{const m=/bp_sid=([a-f0-9]{64})/.exec(req.headers.cookie||'');if(m){const h=hmac(m[1]);db.sessions=db.sessions.filter(s=>s.h!==h);save()}res.setHeader('Set-Cookie','bp_sid=; HttpOnly; Path=/; Max-Age=0');return{ok:1}});
const need=u=>{if(!u)throw new E(401,'Please login');return u};
route('GET','/api/me',(q,b,u)=>({user:pub(need(u))}));
route('PUT','/api/me/state',(q,b,u)=>{need(u);const ok=id=>db.products.some(p=>p.id===id);u.cart=(Array.isArray(b.cart)?b.cart:[]).filter(i=>ok(i.id)&&Number.isInteger(i.qty)&&i.qty>0).map(i=>({id:i.id,qty:Math.min(i.qty,20)})).slice(0,40);u.wish=[...new Set((Array.isArray(b.wish)?b.wish:[]).filter(ok))].slice(0,200);save();return{ok:1}});
route('PUT','/api/me/profile',(q,b,u)=>{need(u);const n=String(b.name||'').trim();if(n.length<2||n.length>60)throw new E(400,'Enter your full name');u.name=n;save();return{user:pub(u)}});
route('POST','/api/me/address',(q,b,u)=>{need(u);if(u.addresses.length>=10)throw new E(400,'You can save up to 10 addresses');u.addresses.push(addr(b,u));save();return{user:pub(u)}});
route('DELETE','/api/me/address',(q,b,u)=>{need(u);u.addresses=u.addresses.filter(a=>a.id!==b.id);save();return{user:pub(u)}});
route('GET','/api/orders',(q,b,u)=>db.orders.filter(o=>o.userId===need(u).id).reverse().map(({userId,riderId,key,...o})=>o));
route('POST','/api/orders',(q,b,u)=>{need(u);const dup=db.orders.find(o=>o.userId===u.id&&o.key===b.key);if(dup)return{order:dup};
  if(b.payment!=='COD')throw new E(400,'Online payment is not enabled yet. Please choose Cash on Delivery.');const a=u.addresses.find(a=>a.id===b.addressId);if(!a)throw new E(400,'Select a delivery address');
  const r=price(b.items,b.coupon,u);for(const{p,q}of r.L)if(p.stock<q)throw new E(409,`Only ${p.stock} left of ${p.name}`);
  for(const{p,q}of r.L)p.stock-=q;
  const o={id:crypto.randomUUID(),key:String(b.key||''),userId:u.id,number:'QM'+Date.now().toString(36).toUpperCase()+crypto.randomInt(100,999),status:'PLACED',timeline:[{status:'PLACED',at:Date.now()}],payment:'COD',paymentStatus:'COD_PENDING',
   items:r.L.map(({p,q})=>({productId:p.id,name:p.name,unitPrice:p.price,qty:q,sellerId:p.sellerId||'platform',packed:false})),subtotal:r.subtotal,discount:r.discount,tax:r.tax,deliveryFee:r.deliveryFee,total:r.total,address:a,createdAt:Date.now()};
  db.orders.push(o);u.cart=[];save();const{userId,...out}=o;return{order:out}});

/* ---------- roles: seller / rider / admin ---------- */
const CATS=["Groceries","Fruits & veg","Dairy & bakery","Personal care","Home & kitchen","Mobiles","Electronics","Fashion","Footwear","Books","Toys","Sports","Appliances"];
function live(p){return p.active&&(!p.sellerId||db.users.some(u=>u.id===p.sellerId&&u.status==='active'))}
function roleProfile(role,b,tmp,a){
 if(role==='seller'){const shop=String(b.shopName||'').trim(),g=String(b.gstin||'').trim().toUpperCase();if(shop.length<2||shop.length>80)throw new E(400,'Enter your shop name');if(g&&!/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(g))throw new E(400,'Enter a valid 15-character GSTIN or leave it empty');if(!a)throw new E(400,'Enter your shop pickup address');return{shopName:shop,gstin:g||null}}
 if(role==='rider'){const v=String(b.vehicleNo||'').replace(/\s/g,'').toUpperCase(),t=String(b.vehicleType||''),c=String(b.city||'').trim();if(!/^[A-Z0-9]{6,12}$/.test(v))throw new E(400,'Enter a valid vehicle number');if(!['bike','scooter','cycle'].includes(t))throw new E(400,'Select your vehicle type');if(c.length<2||c.length>60)throw new E(400,'Enter your city');return{vehicleNo:v,vehicleType:t,city:c}}
 return null}
const guard=(u,role)=>{need(u);if(u.role!==role)throw new E(403,'Not allowed');if(u.status!=='active')throw new E(403,u.status==='pending'?'Your account is waiting for admin approval':'Your application was not approved');return u};
const stamp=(o,s)=>{o.status=s;(o.timeline=o.timeline||[]).push({status:s,at:Date.now()})};
function packItems(o,key){if(!o)throw new E(404,'Order not found');if(o.status!=='PLACED')throw new E(400,'This order cannot be packed now');o.items.forEach(i=>{if(i.sellerId===key)i.packed=true});if(o.items.every(i=>i.packed))stamp(o,'PACKED');save()}
const pn=(v,min,max,lbl)=>{const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)throw new E(400,`Invalid ${lbl}`);return n};
function prodFields(b){const name=String(b.name||'').trim(),brand=String(b.brand||'').trim()||'Local',desc=String(b.desc||'').trim();if(name.length<2||name.length>80)throw new E(400,'Enter a product name');if(!CATS.includes(b.cat))throw new E(400,'Select a category');if(desc.length>200)throw new E(400,'Description is too long');
 const price=pn(b.price,1,1e6,'price'),mrp=pn(b.mrp,price,1e6,'MRP (must be at least the price)');return{name,brand:brand.slice(0,40),desc,cat:b.cat,price,mrp,stock:pn(b.stock,0,1e5,'stock'),icon:String(b.icon||'📦').slice(0,4),quick:!!b.quick,gst:[0,5,12,18,28].includes(+b.gst)?+b.gst:18}}
route('GET','/api/seller/products',(q,b,u)=>db.products.filter(p=>p.sellerId===guard(u,'seller').id));
route('POST','/api/seller/products',(q,b,u)=>{guard(u,'seller');if(db.products.filter(p=>p.sellerId===u.id).length>=500)throw new E(400,'Product limit reached');const id=db.products.reduce((m,p)=>Math.max(m,p.id),0)+1;
 const p={id,sku:'QM'+String(id).padStart(4,'0'),...prodFields(b),rating:4,rev:0,active:true,sellerId:u.id};db.products.push(p);save();return p});
route('PUT','/api/seller/products',(q,b,u)=>{guard(u,'seller');const p=db.products.find(x=>x.id===b.id&&x.sellerId===u.id);if(!p)throw new E(404,'Product not found');
 const price=pn(b.price,1,1e6,'price'),mrp=pn(b.mrp??p.mrp,price,1e6,'MRP (must be at least the price)');p.price=price;p.mrp=mrp;p.stock=pn(b.stock,0,1e5,'stock');if(typeof b.active==='boolean')p.active=b.active;save();return p});
route('GET','/api/seller/orders',(q,b,u)=>{guard(u,'seller');return db.orders.filter(o=>o.items.some(i=>i.sellerId===u.id)).reverse().slice(0,100).map(o=>{const mine=o.items.filter(i=>i.sellerId===u.id);return{id:o.id,number:o.number,status:o.status,at:o.createdAt,items:mine,packed:mine.every(i=>i.packed),earn:mine.reduce((a,i)=>a+i.unitPrice*i.qty,0),ship:{name:o.address.name,city:o.address.city,pincode:o.address.pincode}}})});
route('POST','/api/seller/pack',(q,b,u)=>{guard(u,'seller');packItems(db.orders.find(x=>x.id===b.orderId&&x.items.some(i=>i.sellerId===u.id)),u.id);return{ok:1}});
route('GET','/api/rider/orders',(q,b,u)=>{guard(u,'rider');const owner=o=>db.users.find(x=>x.id===o.userId);
 const avail=db.orders.filter(o=>o.status==='PACKED'&&!o.riderId).map(o=>({id:o.id,number:o.number,total:o.total,city:o.address.city,pincode:o.address.pincode,count:o.items.length}));
 const mine=db.orders.filter(o=>o.riderId===u.id).reverse().slice(0,50).map(o=>({id:o.id,number:o.number,status:o.status,total:o.total,address:o.address,customer:owner(o)?.name,phone:o.status==='DELIVERED'?null:o.address.phone,items:o.items.map(i=>i.name+' × '+i.qty),cod:o.payment==='COD'&&o.status!=='DELIVERED'}));
 return{avail,mine,delivered:mine.filter(o=>o.status==='DELIVERED').length}});
route('POST','/api/rider/accept',(q,b,u)=>{guard(u,'rider');const o=db.orders.find(x=>x.id===b.orderId);if(!o||o.status!=='PACKED'||o.riderId)throw new E(409,'This order was just taken by another rider');o.riderId=u.id;stamp(o,'ASSIGNED_TO_DELIVERY');save();return{ok:1}});
route('POST','/api/rider/status',(q,b,u)=>{guard(u,'rider');const o=db.orders.find(x=>x.id===b.orderId&&x.riderId===u.id),nx={ASSIGNED_TO_DELIVERY:'OUT_FOR_DELIVERY',OUT_FOR_DELIVERY:'DELIVERED'};if(!o||!nx[o.status])throw new E(400,'Cannot update this order');stamp(o,nx[o.status]);if(o.status==='DELIVERED')o.paymentStatus='COD_COLLECTED';save();return{ok:1}});
route('POST','/api/orders/cancel',(q,b,u)=>{need(u);const o=db.orders.find(x=>x.id===b.id&&x.userId===u.id);if(!o)throw new E(404,'Order not found');if(o.status!=='PLACED')throw new E(400,'This order can no longer be cancelled');o.items.forEach(i=>{const p=db.products.find(p=>p.id===i.productId);if(p)p.stock+=i.qty});stamp(o,'CANCELLED');save();return{ok:1}});
const admin=u=>{need(u);if(u.role!=='admin')throw new E(403,'Not allowed');return u};
route('GET','/api/admin/overview',(q,b,u)=>{admin(u);const c=r=>db.users.filter(x=>(x.role||'customer')===r).length;
 return{pending:db.users.filter(x=>['seller','rider'].includes(x.role)&&x.status==='pending').map(x=>({id:x.id,name:x.name,phone:x.phone,email:x.email,role:x.role,profile:x.profile,address:x.addresses[0]||null})),
 counts:{customers:c('customer'),sellers:c('seller'),riders:c('rider'),orders:db.orders.length,sales:db.orders.filter(o=>o.status==='DELIVERED').reduce((a,o)=>a+o.total,0)},
 orders:db.orders.slice(-30).reverse().map(o=>({id:o.id,number:o.number,status:o.status,total:o.total,platformPending:o.status==='PLACED'&&o.items.some(i=>i.sellerId==='platform'&&!i.packed)}))}});
route('POST','/api/admin/review',(q,b,u)=>{admin(u);const t=db.users.find(x=>x.id===b.userId&&['seller','rider'].includes(x.role));if(!t)throw new E(404,'User not found');t.status=b.approve?'active':'rejected';save();return{ok:1}});
route('POST','/api/admin/pack',(q,b,u)=>{admin(u);packItems(db.orders.find(x=>x.id===b.orderId),'platform');return{ok:1}});
{const ap=parseId(process.env.ADMIN_PHONE);if(ap&&ap.kind==='phone'&&!findUser(ap)){db.users.push({id:crypto.randomUUID(),name:'Admin',phone:ap.v,email:'admin@quickmart.invalid',pw:hashPw(crypto.randomBytes(16).toString('hex')),role:'admin',status:'active',addresses:[],cart:[],wish:[],created:Date.now()});save();console.log('Admin account created for +91'+ap.v)}}
if(DEV_SHOW)console.log('\n⚠  DEV MODE: OTPs are shown on screen because no SMS provider is configured. Set NODE_ENV=production (and Twilio keys) before going live.\n');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json'};
http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; img-src 'self' data: https://tile.openstreetmap.org https://cdnjs.cloudflare.com; connect-src 'self' https://nominatim.openstreetmap.org; frame-ancestors 'none'");
  try{const url=new URL(req.url,'http://x'),ip=req.socket.remoteAddress;
   if(url.pathname.startsWith('/api/')){
    const f=R[req.method+' '+url.pathname];if(!f)throw new E(404,'Not found');let b={};
    if(req.method!=='GET'){if(!(req.headers['content-type']||'').startsWith('application/json'))throw new E(415,'JSON required');b=await new Promise((ok,no)=>{let d='';req.on('data',c=>{d+=c;if(d.length>1e5){no(new E(413,'Too large'));req.destroy()}});req.on('end',()=>{try{ok(d?JSON.parse(d):{})}catch{no(new E(400,'Bad JSON'))}})})}
    const out=await f(url.pathname.includes('/auth/')?ip:null,b,authed(req),req,res,url);res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store',...(res.getHeader('Set-Cookie')?{'Set-Cookie':res.getHeader('Set-Cookie')}:{})});return res.end(JSON.stringify(out))}
   const fp=path.join(PUB,url.pathname==='/'?'index.html':path.normalize(url.pathname).replace(/^(\.\.[\/\\])+/,''));
   if(!fp.startsWith(PUB)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory())throw new E(404,'Not found');
   res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(res);
  }catch(e){const c=e.c||500;if(c===500)console.error(e);if(!res.headersSent)res.writeHead(c,{'Content-Type':'application/json'});res.end(JSON.stringify({error:c===500?'Something went wrong. Please try again.':e.message}))}
}).listen(PORT,'0.0.0.0',()=>console.log(`QuickMart running on http://localhost:${PORT}  (open http://<your-pc-ip>:${PORT} on your phone, same Wi-Fi)`));
