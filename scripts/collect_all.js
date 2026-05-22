// Final CDP work hours collection: multi-week, tooltip capture, audit-filtered
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'workhours_data.json');

async function getPages() { return new Promise((r,j)=>{http.get('http://127.0.0.1:9222/json/list',(res)=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>r(JSON.parse(d)))}).on('error',j)}); }
function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

// ── Tooltip parser ──
function parseTooltip(text) {
  if (!text) return { report: '', tasks: [], totalPlanH: 0, totalActH: 0, actDays: 0, _empty: true };
  const rm = text.match(/项目周报[：:]\s*(.+?)(?:任务明细|$)/);
  const report = rm ? rm[1].trim() : '';
  const tasks = [];
  const ti = text.indexOf('任务明细');
  if (ti < 0) return { report, tasks, totalPlanH: 0, totalActH: 0, actDays: 0 };
  let data = text.substring(ti);
  const he = data.indexOf('期望交付日期');
  if (he >= 0) data = data.substring(he + 6);
  const jiraRe = /([A-Z]{2,}-\d+)/g;
  const matches = [...data.matchAll(jiraRe)];
  for (const m of matches) {
    const jira = m[1], start = m.index, end = m.index + m[0].length;
    const nextIdx = data.indexOf(jira, start + 1);
    const chunkEnd = nextIdx > start ? nextIdx : data.length;
    // Take substring from this JIRA to next JIRA (or end)
    let chunkEnd2 = data.length;
    const nextJira = [...data.matchAll(jiraRe)].find(mm => mm.index > start);
    if (nextJira) chunkEnd2 = nextJira.index;
    const chunk = data.substring(start, chunkEnd2);
    const pe = chunk.indexOf(jira), proj = chunk.substring(0, pe), rest = chunk.substring(pe + jira.length);
    const dateRe = /\d{4}-\d{2}-\d{2}/g, dates = [...rest.matchAll(dateRe)];
    let planH = 0, actH = 0;
    if (dates.length >= 3) {
      const php = dates[1].index + 10, phe = dates[2].index;
      if (phe > php) { const v = parseFloat(rest.substring(php, phe)); if (!isNaN(v)) planH = v; }
      const aep = (dates.length >= 4 ? dates[3].index : dates[2].index) + 10;
      const aee = dates.length >= 5 ? dates[4].index : rest.length;
      if (aee > aep) { const v = parseFloat(rest.substring(aep, aee)); if (!isNaN(v)) actH = v; }
    }
    let sub = '', type = '', status = '';
    if (dates.length > 0) {
      const before = rest.substring(0, dates[0].index);
      const sm = before.match(/(已完成|进行中|未开始|已关闭|已取消|待评审|待确认)/);
      if (sm) { status = sm[1]; const bs = before.substring(0, sm.index); const tm = bs.match(/([一-龥]{2,})$/); if (tm) { type = tm[1]; sub = bs.substring(0, bs.length - type.length); } else sub = bs; }
      else sub = before;
    }
    tasks.push({ proj, jira, subject: sub, type, status, planS: dates[0]?.[0]||'', planE: dates[1]?.[0]||'', planH: +planH.toFixed(2), actS: dates[2]?.[0]||'', actE: dates[3]?.[0]||'', actH: +actH.toFixed(2), delivery: dates.length>=5?dates[4][0]:(dates.length>=4?dates[3][0]:'') });
  }
  const totalPlanH = +tasks.reduce((s,t)=>s+t.planH,0).toFixed(2);
  const totalActH = +tasks.reduce((s,t)=>s+t.actH,0).toFixed(2);
  return { report, tasks, totalPlanH, totalActH, actDays: +(totalActH/8).toFixed(2) };
}

// ── JS exec helpers ──
let _ws, _pending, _mid;
function initWS(ws) { _ws = ws; _pending = new Map(); _mid = 0; ws.onmessage = (e)=>{const m=JSON.parse(e.data);if(m.id&&_pending.has(m.id)){_pending.get(m.id)(m);_pending.delete(m.id);}}; }
function send(m,p={}){return new Promise(r=>{const id=++_mid;_pending.set(id,r);_ws.send(JSON.stringify({id,method:m,params:p}));});}
function evalJS(c){return send('Runtime.evaluate',{expression:c,returnByValue:true});}
function evalIIFE(c){return evalJS('(function(){'+c+'})()');}

// ── Page interaction helpers ──
async function openDropdown() {
  await evalIIFE('var s=document.querySelectorAll(".ant-select");for(var i=0;i<s.length;i++){if(/[0-9]{4}-[0-9]{2}-[0-9]{2}~[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(s[i].textContent)){s[i].click();return}}');
  await sleep(1500);
}

