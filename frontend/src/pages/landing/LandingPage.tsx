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
                놓치기 쉬운 다크패턴 위험과 <br />
                수정이 필요한 이유를 확인하세요.
                <br />
                금융상품 가입 화면을 근거와 함께 검토합니다.
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
                  문제의 위치부터
                  <br />
                  수정이 필요한 이유까지.
                </h2>
              </div>
              <p>
                어디에서 무엇을 발견했는지 화면과 근거를 함께 확인하세요.
                <br />
                검토가 필요한 이유와 수정 방법도 살펴볼 수 있습니다.
              </p>
            </div>
            <FindingWorkspace />
            <p className="lp-workspace-disclaimer">
              AI가 제시한 위험 후보와 개선 권고는 담당자가 검토해야 합니다.
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
                  작은 수정으로
                  <br />
                  선택이 분명해집니다.
                </h2>
              </div>
            </div>
            <div className="lp-comparison">
              <div className="lp-comparison-before">
                <div className="lp-card-meta">
                  <span className="lp-tiny">수정 전 / 발견한 화면</span>
                  <Status>사전선택</Status>
                </div>
                <MiniScreen />
                <div className="lp-comparison-caption">
                  <span className="lp-annotation-dot" />
                  <p>
                    사용자가 고르기도 전에
                    <br />
                    <strong>추가 비용이 드는 옵션이 선택돼 있습니다.</strong>
                  </p>
                </div>
              </div>
              <div className="lp-comparison-arrow" aria-hidden="true">
                <ArrowRight size={25} />
              </div>
              <div className="lp-comparison-after">
                <div className="lp-card-meta">
                  <span className="lp-tiny">수정 후 / 개선 방향 예시</span>
                  <Status safe>직접 선택</Status>
                </div>
                <MiniScreen corrected />
                <div className="lp-comparison-caption">
                  <Check size={20} aria-hidden="true" />
                  <p>
                    보장 내용과 비용을 확인한 뒤
                    <br />
                    <strong>필요한 옵션만 직접 선택합니다.</strong>
                  </p>
                </div>
              </div>
            </div>
            <p className="lp-example-note">
              개선 권고를 화면에 적용한 예시입니다. 실제 화면은 담당자가 수정합니다.
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
                발견한 문제와
                <br />
                검토 결과를 기록하세요.
              </h2>
              <p>
                진단 결과에 근거와 개선 권고를 담고
                <br />
                담당자의 판단을 기록으로 남깁니다.
              </p>
              <div className="lp-report-deliverables">
                <div>
                  <span>01</span>
                  <p>
                    <strong>어디를 확인할지</strong>문제가 있는 화면 위치와 탐지 근거를 확인합니다.
                  </p>
                </div>
                <div>
                  <span>02</span>
                  <p>
                    <strong>어떻게 개선할지</strong>검토 기준에 따른 구체적인 개선 권고를
                    살펴봅니다.
                  </p>
                </div>
                <div>
                  <span>03</span>
                  <p>
                    <strong>무엇을 처리했는지</strong>검토 의견과 해결 상태를 남기고 PDF 보고서로
                    공유합니다.
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
              이제 내 화면을
              <br />
              살펴보세요.
            </h2>
            <div className="lp-closing-copy">
              <p>
                사용자가 만나기 전에
                <br />한 번 더 꼼꼼히 살펴보세요.
              </p>
            </div>
          </div>
          <footer className="lp-footer lp-container">
            <Brand dark />
            <p>금융 화면을 더 명확하게. 선택을 더 공정하게.</p>
            <span>금융 UX · 소비자 보호</span>
          </footer>
        </section>
      </main>
      <BackToTop />
    </div>
  );
}
