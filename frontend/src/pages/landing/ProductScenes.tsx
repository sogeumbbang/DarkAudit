import { ArrowDown, ArrowUpRight, Check, ScanLine } from "lucide-react";
import { LandingPhoto } from "./LandingPhoto";
import { AnnotatedScreen, FindingCard, OptionRow } from "./LandingVisuals";

export function ScreenExhibit() {
  return (
    <div className="lp-screen-exhibit">
      <div className="lp-exhibit-heading">
        <ScanLine size={16} aria-hidden="true" />
        <span>SCREEN REVIEW</span>
        <span>검토 예시</span>
      </div>
      <div className="lp-exhibit-rail" aria-hidden="true">
        <span>01</span>
        <span className="is-active">02</span>
        <span>03</span>
        <i />
      </div>
      <div className="lp-exhibit-sheet">
        <AnnotatedScreen />
      </div>
      <div className="lp-exhibit-caption">
        <span className="lp-annotation-dot" />
        <div>
          <span>WHERE / 발견 위치</span>
          <strong>02. 옵션 선택 화면</strong>
        </div>
        <span className="lp-rule-code">DA-04</span>
      </div>
    </div>
  );
}

export function FindingExhibit() {
  return (
    <div className="lp-finding-exhibit">
      <div className="lp-evidence-extract">
        <div className="lp-card-meta">
          <span className="lp-tiny">01 / 화면 속 근거</span>
          <ScanLine size={17} aria-hidden="true" />
        </div>
        <div className="lp-evidence-extract-selection">
          <OptionRow compact />
        </div>
        <span className="lp-extract-caption">추가 비용이 있는 옵션 · 기본 선택 상태</span>
      </div>
      <div className="lp-evidence-connector">
        <span />
        <ArrowDown size={17} aria-hidden="true" />
        <span>근거에서 발견 항목으로</span>
      </div>
      <FindingCard />
    </div>
  );
}

export function ChoiceExhibit() {
  return (
    <div className="lp-decision-scene">
      <LandingPhoto kind="choice" sizes="(max-width: 639px) 90vw, 600px" />
      <span className="lp-decision-eyebrow">A CLEARER CHOICE</span>
      <div className="lp-decision-card">
        <div className="lp-card-meta">
          <span className="lp-tiny">FIX / 개선 방향 예시</span>
          <span className="lp-decision-check">
            <Check size={16} aria-hidden="true" />
          </span>
        </div>
        <p>
          필요한 보장만,
          <br />
          내가 직접 선택하도록.
        </p>
        <OptionRow selected={false} compact />
        <div className="lp-decision-footer">
          <span>기본 선택 해제 · 비용 안내</span>
          <ArrowUpRight size={18} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
