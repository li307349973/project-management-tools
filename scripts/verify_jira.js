// Verify JIRA hours with sub-task traversal
const http=require('http'),fs=require('fs');
async function gp(){return new Promise((r,j)=>{http.get('http://localhost:9222/json',res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>r(JSON.parse(d)))}).on('error',j)})}

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
  const data=JSON.parse(fs.readFileSync('/Users/mac/Documents/Codex/2026-05-20/claude-code/workhours_data.json','utf-8'));

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

  // Connect Chrome
  const pages=await gp();
  const jp=pages.find(p=>p.url.includes('jira.fingard.com'));
  if(!jp){console.log('No JIRA page');return;}
  const ws=new WebSocket(jp.webSocketDebuggerUrl);
  const pmap=new Map();let mid=0;
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pmap.has(m.id)){pmap.get(m.id)(m.result);pmap.delete(m.id)}};
  const S=(m,p={})=>new Promise(r=>{const id=++mid;pmap.set(id,r);ws.send(JSON.stringify({id,method:m,params:p}))});
  const J=(e)=>S('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});
  await new Promise(r=>ws.onopen=r);
  await S('Page.enable');await S('Runtime.enable');

  const workFields=['customfield_14606','customfield_14607','customfield_10539','customfield_10528','customfield_10550','customfield_10557','customfield_14625','customfield_10513','customfield_10542','customfield_10533','customfield_10551','customfield_10562','customfield_10516','customfield_14602','customfield_14604'];
  const jiraData={};

  // Fetch all top-level issues
  const jql='issue in ('+issueList.join(',')+')';
  let r=await J('fetch("http://jira.fingard.com:6001/rest/api/2/search?jql='+encodeURIComponent(jql)+'&fields='+workFields.join(',')+',summary,status,subtasks,assignee&maxResults=100").then(r=>r.json()).then(d=>JSON.stringify(d))');
  const searchResult=JSON.parse(r.result?.value||'{}');

  if(!searchResult.issues){console.log('Search failed');ws.close();return;}

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
    let sr=await J('fetch("http://jira.fingard.com:6001/rest/api/2/search?jql='+encodeURIComponent(sjql)+'&fields='+workFields.join(',')+',summary,status,subtasks,assignee&maxResults=200").then(r=>r.json()).then(d=>JSON.stringify(d))');
    const subResult=JSON.parse(sr.result?.value||'{}');
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

  fs.writeFileSync('/Users/mac/Documents/Codex/2026-05-20/claude-code/jira_verify.json',JSON.stringify({jiraData,mismatches},null,2));
  console.log('Saved jira_verify.json');
  ws.close();
}
main().catch(e=>console.error(e.message));
