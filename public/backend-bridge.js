/* Backend bridge for the existing Compliance OS UI. */
(function(){
  const KEY='compliance_os_token';
  const cfg=window.COMPLIANCE_OS_CONFIG||{};
  const API_BASE=String(cfg.API_BASE_URL||window.COMPLIANCE_OS_API_URL||'').replace(/\/$/,'');
  const url=p=>API_BASE+(p.startsWith('/')?p:'/'+p);
  const api=async(path,opts={})=>{
    const token=localStorage.getItem(KEY);
    const headers={...(opts.headers||{})};
    if(!(opts.body instanceof FormData)) headers['Content-Type']='application/json';
    if(token) headers.Authorization='Bearer '+token;
    const r=await fetch(url(path),{...opts,headers});
    if(r.status===401){localStorage.removeItem(KEY);throw new Error('Session expired. Please sign in again.');}
    if(r.status===204)return null;
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.error||'Request failed');
    return data;
  };
  const authHeaders=()=>{const t=localStorage.getItem(KEY);return t?{Authorization:'Bearer '+t}:{}};
  const docsWrap=(rows)=>({docs:(rows||[]).map(x=>({id:String(x.id),data:()=>({...x})}))});
  const legacyCollection=(name)=>({
    get:async()=>{
      if(name==='quiz_scores') return docsWrap((await api('/api/legacy/quiz-scores')).docs);
      if(name==='kb_files') return docsWrap((await api('/api/kb/files')).docs);
      if(name==='kb_overrides') return docsWrap((await api('/api/kb/overrides')).docs);
      if(name==='kb_queries') return docsWrap((await api('/api/kb/queries')).docs);
      const m=name.match(/^kb_queries\/([^/]+)\/answers$/);
      if(m) return docsWrap((await api('/api/kb/queries/'+encodeURIComponent(m[1])+'/answers')).docs);
      throw new Error('Unsupported collection: '+name);
    },
    doc:(id)=>({
      get:async()=>{
        const m=name.match(/^kb_queries\/([^/]+)\/answers$/);
        if(m){const d=await api('/api/kb/queries/'+encodeURIComponent(m[1])+'/answers/'+encodeURIComponent(id));return {id:String(id),data:()=>d};}
        const list=await legacyCollection(name).get(); const d=list.docs.find(x=>x.id===String(id));
        return d||{id:String(id),data:()=>({})};
      },
      set:async(value)=>{
        if(name==='quiz_scores') return api('/api/legacy/quiz-scores/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify(value)});
        if(name==='kb_files') return api('/api/kb/files/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify(value)});
        if(name==='kb_overrides') return api('/api/kb/overrides/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify(value)});
        if(name==='kb_queries') return api('/api/kb/queries/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify(value)});
        const m=name.match(/^kb_queries\/([^/]+)\/answers$/); if(m) return api('/api/kb/queries/'+encodeURIComponent(m[1])+'/answers',{method:'POST',body:JSON.stringify({...value,id})});
        throw new Error('Unsupported collection: '+name);
      },
      update:async(value)=>{
        if(name==='kb_queries'){
          const current=(await legacyCollection(name).get()).docs.find(x=>x.id===String(id));
          return api('/api/kb/queries/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({...((current&&current.data())||{}),...value})});
        }
        throw new Error('Update is not supported for '+name);
      },
      delete:async()=>{
        if(name==='kb_files') return api('/api/kb/files/'+encodeURIComponent(id),{method:'DELETE'});
        if(name==='kb_overrides') return api('/api/kb/overrides/'+encodeURIComponent(id),{method:'DELETE'});
        if(name==='kb_queries') return api('/api/kb/queries/'+encodeURIComponent(id),{method:'DELETE'});
        const m=name.match(/^kb_queries\/([^/]+)\/answers$/); if(m) return api('/api/kb/queries/'+encodeURIComponent(m[1])+'/answers/'+encodeURIComponent(id),{method:'DELETE'});
        throw new Error('Delete is not supported for '+name);
      }
    }),
    add:async(value)=>{
      const m=name.match(/^kb_queries\/([^/]+)\/answers$/);
      if(!m) throw new Error('Add is only supported for query answers');
      const r=await api('/api/kb/queries/'+encodeURIComponent(m[1])+'/answers',{method:'POST',body:JSON.stringify(value)}); return {id:r.id};
    }
  });
  const legacyUser={
    id:async()=>{const d=await api('/api/auth/me');return d.user.id},
    profiles:async(ids)=>api('/api/users/profiles?ids='+ids.map(encodeURIComponent).join(','))
  };
  const legacyAssets={
    upload:async(file)=>{const f=new FormData();f.append('file',file,file.name||'upload');return api('/api/assets',{method:'POST',body:f})},
    delete:async(id)=>api('/api/assets/'+encodeURIComponent(id),{method:'DELETE'})
  };
  const legacyDownloads={save:async({filename,data})=>{const blob=new Blob([data],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000)}};
  window.claude=window.claude||{use:async(kind)=>{if(kind==='db')return{collection:legacyCollection};if(kind==='assets')return legacyAssets;if(kind==='user')return legacyUser;if(kind==='downloads')return legacyDownloads;throw new Error('Unsupported storage service: '+kind)}};
  window.ComplianceOSAPI={
    baseUrl:API_BASE,
    assetFetch:async(id)=>{const r=await fetch(url('/api/assets/'+encodeURIComponent(id)+'/raw'),{headers:authHeaders()});if(!r.ok)throw new Error('Could not load asset');return r;},
    openAsset:async(id)=>{const r=await window.ComplianceOSAPI.assetFetch(id);const b=await r.blob();const u=URL.createObjectURL(b);window.open(u,'_blank');setTimeout(()=>URL.revokeObjectURL(u),60000)},
    api,
    login:async(email,password)=>{const d=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email,password})});localStorage.setItem(KEY,d.token);return d},
    logout:()=>localStorage.removeItem(KEY),
    me:()=>api('/api/auth/me'),
    users:{list:()=>api('/api/users'),create:x=>api('/api/users',{method:'POST',body:JSON.stringify(x)})},
    tickets:{list:(q='')=>api('/api/tickets'+q),create:x=>api('/api/tickets',{method:'POST',body:JSON.stringify(x)}),update:(id,x)=>api('/api/tickets/'+id,{method:'PATCH',body:JSON.stringify(x)})},
    ubos:{list:(exporterId)=>api('/api/ubos'+(exporterId?'?exporterId='+encodeURIComponent(exporterId):'')),create:x=>api('/api/ubos',{method:'POST',body:JSON.stringify(x)}),update:(id,x)=>api('/api/ubos/'+id,{method:'PATCH',body:JSON.stringify(x)})},
    documents:{list:(params='')=>api('/api/documents'+params),upload:(form)=>api('/api/documents',{method:'POST',body:form}),download:(id)=>url('/api/documents/'+id+'/download')},
    saved:{list:()=>api('/api/saved-items'),upsert:x=>api('/api/saved-items',{method:'POST',body:JSON.stringify(x)}),remove:id=>api('/api/saved-items/'+id,{method:'DELETE'})},
    quiz:{submit:x=>api('/api/quiz/attempts',{method:'POST',body:JSON.stringify(x)}),list:()=>api('/api/quiz/attempts')},
    audit:{list:()=>api('/api/audit')},
    integrations:{list:()=>api('/api/integrations')},
    health:()=>api('/api/health')
  };
  function mount(){
    if(document.getElementById('cos-backend-bar'))return;
    const bar=document.createElement('div');bar.id='cos-backend-bar';bar.innerHTML='<span id="cos-status">Backend: checking…</span><button id="cos-login">Sign in</button><button id="cos-logout" style="display:none">Sign out</button>';
    Object.assign(bar.style,{position:'fixed',right:'16px',bottom:'16px',zIndex:99999,padding:'10px 12px',borderRadius:'12px',background:'#111827',color:'#fff',font:'13px system-ui',boxShadow:'0 8px 30px rgba(0,0,0,.25)'});
    document.body.appendChild(bar);
    const status=document.getElementById('cos-status'),loginBtn=document.getElementById('cos-login'),logoutBtn=document.getElementById('cos-logout');
    const check=async()=>{try{const d=await window.ComplianceOSAPI.me();status.textContent='Backend: '+d.user.name+' ('+d.user.role+')';loginBtn.style.display='none';logoutBtn.style.display='inline-block'}catch{status.textContent=API_BASE?'Backend: ready':'Backend URL not configured';loginBtn.style.display='inline-block';logoutBtn.style.display='none'}};
    loginBtn.onclick=async()=>{const email=prompt('Compliance OS email');if(!email)return;const password=prompt('Password');if(!password)return;try{await window.ComplianceOSAPI.login(email,password);await check();alert('Signed in successfully.')}catch(e){alert(e.message)}};
    logoutBtn.onclick=()=>{window.ComplianceOSAPI.logout();check()};check();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
