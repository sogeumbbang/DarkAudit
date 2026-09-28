import { BookOpen, ClipboardList, LayoutDashboard, Plus, Menu, X } from "lucide-react";
import { Fragment, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { Brand } from "@/components/common/Brand";
import { ChatbotWidget } from "@/features/chatbot/ChatbotWidget";
import { cn } from "@/lib/cn";

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
        "fixed inset-y-0 left-0 z-20 flex-col border-r border-border bg-surface p-5 text-text transition-[width]",
        collapsed && !mobile ? "w-[88px]" : "w-[280px]",
        mobile ? "flex lg:hidden" : "hidden lg:flex",
      )}
    >
      <div className="flex items-center justify-between px-2 py-2">
        {!collapsed || mobile ? (
          <Brand dark />
        ) : (
          <span className="px-1 text-xl font-bold text-brand-600">D</span>
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
      <nav aria-label="주요 메뉴" className="mt-7 space-y-2">
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
                  "flex items-center gap-3 rounded-control px-4 py-3.5 text-sm font-medium text-muted transition-colors hover:bg-brand-50 hover:text-brand-600",
                  isActive && "bg-brand-50 text-brand-600 ring-1 ring-inset ring-accent/35",
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
    </aside>
  );
}

export function AppLayout() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <div
      className={cn(
        "min-h-screen bg-background transition-[padding]",
        isCollapsed ? "lg:pl-[88px]" : "lg:pl-[280px]",
      )}
    >
      <Sidebar collapsed={isCollapsed} onCollapse={() => setIsCollapsed((value) => !value)} />
      {isMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="메뉴 닫기"
            className="absolute inset-0 bg-black/45"
            onClick={() => setIsMenuOpen(false)}
          />
          <div className="relative h-full w-[280px] shadow-2xl">
            <Sidebar mobile onNavigate={() => setIsMenuOpen(false)} />
            <button
              aria-label="메뉴 닫기"
              className="absolute right-5 top-7 rounded-control border border-border p-2 text-text lg:hidden"
              onClick={() => setIsMenuOpen(false)}
            >
              <X size={17} />
            </button>
          </div>
        </div>
      )}
      <main className="min-w-0 px-6 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10 xl:px-12">
        <div className="mb-5 flex items-center gap-3 lg:hidden">
          <button
            aria-label="메뉴 열기"
            className="rounded-control border border-border p-2 text-text"
            onClick={() => setIsMenuOpen(true)}
          >
            <Menu size={20} />
          </button>
          <Brand dark />
        </div>
        <Outlet />
      </main>
      <ChatbotWidget />
    </div>
  );
}
