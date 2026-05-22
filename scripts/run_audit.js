// Audit script with JIRA verification
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const DATA_FILE=path.join(ROOT,'workhours_data.json');
const JIRA_FILE=path.join(ROOT,'jira_verify.json');
const AUDIT_FILE=path.join(ROOT,'audit_result.json');
function gid(...p){let h=0;const s=p.join('::');for(let i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i);h|=0;}return Math.abs(h).toString(36);}
const CFG={spikeThreshold:50,identicalWeeks:3,maxDaily:24,maxWeekly:168,suspiciousDaily:16,suspiciousWeekly:84,taskVarPct:10};

// Role-aware JIRA hours (recursive, assignee-filtered)
function getJH(ji,role,jiraMap,personName){if(!ji)return 0;let h=ji.actGeneral||0;if(role==='研发')h+=ji.actDev||0;else if(role==='测试')h+=ji.actTest||0;if(ji._subs)for(const sk of ji._subs){const s=jiraMap[sk];if(s){const cnM=personName?personName.match(/[一-鿿]+/):null;const pCN=cnM?cnM[0]:'';const aM=s.assignee?s.assignee.match(/[一-鿿]+/):null;const aCN=aM?aM[0]:'';if(pCN&&aCN&&pCN===aCN)h+=getJH(s,role,jiraMap,personName);else if(!pCN)h+=getJH(s,role,jiraMap,personName)}}return h;}

// ── Check 1: Report completeness ──
function checkReports(entries,jiraMap){
  const f=[];
  for(const e of entries){
    const td=e.tooltipData;if(!td)continue;
    // Both empty
    if(td._bothEmpty){f.push({id:gid('both-empty',e.name,e._dateRange,e.subProduct),severity:'error',category:'weeklyReport',person:e.name,subProduct:e.subProduct,week:e._dateRange,message:`${e.name} 周报和任务明细均为空`,detail:`${e.projectName}/${e.subProduct}: 无周报内容且无关联工单`,suggestion:'请补充周报或关联工单'});continue;}

    const jiraIds=(td.report||'').match(/(ATSES|FRISK)-\d+/g)||[];

    // Has report text, no tasks
    if(!td.reportEmpty&&td.tasks.length===0){
      if(jiraIds.length===0){f.push({id:gid('no-ids',e.name,e._dateRange,e.subProduct),severity:'error',category:'weeklyReport',person:e.name,subProduct:e.subProduct,week:e._dateRange,message:`${e.name} 周报未按规范填写，无工单号，标记为异议`,detail:`${e.projectName}/${e.subProduct}: 周报="${td.report.substring(0,80)}"`,suggestion:'请按规范填写ATSES/FRISK工单号'});continue;}

      // Has JIRA IDs → check JIRA for actual hours (role-aware)
      let jiraH=0;const jd=[];
      jiraIds.forEach(id=>{const ji=jiraMap[id];if(ji){const h=getJH(ji,e.role,jiraMap,e.name);jiraH+=h;jd.push(id+':'+h+'h')}});
      const jDays=+(jiraH/8).toFixed(2);
      const dev=e.total>jDays&&jDays>0?Math.round((e.total-jDays)/e.total*100):(jDays===0&&e.total>0?100:0);
      const sev=dev>50?'error':(dev>10?'warning':'info');
      f.push({id:gid('jira-check',e.name,e._dateRange,e.subProduct),severity:sev,category:'weeklyReport',person:e.name,subProduct:e.subProduct,week:e._dateRange,message:`有工单无明细，JIRA实际: ${jd.join(', ')} 合计${jiraH}h=${jDays}天`+(dev>10?' vs 填报'+e.total+'天 差'+dev+'%':''),detail:`${e.projectName}/${e.subProduct}: 周报提到${jiraIds.join(',')}`,suggestion:jiraH===0?'JIRA无工时记录，请核实':(dev>10?'填报与JIRA不一致，请核实':'已通过JIRA核验'),value:e.total,expectedValue:jDays});
      continue;
    }

    // Report empty, has tasks
    if(td.reportEmpty&&td.tasks.length>0){f.push({id:gid('report-empty',e.name,e._dateRange,e.subProduct),severity:'warning',category:'weeklyReport',person:e.name,subProduct:e.subProduct,week:e._dateRange,message:`${e.name} 项目周报未填写，但有${td.tasks.length}个任务明细`,detail:`${e.projectName}/${e.subProduct}: 实际工时合计${td.totalActH}h`,suggestion:'请补充项目周报文字描述'});}
  }
  return f;
}

