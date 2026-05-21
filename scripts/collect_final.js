// Final CDP work hours collection - simplified & robust
const http=require('http'),fs=require('fs');
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

function parseTooltip(t){
  if(!t)return{report:'',tasks:[],totalPlanH:0,totalActH:0,actDays:0,_empty:true};
  const rm=t.match(/项目周报[：:]\s*(.+?)(?:任务明细|$)/),report=rm?rm[1].trim():'';
  const tasks=[],ti=t.indexOf('任务明细');
  if(ti<0)return{report,tasks,totalPlanH:0,totalActH:0,actDays:0};
  let d=t.substring(ti),he=d.indexOf('期望交付日期');
  if(he>=0)d=d.substring(he+6);
  const ms=[...d.matchAll(/([A-Z]{2,}-\d+)/g)];
  for(let i=0;i<ms.length;i++){
    const jira=ms[i][1],start=ms[i].index;
    const end=i+1<ms.length?ms[i+1].index:d.length,chunk=d.substring(start,end);
    const pe=chunk.indexOf(jira),proj=chunk.substring(0,pe),rest=chunk.substring(pe+jira.length);
    const dates=[...rest.matchAll(/\d{4}-\d{2}-\d{2}/g)];
    let pH=0,aH=0;
    if(dates.length>=3){
      const pp=dates[1].index+10,pe2=dates[2].index;if(pe2>pp){const v=parseFloat(rest.substring(pp,pe2));if(!isNaN(v))pH=v;}
      const ap=(dates.length>=4?dates[3].index:dates[2].index)+10;
      const ae=dates.length>=5?dates[4].index:rest.length;if(ae>ap){const v=parseFloat(rest.substring(ap,ae));if(!isNaN(v))aH=v;}
    }
    let sub='',type='',status='';
    if(dates.length>0){const bf=rest.substring(0,dates[0].index),sm=bf.match(/(已完成|进行中|未开始|已关闭|已取消|待评审|待确认)/);
      if(sm){status=sm[1];const bs=bf.substring(0,sm.index),tm=bs.match(/([一-龥]{2,})$/);if(tm){type=tm[1];sub=bs.substring(0,bs.length-type.length)}else sub=bs}else sub=bf}
    tasks.push({proj,jira,subject:sub,type,status,planS:dates[0]?.[0]||'',planE:dates[1]?.[0]||'',planH:+pH.toFixed(2),actS:dates[2]?.[0]||'',actE:dates[3]?.[0]||'',actH:+aH.toFixed(2),delivery:dates.length>=5?dates[4][0]:(dates.length>=4?dates[3][0]:'')});
  }
  return{report,tasks,totalPlanH:+tasks.reduce((s,t)=>s+t.planH,0).toFixed(2),totalActH:+tasks.reduce((s,t)=>s+t.actH,0).toFixed(2),actDays:+(tasks.reduce((s,t)=>s+t.actH,0)/8).toFixed(2)};
}

async function gp(){return new Promise((r,j)=>{http.get('http://localhost:9222/json',res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>r(JSON.parse(d)))}).on('error',j)})}

async function main(){
  const pages=await gp();
  const page=pages.find(p=>p.type==='page'&&p.url.includes('fingard'));
  if(!page){console.log('Page not found');return;}
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  const pmap=new Map();let mid=0;
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pmap.has(m.id)){pmap.get(m.id)(m.result);pmap.delete(m.id)}};
  const S=(method,params={})=>new Promise(r=>{const id=++mid;pmap.set(id,r);ws.send(JSON.stringify({id,method,params}))});
  const E=(c)=>S('Runtime.evaluate',{expression:c,returnByValue:true});
  const EF=(c)=>E('(function(){'+c+'})()');

  // Click helper: activate Chrome, find element, CDP-click
  async function click(findCode,label){
    activate();await sleep(300);
    let r=await EF(findCode);
    const raw=r.result?.value||'{}',pos=JSON.parse(raw);
    if(pos.err||!pos.x){console.log('  click['+label+'] fail:',raw);return false;}
    console.log('  click['+label+'] at',pos.x+','+pos.y);
    await S('Input.dispatchMouseEvent',{type:'mouseMoved',x:pos.x,y:pos.y,modifiers:0});await sleep(200);
    await S('Input.dispatchMouseEvent',{type:'mousePressed',x:pos.x,y:pos.y,button:'left',clickCount:1,modifiers:0});
    await S('Input.dispatchMouseEvent',{type:'mouseReleased',x:pos.x,y:pos.y,button:'left',clickCount:1,modifiers:0});
    await sleep(500);
    return true;
  }

