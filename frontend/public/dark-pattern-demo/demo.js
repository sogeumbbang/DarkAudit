const query = new URLSearchParams(location.search);
const scenarioId = Object.hasOwn(window.DEMO_SCENARIOS, query.get("scenario"))
  ? query.get("scenario")
  : "travel";
const scenario = window.DEMO_SCENARIOS[scenarioId];
const rawStep = Number(query.get("step") || 1);
const step =
  Number.isInteger(rawStep) && rawStep >= 1 && rawStep <= scenario.steps.length ? rawStep : 1;
const screen = scenario.steps[step - 1];
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
const copy = (value) => escapeHtml(value).replace(/\n/g, "<br>");
const list = (items) =>
  `<ul class="features">${items.map((item) => `<li><span class="tick">✓</span>${copy(item)}</li>`).join("")}</ul>`;
function readOptions() {
  try {
    return JSON.parse(sessionStorage.getItem(`demo-${scenarioId}-options`) || "null");
  } catch {
    return null;
  }
}
document.body.dataset.theme = scenario.theme;
document.title = `${scenario.local} · ${screen.name} · 가상 데모`;
document.querySelector("#brand").innerHTML =
  `<b class="brand-symbol">${scenario.symbol}</b><strong>${scenario.brand}<small>${scenario.local}</small></strong><span class="header-menu">•••</span>`;
document.querySelector("#step-label").innerHTML =
  `<span>${scenario.category}</span><strong>${String(step).padStart(2, "0")} <i>/ 06</i></strong>`;
document.querySelector("#progress").style.width = `${(step / 6) * 100}%`;
const header = `<div class="section-tag">${copy(screen.tag)}</div><h1>${copy(screen.title)}</h1><p class="description">${copy(screen.description)}</p>`;
let body = "";
if (screen.kind === "offer") {
  body = `<div class="hero-card"><div class="orb orb-one"></div><div class="orb orb-two"></div><span class="hero-kicker">${copy(screen.product)}</span><div class="hero-metric">${copy(screen.metric)}</div><span class="hero-label">${copy(screen.metricLabel)}</span><div class="hero-bottom"><span>나에게 맞는 금융의 시작</span><b>${scenario.symbol}</b></div></div><div class="price-inline"><span>${scenarioId === "credit" ? "체험 기간 이용료" : "월 이용료 총액"}</span><strong>${screen.amount}<small>${copy(screen.unit)}</small></strong></div>${list(screen.features)}<p class="fine-print">${copy(screen.fine)}</p>`;
} else if (screen.kind === "options") {
  const saved = step === 2 ? readOptions() : null;
  body = `<div class="options">${screen.options.map(([title, detail, checked], index) => `<label class="option"><input type="checkbox" data-option="${index}" ${(saved?.[index] ?? checked) ? "checked" : ""}><span><strong>${copy(title)}</strong><small>${copy(detail)}</small></span><span class="option-mark">추천</span></label>`).join("")}</div><aside class="info"><span>i</span><p>${copy(screen.note)}</p></aside>`;
} else if (screen.kind === "choice" || screen.kind === "pressure") {
  body = `<div class="illustration" aria-hidden="true"><div class="halo"></div><div class="mini-card"><span>${scenario.brand.toUpperCase()} PLUS</span><b>${scenario.symbol}</b><small>YOUR NEXT POSSIBILITY</small></div><span class="spark">✦</span></div><div class="feature-callout"><h2>${copy(screen.metric)}</h2><p>${copy(screen.metricLabel)}</p></div>${screen.pressure ? `<div class="pressure">${copy(screen.pressure)}</div>` : list(screen.features)}`;
} else if (screen.kind === "conditions") {
  body = `<div class="document-card"><div class="document-icon">≡</div><h2>${scenarioId === "pet" ? "보장 내역 안내서" : "구독 관리 안내"}</h2>${list(screen.features)}<div class="document-stamp">${scenario.brand.toUpperCase()} · PERSONAL PLAN</div></div><p class="fine-print dense">${copy(screen.fine)}</p>`;
} else {
  const savedOptions = readOptions();
  let total = Number(screen.amount.replaceAll(",", ""));
  const optionRows =
    scenarioId === "travel"
      ? { 2: [0, 1900] }
      : scenarioId === "pet"
        ? { 2: [0, 3200], 3: [1, 1800] }
        : {};
  const rows = screen.rows.filter((row, index) => {
    const option = optionRows[index];
    if (option && savedOptions?.[option[0]] === false) {
      total -= option[1];
      return false;
    }
    return true;
  });
  body = `<div class="receipt"><div class="receipt-top"><span>${scenario.brand.toUpperCase()} / PLAN SUMMARY</span><b>✓</b></div>${rows.map(([label, amount]) => `<div class="receipt-row"><span>${copy(label)}</span><strong>${amount}</strong></div>`).join("")}<div class="receipt-total"><span>최종 월 이용료</span><strong>${total.toLocaleString("ko-KR")}<small>원</small></strong></div></div><aside class="info"><span>i</span><p>${copy(screen.note)}</p></aside><div class="complete-label"><span>✓</span><div><strong>데모 흐름을 모두 확인했어요</strong><p>실제 계약이나 결제는 발생하지 않습니다.</p></div></div>`;
}
document.querySelector("#screen").innerHTML = header + body;
document.querySelector("#actions").innerHTML = screen.cta
  ? `<button type="button" data-next>${copy(screen.cta)}<span>→</span></button>${screen.secondary ? `<button type="button" class="secondary" data-next>${copy(screen.secondary)}</button>` : ""}`
  : `<a class="restart" href="?scenario=${scenarioId}&step=1">처음부터 다시 보기 ↻</a>`;
document.querySelectorAll("[data-next]").forEach((button) =>
  button.addEventListener("click", () => {
    if (step === 2 && screen.kind === "options")
      sessionStorage.setItem(
        `demo-${scenarioId}-options`,
        JSON.stringify(
          [...document.querySelectorAll("[data-option]")].map((input) => input.checked),
        ),
      );
    const target = new URL(location.href);
    target.searchParams.set("step", String(step + 1));
    location.href = target.href;
  }),
);
document
  .querySelector(".restart")
  ?.addEventListener("click", () => sessionStorage.removeItem(`demo-${scenarioId}-options`));
