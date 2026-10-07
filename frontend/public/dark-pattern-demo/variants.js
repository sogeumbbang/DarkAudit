// Authored input variants, never injected into analysis results.
window.DEMO_VARIANTS = { risky: window.DEMO_SCENARIOS };
for (const variant of ["partial", "revised"]) {
  const scenarios = structuredClone(window.DEMO_SCENARIOS);
  for (const [id, scenario] of Object.entries(scenarios)) {
    const [offer, options, choice, pressure, conditions, summary] = scenario.steps;
    scenario.variant = variant;
    // First fix: explicit opt-in and mandatory fees disclosed before selection.
    for (const screen of scenario.steps) {
      if (screen.options)
        screen.options = screen.options.map(([title, detail]) => [title, detail, false]);
      screen.rules = (screen.rules || []).filter((rule) => !["DA-04", "DA-15"].includes(rule));
    }
    options.title = "필요한 항목만\n직접 선택해 주세요";
    options.description =
      "선택사항은 모두 미선택 상태입니다.\n동의하지 않아도 기본 서비스를 이용할 수 있어요.";
    options.cta = "다음 · 선택 내역 확인";
    if (id === "pet") {
      offer.amount = "14,000";
      offer.features[2] = "필수 계약 관리비 1,100원 포함";
      conditions.features[1] = "선택 특약은 직접 고른 경우에만 추가";
    } else if (id === "travel") {
      offer.amount = "6,400";
      offer.features[2] = "필수 해외서비스 운영비 1,500원 포함";
    } else {
      offer.features[2] = "갱신 선택 시 월 9,900원 (관리비 포함)";
      offer.fine =
        "체험 7일은 무료입니다. 유료 갱신을 직접 선택하면 기본료 7,900원과 필수 관리비 2,000원, 합계 월 9,900원이 청구됩니다. 점수 상승은 보장하지 않습니다.";
      options.options[0][1] = "[선택] 7일 후 월 9,900원 (필수 관리비 포함)";
      summary.title = "유료 갱신을 선택할 때의\n월 이용료 안내";
      summary.description =
        "무료 체험은 자동으로 종료됩니다.\n유료 갱신은 별도로 선택해야 시작됩니다.";
      summary.note =
        "갱신하지 않으면 청구액은 0원입니다. 갱신 선택 시 기본료 7,900원 + 필수 관리비 2,000원 = 월 9,900원입니다.";
    }
    if (variant === "partial") continue;
    // Second fix: readable terms, equal choices, neutral copy and no repeated consent.
    for (const screen of scenario.steps) screen.rules = [];
    offer.metric =
      id === "pet" ? "보장 조건 확인" : id === "travel" ? "통화별 우대" : "신용 리포트";
    offer.metricLabel =
      id === "pet"
        ? "상해 90% · 질병 50%"
        : id === "travel"
          ? "USD 평일 10만 원 이하 100%"
          : "점수 상승은 보장하지 않습니다";
    if (id === "pet") {
      // Qualify the headline rate and surface its limits before the price.
      offer.metricLabel = "일부 상해 최대 90% · 질병 50%";
      offer.terms = {
        title: "보장 조건",
        items: ["일부 상해만 90%", "질병 50%", "자기부담금 3만 원", "기존·슬개골 질환 제외"],
      };
      delete offer.fine;
    }
    choice.cta = "동의하고 계속";
    choice.secondary = "동의하지 않고 계속";
    pressure.kind = "choice";
    pressure.tag = "선택 내역 안내";
    pressure.title = "선택은 자유롭게,\n서비스는 동일하게";
    pressure.description = "선택사항에 동의하지 않아도\n기본 서비스 이용에 불이익이 없습니다.";
    pressure.metric = "내 선택 존중";
    pressure.metricLabel = "추가 동의나 재선택을 요구하지 않습니다";
    delete pressure.pressure;
    pressure.features = ["앞 단계의 선택은 그대로 유지", "원할 때 설정에서 직접 변경"];
    pressure.cta = "다음 · 안내 확인";
    delete pressure.secondary;
    if (id === "travel") {
      conditions.kind = "conditions";
      conditions.tag = "알림 설정 확인";
      conditions.title = "알림 선택을\n그대로 유지합니다";
      conditions.description = "거절한 항목을 다시 켜거나\n동의를 반복해서 요구하지 않습니다.";
      conditions.features = ["광고 수신은 선택사항", "선택하지 않아도 서비스 이용 가능"];
      conditions.fine =
        "알림은 설정에서 언제든 변경할 수 있습니다. 기본 패스 월 6,400원에는 필수 운영비 1,500원이 포함됩니다.";
      conditions.cta = "다음 · 최종 금액 보기";
      delete conditions.options;
      delete conditions.secondary;
    } else if (id === "credit") {
      conditions.title = "원할 때 바로\n갱신을 중단하세요";
      conditions.description =
        "설정의 구독 관리에서 직접 중단합니다.\n상담 대기나 사유 작성은 필요하지 않습니다.";
      conditions.features = ["설정 → 구독 관리 → 갱신 중단", "중단 즉시 다음 결제 예약 해제"];
      conditions.fine =
        "24시간 직접 중단할 수 있으며 다음 갱신부터 청구하지 않습니다. 무료 체험만 이용하면 청구액은 0원입니다.";
    }
  }
  window.DEMO_VARIANTS[variant] = scenarios;
}
