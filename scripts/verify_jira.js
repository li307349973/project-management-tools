// Verify JIRA hours with sub-task traversal
const http=require('http'),fs=require('fs'),path=require('path'),childProcess=require('child_process');
const ROOT=path.resolve(__dirname,'..');
const DATA_FILE=path.join(ROOT,'workhours_data.json');
const JIRA_FILE=path.join(ROOT,'jira_verify.json');
const JIRA_BASE_URL=(process.env.JIRA_BASE_URL||'http://jira.fingard.com:6001').replace(/\/+$/,'');
const JIRA_KEYCHAIN_SERVICE=process.env.JIRA_KEYCHAIN_SERVICE||'codex-work-hour-audit-jira-token';
const JIRA_KEYCHAIN_ACCOUNT=process.env.JIRA_KEYCHAIN_ACCOUNT||process.env.JIRA_USERNAME||'liqing';
async function gp(){return new Promise((r,j)=>{http.get('http://127.0.0.1:9222/json/list',res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>r(JSON.parse(d)))}).on('error',j)})}

function keychainToken(){
  try{
    return childProcess.execFileSync('security',[
      'find-generic-password',
      '-a',JIRA_KEYCHAIN_ACCOUNT,
      '-s',JIRA_KEYCHAIN_SERVICE,
      '-w'
    ],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  }catch(e){
    return '';
  }
}

function authHeaders(){
  const headers={Accept:'application/json'};
  if(process.env.JIRA_AUTH_HEADER){
    headers.Authorization=process.env.JIRA_AUTH_HEADER;
    return headers;
  }
  const token=process.env.JIRA_BEARER_TOKEN||process.env.JIRA_TOKEN;
  if(token){
    headers.Authorization='Bearer '+token;
    return headers;
  }
  const kcToken=keychainToken();
  if(kcToken){
    headers.Authorization='Bearer '+kcToken;
    return headers;
  }
  const user=process.env.JIRA_USERNAME;
  const pass=process.env.JIRA_API_TOKEN||process.env.JIRA_PASSWORD;
  if(user&&pass){
    headers.Authorization='Basic '+Buffer.from(user+':'+pass).toString('base64');
    return headers;
  }
  return null;
}

async function directSearch(jql,fields,maxResults,headers){
  const url=new URL('/rest/api/2/search',JIRA_BASE_URL+'/');
  url.searchParams.set('jql',jql);
  url.searchParams.set('fields',fields.join(','));
  url.searchParams.set('maxResults',String(maxResults));
  const res=await fetch(url,{headers});
  const text=await res.text();
  if(!res.ok)throw new Error('JIRA API '+res.status+': '+text.substring(0,300));
  return JSON.parse(text);
}

async function chromeSearch(runtimeEval,jql,fields,maxResults){
  const url=new URL('/rest/api/2/search',JIRA_BASE_URL+'/');
  url.searchParams.set('jql',jql);
  url.searchParams.set('fields',fields.join(','));
  url.searchParams.set('maxResults',String(maxResults));
  const expr='fetch('+JSON.stringify(url.toString())+').then(async r=>{const t=await r.text(); if(!r.ok) throw new Error("JIRA API "+r.status+": "+t.slice(0,300)); return t;})';
  const r=await runtimeEval(expr);
  if(r.exceptionDetails)throw new Error(r.exceptionDetails.text||'JIRA fetch failed in Chrome');
  return JSON.parse(r.result?.value||'{}');
}

// Role-aware JIRA hours (recursive with sub-tasks, assignee-filtered)
function getJiraHours(ji,role,jiraData,personName){
  if(!ji)return 0;
  let h=ji.actGeneral||0;
  if(role==='研发')h+=ji.actDev||0;
  else if(role==='测试')h+=ji.actTest||0;
  // Recurse into sub-tasks, filter by assignee if personName provided
  if(ji._subs)for(const sk of ji._subs){const s=jiraData[sk];if(s){
    // Check assignee match: extract Chinese name from personName and match against JIRA assignee
    const cnMatch=personName?personName.match(/[一-鿿]+/):null;
    const personCN=cnMatch?cnMatch[0]:'';
    const assigneeMatch=s.assignee?s.assignee.match(/[一-鿿]+/):null;
    const assigneeCN=assigneeMatch?assigneeMatch[0]:'';
    if(personCN&&assigneeCN&&personCN===assigneeCN)h+=getJiraHours(s,role,jiraData,personName);
    else if(!personCN)h+=getJiraHours(s,role,jiraData,personName); // no person filter → include all
  }}
  return h;
}

async function main(){
  const data=JSON.parse(fs.readFileSync(DATA_FILE,'utf-8'));

  // Collect ALL issue IDs
  const issues=new Set();
  data.forEach(e=>{
    const td=e.tooltipData;
    td.tasks.forEach(t=>issues.add(t.jira));
    const ids=(td.report||'').match(/(ATSES|FRISK)-\d+/g)||[];
    ids.forEach(id=>issues.add(id));
  });
  const issueList=[...issues];
  console.log('Issues to verify:',issueList.length);

  const workFields=['customfield_14606','customfield_14607','customfield_10539','customfield_10528','customfield_10550','customfield_10557','customfield_14625','customfield_10513','customfield_10542','customfield_10533','customfield_10551','customfield_10562','customfield_10516','customfield_14602','customfield_14604'];
  const fields=[...workFields,'summary','status','subtasks','assignee'];
  const jiraData={};
  const headers=authHeaders();
  let close=()=>{};
  let search;
  if(headers){
    console.log('JIRA mode: direct REST API');
    search=(jql,maxResults)=>directSearch(jql,fields,maxResults,headers);
  }else{
    console.log('JIRA mode: Chrome session REST API');
    const pages=await gp();
    const jp=pages.find(p=>p.url.includes('jira.fingard.com'));
    if(!jp){console.log('No JIRA page and no JIRA token configured');return;}
    const ws=new WebSocket(jp.webSocketDebuggerUrl);
    const pmap=new Map();let mid=0;
    ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pmap.has(m.id)){pmap.get(m.id)(m.result);pmap.delete(m.id)}};
    const S=(m,p={})=>new Promise(r=>{const id=++mid;pmap.set(id,r);ws.send(JSON.stringify({id,method:m,params:p}))});
    const J=(e)=>S('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});
    await new Promise(r=>ws.onopen=r);
    await S('Page.enable');await S('Runtime.enable');
    close=()=>ws.close();
    search=(jql,maxResults)=>chromeSearch(J,jql,fields,maxResults);
  }

  // Fetch all top-level issues
  const jql='issue in ('+issueList.join(',')+')';
  const searchResult=await search(jql,100);

  if(!searchResult.issues){console.log('Search failed');close();return;}

  // Parse issues + collect sub-task keys
  const subKeys=new Set();
  for(const issue of searchResult.issues){
    const f=issue.fields;
    const subs=(f.subtasks||[]).map(s=>s.key);
    subs.forEach(k=>subKeys.add(k));
    jiraData[issue.key]={
      summary:f.summary||'',status:f.status?.name||'',
      actGeneral:f.customfield_14607||0,
      actDev:(f.customfield_10539||0)+(f.customfield_10550||0)+(f.customfield_10557||0),
      planDev:(f.customfield_10542||0)+(f.customfield_10551||0)+(f.customfield_10562||0),
      actTest:(f.customfield_10528||0)+(f.customfield_14625||0),
      planTest:(f.customfield_10533||0)+(f.customfield_14625||0),
      actCoding:f.customfield_10539||0,actTesting:f.customfield_10528||0,
      actDesign:f.customfield_10550||0,actReqAnalysis:f.customfield_10557||0,
      actTestConfirm:f.customfield_14625||0,actWork:f.customfield_10513||0,
      planStart:f.customfield_14602||'',actualStart:f.customfield_14604||'',
      _subs:subs,
    };
  }
  console.log('Top-level:',Object.keys(jiraData).length);

  // Fetch sub-tasks
  if(subKeys.size>0){
    const subList=[...subKeys];
    console.log('Sub-tasks:',subList.length);
    const sjql='key in ('+subList.join(',')+')';
    const subResult=await search(sjql,200);
    for(const issue of subResult.issues||[]){
      const f=issue.fields;
      const asgn=(f.assignee||{}).displayName||'';
      jiraData[issue.key]={
        summary:f.summary||'',status:f.status?.name||'',assignee:asgn,
        actGeneral:f.customfield_14607||0,
        actDev:(f.customfield_10539||0)+(f.customfield_10550||0)+(f.customfield_10557||0),
        planDev:(f.customfield_10542||0)+(f.customfield_10551||0)+(f.customfield_10562||0),
        actTest:(f.customfield_10528||0)+(f.customfield_14625||0),
        planTest:(f.customfield_10533||0)+(f.customfield_14625||0),
        actCoding:f.customfield_10539||0,actTesting:f.customfield_10528||0,
        actDesign:f.customfield_10550||0,actReqAnalysis:f.customfield_10557||0,
        actTestConfirm:f.customfield_14625||0,actWork:f.customfield_10513||0,
        planStart:f.customfield_14602||'',actualStart:f.customfield_14604||'',
        _subs:[],
      };
    }
  }
  console.log('Total:',Object.keys(jiraData).length,'issues\n');

  // Compare
  console.log('═══ 核验结果 ═══\n');
  const mismatches=[];
  data.forEach(e=>{
    const td=e.tooltipData;
    const reportIds=(td.report||'').match(/(ATSES|FRISK)-\d+/g)||[];

    // Collect unique JIRA IDs: from tasks + from report
    const allIds=new Set();
    td.tasks.forEach(t=>allIds.add(t.jira));
    reportIds.forEach(id=>allIds.add(id));

    let jiraH=0;
    const results=[];
    for(const id of allIds){
      const ji=jiraData[id];
      if(ji){
        const h=getJiraHours(ji,e.role,jiraData,e.name);
        jiraH+=h;
        results.push({id,h,direct:td.tasks.some(t=>t.jira===id)});
      }
    }

    const jd=+(jiraH/8).toFixed(2);
    const dev=e.total>jd&&jd>0?Math.round((e.total-jd)/e.total*100):(jd===0&&e.total>0?100:0);

    if(dev>0||results.length>0){
      const label=td.tasks.length===0&&reportIds.length>0?'[有工单无明细]':'';
      const flag=dev>50?'🔴':dev>10?'🟡':jd>=e.total?'✅':'🔵';
      console.log(flag,label,e.name,'|',e._dateRange,'|',e.projectName+'/'+e.subProduct,'| 填报'+e.total+'天 | JIRA合计'+jiraH+'h='+jd+'天'+(dev>10?' 差'+dev+'%':''));
      for(const r of results){
        const ji=jiraData[r.id];
        const h=getJiraHours(ji,e.role,jiraData,e.name);
        const subInfo=ji._subs&&ji._subs.length>0?' (含'+ji._subs.length+'子任务)':'';
        console.log('    '+r.id+': JIRA实际'+h+'h'+(r.direct?'':' [子任务]')+' | '+ji.summary?.substring(0,50)+subInfo);
      }
      console.log('');
    }
  });

  fs.writeFileSync(JIRA_FILE,JSON.stringify({jiraData,mismatches},null,2));
  console.log('Saved '+JIRA_FILE);
  close();
}
main().catch(e=>console.error(e.message));
