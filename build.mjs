import { writeFileSync, readFileSync } from 'fs';
​
const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) { console.error('NOTION_TOKEN not set'); process.exit(1); }
​
const H = { 'Authorization': 'Bearer ' + TOKEN, 'Notion-Version': '2022-06-28' };
​
async function blocks(id) {
  const url = 'https://api.notion.com/v1/blocks/' + id.replace(/-/g,'') + '/children?page_size=100';
  const r = await fetch(url, { headers: H });
  if (!r.ok) return [];
  return (await r.json()).results || [];
}
​
function txt(b) {
  const c = b[b.type];
  return c && c.rich_text ? c.rich_text.map(function(t){return t.plain_text;}).join('') : '';
}
​
async function getTodayFocus() {
  const bs = await blocks('35db390ee987807882aed864494124a3');
  const items = [];
  let inToday = false, inPri = false;
  for (const b of bs) {
    const t = txt(b);
    if (b.type === 'heading_1' && t.toUpperCase().includes('TODAY')) { inToday=true; inPri=false; continue; }
    if (inToday && b.type === 'heading_1') break;
    if (inToday && b.type === 'heading_2' && t.toLowerCase().includes('priorit')) { inPri=true; continue; }
    if (inToday && inPri && b.type === 'heading_2') break;
    if (inPri && b.type === 'bulleted_list_item' && t.trim()) items.push(t.trim());
  }
  return items.length ? items : ['Check Command Centre for priorities'];
}
​
async function getChecklists() {
  const bs = await blocks('2a3b390ee98780a5b1c9f6981aad41e5');
  const res = { pizza:{daily:[],weekly:[]}, bar:{daily:[]}, delivery:{daily:[],weekly:[]}, owner:{daily:[]} };
  const def = {
    pizza:{ daily:['Ovens on - sweep and scrape','Doughs out of fridge and balled up','WIX phone set up','Organise and prioritise prep list','Check older stock (sniff test)','Rotate and put away new stock','Doughs made for next couple days','WIX delivery times correct','Pizza paddles cleaned','Dirty dishes to sink area','Cling wrap dixies and lids on','Dough in fridge','Benches dry and wiped down','Sink cleaned and sanitised','Floors swept and mopped','Prep and order list done','Marble and glass cleaned','Defrost for tomorrow if needed','Pizza trays washed'], weekly:['Clean top of oven','Sweep under oven','Clean fridge dust filters','Check fan and repair','Defrost freezer','Stock take efficiency report'] },
    bar:{ daily:['Bar set up complete','Glasses polished and stocked','Fridges stocked and temps checked','Till float counted','Music on and ambiance set','Menus out','Bar wiped and sanitised','Cash-up done','Bar surfaces cleaned','Glasses washed and put away','Fridges restocked for next day','Bins emptied'] },
    delivery:{ daily:['Bikes charged and tyres pumped','Check delivery boxes and straps','Check delivery float','Turn on online orders','Test delivery phone','Confirm order radius and delivery times','Check helmets lights and locks','Clean delivery bags','Wipe bikes after service','Record any damage'], weekly:['Tyre pressure check','Lube bike chains','Brake test and adjust pads','Clean bike frames','Replace damaged straps','Deep clean delivery area','Inventory of boxes and spares'] },
    owner:{ daily:['Open Circle T - Today','Ops Manager - what needs you today','Roster confirmed','Produce orders - anything overdue?','Catering enquiries actioned','Voice Notes cleared'] }
  };
  for (const b of bs) {
    if (b.type !== 'toggle') continue;
    const t = txt(b).toLowerCase();
    let role = null;
    if (t.includes('pizza') || t.includes('kitchen')) role = 'pizza';
    else if (t.includes('bar')) role = 'bar';
    else if (t.includes('delivery')) role = 'delivery';
    else if (t.includes('owner')) role = 'owner';
    if (!role) continue;
    const ch = await blocks(b.id);
    for (const c of ch) {
      const ct = txt(c).toLowerCase();
      const period = ct.includes('weekly') ? 'weekly' : 'daily';
      if (c.type === 'toggle') {
        const items = await blocks(c.id);
        for (const it of items) {
          const s = txt(it).trim();
          if (s && res[role][period] !== undefined) res[role][period].push(s);
        }
      } else if (['to_do','bulleted_list_item'].includes(c.type)) {
        const s = txt(c).trim();
        if (s) res[role].daily.push(s);
      }
    }
  }
  for (const [role, periods] of Object.entries(res)) {
    for (const [period, items] of Object.entries(periods)) {
      if (!items.length && def[role] && def[role][period]) res[role][period] = def[role][period];
    }
  }
  return res;
}
​
async function main() {
  console.log('Fetching Notion data...');
  const [focus, cls] = await Promise.all([getTodayFocus(), getChecklists()]);
  console.log('Focus items:', focus.length);
  const ts = new Date().toLocaleString('en-AU', {timeZone:'Australia/Melbourne'});
  let html = readFileSync('index.html', 'utf8');
  html = html.replace(
    /var TODAY_FOCUS = \[.*?\];/,
    'var TODAY_FOCUS = ' + JSON.stringify(focus) + ';'
  );
  html = html.replace(
    /var CHECKLISTS = \{[\s\S]*?\};\n/,
    'var CHECKLISTS = ' + JSON.stringify(cls) + ';\n'
  );
  html = html.replace(
    /<!-- Built from Notion:.*?-->/,
    '<!-- Built from Notion: ' + ts + ' AEST -->'
  );
  html = html.replace(
    /Notion sync:.*?<\/div>/,
    'Notion sync: ' + ts + '</div>'
  );
  writeFileSync('index.html', html, 'utf8');
  console.log('Done - index.html updated');
}
​
main().catch(function(e){ console.error(e); process.exit(1); });
​
Notion AI
