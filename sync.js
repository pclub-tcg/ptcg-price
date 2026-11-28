/* 雲端同步：我的庫存、想要清單、庫存總值走勢。用 LINE 登入（atok，和市集、社群共用）後自動備份，換手機登入就會同步回來。
   做法：攔截 localStorage 寫入這三個 key → 1.5 秒後上傳；打開頁面時拉雲端版本，較新的就套用；第一次在這台裝置登入時，本機和雲端合併。 */
(function(){
  if(window.PCSync)return;
  var API="https://ptcg-line-bot.spickertop.workers.dev/api/",KEYS=["inv","dex_want","inv_hist"],LS=window.localStorage;
  if(!LS)return;
  var hm=location.hash.match(/(?:^#|&)t=([A-Za-z0-9_-]{20,64})/);if(hm){try{LS.setItem("atok",hm[1])}catch(e){}} /* 從 LINE 登入連結來的 */
  var raw=Storage.prototype.setItem,applying=false,T={},ST={s:"",msg:""},lastPull=0;
  function tok(){try{return LS.getItem("atok")||""}catch(e){return""}}
  function meta(){try{return JSON.parse(LS.getItem("sync_meta")||"{}")||{}}catch(e){return{}}}
  function setMeta(m){try{raw.call(LS,"sync_meta",JSON.stringify(m))}catch(e){}}
  function parse(s,d){try{var v=JSON.parse(s);return v==null?d:v}catch(e){return d}}
  function put(k,v){applying=true;try{LS.setItem(k,v)}catch(e){}applying=false}
  Storage.prototype.setItem=function(k,v){raw.call(this,k,v);if(this===LS&&!applying&&KEYS.indexOf(k)>=0){var m=meta();m[k]=Object.assign({},m[k],{dirty:1,lt:Date.now()});setMeta(m);later(k)}};
  function later(k){if(!tok())return;clearTimeout(T[k]);T[k]=setTimeout(function(){push(k)},1500)}
  function push(k){var v=LS.getItem(k);if(v==null||!tok())return;var m=meta(),at=(m[k]&&m[k].lt)||Date.now();
    fetch(API+"u/put",{method:"POST",headers:{"x-tok":tok(),"content-type":"application/json"},body:JSON.stringify({k:k,v:v,at:at})}).then(function(r){return r.json()}).then(function(j){
      if(j.ok){var m=meta();m[k]={at:j.at,dirty:0,lt:j.at};setMeta(m);set("ok")}else if(j.stale)pull(true);else if(j.login)set("login");else set("err",j.err)}).catch(function(){set("off")})}
  /* 合併：庫存同一張卡（k）留本機那筆，雲端多的補進來；想要清單取聯集；走勢以日期合併 */
  function merge(k,a,b){
    if(k==="inv"){a=Array.isArray(a)?a:[];b=Array.isArray(b)?b:[];var seen={},out=a.slice();a.forEach(function(e){seen[e.k+"|"+(e.at||"")]=1});b.forEach(function(e){if(!seen[e.k+"|"+(e.at||"")])out.push(e)});return out}
    if(k==="dex_want"){a=Array.isArray(a)?a:[];b=Array.isArray(b)?b:[];return a.concat(b.filter(function(x){return a.indexOf(x)<0}))}
    return Object.assign({},b||{},a||{})}
  function pull(force){if(!tok())return set("login");if(!force&&Date.now()-lastPull<60e3)return;lastPull=Date.now();
    fetch(API+"u/get",{headers:{"x-tok":tok()}}).then(function(r){return r.json()}).then(function(j){
      if(j.login){set("login");return}if(!j.data){set("err",j.err);return}
      ST.name=j.name||"";var changed=false;
      KEYS.forEach(function(k){var r=j.data[k],m=meta()[k],loc=LS.getItem(k);
        if(!r){if(loc!=null&&loc!=="[]"&&loc!=="{}")push(k);return}
        if(!m||!m.at){ /* 這台第一次同步：合併 */
          var mg=JSON.stringify(merge(k,parse(loc,null),parse(r.v,null)));
          if(mg!==loc){put(k,mg);changed=true}
          var mm=meta();if(mg!==r.v){mm[k]={at:r.at,dirty:1,lt:Date.now()};setMeta(mm);push(k)}else{mm[k]={at:r.at,dirty:0,lt:r.at};setMeta(mm)}
        }else if(m.dirty){ /* 本機有還沒上傳的改動 */
          if(r.at>m.at){var mg2=JSON.stringify(merge(k,parse(loc,null),parse(r.v,null)));put(k,mg2);changed=true;var m2=meta();m2[k]={at:r.at,dirty:1,lt:Date.now()};setMeta(m2)}
          push(k)
        }else if(r.at>m.at){put(k,r.v);changed=true;var m3=meta();m3[k]={at:r.at,dirty:0,lt:r.at};setMeta(m3)}
      });
      set("ok");
      if(changed){try{window.INV&&INV.reload&&INV.reload()}catch(e){}try{window.dispatchEvent(new Event("pcsync"))}catch(e){}}
    }).catch(function(){set("off")})}
  function set(s,msg){ST.s=s;ST.msg=msg||"";render()}
  function render(){var el=document.getElementById("inv-sync");if(!el)return;
    var L="https://line.me/R/oaMessage/@916ctmro/?"+encodeURIComponent("登入");
    el.innerHTML=!tok()||ST.s==="login"?'☁️ <b>還沒有雲端備份</b>：資料只存在這台裝置。<a href="'+L+'" target="_blank" rel="noopener" style="color:var(--brand);font-weight:800">用 LINE 登入</a>後會自動備份，換手機也找得回來。'
      :ST.s==="ok"?'☁️ 已自動備份到雲端'+(ST.name?'（'+ST.name.replace(/[<>&"]/g,"")+'）':'')+'，換手機用 LINE 登入就會同步回來。'
      :ST.s==="off"?'☁️ 目前連不上雲端，改動會先存在這台裝置，連上網路後自動備份。'
      :ST.s==="err"?'☁️ 雲端備份失敗：'+String(ST.msg||"").replace(/[<>&"]/g,""):'☁️ 同步中…'}
  window.PCSync={pull:function(){pull(true)},render:render,state:ST};
  document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")pull()});
  if(tok())pull(true);else set("login");
})();