async function getWeeks() {
  let r = await evalIIFE('return JSON.stringify(Array.from(document.querySelectorAll(".ant-select-item-option-content")).map(function(o){return o.textContent.trim()}))');
  try { return JSON.parse(r.result?.result?.value||'[]'); } catch(e) { return []; }
}

async function selectWeek(week) {
  await evalIIFE('var o=document.querySelectorAll(".ant-select-item-option-content");for(var i=0;i<o.length;i++){if(o[i].textContent.trim()==="'+week+'"){o[i].click();return}}');
  await sleep(1000);
  await evalIIFE('var b=document.querySelectorAll("button");for(var i=0;i<b.length;i++){if(b[i].textContent.includes("查 询")){b[i].click();return}}');
  await sleep(4000);
}

async function getPageText() {
  let r = await evalJS('(document.querySelector("[class*=work-time-check]")||document.body).innerText');
  return r.result?.result?.value || '';
}

async function parseTableData() {
  let r = await evalIIFE('return JSON.stringify(Array.from(document.querySelectorAll(".ant-table-row")).map(function(row){return Array.from(row.querySelectorAll("td")).map(function(c){return c.textContent.trim().substring(0,50)})}))');
  const rows = JSON.parse(r.result?.result?.value||'[]');
  const groups = {}; let curProj='', curProjName='', curSub='';
  const persons = [];
  for (let ri = 0; ri < rows.length; ri++) {
    const cells = rows[ri];
    if (cells.length < 4) continue;
    if (cells[3] && /^QJ_PRJ_/.test(cells[3])) { curProj=cells[3]; curProjName=cells[4]||''; curSub=cells[5]||''; const k=curProj+'|'+curSub; if(!groups[k]) groups[k]={project:curProj,projectName:curProjName,subProduct:curSub,persons:[]}; continue; }
    const nameCell=cells.find(c=>/^\d{4}-[^\d\s]{2,}$/.test(c));
    const roleCell=cells.find(c=>/^(研发|测试|需求)$/.test(c));
    if (nameCell && roleCell && curProj) { const k=curProj+'|'+curSub; if(!groups[k]) continue;
      const vi=cells.findIndex(c=>c==='查看'); const total=vi>0?(parseFloat(cells[vi+1])||0):0;
      const hours=cells.slice(vi+1,vi+8).map(v=>parseFloat(v)||0); while(hours.length<7) hours.push(0);
      const p={name:nameCell,role:roleCell,status:cells[1]||'',timestamp:cells[2]||'',total,hours,rowIndex:ri};
      groups[k].persons.push(p); persons.push({...p,projectKey:k}); }
  }
  return { groups, persons };
}

async function getViewCellPositions() {
  let r = await evalIIFE(`
    var cells = document.querySelectorAll("td");
    var result = [];
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].textContent.trim() === "查看") {
        var rect = cells[i].getBoundingClientRect();
        // Get person name from same row
        var row = cells[i].parentElement;
        var rowCells = row ? row.querySelectorAll("td") : [];
        var name = "";
        for (var j = 0; j < rowCells.length; j++) {
          var t = rowCells[j].textContent.trim();
          if (/^\\d{4}-[^\\d\\s]{2,}\$/.test(t)) { name = t; break; }
        }
        result.push({ name: name, x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2), cellIdx: i });
      }
    }
    return JSON.stringify(result);
  `);
  try { return JSON.parse(r.result?.result?.value||'[]'); } catch(e) { return []; }
}

