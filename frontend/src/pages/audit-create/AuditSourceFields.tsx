import {
  AppWindow,
  Globe2,
  Monitor,
  Smartphone,
  Sparkles,
  PenTool,
  UploadCloud,
  X,
} from "lucide-react";
import type { Dispatch, RefObject, SetStateAction } from "react";

import { Button } from "@/components/ui/Button";
import type { AuditDto } from "@/entities/audit/types";
import { cn } from "@/lib/cn";

export type AuditSource = "website" | "figma" | "android" | "screenshots";
export type DeviceProfile = "desktop" | "mobile";
export type UploadScreen = { id: string; file: File; previewUrl: string; flowStep: string };

const sources = [
  { id: "website", label: "웹사이트", description: "URL 자동 탐색", icon: Globe2 },
  { id: "figma", label: "Figma", description: "디자인 사전 진단", icon: PenTool },
  { id: "android", label: "Android 앱", description: "실제 기기 APK 탐색", icon: AppWindow },
  { id: "screenshots", label: "스크린샷", description: "이미지 직접 등록", icon: UploadCloud },
] satisfies Array<{ id: AuditSource; label: string; description: string; icon: typeof Globe2 }>;

export function SourcePicker({
  value,
  onChange,
}: {
  value: AuditSource;
  onChange: (value: AuditSource) => void;
}) {
  return (
    <div
      className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
      role="tablist"
      aria-label="진단 입력 소스"
    >
      {sources.map(({ id, label, description, icon: Icon }) => (
        <button
          className={cn(
            "rounded-control border p-4 text-left transition-colors",
            value === id
              ? "border-brand-500 bg-brand-50 text-brand-900"
              : "border-border hover:border-brand-300",
          )}
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
        >
          <Icon size={20} />
          <strong className="mt-3 block text-sm">{label}</strong>
          <span className="mt-1 block text-xs text-muted">{description}</span>
        </button>
      ))}
    </div>
  );
}

export function WebsiteFields({
  url,
  setUrl,
  profiles,
  toggleProfile,
  scanMode,
  setScanMode,
  goal,
  setGoal,
}: {
  url: string;
  setUrl: (value: string) => void;
  profiles: DeviceProfile[];
  toggleProfile: (profile: DeviceProfile) => void;
  scanMode: "quick" | "smart";
  setScanMode: (mode: "quick" | "smart") => void;
  goal: string;
  setGoal: (value: string) => void;
}) {
  return (
    <section className="mt-7" aria-labelledby="website-source-title">
      <h2 className="font-bold" id="website-source-title">
        웹사이트 자동 진단
      </h2>
      <p className="mt-1 text-xs text-muted">
        공개 URL을 Playwright로 열어 선택한 화면 크기에서 자동 캡처합니다.
      </p>
      <FieldLabel htmlFor="target-url" className="mt-5">
        검사할 웹사이트 주소
      </FieldLabel>
      <TextInput
        id="target-url"
        type="url"
        required
        placeholder="https://example.com/product"
        value={url}
        onChange={setUrl}
      />
      <FieldTitle>검사 화면</FieldTitle>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {(["desktop", "mobile"] as const).map((profile) => {
          const selected = profiles.includes(profile);
          const Icon = profile === "desktop" ? Monitor : Smartphone;
          return (
            <ChoiceButton key={profile} active={selected} onClick={() => toggleProfile(profile)}>
              <Icon size={20} />
              <span>
                <strong className="block text-sm">
                  {profile === "desktop" ? "데스크톱" : "모바일"}
                </strong>
                <small className="text-muted">
                  {profile === "desktop" ? "1440 × 900" : "390 × 844"}
                </small>
              </span>
            </ChoiceButton>
          );
        })}
      </div>
      <FieldTitle>탐색 방식</FieldTitle>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <ModeButton
          active={scanMode === "quick"}
          title="빠른 캡처"
          description="첫 화면과 전체 페이지 자동 캡처"
          onClick={() => setScanMode("quick")}
        />
        <ModeButton
          active={scanMode === "smart"}
          title="스마트 탐색"
          description="Computer Use로 주요 선택 흐름 탐색"
          smart
          onClick={() => setScanMode("smart")}
        />
      </div>
      {scanMode === "smart" && (
        <TextAreaField
          id="website-goal"
          label="탐색 목표"
          placeholder="예: 옵션 선택부터 최종 가격 확인 직전까지"
          value={goal}
          onChange={setGoal}
        />
      )}
    </section>
  );
}

