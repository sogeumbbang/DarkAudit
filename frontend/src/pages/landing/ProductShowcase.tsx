import {
  ArrowRight,
  Check,
  FileText,
  ListChecks,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { ReportPreview, RuleCard } from "./LandingVisuals";

import { ChoiceExhibit, FindingExhibit, ScreenExhibit } from "./ProductScenes";

const features = [
  {
    id: "screen",
    label: "화면 검토",
    eyebrow: "화면 검토",
    title: (
      <>
        놓치기 쉬운 곳을
        <br />
        함께 살펴봅니다.
      </>
    ),
    description:
      "위험이 의심되는 부분을 화면에서 확인하세요. 문구와 선택 상태를 살펴보며 사용자의 관점에서 검토합니다.",
    details: ["화면별 위험 후보", "문제 위치 표시", "선택 상태 확인", "화면 속 근거"],
    icon: ScanLine,
  },
  {
    id: "finding",
    label: "탐지 결과",
    eyebrow: "탐지 결과와 근거",
    title: (
      <>
        무엇을 발견했는지,
        <br />
        근거를 확인하세요.
      </>
    ),
    description:
      "탐지한 항목과 관찰 내용을 함께 읽어보세요. 어떤 상황에서 위험 후보가 발견됐는지 확인하고 검토할 부분을 판단합니다.",
    details: ["발견 항목", "관찰 내용", "화면 근거", "담당자 검토"],
    icon: ListChecks,
  },
  {
    id: "rule",
    label: "검토 기준",
    eyebrow: "검토 기준",
    title: (
      <>
        수정이 필요한 이유를
        <br />
        기준과 함께 확인하세요.
      </>
    ),
    description:
      "어떤 기준으로 탐지했는지 확인하세요. 화면의 문제에 해당하는 규칙을 함께 보며 검토할 수 있습니다.",
    details: ["규칙별 분류", "관련 기준", "문제와 근거 연결", "검토가 필요한 이유"],
    icon: ShieldCheck,
  },
  {
    id: "fix",
    label: "개선 권고",
    eyebrow: "개선 방향",
    title: (
      <>
        발견한 문제,
        <br />
        이렇게 바꿔보세요.
      </>
    ),
    description:
      "기본 체크 해제부터 추가 비용 안내까지, 항목별 개선 권고를 확인하세요. 서비스에 맞는 수정 방향을 정하는 데 참고할 수 있습니다.",
    details: ["구체적인 수정 방향", "사용자의 선택권", "추가 비용 안내", "담당자의 최종 판단"],
    icon: SlidersHorizontal,
  },
  {
    id: "report",
    label: "기록 · 보고서",
    eyebrow: "검토 기록과 보고서",
    title: (
      <>
        검토한 내용을
        <br />
        기록으로 남기세요.
      </>
    ),
    description:
      "검토 의견과 해결 상태를 기록하세요. 이전 진단을 다시 확인하고 PDF 보고서로 결과를 공유할 수 있습니다.",
    details: ["검토 의견", "해결 상태", "진단 기록", "PDF 보고서"],
    icon: FileText,
  },
] as const;

function FeatureVisual({ id }: { id: (typeof features)[number]["id"] }) {
  if (id === "screen") return <ScreenExhibit />;
  if (id === "finding") return <FindingExhibit />;
  if (id === "rule")
    return (
      <>
        <div className="lp-feature-rule">
          <RuleCard />
          <div className="lp-feature-rule-why">
            <span className="lp-tiny">검토가 필요한 이유</span>
            <p>사용자가 모르는 사이에 추가 비용이 드는 옵션이 선택될 수 있습니다.</p>
          </div>
        </div>
        <span className="lp-feature-marker">DA-04 · 오도형</span>
      </>
    );
  if (id === "fix") return <ChoiceExhibit />;
  return (
    <>
      <div className="lp-feature-report">
        <ReportPreview />
      </div>
      <span className="lp-feature-marker">
        <FileText size={15} aria-hidden="true" />
        검토 기록 · PDF
      </span>
    </>
  );
}

export function ProductShowcase() {
  const [selected, setSelected] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const feature = features[selected] ?? features[0];
  const Icon = feature.icon;
  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % features.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + features.length) % features.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = features.length - 1;
    else return;
    event.preventDefault();
    setSelected(next);
    tabRefs.current[next]?.focus({ preventScroll: true });
  }
  return (
    <section className="lp-section lp-product-section" aria-labelledby="lp-product-title">
      <div className="lp-product-intro lp-section-heading lp-container">
        <div>
          <p className="lp-eyebrow">
            <span className="lp-chapter-number">01</span> 주요 기능
          </p>
          <h2 id="lp-product-title">
            좋은 금융 경험,
            <br />
            세심한 검토부터.
          </h2>
        </div>
        <p>
          하나의 화면을 여러 관점에서 검토합니다.
          <br />
          선택 상태부터 수정이 필요한 근거까지 함께 살펴보세요.
        </p>
      </div>
      <div className="lp-product-explorer">
        <div role="tablist" aria-label="DarkAudit 기능 둘러보기" className="lp-product-tabs">
          {features.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`product-tab-${item.id}`}
              aria-controls={`product-panel-${item.id}`}
              aria-selected={index === selected}
              tabIndex={index === selected ? 0 : -1}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              onClick={() => setSelected(index)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {features
          .filter((item) => item.id !== feature.id)
          .map((item) => (
            <div
              key={item.id}
              id={`product-panel-${item.id}`}
              role="tabpanel"
              aria-labelledby={`product-tab-${item.id}`}
              hidden
            />
          ))}
        <div
          key={feature.id}
          id={`product-panel-${feature.id}`}
          role="tabpanel"
          aria-labelledby={`product-tab-${feature.id}`}
          tabIndex={0}
          className={`lp-product-panel lp-product-panel-${feature.id}`}
        >
          <div className="lp-feature-copy">
            <span className="lp-feature-icon">
              <Icon size={30} strokeWidth={1.5} aria-hidden="true" />
            </span>
            <p className="lp-eyebrow">{feature.eyebrow}</p>
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
            <ul>
              {feature.details.map((detail) => (
                <li key={detail}>
                  <Check size={14} aria-hidden="true" />
                  {detail}
                </li>
              ))}
            </ul>
            {feature.id === "rule" && (
              <Link to="/app/guidelines" className="lp-feature-link">
                검토 기준 살펴보기
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
            )}
          </div>
          <div className="lp-feature-visual">
            <FeatureVisual id={feature.id} />
          </div>
        </div>
      </div>
      <p className="lp-example-note lp-container">
        가상의 보험 가입 화면으로 기능을 설명한 예시입니다. 최종 판단과 화면 수정은 담당자가 합니다.
      </p>
    </section>
  );
}
