import {
  ArrowUpRight,
  BookOpen,
  ClipboardList,
  LayoutDashboard,
  Plus,
  Menu,
  X,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

import { Brand } from "@/components/common/Brand";
import { brandLogo } from "@/components/common/brandLogo";
import { ChatbotWidget } from "@/features/chatbot/ChatbotWidget";
import { cn } from "@/lib/cn";
import "./workspace.css";

const navigation = [
  { label: "대시보드", icon: LayoutDashboard, to: "/app/dashboard", nested: false },
  { label: "새 진단", icon: Plus, to: "/app/audits/new", nested: true },
  { label: "진단 기록", icon: ClipboardList, to: "/app/audits", nested: true },
  { label: "검토 기준", icon: BookOpen, to: "/app/guidelines", nested: false },
];

function Sidebar({
  collapsed = false,
  mobile = false,
  onCollapse,
  onNavigate,
}: {
  collapsed?: boolean;
  mobile?: boolean;
  onCollapse?: () => void;
  onNavigate?: () => void;
}) {
  return (
    <aside
      className={cn(
        "workspace-sidebar flex-col bg-surface p-5 text-text transition-[width]",
        collapsed && !mobile ? "w-[88px]" : "w-[240px]",
        mobile ? "relative flex h-full" : "fixed inset-y-0 left-0 z-20 hidden lg:flex",
      )}
    >
      <div className="flex items-center justify-between px-2 py-2">
        {!collapsed || mobile ? (
          <Brand dark />
        ) : (
          <img alt="DarkAudit" className="h-6 w-auto" src={brandLogo({ compact: true })} />
        )}
        <button
          aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          className={cn(
            "rounded-control border border-border p-2 text-muted",
            mobile && "invisible",
          )}
          onClick={onCollapse}
        >
          <Menu size={17} />
        </button>
      </div>
      <nav aria-label="주요 메뉴" className="mt-8 space-y-1 border-t border-border pt-6">
        {navigation.map(({ label, icon: Icon, to, nested }) => (
          <Fragment key={to}>
            {label === "새 진단" && (!collapsed || mobile) && (
              <p className="px-4 pb-1 pt-5 text-xs font-semibold text-muted">진단 관리</p>
            )}
            <NavLink
              end
              aria-label={label}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 border-l-2 border-transparent px-4 py-3.5 text-sm font-medium text-muted transition-colors hover:bg-brand-50 hover:text-brand-600",
                  isActive && "border-brand-600 bg-brand-50 text-brand-600",
                  nested && (!collapsed || mobile) && "ml-4 border-l border-border",
                )
              }
              key={to}
              onClick={onNavigate}
              to={to}
            >
              <Icon aria-hidden="true" size={19} />
              {(!collapsed || mobile) && label}
            </NavLink>
          </Fragment>
        ))}
      </nav>
      {(!collapsed || mobile) && (
        <div className="mt-auto border-t border-border px-3 pt-5">
          <p className="text-[10px] tracking-[0.15em] text-brand-600">DARKAUDIT</p>
          <p className="mt-2 text-xs leading-6 text-muted">
            금융상품 화면을 검토하고,
            <br />
            개선의 근거를 남깁니다.
          </p>
        </div>
      )}
    </aside>
  );
}

function MobileNavigation({ onDismiss }: { onDismiss: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) onDismiss();
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      desktop.removeEventListener("change", closeOnDesktop);
      document.body.style.overflow = previousOverflow;
      dialog?.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [onDismiss]);

  return (
    <dialog
      id="mobile-navigation"
      ref={dialogRef}
      className="workspace-mobile-menu"
      aria-label="주요 메뉴"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'a[href], button:not([tabindex="-1"])',
          ),
        ].filter(
          (element) =>
            element.getClientRects().length && getComputedStyle(element).visibility !== "hidden",
        );
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
    >
      <button
        aria-label="메뉴 닫기"
        tabIndex={-1}
        className="workspace-menu-backdrop"
        onClick={onDismiss}
      />
      <div className="workspace-menu-panel">
        <Sidebar mobile onNavigate={onDismiss} />
        <button
          aria-label="메뉴 닫기"
          className="workspace-menu-close rounded-control border border-border text-text"
          onClick={onDismiss}
        >
          <X size={20} />
        </button>
      </div>
    </dialog>
  );
}

const reviewFlowPath = /^\/app\/(overview|benchmark|audits\/[^/]+\/recheck)$/;

export function AppLayout() {
  const { pathname } = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <div
      className={cn(
        "workspace min-h-screen bg-background",
        // Result, revision and comparison are one flow; keep one palette and spacing.
        reviewFlowPath.test(pathname) && "workspace--overview",
        isCollapsed ? "lg:pl-[88px]" : "lg:pl-[240px]",
      )}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-white focus:p-3"
      >
        본문으로 건너뛰기
      </a>
      <Sidebar collapsed={isCollapsed} onCollapse={() => setIsCollapsed((value) => !value)} />
      {isMenuOpen && <MobileNavigation onDismiss={() => setIsMenuOpen(false)} />}
      <main id="main-content" className="workspace-main min-w-0">
        <div className="workspace-mobile-header flex items-center gap-3 lg:hidden">
          <button
            aria-label="메뉴 열기"
            aria-expanded={isMenuOpen}
            aria-controls={isMenuOpen ? "mobile-navigation" : undefined}
            className="rounded-control border border-border p-2 text-text"
            onClick={() => setIsMenuOpen(true)}
          >
            <Menu size={20} />
          </button>
          <Brand dark compact />
        </div>
        <div className="workspace-topbar">
          <span>
            FINANCIAL UX <span aria-hidden="true">/</span> REVIEW WORKSPACE
          </span>
          <Link to="/landing">
            DarkAudit 소개 <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        </div>
        <Outlet />
      </main>
      <ChatbotWidget />
    </div>
  );
}