// ── Check 2: Task hours vs reported (JIRA verified) ──
function checkTaskHours(entries,jiraMap){
  const f=[];
  const approved=[];
  for(const e of entries){
    const td=e.tooltipData;

    // Use JIRA actual hours (role-aware) if available
    let jiraActH=0;
    if(td.tasks.length>0){
      td.tasks.forEach(t=>{const ji=jiraMap[t.jira];if(ji)jiraActH+=getJH(ji,e.role,jiraMap,e.name)});
    }
    // For entries with report IDs but no tasks, collect JIRA hours
    const reportIds=(td.report||'').match(/(ATSES|FRISK)-\d+/g)||[];
    if(td.tasks.length===0&&reportIds.length>0){
      reportIds.forEach(id=>{const ji=jiraMap[id];if(ji)jiraActH+=getJH(ji,e.role,jiraMap,e.name)});
    }

    const actDays=+(jiraActH/8).toFixed(2);
    const rep=e.total;

    // Rule: JIRA actual >= reported, or deviation <= 10% → approved (auto-confirm)
    if(jiraActH>0){
      const v2=rep>0&&actDays>0?(rep-actDays)/rep*100:0;
      if(actDays>=rep||v2<=10){
        approved.push({name:e.name,week:e._dateRange,proj:e.projectName+'/'+e.subProduct,rep,jiraActH,actDays});
        continue;
      }
    }
    // No JIRA data or no tasks → can't verify
    if(jiraActH===0)continue;

    // JIRA actual < reported → needs review
    const v=(rep-actDays)/rep*100;
    if(v<=10){approved.push({name:e.name,week:e._dateRange,proj:e.projectName+'/'+e.subProduct,rep,jiraActH,actDays:+(jiraActH/8).toFixed(2)});continue;}
    f.push({id:gid(v>50?'task-err':'task-warn',e.name,e._dateRange,e.subProduct),severity:v>50?'error':'warning',category:'taskHours',person:e.name,subProduct:e.subProduct,week:e._dateRange,message:`${e.name} 填报${rep}天 > JIRA实际${jiraActH}h=${actDays}天 (差${Math.round(v)}%)`,detail:`${e.projectName}/${e.subProduct}: JIRA核验${jiraActH}h`,suggestion:'核实是否多报工时',value:rep,expectedValue:actDays});
  }
  return {findings:f,approved};
}

// ── Check 3: Cross-week consistency ──
function checkConsistency(entries){
  const f=[],groups=new Map();
  for(const e of entries){const g=groups.get(e.name)||[];g.push(e);groups.set(e.name,g);}
  for(const [person,grp] of groups){
    grp.sort((a,b)=>a._dateRange.localeCompare(b._dateRange));
    for(let i=1;i<grp.length;i++){
      const pr=grp[i-1],cr=grp[i];
      if(pr.total===0&&cr.total>0){f.push({id:gid('recov',person,cr._dateRange),severity:'info',category:'consistency',person,subProduct:cr.subProduct,week:cr._dateRange,message:`${person} 从0恢复至${cr.total}人天`,suggestion:'确认是否休假后复工'});continue;}
      if(pr.total===0&&cr.total===0)continue;
      const ch=Math.abs(cr.total-pr.total)/Math.max(pr.total,1)*100;
      if(ch>100)f.push({id:gid('spike',person,cr._dateRange),severity:'error',category:'consistency',person,subProduct:cr.subProduct,week:cr._dateRange,message:`${person} 工时剧变: ${pr.total}→${cr.total}人天 (${Math.round(ch)}%)`,suggestion:'核实任务变更或录入错误'});
      else if(ch>CFG.spikeThreshold)f.push({id:gid('vol',person,cr._dateRange),severity:'warning',category:'consistency',person,subProduct:cr.subProduct,week:cr._dateRange,message:`${person} 工时波动: ${pr.total}→${cr.total}人天 (${Math.round(ch)}%)`,suggestion:'确认工时变化是否合理'});
    }
  }
  return f;
}