export function FigmaFields({
  fileUrl,
  setFileUrl,
  target,
  setTarget,
  selectionMode,
  setSelectionMode,
  flowName,
  setFlowName,
}: {
  fileUrl: string;
  setFileUrl: (value: string) => void;
  target: AuditDto["platform"];
  setTarget: (value: AuditDto["platform"]) => void;
  selectionMode: "prototype-flow" | "all-frames";
  setSelectionMode: (value: "prototype-flow" | "all-frames") => void;
  flowName: string;
  setFlowName: (value: string) => void;
}) {
  return (
    <section className="mt-7" aria-labelledby="figma-source-title">
      <h2 className="font-bold" id="figma-source-title">
        Figma 디자인 진단
      </h2>
      <p className="mt-1 text-xs text-muted">
        프레임 이미지와 레이어 정보를 가져와 개발 전에 검사합니다.
      </p>
      <FieldLabel htmlFor="figma-url" className="mt-5">
        Figma 파일 링크
      </FieldLabel>
      <TextInput
        id="figma-url"
        type="url"
        required
        placeholder="https://www.figma.com/design/..."
        value={fileUrl}
        onChange={setFileUrl}
      />
      <p className="mt-2 text-xs text-muted">
        MVP에서는 링크로 접근할 수 있는 Figma 파일을 지원합니다.
      </p>
      <FieldTitle>디자인 대상</FieldTitle>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {(
          [
            ["mobile-web", "모바일 웹"],
            ["desktop-web", "데스크톱 웹"],
            ["app", "모바일 앱"],
          ] as const
        ).map(([value, label]) => (
          <SmallChoice
            key={value}
            active={target === value}
            label={label}
            onClick={() => setTarget(value)}
          />
        ))}
      </div>
      <FieldTitle>검사 범위</FieldTitle>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <ModeButton
          active={selectionMode === "prototype-flow"}
          title="프로토타입 Flow"
          description="시작점과 화면 전환 순서 중심으로 검사"
          onClick={() => setSelectionMode("prototype-flow")}
        />
        <ModeButton
          active={selectionMode === "all-frames"}
          title="전체 최상위 프레임"
          description="페이지의 주요 프레임을 일괄 검사"
          onClick={() => setSelectionMode("all-frames")}
        />
      </div>
      {selectionMode === "prototype-flow" && (
        <TextAreaField
          id="figma-flow"
          label="Flow 이름 또는 설명"
          placeholder="예: 보험 가입 Flow, 결제 확인 Flow"
          value={flowName}
          onChange={setFlowName}
          rows={2}
        />
      )}
      <InfoBox>
        서버가 Figma 프레임을 렌더링하고 텍스트·색상·좌표·컴포넌트 정보를 함께 분석합니다.
      </InfoBox>
    </section>
  );
}

export function AndroidFields({
  appFile,
  setAppFile,
  goal,
  setGoal,
  inputRef,
}: {
  appFile?: File;
  setAppFile: (file?: File) => void;
  goal: string;
  setGoal: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <section className="mt-7" aria-labelledby="android-source-title">
      <h2 className="font-bold" id="android-source-title">
        Android 앱 자동 진단
      </h2>
      <p className="mt-1 text-xs text-muted">
        APK를 원격 Android 기기에 설치하고 안전한 범위에서 UI 흐름을 자동 탐색합니다.
      </p>
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept=".apk,application/vnd.android.package-archive"
        onChange={(event) => setAppFile(event.target.files?.[0])}
      />
      <button
        className="mt-5 flex min-h-40 w-full flex-col items-center justify-center rounded-card border-2 border-dashed border-border p-6 hover:border-brand-400"
        type="button"
        onClick={() => inputRef.current?.click()}
      >
        <AppWindow className="text-brand-700" size={30} />
        <strong className="mt-3">{appFile ? appFile.name : "APK 파일을 선택하세요"}</strong>
        <span className="mt-2 text-xs text-muted">
          테스트용 APK · 서명된 프로덕션 앱보다 별도 QA 빌드 권장
        </span>
      </button>
      {appFile && (
        <button
          className="mt-2 inline-flex items-center gap-1 text-xs text-danger"
          type="button"
          onClick={() => setAppFile(undefined)}
        >
          <X size={13} /> 선택 취소
        </button>
      )}
      <TextAreaField
        id="android-goal"
        label="탐색 목표"
        placeholder="예: 앱 실행 후 상품 선택부터 신청 확인 직전까지"
        value={goal}
        onChange={setGoal}
      />
      <InfoBox>
        결제·가입·제출·로그인 동작은 누르지 않으며 최대 6개 화면까지만 수집합니다. iOS 자동화에는
        별도의 기기 runner가 필요합니다. APK는 자동 탐색을 위해 BrowserStack으로 전송됩니다.
      </InfoBox>
    </section>
  );
}

