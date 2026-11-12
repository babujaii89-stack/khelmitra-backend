import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 8080);
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const DATA_GOV_IN_API_KEY = process.env.DATA_GOV_IN_API_KEY || '';
const DATA_GOV_IN_MANDI_RESOURCE_ID = process.env.DATA_GOV_IN_MANDI_RESOURCE_ID || '9ef84268-d588-465a-a308-a864a43d0070';
const MANDI_STATE = process.env.MANDI_STATE || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const CROPS = [
  { id:'tomato', name:'Tomato', seasons:['Rabi','Zaid'], terrains:['plains','hilly','plateau'], phRange:[6,7], nNeed:'high', durationDays:120, family:'Solanaceae', basePrice:1500 },
  { id:'onion', name:'Onion', seasons:['Rabi','Kharif'], terrains:['plains','plateau'], phRange:[6,7.5], nNeed:'medium', durationDays:130, family:'Amaryllidaceae', basePrice:1800 },
  { id:'potato', name:'Potato', seasons:['Rabi'], terrains:['plains','hilly'], phRange:[5.2,6.5], nNeed:'high', durationDays:100, family:'Solanaceae', basePrice:1200 },
  { id:'wheat', name:'Wheat', seasons:['Rabi'], terrains:['plains','plateau'], phRange:[6,7.5], nNeed:'medium', durationDays:140, family:'Poaceae', basePrice:2350 },
  { id:'mustard', name:'Mustard', seasons:['Rabi'], terrains:['plains','plateau'], phRange:[6,8], nNeed:'low', durationDays:120, family:'Brassicaceae', basePrice:5650 },
  { id:'ginger', name:'Ginger', seasons:['Kharif'], terrains:['hilly'], phRange:[5.5,6.5], nNeed:'medium', durationDays:240, family:'Zingiberaceae', basePrice:4200 },
  { id:'capsicum', name:'Capsicum', seasons:['Rabi','Zaid'], terrains:['hilly','plains'], phRange:[6,7], nNeed:'high', durationDays:110, family:'Solanaceae', basePrice:2800 },
  { id:'cabbage', name:'Cabbage', seasons:['Rabi'], terrains:['hilly','plains'], phRange:[6,6.8], nNeed:'high', durationDays:90, family:'Brassicaceae', basePrice:900 },
  { id:'soybean', name:'Soybean', seasons:['Kharif'], terrains:['plateau','plains'], phRange:[6,7.5], nNeed:'low', durationDays:100, family:'Fabaceae', basePrice:4600 },
  { id:'paddy', name:'Paddy', seasons:['Kharif'], terrains:['plains','hilly'], phRange:[5,7], nNeed:'high', durationDays:130, family:'Poaceae', basePrice:2300 },
];
const seasonNow = () => { const m = new Date().getMonth()+1; return m>=6&&m<=9?'Kharif':m>=10||m<=2?'Rabi':'Zaid'; };
const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
function scoreCrops(profile, season) {
  const soil = profile.soil || {}; const n = Number(soil.nitrogen ?? 280);
  const nLevel = n < 280 ? 'low' : n > 560 ? 'high' : 'medium';
  return CROPS.map(crop => {
    let score=40; const reasons=[]; const warnings=[];
    const [lo,hi]=crop.phRange; const ph=Number(soil.ph ?? 6.5);
    if(ph>=lo&&ph<=hi){score+=22;reasons.push(`Soil pH ${ph} is within ideal ${lo}–${hi}`)} else {score-=Math.round(Math.min(Math.abs(ph-lo),Math.abs(ph-hi))*15);warnings.push(`pH ${ph} outside ideal ${lo}–${hi}`)}
    if(crop.terrains.includes(profile.terrain)){score+=15;reasons.push(`Suited to ${profile.terrain} terrain`)}else{score-=15;warnings.push(`Not ideal for ${profile.terrain} terrain`)}
    if(crop.seasons.includes(season)){score+=18;reasons.push(`${season} season crop`)}else{score-=25;warnings.push(`Off-season for ${season}`)}
    if(crop.nNeed===nLevel||(crop.nNeed==='low'&&nLevel!=='low')){score+=6;reasons.push(`Nitrogen level (${nLevel}) matches demand`)}else if(crop.nNeed==='high'&&nLevel==='low'){score-=6;warnings.push('Needs extra nitrogen top-dressing')}
    if(Number(soil.phosphorus??22)<22){score-=4;warnings.push('Low soil phosphorus — plan a soil-test-based basal phosphorus dose')}else reasons.push('Soil phosphorus is not in the low range');
    if(Number(soil.potassium??140)<140){score-=4;warnings.push('Low soil potassium — plan a soil-test-based potash dose')}else reasons.push('Soil potassium is not in the low range');
    if(Number(soil.organicCarbon??0.5)<0.5){score-=3;warnings.push('Low organic carbon — improve soil organic matter')}else reasons.push('Soil organic carbon is adequate for the screening rule');
    const last = CROPS.find(c=>c.name.toLowerCase()===(profile.previousCrops?.[0]||'').toLowerCase());
    if(last&&last.family===crop.family){score-=12;warnings.push(`Same family as last crop (${last.name}) — rotation risk`)} else if(last?.family==='Fabaceae'){score+=5;reasons.push('Benefits from legume residue nitrogen')}
    return {crop,score:clamp(score,5,98),reasons,warnings};
  }).sort((a,b)=>b.score-a.score);
}
function fertilizerPlan(crop, soil={}) {
  const lowN=Number(soil.nitrogen??280)<280, lowP=Number(soil.phosphorus??22)<22, lowK=Number(soil.potassium??140)<140;
  const days=crop.durationDays; const nRate=crop.nNeed==='high'?(lowN?35:22):crop.nNeed==='medium'?(lowN?25:15):(lowN?15:8);
  const plan=[
    {day:0,product:'Well-decomposed farmyard manure',type:'Organic',dosePerAcre:4000,unit:'kg',method:'Incorporate into soil before planting; use mature, well-decomposed manure.'},
    {day:0,product:lowP?'DAP (soil-test adjusted basal phosphorus)':'Balanced basal NPK (soil-test based)',type:'Phosphate',dosePerAcre:lowP?45:35,unit:'kg',method:'Basal placement at planting; confirm exact nutrient requirement with local soil-test guidance.'},
    {day:Math.max(14,Math.round(days*.2)),product:'Urea (first nitrogen split)',type:'Nitrogen',dosePerAcre:+(nRate*.55).toFixed(1),unit:'kg',method:'Side-dress near the root zone; irrigate after application.'},
    {day:Math.max(28,Math.round(days*.4)),product:'Urea (second nitrogen split)',type:'Nitrogen',dosePerAcre:+(nRate*.45).toFixed(1),unit:'kg',method:'Apply only if crop condition supports it; avoid application before heavy rain.'},
    {day:Math.round(days*.55),product:lowK?'MOP (potash; soil-test adjusted)':'MOP/SOP (potash split)',type:'Potash',dosePerAcre:lowK?22:12,unit:'kg',method:'Apply as a split dose according to soil-test potassium and crop stage.'},
  ];
  if(['tomato','potato','onion','capsicum','cabbage'].includes(crop.id)) plan.push({day:Math.round(days*.65),product:'Micronutrient mix (only if deficiency confirmed)',type:'Micronutrient',dosePerAcre:1,unit:'kg',method:'Apply only after confirming deficiency; follow label dilution and local extension advice.'});
  plan.push({day:Math.round(days*.82),product:'Potassium finishing dose (only if crop/soil test requires)',type:'Potash',dosePerAcre:8,unit:'kg',method:'For fruit, tuber or bulb filling only where recommended; avoid late application without local agronomist guidance.'});
  return plan.filter(t=>t.day<days).sort((a,b)=>a.day-b.day).map((t,i)=>({ ...t,id:`${crop.id}-${i}` }));
}
function send(res,status,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8','access-control-allow-origin':ALLOWED_ORIGIN,'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,OPTIONS','vary':'Origin'});res.end(JSON.stringify(body));}
async function readJson(req){let s='';for await(const c of req){s+=c;if(s.length>100_000)throw new Error('Request body too large')}return s?JSON.parse(s):{}}
async function authenticate(req){
  if(!SUPABASE_URL||!SUPABASE_PUBLISHABLE_KEY) throw Object.assign(new Error('Backend missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY'),{status:500});
  const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!token||token.split('.').length!==3) throw Object.assign(new Error('Sign in is required.'),{status:401});
  const r=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:SUPABASE_PUBLISHABLE_KEY,authorization:`Bearer ${token}`}});
  if(!r.ok) throw Object.assign(new Error('Your session is invalid or expired. Please sign in again.'),{status:401});
  return {token,user:await r.json()};
}
async function profileFor(token,uid,select='farm_profile,onboarded,active_crop_id,tasks'){
  const u=new URL(`${SUPABASE_URL}/rest/v1/profiles`);u.searchParams.set('select',select);u.searchParams.set('id',`eq.${uid}`);u.searchParams.set('limit','1');
  const r=await fetch(u,{headers:{apikey:SUPABASE_PUBLISHABLE_KEY,authorization:`Bearer ${token}`}});
  if(!r.ok) throw Object.assign(new Error(`Could not load saved farm profile (${r.status}).`),{status:502});
  const rows=await r.json();return rows[0]||null;
}
async function mandi(crops,district,state){
  if(!DATA_GOV_IN_API_KEY)return {quotes:crops.map(crop=>({crop,price:null,market:null,arrivalDate:null,source:'data.gov.in'})),live:false,message:'Live mandi prices need DATA_GOV_IN_API_KEY in the backend environment.'};
  const quotes=await Promise.all(crops.map(async crop=>{try{
    const u=new URL(`https://api.data.gov.in/resource/${DATA_GOV_IN_MANDI_RESOURCE_ID}`);u.searchParams.set('api-key',DATA_GOV_IN_API_KEY);u.searchParams.set('format','json');u.searchParams.set('limit','20');u.searchParams.set('filters[state]',state||MANDI_STATE);u.searchParams.set('filters[district]',district);u.searchParams.set('filters[commodity]',crop);
    const r=await fetch(u,{signal:AbortSignal.timeout(9000)});if(!r.ok)return {crop,price:null,market:null,arrivalDate:null,source:'data.gov.in',note:`Mandi service returned ${r.status}`};
    const body=await r.json();const records=(body.records||[]).map(x=>({price:Number(x.modal_price??x.modalprice??x.modalPrice),market:String(x.market??x.market_name??''),arrivalDate:String(x.arrival_date??x.arrivalDate??'')})).filter(x=>x.price>0&&Number.isFinite(x.price));
    records.sort((a,b)=>Date.parse(b.arrivalDate)-Date.parse(a.arrivalDate));const q=records[0];return {crop,price:q?.price??null,market:q?.market??null,arrivalDate:q?.arrivalDate??null,source:'AGMARKNET via data.gov.in',...(!q?{note:'No matching district-market quote was returned.'}:{})};
  }catch{return {crop,price:null,market:null,arrivalDate:null,source:'data.gov.in',note:'Mandi service unavailable; retry later.'}}}));
  return {quotes,live:quotes.some(q=>q.price!==null),message:'Latest matching district-market quotes returned by AGMARKNET; availability varies by district and commodity.'};
}
const server=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS'){send(res,204,{});return}
  const path=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET'&&path==='/health'){send(res,200,{ok:true,service:'khetmitra-api'});return}
  try{
    const {token,user}=await authenticate(req);const uid=user.id;
    if(req.method==='POST'&&path==='/api/crop-advice'){
      const row=await profileFor(token,uid,'farm_profile,onboarded');if(!row?.farm_profile||!row.onboarded)throw Object.assign(new Error('Complete your farm profile before requesting crop advice.'),{status:400});
      const season=seasonNow();
      const profile=row.farm_profile;const cropNames=CROPS.map(c=>c.id==='soybean'?'Soyabean':c.name);
      const market=profile.district?await mandi(cropNames,profile.district,profile.state):{quotes:[],live:false,message:'Add your district in farm profile to retrieve local mandi prices.'};
      const quoteByName=new Map(market.quotes.map(q=>[q.crop.toLowerCase(),q]));
      const recommendations=scoreCrops(profile,season).map(item=>{const key=item.crop.id==='soybean'?'soyabean':item.crop.name.toLowerCase();const q=quoteByName.get(key);const marketAdjustment=q?.price?clamp(Math.round(((q.price/item.crop.basePrice)-1)*12),-8,8):0;return {...item,score:clamp(item.score+marketAdjustment,5,98)}}).sort((a,b)=>b.score-a.score);
      send(res,200,{season,recommendations,quotes:market.quotes,live:market.live,message:market.message,profileSummary:{district:profile.district,state:profile.state||null,soil:profile.soil,previousCrops:profile.previousCrops||[]}});return;
    }
    if(req.method==='POST'&&path==='/api/crop-validation'){
      const body=await readJson(req);const crop=CROPS.find(c=>c.id===body.cropId);if(!crop)throw Object.assign(new Error('Choose a valid crop.'),{status:400});
      const row=await profileFor(token,uid,'farm_profile,onboarded');if(!row?.farm_profile||!row.onboarded)throw Object.assign(new Error('Complete your farm profile first.'),{status:400});
      const result=scoreCrops(row.farm_profile,seasonNow()).find(x=>x.crop.id===crop.id);
      const commodity=crop.id==='soybean'?'Soyabean':crop.name;const market=row.farm_profile.district?await mandi([commodity],row.farm_profile.district,row.farm_profile.state):{quotes:[],live:false};const quote=market.quotes[0];
      const adjustment=quote?.price?clamp(Math.round(((quote.price/crop.basePrice)-1)*12),-8,8):0;const score=clamp(result.score+adjustment,5,98);
      send(res,200,{...result,score,quote:quote||null,season:seasonNow(),valid:score>=55&&!result.warnings.some(w=>w.startsWith('Off-season'))});return;
    }
    if(req.method==='POST'&&path==='/api/mandi-prices'){
      const b=await readJson(req);if(typeof b.district!=='string'||b.district.trim().length<2)throw Object.assign(new Error('District is required.'),{status:400});const crops=Array.isArray(b.crops)?b.crops.slice(0,10):[];if(!crops.length)throw Object.assign(new Error('At least one crop is required.'),{status:400});send(res,200,await mandi(crops,b.district.trim(),b.state));return;
    }
    if(req.method==='POST'&&path==='/api/fertilizer-plan'){
      const row=await profileFor(token,uid);if(!row)throw Object.assign(new Error('Farm profile not found.'),{status:404});const p=row.farm_profile||{};const crop=CROPS.find(c=>c.id===row.active_crop_id)||CROPS[0];
      const stored=Array.isArray(row.tasks)?row.tasks:[];const done=new Map(stored.filter(t=>t&&t.done).map(t=>[String(t.id),t.done]));
      const tasks=fertilizerPlan(crop,p.soil||{}).map(t=>({...t,...(done.has(t.id)?{done:done.get(t.id)}:{})}));
      send(res,200,{cropId:crop.id,cropName:crop.name,durationDays:crop.durationDays,startedAt:p.cropStartedAt||new Date().toISOString(),tasks,advisory:'Planning estimates only. Confirm rates and products against a complete soil test and local KVK/Agriculture Department advice.'});return;
    }
    send(res,404,{error:'Route not found.'});
  }catch(e){send(res,e.status||500,{error:e.message||'Unexpected backend error.'});}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`KhetMitra API listening on ${PORT}`));