// ── Main ──
async function main() {
  const pages = await getPages();
  const page = pages.find(p => p.type === 'page' && p.url.includes('fingard'));
  if (!page) { console.log('❌ Page not found. Is Chrome running on port 9222?'); return; }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  initWS(ws);
  await new Promise(r=>ws.onopen=r);
  await send('Page.enable'); await send('Runtime.enable'); await send('Input.enable');
  console.log('✅ Connected to Chrome\n');

  // 1. Navigate to workTime/check
  await send('Page.navigate', {url: 'https://proj.fingard.com:1888/workTime/check'});
  await sleep(5000);

  // 2. Get available weeks, focus on (待复核) weeks
  console.log('📋 Getting available weeks...');
  await openDropdown();
  const allWeeks = await getWeeks();
  console.log('   All weeks: ' + allWeeks.join(', '));

  const pendingWeeks = allWeeks.filter(w => w.includes('(待复核)'));
  console.log('   Pending weeks: ' + pendingWeeks.join(', '));

  // Close dropdown
  await evalIIFE('document.body.click()');
  await sleep(500);

  // 3. Collect all data per week
  const allData = [];

  for (let wi = 0; wi < pendingWeeks.length; wi++) {
    const week = pendingWeeks[wi];
    console.log('\n📅 Week ' + (wi+1) + '/' + pendingWeeks.length + ': ' + week);

    if (wi > 0) {
      await openDropdown();
      await selectWeek(week);
    }

    const text = await getPageText();
    if (text.includes('暂无数据')) { console.log('   ⏭️ No data'); continue; }

    const pm = text.match(/(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})/);
    const dateRange = pm ? pm[0].replace(/\(.*\)/, '') : '';
    const ym = pm ? pm[1].substring(0, 7) : '';
    const dhm = text.match(/((?:\d{2}月\d{2}日\s*)+)/);
    const dates = []; if (dhm) { const dr=/(\d{2})月(\d{2})日/g; let m; while((m=dr.exec(dhm[1]))!==null) dates.push(ym+'-'+m[2]); }
    console.log('   Date: ' + dateRange);

    const { groups, persons } = await parseTableData();
    console.log('   Groups: ' + Object.keys(groups).length + ', Persons: ' + persons.length);

    // Show status distribution
    const statusCounts = {};
    persons.forEach(p => { statusCounts[p.status] = (statusCounts[p.status]||0)+1; });
    console.log('   Statuses:', JSON.stringify(statusCounts));

    // Get view cell positions
    const viewCells = await getViewCellPositions();
    console.log('   View cells: ' + viewCells.length);

    // 4. Hover each person's 查看 in sequence, capture tooltip
    // Use pending-approval filter: status must be "研发负责人已确认"
    const filteredPersons = persons.filter(p => p.status === '研发负责人已确认');
    console.log('   🎯 Filtered (研发负责人已确认): ' + filteredPersons.length);

    for (let pi = 0; pi < viewCells.length; pi++) {
      const vc = viewCells[pi];
      const person = persons.find(p => p.name === vc.name);
      if (!person) continue;
      if (person.status !== '研发负责人已确认') {
        console.log('   ⏭️ Skip ' + vc.name + ' (status=' + person.status + ')');
        continue;
      }

      // Dismiss previous tooltip: move mouse away
      if (pi > 0) {
        await send('Input.dispatchMouseEvent', {type:'mouseMoved', x:10, y:500, modifiers:0});
        await sleep(800);
      }

      // Hover
      console.log('   🖱️ ' + vc.name);
      await send('Input.dispatchMouseEvent', {type:'mouseMoved', x:vc.x, y:vc.y, modifiers:0});
      await sleep(1800);

      // Capture
      let r = await evalIIFE('var tts=document.querySelectorAll(".ant-tooltip:not(.ant-tooltip-hidden)");for(var i=0;i<tts.length;i++){var t=tts[i].textContent.trim();if(t.includes("项目周报"))return t.substring(0,5000)}return""');
      const raw = r.result?.result?.value || '';
      const tooltip = parseTooltip(raw);

      const info = tooltip._empty ? '⚠️ EMPTY' : 'report='+tooltip.report.substring(0,30)+(tooltip.tasks.length>0?' tasks='+tooltip.tasks.length:'')+(tooltip.totalActH>0?' actH='+tooltip.totalActH:'');
      console.log('     ' + info);

      // Build the group key for project context
      const groupKey = person.projectKey;
      const group = groups[groupKey];

      allData.push({
        name: person.name,
        role: person.role,
        status: person.status,
        timestamp: person.timestamp,
        project: group ? group.project : '',
        projectName: group ? group.projectName : '',
        subProduct: group ? group.subProduct : '',
        total: person.total,
        hours: person.hours,
        _dateRange: dateRange,
        _dates: dates,
        _weekLabel: week,
        tooltipData: tooltip,
      });
    }
  }

  // Deduplicate
  const seen = new Set();
  const unique = allData.filter(e => {
    const key = e.name + '|' + e.project + '|' + e._dateRange;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log('\n💾 Saving ' + unique.length + ' entries...');
  const outFile = DATA_FILE;
  fs.writeFileSync(outFile, JSON.stringify(unique, null, 2));
  console.log('   ✅ ' + outFile);

  // Summary
  const emptyReports = unique.filter(e => e.tooltipData?._empty || !e.tooltipData?.report || e.tooltipData?.report === '无');
  const withReports = unique.filter(e => !(e.tooltipData?._empty || !e.tooltipData?.report || e.tooltipData?.report === '无'));
  const taskMismatch = unique.filter(e => {
    if (!e.tooltipData || e.tooltipData._empty) return false;
    const td = e.tooltipData;
    if (td.actDays === 0) return false;
    return Math.abs(td.actDays - e.total) / Math.max(e.total, 0.01) > 0.1;
  });

  console.log('\n📊 Summary:');
  console.log('   总条目: ' + unique.length);
  console.log('   项目周报为空: ' + emptyReports.length);
  console.log('   项目周报已填: ' + withReports.length);
  console.log('   工单小时≠填报人天(>10%偏差): ' + taskMismatch.length);

  ws.close();
}

main().catch(e => console.error('💥 Fatal:', e.message));