export function ScreenshotFields({
  screens,
  setScreens,
  platform,
  setPlatform,
  inputRef,
  dragOver,
  setDragOver,
  addFiles,
  removeScreen,
}: {
  screens: UploadScreen[];
  setScreens: Dispatch<SetStateAction<UploadScreen[]>>;
  platform: AuditDto["platform"];
  setPlatform: (value: AuditDto["platform"]) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  dragOver: boolean;
  setDragOver: (value: boolean) => void;
  addFiles: (files: FileList | File[]) => void;
  removeScreen: (id: string) => void;
}) {
  return (
    <section className="mt-7" aria-labelledby="screens-source-title">
      <h2 className="font-bold" id="screens-source-title">
        스크린샷 직접 진단
      </h2>
      <p className="mt-1 text-xs text-muted">
        자동 접근이 어려운 화면을 최대 6개까지 순서대로 등록합니다.
      </p>
      <FieldTitle>스크린샷 플랫폼</FieldTitle>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {(
          [
            ["mobile-web", "모바일 웹"],
            ["desktop-web", "데스크톱 웹"],
            ["app", "모바일 앱"],
          ] as const
        ).map(([value, label]) => (
          <SmallChoice
            key={value}
            active={platform === value}
            label={label}
            onClick={() => setPlatform(value)}
          />
        ))}
      </div>
      <input
        ref={inputRef}
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        multiple
        type="file"
        onChange={(event) => event.target.files && addFiles(event.target.files)}
      />
      {screens.length === 0 ? (
        <button
          className={cn(
            "mt-5 flex min-h-52 w-full flex-col items-center justify-center rounded-card border-2 border-dashed p-8",
            dragOver ? "border-brand-500 bg-brand-50" : "border-border",
          )}
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            addFiles(event.dataTransfer.files);
          }}
        >
          <UploadCloud className="text-brand-700" size={30} />
          <strong className="mt-4">화면 이미지를 드래그하거나 선택하세요</strong>
          <span className="mt-2 text-xs text-muted">PNG, JPG, WEBP · 화면당 최대 10MB</span>
        </button>
      ) : (
        <div className="mt-5 space-y-3">
          {screens.map((item, index) => (
            <div
              className="grid grid-cols-[64px_1fr_auto] items-center gap-4 rounded-card border border-border p-3"
              key={item.id}
            >
              <img alt="" className="size-16 rounded-control object-cover" src={item.previewUrl} />
              <div>
                <p className="truncate text-xs text-muted">
                  {index + 1}. {item.file.name}
                </p>
                <input
                  aria-label={`${index + 1}번 화면 단계 이름`}
                  className="mt-2 w-full border-b border-border pb-1 text-sm font-semibold outline-none"
                  value={item.flowStep}
                  onChange={(event) =>
                    setScreens((current) =>
                      current.map((screen) =>
                        screen.id === item.id
                          ? { ...screen, flowStep: event.target.value }
                          : screen,
                      ),
                    )
                  }
                />
              </div>
              <button
                aria-label="화면 삭제"
                className="p-2 text-danger"
                type="button"
                onClick={() => removeScreen(item.id)}
              >
                <X size={17} />
              </button>
            </div>
          ))}
        </div>
      )}
      {screens.length > 0 && screens.length < 6 && (
        <Button
          className="mt-3"
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
        >
          화면 추가
        </Button>
      )}
    </section>
  );
}

function FieldTitle({ children }: { children: React.ReactNode }) {
  return <p className="mt-5 text-sm font-semibold">{children}</p>;
}
function FieldLabel({
  htmlFor,
  className,
  children,
}: {
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block text-sm font-semibold", className)} htmlFor={htmlFor}>
      {children}
    </label>
  );
}
function TextInput({
  id,
  type = "text",
  required,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  type?: string;
  required?: boolean;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      className="mt-2 w-full rounded-control border border-border px-4 py-3 text-sm outline-none focus:border-brand-500"
      id={id}
      type={type}
      required={required}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
function TextAreaField({
  id,
  label,
  placeholder,
  value,
  onChange,
  rows = 3,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <div className="mt-5">
      <FieldLabel htmlFor={id}>
        {label} <span className="font-normal text-muted">(선택)</span>
      </FieldLabel>
      <textarea
        className="mt-2 w-full resize-y rounded-control border border-border px-4 py-3 text-sm outline-none focus:border-brand-500"
        id={id}
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
function ChoiceButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={cn(
        "flex items-center gap-3 rounded-control border p-4 text-left",
        active ? "border-brand-500 bg-brand-50" : "border-border",
      )}
      type="button"
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function SmallChoice({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "rounded-control border px-3 py-3 text-sm font-semibold",
        active ? "border-brand-500 bg-brand-50 text-brand-800" : "border-border",
      )}
      type="button"
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
function ModeButton({
  active,
  title,
  description,
  smart,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  smart?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "rounded-control border p-4 text-left",
        active ? "border-brand-500 bg-brand-50" : "border-border",
      )}
      type="button"
      onClick={onClick}
    >
      <strong className="flex items-center gap-2 text-sm">
        {smart && <Sparkles size={15} />}
        {title}
      </strong>
      <span className="mt-1 block text-xs text-muted">{description}</span>
    </button>
  );
}
function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 rounded-control bg-brand-50 p-4 text-xs leading-6 text-brand-900">
      {children}
    </div>
  );
}
