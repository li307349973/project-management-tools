// Collect work hours via CDP Network API interception - complete & reliable
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const DATA_FILE=path.join(ROOT,'workhours_data.json');
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function gp(){return new Promise((r,j)=>{http.get('http://127.0.0.1:9222/json/list',res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>r(JSON.parse(d)))}).on('error',j)})}

async function main(){
  const pages=await gp();
  const page=pages.find(p=>p.type==='page'&&p.url.includes('fingard'));
  if(!page){console.log('Page not found');return;}
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  const pmap=new Map();let mid=0;
  let searchResponses=[];

  ws.onmessage=e=>{
    const m=JSON.parse(e.data);
    if(m.id&&pmap.has(m.id)){pmap.get(m.id)(m.result);pmap.delete(m.id)}
    // Capture RECHECK_SEARCH response bodies
    if(m.method==='Network.responseReceived'){
      const url=m.params.response.url;
      if(url.includes('RECHECK_SEARCH')) searchResponses.push(m.params.requestId);
    }
  };
  const S=(m,p={})=>new Promise(r=>{const id=++mid;pmap.set(id,r);ws.send(JSON.stringify({id,method:m,params:p}))});
  const E=(c)=>S('Runtime.evaluate',{expression:c,returnByValue:true});
  const EF=(c)=>E('(function(){'+c+'})()');
  await new Promise(r=>ws.onopen=r);
  await S('Page.enable');await S('Runtime.enable');await S('Network.enable');await S('Input.enable');
  const activate=()=>{try{require('child_process').spawnSync('osascript',['-e','tell application "Google Chrome" to activate'],{timeout:3000})}catch(e){}};

  // First get weeks list, then query each week, capture API response
  const allData=[];

  // Navigate
  await S('Page.navigate',{url:'https://proj.fingard.com:1888/workTime/check'});
  await sleep(8000);
  for(let i=0;i<30;i++){await sleep(1000);let r=await E('document.querySelectorAll(".ant-select").length');if(parseInt(r.result?.value||'0')>=3)break;}

  // Open dropdown
  activate();await sleep(300);
  let r=await EF('var s=document.querySelectorAll(\".ant-select\");for(var i=0;i<s.length;i++){if(/[0-9]{4}-[0-9]{2}-[0-9]{2}~[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(s[i].textContent)){var sel=s[i].querySelector(\".ant-select-selector\");var rect=sel.getBoundingClientRect();return JSON.stringify({x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)})}}return\"none\"');
  const spos=JSON.parse(r.result?.value||'{}');
  await S('Input.dispatchMouseEvent',{type:'mouseMoved',x:spos.x,y:spos.y,modifiers:0});await sleep(200);
  await S('Input.dispatchMouseEvent',{type:'mousePressed',x:spos.x,y:spos.y,button:'left',clickCount:1,modifiers:0});
  await S('Input.dispatchMouseEvent',{type:'mouseReleased',x:spos.x,y:spos.y,button:'left',clickCount:1,modifiers:0});
  await sleep(1500);

  // Get weeks
  r=await EF('return JSON.stringify(Array.from(document.querySelectorAll(\".ant-select-item-option-content\")).map(function(o){return o.textContent.trim()}))');
  const allWeeks=JSON.parse(r.result?.value||'[]');
  const pendingWeeks=allWeeks.filter(w=>w.includes('(待复核)'));
  console.log('Pending weeks:',pendingWeeks);

  // Keep dropdown open for first week selection

  // Helper: click an element found by JS code
  async function jsClick(code,label){
    let r=await EF(code);
    const pos=JSON.parse(r.result?.value||'{}');
    if(pos.err||!pos.x){console.log('  click['+label+'] fail:',JSON.stringify(pos));return false;}
    activate();await sleep(200);
    await S('Input.dispatchMouseEvent',{type:'mouseMoved',x:pos.x,y:pos.y,modifiers:0});await sleep(200);
    await S('Input.dispatchMouseEvent',{type:'mousePressed',x:pos.x,y:pos.y,button:'left',clickCount:1,modifiers:0});
    await S('Input.dispatchMouseEvent',{type:'mouseReleased',x:pos.x,y:pos.y,button:'left',clickCount:1,modifiers:0});
    await sleep(500);return true;
  }

  const FIND_SEL='var s=document.querySelectorAll(\".ant-select\");for(var i=0;i<s.length;i++){if(/[0-9]{4}-[0-9]{2}-[0-9]{2}~[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(s[i].textContent)){var sel=s[i].querySelector(\".ant-select-selector\");var rect=sel.getBoundingClientRect();return JSON.stringify({x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)})}}return JSON.stringify({err:\"no\"})';
  const FIND_QRY='var b=document.querySelectorAll(\"button\");for(var i=0;i<b.length;i++){if(b[i].textContent.indexOf(\"查 询\")>=0){var rect=b[i].getBoundingClientRect();return JSON.stringify({x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)})}}return JSON.stringify({err:\"no\"})';

  for(let wi=0;wi<pendingWeeks.length;wi++){
    const week=pendingWeeks[wi];
    console.log('\n'+week);
    searchResponses=[];

    // Open dropdown (skip for first week - already open from weeks list)
    if(wi>0){await jsClick(FIND_SEL,'sel');await sleep(1500);}
    const weekCode='var o=document.querySelectorAll(\".ant-select-item-option-content\");for(var i=0;i<o.length;i++){if(o[i].textContent.trim()===\"'+week+'\"){o[i].scrollIntoView({block:\"center\"});var rect=o[i].getBoundingClientRect();return JSON.stringify({x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)})}}return JSON.stringify({err:\"no\"})';
    await jsClick(weekCode,'week');await sleep(1000);
    await jsClick(FIND_QRY,'query');await sleep(4000);

    // Fetch captured API response body
    if(searchResponses.length===0){console.log('  No API response captured');continue;}
    const rid=searchResponses[searchResponses.length-1]; // last one
    let body;
    try{
      let r=await S('Network.getResponseBody',{requestId:rid});
      if(r.body){
        body=r.base64Encoded?Buffer.from(r.body,'base64').toString('utf-8'):r.body;
      }
    }catch(e){console.log('  Error fetching body:',e.message);continue;}
    if(!body){console.log('  Empty body');continue;}

    const apiData=JSON.parse(body);
    // Save raw API response for debugging
    fs.writeFileSync('/tmp/api_'+week.replace(/[\(\)]/g,'_').substring(0,20)+'.json',JSON.stringify(apiData,null,2));
    if(!apiData.data){console.log('  No data in response');continue;}

    // Parse API response into our standard format
    const dateRange=week.replace(/\(.*\)/,'').trim();
    const ym=dateRange.substring(0,7);
    const pm=dateRange.match(/(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})/);
    const startD=pm?new Date(pm[1]):null,endD=pm?new Date(pm[2]):null;
    const dates=[];
    if(startD&&endD){
      for(let d=new Date(startD);d<=endD;d.setDate(d.getDate()+1)){
        dates.push(d.toISOString().substring(0,10));
      }
    }

    let totalEntries=0;
    for(const proj of apiData.data){
      for(const detail of proj.detailList||[]){
        // Filter: 研发负责人已确认
        if(detail.statusTranslate!=='研发负责人已确认')continue;
        // Check if has data: projectreport text OR issueDetailList tasks
        const hasReport=detail.projectreport&&detail.projectreport!=='null'&&detail.projectreport.trim()!==''&&detail.projectreport.trim()!=='无';
        const hasTasks=(detail.issueDetailList||[]).length>0;
        // Include if either has data; if both empty, still include for 异议 flagging
        const bothEmpty=!hasReport&&!hasTasks;

        const tasks=(detail.issueDetailList||[]).map(t=>({
          proj:proj.projectName||'',
          jira:t.issueNo||'',
          subject:t.issueTheme||'',
          type:t.issueType||'',
          status:t.issueStatus||'',
          planS:t.preStartDate||'',planE:t.preEndDate||'',
          planH:t.peopleWorkTime||0,
          actS:t.actualStartDate||'',actE:t.actualEndDate||'',
          actH:t.actualTaskTime||0,
          delivery:t.estimatedDeliveryDate||''
        }));
        const totalPlanH=+tasks.reduce((s,t)=>s+t.planH,0).toFixed(2);
        const totalActH=+tasks.reduce((s,t)=>s+t.actH,0).toFixed(2);
        const actDays=+(totalActH/8).toFixed(2);
        const report=detail.projectreport&&detail.projectreport!=='null'?detail.projectreport:'';
        const reportEmpty=!report||report.trim()===''||report.trim()==='无';

        const hours=[detail.monday||0,detail.tuesday||0,detail.wednesday||0,detail.thursday||0,detail.friday||0,detail.saturday||0,detail.sunday||0];

        const entry={
          name:detail.name,
          role:detail.peopleTypeTranslate||'',
          status:detail.statusTranslate||'',
          timestamp:detail.recheckTime||'',
          project:proj.projectNo||'',
          projectName:proj.projectName||'',
          subProduct:proj.productTranslate||'',
          total:detail.sum||0,
          hours:hours,
          _dateRange:dateRange,
          _dates:dates,
          _weekLabel:week,
          tooltipData:{
            report:report||(tasks.length===0?'':'无'),
            reportEmpty:reportEmpty,
            tasks:tasks,
            totalPlanH:totalPlanH,
            totalActH:totalActH,
            actDays:actDays,
            _bothEmpty:bothEmpty,
          }
        };
        allData.push(entry);
        totalEntries++;
      }
    }
    console.log('  Entries:',totalEntries);
  }

  // Deduplicate & save
  const seen=new Set();
  const unique=allData.filter(e=>{const k=e.name+'|'+e.project+'|'+e._dateRange;if(seen.has(k))return false;seen.add(k);return true;});

  const outFile=DATA_FILE;
  fs.writeFileSync(outFile,JSON.stringify(unique,null,2));
  console.log('\nSaved '+unique.length+' entries to '+outFile);

  const emptyReports=unique.filter(e=>!e.tooltipData.report||e.tooltipData.report==='无');
  const mismatch=unique.filter(e=>{if(!e.tooltipData||e.tooltipData.actDays===0)return false;return Math.abs(e.tooltipData.actDays-e.total)/Math.max(e.total,0.01)>0.1;});
  console.log('Empty reports:',emptyReports.length,', Mismatch:',mismatch.length);

  ws.close();
}
main().catch(e=>console.error(e.message));