// ── Main ──
function main(){
  const data=JSON.parse(fs.readFileSync(DATA_FILE,'utf-8'));
  let jiraMap={};
  try{const jv=JSON.parse(fs.readFileSync(JIRA_FILE,'utf-8'));for(const [k,v] of Object.entries(jv.jiraData||{}))jiraMap[k]=v;}catch(e){}

  const entries=data.filter(e=>e.status==='研发负责人已确认');

  const reportF=checkReports(entries,jiraMap);
  const {findings:taskF,approved}=checkTaskHours(entries,jiraMap);
  const consF=checkConsistency(entries);
  // Check 4: Duplicate JIRA issues within a month
  const dupF=[];
  const issueMap=new Map(); // key: jiraId → [{name, week, project}]
  for(const e of entries){
    const td=e.tooltipData;
    const allIds=new Set();
    td.tasks.forEach(t=>allIds.add(t.jira));
    const reportIds=(td.report||'').match(/(ATSES|FRISK)-\d+/g)||[];
    reportIds.forEach(id=>allIds.add(id));
    for(const id of allIds){
      if(!issueMap.has(id))issueMap.set(id,[]);
      issueMap.get(id).push({name:e.name,week:e._dateRange,proj:e.projectName+'/'+e.subProduct});
    }
  }
  for(const [id,usages] of issueMap){
    if(usages.length<2)continue;
    for(let i=0;i<usages.length;i++){
      for(let j=i+1;j<usages.length;j++){
        const d1=new Date(usages[i].week.substring(0,10));
        const d2=new Date(usages[j].week.substring(0,10));
        const days=Math.abs(d2-d1)/(1000*86400);
        if(days<=30){
          dupF.push({id:gid('dup',id,usages[i].name,usages[j].name),severity:'error',category:'taskHours',
            person:usages[i].name+' + '+usages[j].name,subProduct:'',week:usages[i].week+' / '+usages[j].week,
            message:`工单 ${id} 在${days}天内重复出现: ${usages[i].name}(${usages[i].week}) & ${usages[j].name}(${usages[j].week})`,
            detail:`${usages[i].proj} / ${usages[j].proj}`,
            suggestion:'核实是否存在重复填报或工单归属冲突'});
        }
      }
    }
  }
  const all=[...reportF,...taskF,...consF,...dupF];

  const summary={total:all.length,errors:all.filter(f=>f.severity==='error').length,warnings:all.filter(f=>f.severity==='warning').length,infos:all.filter(f=>f.severity==='info').length};

  // Group by week
  const weeks=[...new Set([...all.map(f=>f.week),...approved.map(a=>a.week)])].sort();

  console.log('═══════════════════════════════════');
  console.log('  工时审核报告（含JIRA核验）');
  console.log('═══════════════════════════════════\n');
  console.log('采集条目:',entries.length,'| ','JIRA核验:',Object.keys(jiraMap).length+'个工单 ✅');
  console.log('审核发现:',summary.total,'(🔴',summary.errors,'🟡',summary.warnings,'🔵',summary.infos,')');
  console.log('覆盖时段:',weeks.length,'周\n');

  for(const wk of weeks){
    console.log('═══ ' + wk + ' ═══');

    const wf=all.filter(f=>f.week===wk);
    const wa=approved.filter(a=>a.week===wk);

    for(const sev of ['error','warning','info']){
      const fs=wf.filter(f=>f.severity===sev);
      if(fs.length===0)continue;
      const label=sev==='error'?'🔴 错误':sev==='warning'?'🟡 警告':'🔵 提示';
      for(const f of fs)console.log('  '+label+' ['+f.category+'] '+f.person+' | '+f.subProduct+' | '+f.message);
    }

    if(wa.length>0){
      console.log('  ✅ 可确认审批 ('+wa.length+'条):');
      for(const a of wa)console.log('    '+a.name+' | '+a.proj+' | 填报'+a.rep+'天 | JIRA实际'+a.jiraActH+'h='+a.actDays+'天');
    }
    console.log('');
  }

  fs.writeFileSync(AUDIT_FILE,JSON.stringify({summary,findings:all,approved},null,2));
  console.log('已保存 '+AUDIT_FILE);
}
main();
