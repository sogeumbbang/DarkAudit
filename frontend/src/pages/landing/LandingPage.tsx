import { ArrowRight, ArrowUp, Check, Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Brand } from "@/components/common/Brand";
import { Button } from "@/components/ui/Button";
import { ProductShowcase } from "./ProductShowcase";
import { WorkflowSection } from "./WorkflowSection";
import { ChoiceStory, FindingWorkspace, MiniScreen, ReportPreview, Status } from "./LandingVisuals";
import "./landing.css";
import "./photography.css";
import "./showcase.css";
import "./product-scenes.css";
import "./workflow.css";

function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const updateVisibility = () => setVisible(window.scrollY > 320);
    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    return () => window.removeEventListener("scroll", updateVisibility);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      className="lp-back-to-top"
      aria-label="페이지 맨 위로"
      onClick={() => {
        document.getElementById("landing-title")?.focus({ preventScroll: true });
        window.scrollTo({
          top: 0,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        });
      }}
    >
      <ArrowUp size={22} aria-hidden="true" />
    </button>
  );
}

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="landing-page">
      <header
        className="landing-header sticky top-0 z-30 backdrop-blur"
        onKeyDown={(event) => {
          if (event.key === "Escape" && menuOpen) {
            setMenuOpen(false);
            menuButtonRef.current?.focus();
          }
        }}
      >
        <div className="page-container landing-header-inner">
          <Brand dark />
          <nav
            aria-label="랜딩 메뉴"
            id="landing-navigation"
            data-open={menuOpen}
            className="landing-navigation text-sm font-medium text-muted"
            onClick={() => setMenuOpen(false)}
          >
            <a className="py-1 hover:text-brand-700" href="#product">
              서비스 소개
            </a>
            <Link className="py-1 hover:text-brand-700" to="/app/guidelines">
              검토 기준
            </Link>
            <Link className="py-1 hover:text-brand-700" to="/app/dashboard">
              대시보드
            </Link>
          </nav>
          <button
            ref={menuButtonRef}
            type="button"
            className="landing-menu-toggle"
            aria-label={menuOpen ? "랜딩 메뉴 닫기" : "랜딩 메뉴 열기"}
            aria-expanded={menuOpen}
            aria-controls="landing-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={21} aria-hidden="true" /> : <Menu size={21} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <main className="lp-main">
        <div className="lp-intro-stage">
          <section className="lp-intro lp-container" id="product">
            <div className="lp-intro-copy">
              <h1 id="landing-title" tabIndex={-1}>
                다 만든 화면,
                <br />
                <span>다 살펴본 건가요?</span>
              </h1>
              <p className="lp-intro-description">
                놓치기 쉬운 다크패턴 위험부터 <br />
                수정이 필요한 이유까지.
                <br />
                금융상품 가입 화면을 근거와 함께 검토하세요.
              </p>
              <Button asChild className="lp-primary-action">
                <Link to="/app/audits/new">
                  내 화면 점검하기 <ArrowRight size={18} aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </section>
        </div>
        <ProductShowcase />

        <ChoiceStory />

        <WorkflowSection />

        <section
          className="lp-section lp-finding-section"
          id="finding-experience"
          aria-labelledby="finding-title"
        >
          <div className="lp-container">
            <div className="lp-section-heading">
              <div>
                <p className="lp-eyebrow">
                  <span className="lp-chapter-number">03</span> 탐지 근거
                </p>
                <h2 id="finding-title">
                  문제의 위치에서,
                  <br />
                  수정의 이유까지.
                </h2>
              </div>
              <p>
                어디에서 무엇을 발견했는지,
                <br />왜 확인해야 하고 어떻게 바꿀 수 있는지.
                <br />
                화면과 근거를 나란히 읽어보세요.
              </p>
            </div>
            <FindingWorkspace />
            <p className="lp-workspace-disclaimer">
              AI가 제시한 위험 후보와 개선 권고는 담당자의 검토가 필요합니다.
            </p>
          </div>
        </section>

        <section className="lp-section lp-comparison-section" aria-labelledby="comparison-title">
          <div className="lp-container">
            <div className="lp-comparison-heading lp-section-heading">
              <div>
                <p className="lp-eyebrow">
                  <span className="lp-chapter-number">04</span> 개선 방향
                </p>
                <h2 id="comparison-title">
                  작은 수정으로,
                  <br />
                  분명해지는 선택.
                </h2>
              </div>
              <p>기본 선택을 해제해 사용자가 직접 결정하도록.</p>
            </div>
            <div className="lp-comparison">
              <div className="lp-comparison-before">
                <div className="lp-card-meta">
                  <span className="lp-tiny">BEFORE / 발견한 화면</span>
                  <Status>사전선택</Status>
                </div>
                <MiniScreen />
                <div className="lp-comparison-caption">
                  <span className="lp-annotation-dot" />
                  <p>
                    선택하기 전에,
                    <br />
                    <strong>추가 비용이 이미 선택된 상태.</strong>
                  </p>
                </div>
              </div>
              <div className="lp-comparison-arrow" aria-hidden="true">
                <ArrowRight size={25} />
              </div>
              <div className="lp-comparison-after">
                <div className="lp-card-meta">
                  <span className="lp-tiny">AFTER / 개선 방향 예시</span>
                  <Status safe>직접 선택</Status>
                </div>
                <MiniScreen corrected />
                <div className="lp-comparison-caption">
                  <Check size={20} aria-hidden="true" />
                  <p>
                    보장 내용과 비용을 확인하고,
                    <br />
                    <strong>필요한 옵션만 직접 선택.</strong>
                  </p>
                </div>
              </div>
            </div>
            <p className="lp-example-note">
              개선 권고를 시각화한 예시입니다. 실제 화면 수정은 담당자가 진행합니다.
            </p>
          </div>
        </section>

        <section className="lp-section lp-report-section" aria-labelledby="report-title">
          <div className="lp-container lp-report-layout">
            <div className="lp-report-composition">
              <div className="lp-report-backdrop" aria-hidden="true" />
              <div className="lp-report-main">
                <ReportPreview />
              </div>
            </div>
            <div className="lp-report-copy">
              <p className="lp-eyebrow">
                <span className="lp-chapter-number">05</span> 검토 기록
              </p>
              <h2 id="report-title">
                발견에서
                <br />
                끝나지 않도록.
              </h2>
              <p>
                진단 결과에 근거와 개선 권고를 담고,
                <br />
                담당자의 판단을 기록으로 남깁니다.
              </p>
              <div className="lp-report-deliverables">
                <div>
                  <span>01</span>
                  <p>
                    <strong>어디를 확인할지</strong>화면 위치와 탐지 근거를 함께.
                  </p>
                </div>
                <div>
                  <span>02</span>
                  <p>
                    <strong>어떻게 개선할지</strong>기준에 연결된 구체적인 개선 권고.
                  </p>
                </div>
                <div>
                  <span>03</span>
                  <p>
                    <strong>무엇이 처리됐는지</strong>검토 의견, 해결 상태, PDF 보고서까지.
                  </p>
                </div>
              </div>
              <Link to="/app/guidelines" className="lp-text-link">
                DarkAudit 검토 기준 살펴보기 <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>

        <section className="lp-closing" aria-labelledby="lp-closing-title">
          <div className="lp-container lp-closing-inner">
            <h2 id="lp-closing-title">
              이제, 내 화면을
              <br />
              살펴볼 차례
            </h2>
            <div className="lp-closing-copy">
              <p>
                사용자에게 닿기 전,
                <br />한 번 더 깊이 살펴보세요.
              </p>
              <Button asChild className="lp-closing-button">
                <Link to="/app/audits/new">
                  화면 등록하고 시작하기 <ArrowRight size={18} aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </div>
          <footer className="lp-footer lp-container">
            <Brand dark />
            <p>금융 화면을 더 명확하게. 선택을 더 공정하게.</p>
            <span>Financial UX · Consumer Protection</span>
          </footer>
        </section>
      </main>
      <BackToTop />
    </div>
  );
}
