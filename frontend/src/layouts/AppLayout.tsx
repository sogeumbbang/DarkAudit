import { BookOpen, ClipboardList, Home, Menu, Settings, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";

import { Brand } from "@/components/common/Brand";
import { cn } from "@/lib/cn";

const navigation = [
  { label: "대시보드", icon: Home, to: "/app/overview" },
  { label: "진단 관리", icon: ClipboardList, to: "/app/audits" },
  { label: "검토 기준", icon: BookOpen, to: "/app/guidelines" },
  { label: "설정", icon: Settings, to: "/app/settings" },
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
        "fixed inset-y-0 left-0 z-20 flex-col bg-brand-950 p-5 text-white transition-[width]",
        collapsed && !mobile ? "w-[88px]" : "w-[280px]",
        mobile ? "flex lg:hidden" : "hidden lg:flex",
      )}
    >
      <div className="flex items-center justify-between px-2 py-2">
        {!collapsed || mobile ? (
          <Brand />
        ) : (
          <span className="px-1 text-xl font-bold text-brand-400">D</span>
        )}
        <button
          aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          className={cn(
            "rounded-control border border-white/20 p-2 text-white/80",
            mobile && "invisible",
          )}
          onClick={onCollapse}
        >
          <Menu size={17} />
        </button>
      </div>
      <nav aria-label="주요 메뉴" className="mt-7 space-y-2">
        {navigation.map(({ label, icon: Icon, to }) => (
          <NavLink
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-control px-4 py-3.5 text-sm font-medium text-white/75 transition-colors hover:bg-white/5 hover:text-white",
                isActive && "bg-brand-600 text-white shadow-lg shadow-black/10",
              )
            }
            key={to}
            onClick={onNavigate}
            to={to}
          >
            <Icon aria-hidden="true" size={19} />
            {(!collapsed || mobile) && label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto space-y-4">
        <div
          className={cn(
            "rounded-card border border-white/20 p-4",
            collapsed && !mobile && "hidden",
          )}
        >
          <p className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="text-brand-400" size={21} /> 안전한 규제 준수
          </p>
          <p className="mt-3 text-xs leading-5 text-white/55">
            금융보안 및 개인정보 보호 기준을 준수하여 안전하게 운영됩니다.
          </p>
          <Link
            className="mt-4 inline-block text-xs font-semibold text-brand-400"
            to="/app/guidelines"
          >
            자세히 보기 →
          </Link>
        </div>
      </div>
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
              className="absolute right-5 top-7 rounded-control border border-white/20 p-2 text-white lg:hidden"
              onClick={() => setIsMenuOpen(false)}
            >
              <X size={17} />
            </button>
          </div>
        </div>
      )}
      <main className="min-w-0 p-4 sm:p-6 lg:p-8">
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
    </div>
  );
}
