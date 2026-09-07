const data=DEMO.steps[index];
    const screen=frame(page,`${String(index+1).padStart(2,"0")}_${data.name}`,393,0,"white",24);
    screen.x=100+index*453; screen.y=100; screen.resize(393,852); screen.primaryAxisSizingMode="FIXED"; screen.clipsContent=true;
    const header=frame(screen,"Brand and progress",345,14);
    text(header,"◈  lit     릿 크레딧",24,"accent",true);
    text(header,`CREDIT MEMBERSHIP                                  0${index+1} / 06`,10,"muted");
    const track=frame(header,"Progress",345,0,"soft"); track.resize(345,3);track.primaryAxisSizingMode="FIXED";
    const bar=figma.createRectangle(); track.appendChild(bar);bar.resize(345*(index+1)/6,3);bar.fills=paint("accent");
    const body=frame(screen,"Content",345,8); body.paddingTop=18; body.layoutGrow=1;
    text(body,data.tag,11,"accent",true);text(body,data.title,29,"ink",true);text(body,data.description,12,"muted");
    if(data.kind==="offer") {
      const hero=frame(body,"Membership highlight",345,4,"accent",16);hero.cornerRadius=18;
      text(hero,data.product,11,"white");text(hero,data.metric,38,"white",true);text(hero,data.metricLabel,12,"white");
      text(hero,"LIT PLUS                         YOUR NEXT POSSIBILITY",8,"white");
      text(body,"체험 기간 이용료                                    0원 / 7일",14,"ink",true);
      data.features.forEach(value=>text(body,"✓  "+value,12));text(body,data.fine,8,"faint");
    } else if(data.kind==="options") {
      for(const [name,detail] of data.options) {
        const option=frame(body,"Selected / "+name,345,5,"soft",15);option.cornerRadius=12;option.strokes=paint("accent");
        text(option,"☑  "+name,13,"ink",true);text(option,detail,10,"muted");
      }
      text(body,data.note,10,"muted");
    } else if(data.kind==="choice" || data.kind==="pressure") {
      const card=frame(body,"Personal credit card",345,10,"soft",24);card.cornerRadius=18;
      text(card,"LIT PLUS / PERSONAL CREDIT",10,"accent");text(card,"◈",58,"accent",true);
      text(card,data.metric,19,"ink",true);text(card,data.metricLabel,11,"muted");
      if(data.pressure) text(body,data.pressure,18,"pressure",true);
      else data.features.forEach(value=>text(body,"✓  "+value,12));
    } else if(data.kind==="conditions") {
      const doc=frame(body,"Cancellation guide",345,15,"soft",20);doc.cornerRadius=16;
      text(doc,"≡  구독 관리 안내",19,"ink",true);data.features.forEach(value=>text(doc,value,13));
      text(doc,"LIT / PERSONAL PLAN",9,"muted");text(body,data.fine,9,"faint");
    } else {
      const receipt=frame(body,"Renewal receipt",345,16,"soft",20);receipt.cornerRadius=16;
      text(receipt,"LIT / PLAN SUMMARY",10,"accent");data.rows.forEach(([name,amount])=>text(receipt,name+"      "+amount,13));
      text(receipt,"최종 월 이용료",12,"muted");text(receipt,data.amount+"원",36,"accent",true);
      text(body,data.note,11,"muted");text(body,"✓  데모 흐름을 모두 확인했어요",14,"accent",true);text(body,"실제 계약이나 결제는 발생하지 않습니다.",10,"muted");
    }
    const actions=frame(screen,"Actions",345,7);actions.paddingTop=16;
    if(data.cta) {
      const button=primary.createInstance();actions.appendChild(button);button.setProperties({[property]:data.cta});buttons.push({node:button,index});
      if(data.secondary) {const secondary=text(actions,data.secondary,9,"faint");secondary.textAlignHorizontal="CENTER";buttons.push({node:secondary,index});}
    }
    const footer=text(screen,"DarkAudit 가상 데모 · 실제 금융상품이 아닙니다",8,"muted");footer.textAlignHorizontal="CENTER";
    screens.push(screen);
