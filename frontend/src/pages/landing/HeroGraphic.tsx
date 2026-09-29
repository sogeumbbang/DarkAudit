import { ArrowDownRight, Check, ScanLine } from "lucide-react";

/** Static product illustration, separate from real audit results. */
export function HeroGraphic() {
  return (
    <figure className="hero-graphic" aria-label="미리 선택된 유료 옵션을 찾아 검토하는 예시">
      <div className="inspection-heading">
        <span className="font-mono">SCREEN REVIEW / 02</span>
        <ScanLine size={20} strokeWidth={1.5} aria-hidden="true" />
      </div>
      <div className="inspection-screen">
        <div className="inspection-screen-top">
          <span>나의 보장 설계</span>
          <span className="font-mono">02 / 03</span>
        </div>
        <p className="inspection-title">
          필요한 보장만,
          <br />
          내가 선택하도록.
        </p>
        <p className="inspection-subtitle">가입 전, 추가 옵션을 확인하세요.</p>
        <div className="inspection-option">
          <span className="inspection-check" aria-hidden="true">
            <Check size={14} />
          </span>
          <span>기본 보장</span>
          <span>포함</span>
        </div>
        <div className="inspection-finding">
          <span className="inspection-marker font-mono">01 — CHECK POINT</span>
          <div className="inspection-option">
            <span className="inspection-check" aria-hidden="true">
              <Check size={14} />
            </span>
            <span>안심케어 서비스</span>
            <span>월 3,000원</span>
          </div>
          <p>선택하지 않은 유료 옵션이 체크되어 있어요.</p>
        </div>
        <div className="inspection-next" aria-hidden="true">
          선택한 보장 확인 <span>→</span>
        </div>
      </div>
      <div className="inspection-note">
        <ArrowDownRight size={24} strokeWidth={1.5} aria-hidden="true" />
        <div>
          <p className="font-mono inspection-code">DA-04 / 사전선택</p>
          <p>선택은 사용자가 직접 하도록.</p>
          <span>초기 체크를 해제하고, 추가 비용을 명확하게.</span>
        </div>
      </div>
      <figcaption>이해를 돕기 위한 진단 예시 · 최종 판단은 담당자 검토</figcaption>
    </figure>
  );
}
