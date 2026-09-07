const family="Noto Sans KR";const regular={family,style:"Regular"},bold={family,style:"Bold"};await Promise.all([figma.loadFontAsync(regular),figma.loadFontAsync(bold)]);
const page=await figma.getNodeByIdAsync("14:2"),foundations=await figma.getNodeByIdAsync("14:3");
const collection=await figma.variables.getVariableCollectionByIdAsync("VariableCollectionId:14:4");
const vars=(await figma.variables.getLocalVariablesAsync()).filter(v=>v.variableCollectionId===collection.id);
const variables=Object.fromEntries(vars.filter(v=>v.name.startsWith("color/")).map(v=>[v.name.slice(6),v]));
const dims=Object.fromEntries(vars.filter(v=>v.name.startsWith("dimension/")).map(v=>[v.name.slice(10),v]));
  const colors = { ink: "27223c", muted: "858094", accent: "7050e5", soft: "f1eeff", white: "ffffff", faint: "c2c5cb", line: "e8e8ee", pressure: "a44835" };
  const rgb = hex => ({r:parseInt(hex.slice(0,2),16)/255,g:parseInt(hex.slice(2,4),16)/255,b:parseInt(hex.slice(4,6),16)/255});

  function paint(name) { return [figma.variables.setBoundVariableForPaint({type:"SOLID",color:rgb(colors[name])},"color",variables[name])]; }
  function frame(parent, name, width, gap=12, fill=null, padding=0) {
    const node=figma.createFrame(); node.name=name; node.layoutMode="VERTICAL"; node.primaryAxisSizingMode="AUTO";
    node.counterAxisSizingMode="FIXED"; node.resize(width,10); node.primaryAxisSizingMode="AUTO"; node.itemSpacing=gap;
    node.paddingTop=node.paddingBottom=node.paddingLeft=node.paddingRight=padding;
    node.fills=fill ? paint(fill) : []; node.clipsContent=false; parent.appendChild(node); return node;
  }
  function text(parent, value, size=12, color="ink", weight=false) {
    const node=figma.createText(); node.name=value.split("\n")[0].slice(0,45); node.fontName=weight?bold:regular;
    node.fontSize=size; node.lineHeight={unit:"PERCENT",value:135}; node.characters=value; node.fills=paint(color);
    parent.appendChild(node); node.resize(parent.width-parent.paddingLeft-parent.paddingRight,20);
    node.textAutoResize="HEIGHT"; return node;
  }

function bindDimensions(root){for(const n of [root,...root.findAll(()=>true)]){for(const p of ["paddingTop","paddingBottom","paddingLeft","paddingRight","itemSpacing","cornerRadius"]){if(typeof n[p]==="number"&&dims[n[p]])n.setBoundVariable(p,dims[n[p]]);}}}
