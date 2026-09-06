const query = new URLSearchParams(location.search);
const clean = query.get("variant") === "clean";
const rawStep = Number(query.get("step") || 1);
const step = Number.isInteger(rawStep) && rawStep >= 1 && rawStep <= 5 ? rawStep : 1;
document.body.classList.toggle("clean", clean);
document.querySelector("#step-label").textContent = `${step} / 5 · 모아 투자관리`;
document.querySelector("#progress").style.width = `${step * 20}%`;
const next = '<button type="button" data-next>다음</button>';
const screens = {
  1: `<h1>투자의 시작을<br>더 가볍게</h1><p>모아 투자관리 기본 플랜<br>추가 옵션 없이 시작하는 투자 정보 서비스</p><div class="card"><span class="eyebrow">월 이용료 총액</span><p class="price">${clean ? "11,400" : "9,900"}원</p>${clean ? "<p>기본 이용료 9,900원 + 필수 관리수수료 1,500원</p>" : ""}<p class="benefit">다양한 자산에 분산 투자</p></div><p class="notice">안내된 투자상품은 원금 손실이 최대 100%까지 발생할 수 있으며 예금자보호 대상이 아닙니다.</p>${next}`,
  2: `<h1>나에게 맞는<br>서비스 설정</h1><p>선택사항을 확인해 주세요.</p><label><input type="checkbox" ${clean ? "" : "checked"}>[선택] 광고성 마케팅 정보 수신</label><label><input type="checkbox" ${clean ? "" : "checked"}>[선택] 제휴사 개인정보 제공</label><label><input type="checkbox" ${clean ? "" : "checked"}>[선택] 만기 시 자동 재투자</label><p>모두 무료 선택사항입니다.<br>동의하지 않아도 기본 서비스를 이용할 수 있습니다.</p>${next}`,
  3: `<h1>혜택 알림을<br>받으시겠어요?</h1><p>선택 서비스 · 무료</p><div class="card"><p class="benefit">나에게 맞는 금융 혜택 소식</p><p>광고성 상품 추천 알림을 보내드립니다.<br>이용료와 기본 서비스는 선택에 관계없이 동일합니다.</p></div><button type="button" data-next>혜택 알림 받기</button><button type="button" class="secondary" data-next>알림 없이 계속하기</button>`,
  4: `<h1>혜택 소식을<br>놓치지 마세요</h1><p>알림 서비스 최종 안내</p><div class="card"><p class="pressure">${clean ? "알림을 받지 않아도 기본 서비스를 동일하게 이용할 수 있습니다." : "지금 동의하지 않으면 준비된 혜택이 모두 사라집니다. 놓치고 후회하시겠어요?"}</p></div><p>혜택 알림은 무료 선택 서비스입니다.</p>${next}`,
  5: `<h1>마지막으로<br>이용료를 확인하세요</h1><p>모아 투자관리 · 동일한 기본 플랜<br>추가 옵션 없음</p><div class="card"><div class="row"><span>기본 이용료</span><strong>9,900원</strong></div><div class="row"><span>필수 관리수수료</span><strong>1,500원</strong></div><hr><span class="eyebrow">월 이용료 총액</span><p class="price">11,400원</p></div><p>테스트가 완료되었습니다.<br>실제 계약이나 결제는 진행되지 않습니다.</p>`
};
document.querySelector("#screen").innerHTML = screens[step];
document.querySelectorAll("[data-next]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = new URL(location.href);
    target.searchParams.set("step", String(step + 1));
    location.href = target.href;
  });
});
