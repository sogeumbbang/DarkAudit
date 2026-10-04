// Run with DEMO_VARIANTS = { risky, partial, revised } credit scenarios.
// Reuses the existing editable six-screen demo and its bound color/button assets.
const page = await figma.getNodeByIdAsync('14:2');
await figma.setCurrentPageAsync(page);
const originalIds = ['17:2','19:3','20:4','23:5','23:26','24:7'];
const originals = await Promise.all(originalIds.map(id=>figma.getNodeByIdAsync(id)));
if (originals.some(n=>!n || n.type!=='FRAME')) throw new Error('Original six-screen demo is missing');
const fonts = new Map();
for (const s of originals) for (const t of s.findAllWithCriteria({types:['TEXT']})) for (const seg of t.getStyledTextSegments(['fontName'])) fonts.set(JSON.stringify(seg.fontName),seg.fontName);
await Promise.all([...fonts.values()].map(f=>figma.loadFontAsync(f)));
const ink = await figma.variables.getVariableByIdAsync('VariableID:14:5');
const inkPaint = [figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color',ink)];
const labels={partial:'일부 수정본',revised:'전체 개선본'};
const createdNodeIds=[], flows=[];
for (const [variant,label] of Object.entries(labels)) {
  const flowName=`릿 크레딧 · ${label} · 6단계`;
  if (page.flowStartingPoints.some(f=>f.name===flowName)) { flows.push({variant,flowName,existing:true}); continue; }
  const screens=[];
  for(let i=0;i<6;i++) {
    const screen=originals[i].clone(); page.appendChild(screen);
    screen.x=originals[i].x; screen.y=variant==='partial'?1100:2150;
    // Names stay identical so regression compares the same steps across versions.
    const old=DEMO_VARIANTS.risky.steps[i], next=DEMO_VARIANTS[variant].steps[i];
    const replacements=new Map();
    function mapStrings(a,b) {
      if(typeof a==='string' && typeof b==='string' && a!==b) { replacements.set(a,b); replacements.set('✓  '+a,'✓  '+b); }
      else if(Array.isArray(a)&&Array.isArray(b)) a.forEach((x,j)=>mapStrings(x,b[j]));
      else if(a&&b&&typeof a==='object'&&typeof b==='object') for(const k of Object.keys(a)) mapStrings(a[k],b[k]);
    }
    mapStrings(old,next);
    if(variant === "revised" && i === 4) replacements.set(old.title, "원할 때 바로\n갱신 중단");
    const actions=screen.children.find(n=>n.name==='Actions');
    for(const t of screen.findAllWithCriteria({types:['TEXT']})) {
      if(t.parent.type==='INSTANCE') continue;
      if(old.features && next.features && old.features.slice(next.features.length).includes(t.characters)) { t.remove(); continue; }
      const replacement=replacements.get(t.characters);
      if(replacement!==undefined) t.characters=replacement;
      if(t.characters.startsWith('☑')) t.characters=t.characters.replace('☑','☐');
      if(variant==='revised' && t.parent!==actions) {
        if(t.fontSize<14 && !t.characters.includes('DarkAudit')) t.fontSize=14;
        const paint=t.fills[0];
        if(paint?.type==='SOLID' && paint.color.r<0.98 && t.fontSize<=18) t.fills=inkPaint;
      }
    }
    for(const b of actions.children.filter(n=>n.type==='INSTANCE')) b.setProperties({'Label#16:0':next.cta});
    const secondary=actions.children.find(n=>n.type==='TEXT');
    if(variant==='revised' && secondary) {
      if(next.secondary) {
        const main=actions.children.find(n=>n.type==='INSTANCE');
        const other=main.clone(); actions.appendChild(other); other.setProperties({'Label#16:0':next.secondary});
      }
      secondary.remove();
    }
    if(variant==='revised' && old.kind==='pressure') {
      const pressure=screen.findAllWithCriteria({types:['TEXT']}).find(t=>t.characters===old.pressure);
      pressure.characters=next.features.map(x=>'✓  '+x).join('\n'); pressure.fontSize=14; pressure.fills=inkPaint;
    }
    // Let longer readable conditions determine height, instead of clipping them.
    const body=screen.children.find(n=>n.name==='Content');
    body.layoutGrow=0; body.primaryAxisSizingMode='AUTO';
    screen.primaryAxisSizingMode='AUTO'; screen.minHeight=852; screen.clipsContent=false;
    screens.push(screen);
  }
  for(let i=0;i<screens.length-1;i++) {
    const actions=screens[i].children.find(n=>n.name==='Actions');
    for(const b of actions.children) await b.setReactionsAsync([{trigger:{type:'ON_CLICK'},actions:[{type:'NODE',destinationId:screens[i+1].id,navigation:'NAVIGATE',transition:null,resetScrollPosition:true}]}]);
  }
  page.flowStartingPoints=[...page.flowStartingPoints.filter(f=>f.nodeId!==screens[0].id),{name:flowName,nodeId:screens[0].id}];
  for(const s of screens) {createdNodeIds.push(s.id,...s.findAll(()=>true).map(n=>n.id));}
  flows.push({variant,flowName,screenIds:screens.map(s=>s.id),bounds:screens.map(s=>({width:s.width,height:s.height})),textCount:screens.reduce((sum,s)=>sum+s.findAllWithCriteria({types:['TEXT']}).length,0)});
}
return {createdNodeIds,mutatedNodeIds:[page.id],flows};
