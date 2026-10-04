import { ArrowUpRight, ScanLine } from "lucide-react";
import { LandingPhoto } from "./LandingPhoto";
import { MiniScreen, Status } from "./LandingVisuals";

/** An illustrated review of the existing demo, not a live analysis. */
export function HeroGraphic() {
  return (
    <figure className="lp-hero-art" aria-label="사전선택된 유료 옵션을 찾아 검토하는 제품 UI 예시">
      <div className="lp-hero-photo">
        <LandingPhoto kind="pet" priority sizes="(max-width: 639px) 240px, 290px" />
        <span>BEHIND EVERY SCREEN</span>
      </div>
      <div className="lp-hero-device lp-review-window">
        <div className="lp-review-chrome">
          <strong>
            DarkAudit<span>.</span>
          </strong>
          <span>
            펫보험 가입 흐름 <span className="lp-review-example">예시</span>
          </span>
          <ArrowUpRight size={16} aria-hidden="true" />
        </div>
        <div className="lp-review-columns">
          <div className="lp-review-source">
            <div className="lp-review-source-label">
              <ScanLine size={12} aria-hidden="true" /> 02 · 옵션 선택
            </div>
            <MiniScreen />
          </div>
          <div className="lp-review-insight">
            <div className="lp-card-meta">
              <span className="lp-tiny">FINDING 01</span>
              <Status />
            </div>
            <p className="lp-review-title">
              선택하기 전에,
              <br />
              선택되어 있습니다.
            </p>
            <p className="lp-review-observation">
              월 3,200원이 추가되는 특약이
              <br />
              기본 선택되어 있습니다.
            </p>
            <div className="lp-review-rule">
              <span className="lp-rule-code">DA-04</span>
              <span>특정옵션의 사전선택</span>
            </div>
            <div className="lp-review-recommendation">
              <span>FIX / 개선 권고</span>
              <strong>
                기본 선택을 해제하고,
                <br />
                결정은 사용자에게.
              </strong>
              <ArrowUpRight size={15} aria-hidden="true" />
            </div>
          </div>
        </div>
        <div className="lp-review-window-footer">
          <span>
            <i /> 화면 근거와 연결된 발견 항목
          </span>
          <span>담당자 검토 필요</span>
        </div>
      </div>
      <figcaption>가상 보험 화면을 활용한 진단 예시</figcaption>
    </figure>
  );
}
