import http from 'node:http';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {scryptSync,randomBytes,timingSafeEqual,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {initial,validateAction,validateRequest,simulate,settle,chat,applyChat,applyOffice,applyArmy,applyRivalAction,applyPolicy,applyAssignment,applyExam,initialFactions,testAiConnectivity,fail,policies,officeDuties,eventForSeason,triggeredEvent,techTree,civicTree,TOKEN_BUDGET,TURN_TOKEN_COST,CHAT_TOKEN_COST,armyCatalog} from './engine.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const MIME={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',json:'application/json; charset=utf-8',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',svg:'image/svg+xml',ico:'image/x-icon',txt:'text/plain; charset=utf-8',woff2:'font/woff2'};
const CSP="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'";

export async function createGameServer({env=process.env,dataDir=path.join(root,'data'),fetcher=fetch,requireAuth=env.AUTH==='1'}={}){
  const savesDir=path.join(dataDir,'saves');
  await mkdir(savesDir,{recursive:true});
  const usersFile=path.join(dataDir,'users.json');
  let users={};
  try{users=JSON.parse(await readFile(usersFile,'utf8'))}catch{users={}}
  const saveUsers=async()=>{await writeFile(usersFile+'.tmp',JSON.stringify(users),'utf8');await rename(usersFile+'.tmp',usersFile)};
  const sessionsFile=path.join(dataDir,'sessions.json');
  const sessions=new Map();
  try{for(const [k,v] of Object.entries(JSON.parse(await readFile(sessionsFile,'utf8'))))sessions.set(k,v)}catch{}
  const saveSessions=async()=>{await writeFile(sessionsFile+'.tmp',JSON.stringify(Object.fromEntries(sessions)),'utf8');await rename(sessionsFile+'.tmp',sessionsFile)};
  const states=new Map();
  const busy=new Set();
  const hashPw=pw=>{const salt=randomBytes(16).toString('hex');return{salt,hash:scryptSync(pw,salt,64).toString('hex')}};
  const verifyPw=(pw,salt,hash)=>{try{return timingSafeEqual(Buffer.from(hash,'hex'),scryptSync(pw,salt,64))}catch{return false}};
  const loadState=async uid=>{
    if(!states.has(uid)){
      let st;
      try{st=JSON.parse(await readFile(path.join(savesDir,uid+'.json'),'utf8'))}catch{st=initial()}
      if(!Array.isArray(st.activePolicies))st.activePolicies=[];
      if(!Array.isArray(st.assignments))st.assignments=[];
      if(!st.exam)st.exam={nextTurn:4,candidates:[],recruited:[],heldTurn:null};
      if(!Array.isArray(st.exam.candidates))st.exam.candidates=[];
      if(!Array.isArray(st.exam.recruited))st.exam.recruited=[];
      if(!Array.isArray(st.factions))st.factions=initialFactions(st.ministers);
      states.set(uid,st);
    }
    return states.get(uid);
  };
  const persist=async(uid,next)=>{states.set(uid,next);const f=path.join(savesDir,uid+'.json');await writeFile(f+'.tmp',JSON.stringify(next),'utf8');await rename(f+'.tmp',f)};
  const aiEnvFor=uid=>{const isLocal=uid==='local';const cfg=(uid&&!isLocal&&users[uid]?.aiConfig)||{};return{DEEPSEEK_API_KEY:cfg.apiKey||(isLocal?env.DEEPSEEK_API_KEY:''),DEEPSEEK_MODEL:cfg.model||env.DEEPSEEK_MODEL||'deepseek-v4-pro',DEEPSEEK_BASE_URL:(cfg.baseUrl||'').replace(/\/+$/,'')||env.DEEPSEEK_BASE_URL||'https://napi.t.e0b.cc/v1',_own:!!cfg.apiKey,_verified:!!(cfg.apiKey&&cfg.verified)}};
  const aiReady=uid=>{const e=aiEnvFor(uid);return !!(e.DEEPSEEK_API_KEY&&(uid==='local'||e._verified))};
  const publicState=(state,aiEnv=env)=>{const ev=eventForSeason(state),tr=triggeredEvent(state);return{state,armyCatalog,aiConfigured:!!(aiEnv&&aiEnv.DEEPSEEK_API_KEY),aiVerified:!!(aiEnv&&aiEnv._verified),aiModel:(aiEnv&&aiEnv.DEEPSEEK_MODEL)||null,hasOwnAi:!!(aiEnv&&aiEnv._own),authRequired:requireAuth,policies:policies.map(p=>p.label),policyOptions:policies,duties:officeDuties,techTree,civicTree,event:ev?{id:ev.id,year:ev.year,title:ev.title,text:ev.text,choices:(ev.choices||[]).map(c=>c.label)}:null,triggerEvent:tr?{id:tr.id,title:tr.title,text:tr.text,choices:(tr.choices||[]).map(c=>c.label)}:null}};
  const readJson=async req=>{
    if(!req.headers['content-type']?.startsWith('application/json'))fail('需要 JSON 请求。',415);
    let raw='';for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>16384)fail('请求过长。',413)}
    try{return JSON.parse(raw)}catch{fail('无效 JSON。',400)}
  };
  return http.createServer(async(req,res)=>{
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))};
    try{
      const route=new URL(req.url,'http://localhost').pathname;
      if(req.method==='POST'&&req.headers.origin){
        const host=req.headers.host||'';
        if(req.headers.origin!=='http://'+host&&req.headers.origin!=='https://'+host)fail('不接受跨站请求。',403);
      }
      const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
      const uid=requireAuth?sessions.get(token):'local';
      const aiEnv=aiEnvFor(uid);

      if(req.method==='GET'&&route!=='/api/game'){
        const rel=route==='/'?'index.html':route.slice(1);
        const ext=rel.includes('.')?rel.split('.').pop().toLowerCase():'';
        if(MIME[ext]){
          const resolved=path.resolve(root,'dist',rel);
          const distRoot=path.resolve(root,'dist');
          if(resolved===distRoot||resolved.startsWith(distRoot+path.sep)){
            try{const body=await readFile(resolved);res.writeHead(200,{'Content-Type':MIME[ext],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':CSP});return res.end(body)}
            catch{return send(404,{error:'未找到资源。'})}
          }
        }
        return send(404,{error:'未找到页面。'});
      }

      if(req.method==='GET'&&route==='/api/game'){
        if(requireAuth&&!uid)return send(401,{error:'请先登录。'});
        return send(200,publicState(await loadState(uid),aiEnv));
      }

      if(req.method==='POST'&&(route==='/api/signup'||route==='/api/login')){
        const a=await readJson(req);
        const username=String(a.username||'').trim();
        const password=String(a.password||'');
        if(!/^[\w\u4e00-\u9fa5]{2,20}$/.test(username))fail('用户名需为 2—20 位字母、数字、下划线或中文。',400);
        if(password.length<6||password.length>64)fail('密码需为 6—64 位。',400);
        let user=Object.values(users).find(u=>u.username===username);
        if(route==='/api/signup'){
          if(user)fail('该用户名已被注册。',409);
          user={id:randomUUID(),username,...hashPw(password),aiConfig:{}};
          users[user.id]=user;
          await saveUsers();
        }else{
          if(!user||!verifyPw(password,user.salt,user.hash))fail('用户名或密码错误。',401);
        }
        const t=randomBytes(24).toString('hex');
        sessions.set(t,user.id);await saveSessions();
        return send(200,{token:t,...publicState(await loadState(user.id),aiEnvFor(user.id))});
      }

      if(req.method==='POST'&&route==='/api/aiconfig'){
        if(requireAuth&&!uid)return send(401,{error:'请先登录。'});
        const a=await readJson(req);
        if(uid!=='local'){const u=users[uid];if(u){u.aiConfig={apiKey:String(a.apiKey||'').trim(),model:String(a.model||'').trim(),baseUrl:String(a.baseUrl||'').trim().replace(/\/+$/,''),verified:false};await saveUsers();}}
        return send(200,publicState(await loadState(uid),aiEnvFor(uid)));
      }

      if(req.method==='POST'&&route==='/api/aitest'){
        if(requireAuth&&!uid)return send(401,{error:'请先登录。'});
        const a=await readJson(req);
        const cfg={apiKey:String(a.apiKey||'').trim(),model:String(a.model||'').trim(),baseUrl:String(a.baseUrl||'').trim().replace(/\/+$/,'')};
        const testEnv={DEEPSEEK_API_KEY:cfg.apiKey,DEEPSEEK_MODEL:cfg.model||env.DEEPSEEK_MODEL||'deepseek-v4-pro',DEEPSEEK_BASE_URL:cfg.baseUrl||env.DEEPSEEK_BASE_URL||'https://napi.t.e0b.cc/v1'};
        const result=await testAiConnectivity(testEnv,fetcher);
        if(result.ok&&uid!=='local'){const u=users[uid];if(u){u.aiConfig={...cfg,verified:true};await saveUsers();}}
        return send(200,result);
      }

      if(req.method==='POST'&&route==='/api/admin'){
        if(!env.ADMIN_KEY)fail('未启用管理功能。',403);
        const a=await readJson(req);
        if(a.adminKey!==env.ADMIN_KEY)fail('管理密钥错误。',403);
        const list=[];
        for(const u of Object.values(users)){
          let st=null;
          try{st=JSON.parse(await readFile(path.join(savesDir,u.id+'.json'),'utf8'))}catch{st=initial()}
          list.push({id:u.id,username:u.username,turn:st.turn,year:1628+Math.floor(st.turn/4),ending:st.ending,stats:st.stats,privy:st.privy,hasAi:!!(u.aiConfig&&u.aiConfig.apiKey),decisions:(st.log||[]).map(e=>({year:e.year,season:e.season,decree:e.decree,mode:e.mode}))});
        }
        list.sort((a,b)=>b.turn-a.turn);
        return send(200,{users:list});
      }

      if(req.method==='POST'&&['/api/turn','/api/reset','/api/chat','/api/office','/api/army','/api/rival','/api/policy','/api/assignment','/api/exam','/api/logout'].includes(route)){
        if(requireAuth&&!uid)return send(401,{error:'请先登录。'});
        if(route==='/api/logout'){if(token){sessions.delete(token);await saveSessions()}return send(200,{ok:true})}
        const a=await readJson(req);
        const state=await loadState(uid);
        if(busy.has(uid))fail('当前奏折正在推演，请稍后重试。',409);busy.add(uid);
        try{
          if(route==='/api/reset'){if(a.gameId!==state.id||a.revision!==state.revision)fail('存档已更新，请刷新。',409);const ni=initial();ni.tokensUsed=state.tokensUsed||0;await persist(uid,ni);}
          else if(route==='/api/turn'){
            if(!aiReady(uid))fail('请先配置并测试你自己的 AI 模型，通过连通性测试后方可游玩。',403);
            if((state.tokensUsed||0)+TURN_TOKEN_COST>TOKEN_BUDGET)fail('本局 AI 推演额度已用完。',429);
            if(validateAction(state,a)){const result=await simulate(state,a,aiEnv,fetcher);const next=settle(state,a,result);if(a.mode==='ai')next.tokensUsed=(state.tokensUsed||0)+TURN_TOKEN_COST;await persist(uid,next);}
          }
          else if(route==='/api/chat'){
            if(!aiReady(uid))fail('请先配置并测试你自己的 AI 模型，通过连通性测试后方可游玩。',403);
            if((state.tokensUsed||0)+CHAT_TOKEN_COST>TOKEN_BUDGET)fail('本局 AI 推演额度已用完。',429);
            if(validateRequest(state,a)){const r=await chat(state,a.ministerId,a.message,aiEnv,fetcher);const next=applyChat(state,a,r);if(aiEnv.DEEPSEEK_API_KEY)next.tokensUsed=(state.tokensUsed||0)+CHAT_TOKEN_COST;await persist(uid,next);return send(200,{...publicState(next,aiEnv),reply:r.reply,relationDelta:r.relationDelta,loyaltyDelta:r.loyaltyDelta});}
          }
          else if(route==='/api/office'){if(validateRequest(state,a))await persist(uid,applyOffice(state,a));}
          else if(route==='/api/army'){if(validateRequest(state,a))await persist(uid,applyArmy(state,a));}
          else if(route==='/api/rival'){if(validateRequest(state,a))await persist(uid,applyRivalAction(state,a));}
          else if(route==='/api/policy'){if(validateRequest(state,a))await persist(uid,applyPolicy(state,a));}
          else if(route==='/api/assignment'){if(validateRequest(state,a))await persist(uid,applyAssignment(state,a));}
          else if(route==='/api/exam'){if(validateRequest(state,a))await persist(uid,applyExam(state,a));}
          return send(200,publicState(states.get(uid),aiEnv));
        }finally{busy.delete(uid)}
      }

      send(404,{error:'未找到页面。'});
    }catch(e){send(e.status||500,{error:e.status?e.message:'存档操作失败，本次未确认结算，请刷新检查。'})}
  });
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const server=await createGameServer();
  const host=process.env.HOST||'127.0.0.1';
  server.listen(Number(process.env.PORT||3210),host,()=>console.log(`大明余烬：http://${host}:${server.address().port}`));
}