// Bring Chrome to front
function activate(){try{require('child_process').spawnSync('osascript',['-e','tell application \"Google Chrome\" to activate'],{timeout:3000})}catch(e){}}

  await new Promise(r=>ws.onopen=r);
  await S('Page.enable');await S('Runtime.enable');await S('Input.enable');
  console.log('Connected');

  // Use current page state - verify we are on workTime/check
  let verify=await E('location.href');
  console.log('URL:',(verify.result?.value||'').substring(0,80));
  verify=await E('document.querySelectorAll(".ant-select").length');
  console.log('Selects:',verify.result?.value);
  if(parseInt(verify.result?.value||'0')<3){console.log('Not on workTime page, navigating...');await S('Page.navigate',{url:'https://proj.fingard.com:1888/workTime/check'});await sleep(8000);for(let i=0;i<30;i++){await sleep(1000);let rr=await E('document.querySelectorAll(".ant-select").length');if(parseInt(rr.result?.value||'0')>=3)break;}}

  // Debug: check page state before clicking
  let dr=await E('JSON.stringify({url:location.href,selects:document.querySelectorAll(".ant-select").length,sel0text:document.querySelectorAll(".ant-select")[1]?document.querySelectorAll(".ant-select")[1].textContent.trim().substring(0,50):"none",hasSelector:document.querySelectorAll(".ant-select")[1]?!!document.querySelectorAll(".ant-select")[1].querySelector(".ant-select-selector"):false})');
  console.log('Page state:',dr.result?.value);

  // Open dropdown - use a simpler finder
  const FIND_SEL='var s=document.querySelectorAll(".ant-select");for(var i=0;i<s.length;i++){var t=s[i].textContent.trim();if(/[0-9]{4}-[0-9]{2}-[0-9]{2}~[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(t)){var sel=s[i].querySelector(".ant-select-selector");if(sel){var r=sel.getBoundingClientRect();if(r.width>5)return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)})}}}return JSON.stringify({err:\"no\"})';
  await click(FIND_SEL,'select');
  // Poll for dropdown options
  for(let i=0;i<10;i++){await sleep(500);let rr=await E('document.querySelectorAll(".ant-select-item-option-content").length');if(parseInt(rr.result?.value||'0')>0){console.log('  dropdown appeared');break;}}

  // Get weeks
  let r=await EF('return JSON.stringify(Array.from(document.querySelectorAll(".ant-select-item-option-content")).map(function(o){return o.textContent.trim()}))');
  const allWeeks=JSON.parse(r.result?.value||'[]');
  console.log('Weeks:',allWeeks.join(', '));
  const pendingWeeks=allWeeks.filter(w=>w.includes('(待复核)'));
  console.log('Pending:',pendingWeeks.join(', ')+'\n');

  // Keep dropdown open - select first week directly from open dropdown
  const FIND_QUERY='var b=document.querySelectorAll("button");for(var i=0;i<b.length;i++){if(b[i].textContent.indexOf("查 询")>=0){var r=b[i].getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)})}}return JSON.stringify({err:"no"})';
  const allData=[];

  for(let wi=0;wi<pendingWeeks.length;wi++){
    const week=pendingWeeks[wi];
    console.log(week);

    // Select week: click select to reopen dropdown (skip for first: already open)
    if(wi>0){await click(FIND_SEL,'sel-open');await sleep(1500);}

    // Click week option (dropdown should be open). Scroll into view first.
    const weekCode='var o=document.querySelectorAll(".ant-select-item-option-content");for(var i=0;i<o.length;i++){if(o[i].textContent.trim()==="'+week+'"){o[i].scrollIntoView({block:"center"});var r=o[i].getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)})}}return JSON.stringify({err:"no"})';
    if(!(await click(weekCode,'week'))){console.log('  Skip - cannot select week');continue;}
    await sleep(1000);
    await click(FIND_QUERY,'query');await sleep(4000);

    // Check data
    r=await E('(document.querySelector("[class*=work-time-check]")||document.body).innerText');
    const text=r.result?.value||'';
    if(text.indexOf('暂无数据')>=0){console.log('  No data');continue;}

    const pm=text.match(/(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})/);
    const dateRange=pm?pm[0].replace(/\(.*\)/,''):'';
    const ym=pm?pm[1].substring(0,7):'';
    const dhm=text.match(/((?:\d{2}月\d{2}日\s*)+)/);
    const dates=[];if(dhm){const dr=/(\d{2})月(\d{2})日/g;let m;while((m=dr.exec(dhm[1]))!==null)dates.push(ym+'-'+m[2]);}
    console.log('  Date:',dateRange);

    // Scroll table to load all rows (Ant Design virtual scrolling)
    await EF('var tb=document.querySelector(".ant-table-body")||document.querySelector(".ant-table-container");if(tb){tb.scrollTop=0;var h=tb.scrollHeight;for(var s=0;s<h;s+=200){tb.scrollTop=s}}');
    await sleep(1500);
    // Parse table
    r=await E('JSON.stringify(Array.from(document.querySelectorAll(".ant-table-row")).map(function(row){return Array.from(row.querySelectorAll("td")).map(function(c){return c.textContent.trim().substring(0,50)})}))');
    const rows=JSON.parse(r.result?.value||'[]');
    const groups={};let cp='',cn='',cs='';const persons=[];
    for(const cells of rows){
      if(cells.length<4)continue;
      if(cells[3]&&/^QJ_PRJ_/.test(cells[3])){cp=cells[3];cn=cells[4]||'';cs=cells[5]||'';const k=cp+'|'+cs;if(!groups[k])groups[k]={project:cp,projectName:cn,subProduct:cs};continue;}
      const nc=cells.find(c=>/^\d{4}-[^\d\s]{2,}$/.test(c));
      const rc=cells.find(c=>/^(研发|测试|需求)$/.test(c));
      if(nc&&rc&&cp){const k=cp+'|'+cs;if(!groups[k])continue;
        const vi=cells.findIndex(c=>c==='查看');const total=vi>0?(parseFloat(cells[vi+1])||0):0;
        const hours=cells.slice(vi+1,vi+8).map(v=>parseFloat(v)||0);while(hours.length<7)hours.push(0);
        persons.push({name:nc,role:rc,status:cells[1]||'',timestamp:cells[2]||'',total,hours,pk:k});}
    }
    console.log('  Persons:',persons.length);

    // Filter
    const targets=persons.filter(p=>p.status==='研发负责人已确认');
    console.log('  Targets:',targets.length);

    // Build unique person list to hover (filter + dedup)
    const toHover=[];
    const hoveredKeys=new Set();
    for(const p of persons){
      if(p.status!=='研发负责人已确认')continue;
      const key=p.name+'|'+p.pk;
      if(hoveredKeys.has(key))continue;
      hoveredKeys.add(key);
      toHover.push(p);
    }
    console.log('  To hover:',toHover.length);
    let hoverCount=0;
    for(const person of toHover){
      const name=person.name;
      const pk=person.pk;

      // Dismiss: move CDP mouse far away
      if(hoverCount>0){
        await S('Input.dispatchMouseEvent',{type:'mouseMoved',x:10,y:500,modifiers:0});
        await sleep(600);
      }
      hoverCount++;
      activate();await sleep(200);

      // Use a pre-defined finder function to locate the correct 查看 cell by name+total
      let r=await EF('var findCell=function(nm,tot){var tds=document.querySelectorAll("td");for(var i=0;i<tds.length;i++){if(tds[i].textContent.trim()!=="查看")continue;var row=tds[i].parentElement,cells=row?row.querySelectorAll("td"):[];var viewIdx=-1,rowName="";for(var j=0;j<cells.length;j++){if(cells[j].textContent.trim()==="查看")viewIdx=j;var t=cells[j].textContent.trim();if(/^[0-9]{4}-[^0-9\\s]{2,}$/.test(t))rowName=t}var rowTotal=viewIdx>=0&&viewIdx+1<cells.length?parseFloat(cells[viewIdx+1].textContent.trim()):-1;if(rowName===nm&&!isNaN(rowTotal)&&Math.abs(rowTotal-tot)<0.02)return tds[i]}return null};var cell=findCell("'+name+'",'+person.total+');if(!cell)return "not found";cell.scrollIntoView({block:"center"});return "ok"');
      await sleep(400);
      r=await EF('var findCell=function(nm,tot){var tds=document.querySelectorAll("td");for(var i=0;i<tds.length;i++){if(tds[i].textContent.trim()!=="查看")continue;var row=tds[i].parentElement,cells=row?row.querySelectorAll("td"):[];var viewIdx=-1,rowName="";for(var j=0;j<cells.length;j++){if(cells[j].textContent.trim()==="查看")viewIdx=j;var t=cells[j].textContent.trim();if(/^[0-9]{4}-[^0-9\\s]{2,}$/.test(t))rowName=t}var rowTotal=viewIdx>=0&&viewIdx+1<cells.length?parseFloat(cells[viewIdx+1].textContent.trim()):-1;if(rowName===nm&&!isNaN(rowTotal)&&Math.abs(rowTotal-tot)<0.02)return tds[i]}return null};var cell=findCell("'+name+'",'+person.total+');if(!cell)return JSON.stringify({err:"not found"});var rect=cell.getBoundingClientRect();return JSON.stringify({x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)})');
      const pos=JSON.parse(r.result?.value||'{}');
      if(pos.err){console.log('  '+name+'('+pk+'): pos error - '+JSON.stringify(pos));continue;}

      // CDP hover
      await S('Input.dispatchMouseEvent',{type:'mouseMoved',x:pos.x,y:pos.y,modifiers:0});
      await sleep(1800);

      // Scroll tooltip internal table to load ALL virtual rows before capture
      await EF('var tts=document.querySelectorAll(".ant-tooltip:not(.ant-tooltip-hidden)");for(var i=0;i<tts.length;i++){if(tts[i].textContent.indexOf("项目周报")>=0){var tb=tts[i].querySelector(".ant-table-body")||tts[i].querySelector("table");if(tb&&tb.scrollHeight>tb.clientHeight){tb.scrollTop=tb.scrollHeight;return "scrolled table"}}}return "no scroll"');
      await sleep(300);
      // Capture full tooltip text (no char limit)
      r=await EF('var tts=document.querySelectorAll(".ant-tooltip:not(.ant-tooltip-hidden)");for(var i=0;i<tts.length;i++){var t=tts[i].textContent.trim();if(t.indexOf("项目周报")>=0)return t}return""');
      const raw=r.result?.value||'';
      const tooltip=parseTooltip(raw);
      const group=groups[person.pk];
      const info=tooltip._empty?'EMPTY':((tooltip.report||'(empty)').substring(0,25)+(tooltip.tasks.length?' | '+tooltip.tasks.length+'t '+tooltip.totalActH+'h='+tooltip.actDays+'d':''));
      console.log('  '+person.name+': '+info);

      allData.push({
        name:person.name,role:person.role,status:person.status,timestamp:person.timestamp,
        project:group?group.project:'',projectName:group?group.projectName:'',subProduct:group?group.subProduct:'',
        total:person.total,hours:person.hours,_dateRange:dateRange,_dates:dates,_weekLabel:week,tooltipData:tooltip
      });
    }
  }

  // Deduplicate & save
  const seen=new Set();
  const unique=allData.filter(e=>{const k=e.name+'|'+e.project+'|'+e._dateRange;if(seen.has(k))return false;seen.add(k);return true;});
  fs.writeFileSync('/Users/mac/Documents/Codex/2026-05-20/claude-code/workhours_data.json',JSON.stringify(unique,null,2));
  console.log('\nSaved '+unique.length+' entries');

  const empty=unique.filter(e=>e.tooltipData?._empty||!e.tooltipData?.report||e.tooltipData?.report==='无');
  const mismatch=unique.filter(e=>{if(!e.tooltipData||e.tooltipData._empty||e.tooltipData.actDays===0)return false;return Math.abs(e.tooltipData.actDays-e.total)/Math.max(e.total,0.01)>0.1;});
  console.log('Empty reports: '+empty.length+', Hour mismatch(>10%): '+mismatch.length);
  ws.close();
}
main().catch(e=>console.error(e.message));
