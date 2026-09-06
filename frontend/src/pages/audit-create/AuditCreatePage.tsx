import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Images, LoaderCircle, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { z } from "zod";

import { AnalysisProgress } from "@/pages/audit-create/AnalysisProgress";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { warmUpApi } from "@/api/client";
import { getDemoApk, getDemoInputs } from "@/api/demo";
import type { AuditDto } from "@/entities/audit/types";
import {
  useAnalysisStatus,
  useAnalyzeAndroidApp,
  useCaptureAuditUrl,
  useCreateAudit,
  useImportFigmaAudit,
  useStartAnalysis,
  useUploadAuditScreens,
} from "@/features/audit-create/useAuditWorkflow";
import {
  AndroidFields,
  type AuditSource,
  type DeviceProfile,
  FigmaFields,
  ScreenshotFields,
  SourcePicker,
  type UploadScreen,
  WebsiteFields,
} from "@/pages/audit-create/AuditSourceFields";

const auditSchema = z.object({
  name: z.string().trim().min(2, "진단 이름을 2자 이상 입력해주세요."),
});
type AuditForm = z.infer<typeof auditSchema>;

export function AuditCreatePage() {
  const [source, setSource] = useState<AuditSource>("website");
  const [url, setUrl] = useState("");
  const [scanMode, setScanMode] = useState<"quick" | "smart">("quick");
  const [profiles, setProfiles] = useState<DeviceProfile[]>(["desktop", "mobile"]);
  const [websiteGoal, setWebsiteGoal] = useState("");
  const [figmaUrl, setFigmaUrl] = useState("");
  const [figmaTarget, setFigmaTarget] = useState<AuditDto["platform"]>("mobile-web");
  const [figmaSelection, setFigmaSelection] = useState<"prototype-flow" | "all-frames">(
    "prototype-flow",
  );
  const [figmaFlow, setFigmaFlow] = useState("");
  const [appFile, setAppFile] = useState<File>();
  const [androidGoal, setAndroidGoal] = useState("");
  const [uploadPlatform, setUploadPlatform] = useState<AuditDto["platform"]>("mobile-web");
  const [screens, setScreens] = useState<UploadScreen[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [loadingSamples, setLoadingSamples] = useState(false);
  const [sampleError, setSampleError] = useState<string>();
  const [loadingDemo, setLoadingDemo] = useState<AuditSource>();
  const [demoNotice, setDemoNotice] = useState<string>();
  const demoInputs = useQuery({ queryKey: ["demo-inputs"], queryFn: getDemoInputs, retry: false });
  const [jobId, setJobId] = useState<string>();
  const [auditId, setAuditId] = useState<string>();
  const screenInputRef = useRef<HTMLInputElement>(null);
  const appInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void warmUpApi().catch(() => undefined);
  }, []);

  const createAudit = useCreateAudit();
  const captureUrl = useCaptureAuditUrl();
  const importFigma = useImportFigmaAudit();
  const analyzeAndroid = useAnalyzeAndroidApp();
  const uploadScreens = useUploadAuditScreens();
  const startAnalysis = useStartAnalysis();
  const analysis = useAnalysisStatus(jobId);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<AuditForm>({
    resolver: zodResolver(auditSchema),
    defaultValues: { name: "" },
  });

  async function loadSampleScreens() {
    const samples = [
      ["01-product-intro.png", "상품 안내"],
      ["02-preselected-addon.png", "유료 옵션 선택"],
      ["03-consent-pressure.png", "약관 동의"],
      ["04-delayed-price.png", "최종 금액 확인"],
      ["05-buried-cancellation.png", "가입 완료"],
    ] as const;

    setLoadingSamples(true);
    setSampleError(undefined);
    setDemoNotice(undefined);
    try {
      const loaded = await Promise.all(
        samples.map(async ([fileName, flowStep]) => {
          const response = await fetch(`/sample-audit/${fileName}`);
          if (!response.ok) throw new Error(`${fileName}을 불러오지 못했습니다.`);
          const blob = await response.blob();
          const file = new File([blob], fileName, { type: blob.type || "image/png" });
          return {
            id: crypto.randomUUID(),
            file,
            previewUrl: URL.createObjectURL(file),
            flowStep,
          };
        }),
      );
      setScreens((current) => {
        current.forEach((screen) => URL.revokeObjectURL(screen.previewUrl));
        return loaded;
      });
      setSource("screenshots");
      setUploadPlatform("mobile-web");
      setValue("name", "샘플 보험 가입 화면 검사", { shouldValidate: true });
    } catch (error) {
      setSampleError(error instanceof Error ? error.message : "샘플 화면을 불러오지 못했습니다.");
    } finally {
      setLoadingSamples(false);
    }
  }

  async function loadDemo(kind: "website" | "figma" | "android") {
    const config = demoInputs.data;
    if (!config?.[kind].available) return;
    setLoadingDemo(kind);
    setSampleError(undefined);
    setDemoNotice(undefined);
    try {
      if (kind === "website") {
        setUrl(config.website.url);
        setScanMode("quick");
        setProfiles(["mobile"]);
        setWebsiteGoal("");
        setValue("name", "URL 데모 · 감정적 언어 검사", { shouldValidate: true });
      } else if (kind === "figma") {
        setFigmaUrl(config.figma.fileUrl);
        setFigmaTarget("mobile-web");
        setFigmaSelection("all-frames");
        setFigmaFlow("");
        setValue("name", "Figma 데모 · 금융상품 화면 검사", { shouldValidate: true });
      } else {
        const file = await getDemoApk(config.android.downloadUrl);
        setAppFile(file);
        setAndroidGoal("다음 버튼으로 5단계 최종 이용료까지 확인");
        setValue("name", "APK 데모 · 모아 투자관리 검사", { shouldValidate: true });
      }
      setSource(kind);
      setDemoNotice(
        "데모 입력을 준비했습니다. 아래 ‘분석 시작하기’를 눌러 실제 진단을 실행하세요.",
      );
    } catch (error) {
      setSampleError(error instanceof Error ? error.message : "데모를 불러오지 못했습니다.");
    } finally {
      setLoadingDemo(undefined);
    }
  }

  function addFiles(files: FileList | File[]) {
    const images = Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, 5 - screens.length);
    setScreens((current) => [
      ...current,
      ...images.map((file, index) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        flowStep: `화면 ${current.length + index + 1}`,
      })),
    ]);
  }

  function removeScreen(id: string) {
    setScreens((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  function toggleProfile(profile: DeviceProfile) {
    setProfiles((current) =>
      current.includes(profile)
        ? current.length === 1
          ? current
          : current.filter((item) => item !== profile)
        : [...current, profile],
    );
  }

  function platformForSource(): AuditDto["platform"] {
    if (source === "figma") return figmaTarget;
    if (source === "android") return "app";
    if (source === "screenshots") return uploadPlatform;
    return profiles.length === 1 && profiles[0] === "desktop" ? "desktop-web" : "mobile-web";
  }

  async function submit(values: AuditForm) {
    if (!canSubmit()) return;
    const audit = await createAudit.mutateAsync({
      name: values.name,
      platform: platformForSource(),
    });
    setAuditId(audit.id);
    if (source === "website") {
      const job = await captureUrl.mutateAsync({
        auditId: audit.id,
        url: url.trim(),
        mode: scanMode,
        profiles,
        goal: websiteGoal.trim() || undefined,
      });
      setJobId(job.jobId);
    } else if (source === "figma") {
      const job = await importFigma.mutateAsync({
        auditId: audit.id,
        fileUrl: figmaUrl.trim(),
        target: figmaTarget,
        selectionMode: figmaSelection,
        flowName: figmaFlow.trim() || undefined,
      });
      setJobId(job.jobId);
    } else if (source === "android" && appFile) {
      const job = await analyzeAndroid.mutateAsync({
        auditId: audit.id,
        appFile,
        goal: androidGoal.trim() || undefined,
      });
      setJobId(job.jobId);
    } else if (source === "screenshots") {
      await uploadScreens.mutateAsync({
        auditId: audit.id,
        screens: screens.map(({ id, flowStep, file }) => ({ id, flowStep, file })),
      });
      setJobId((await startAnalysis.mutateAsync(audit.id)).jobId);
    }
  }

  function canSubmit() {
    if (source === "website") return Boolean(url.trim() && profiles.length);
    if (source === "figma") return Boolean(figmaUrl.trim());
    if (source === "android") return Boolean(appFile);
    return screens.length > 0;
  }

  const mutations = [
    createAudit,
    captureUrl,
    importFigma,
    analyzeAndroid,
    uploadScreens,
    startAnalysis,
  ];
  const pending =
    mutations.some((mutation) => mutation.isPending) || Boolean(loadingDemo) || loadingSamples;
  const requestFailed = mutations.some((mutation) => mutation.isError);
  const requestError = mutations.find((mutation) => mutation.isError)?.error;

  if (jobId)
    return (
      <AnalysisProgress
        key={jobId}
        source={source}
        auditId={auditId}
        progress={analysis.data?.progress ?? 5}
        completed={analysis.data?.status === "completed"}
        failed={analysis.data?.status === "failed" || analysis.isError}
        error={analysis.data?.error}
        onBack={() => setJobId(undefined)}
      />
    );

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        className="inline-flex items-center gap-2 text-sm text-muted hover:text-text"
        to="/app/overview"
      >
        <ArrowLeft size={15} /> 대시보드
      </Link>
      <div className="mt-4">
        <p className="text-xs font-bold uppercase tracking-widest text-brand-600">새 진단</p>
        <h1 className="mt-2 text-3xl font-bold">AI UX 진단 시작</h1>
        <p className="mt-3 text-sm text-muted">
          구현 단계에 맞는 입력 소스를 선택하면 필요한 옵션만 안내합니다.
        </p>
      </div>
      <Card className="mt-7 border-brand-400 bg-brand-50 p-5">
        <p className="flex items-center gap-2 font-bold text-brand-900">
          <Images size={19} /> 입력 유형별 데모 체험
        </p>
        <p className="mt-1 text-xs leading-5 text-muted">
          자료 없이도 체험할 수 있습니다. 데모를 불러온 뒤 ‘분석 시작하기’를 눌러주세요.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(
            [
              ["website", "URL", "감정적 압박 문구가 있는 웹페이지"],
              ["figma", "Figma", "금융상품 디자인의 최상위 프레임"],
              ["android", "APK", "다크패턴 5종이 포함된 앱 흐름"],
            ] as const
          ).map(([kind, label, description]) => (
            <div className="rounded-control border border-border bg-white p-4" key={kind}>
              <p className="text-sm font-bold">{label}</p>
              <p className="mt-1 min-h-10 text-xs leading-5 text-muted">{description}</p>
              <Button
                className="mt-3 w-full"
                type="button"
                variant="outline"
                disabled={pending || !demoInputs.data?.[kind].available}
                onClick={() => void loadDemo(kind)}
              >
                {loadingDemo === kind ? (
                  <LoaderCircle className="animate-spin" size={16} />
                ) : (
                  <Play size={16} />
                )}
                {label} 데모 불러오기
              </Button>
              {kind !== "website" && demoInputs.data?.[kind].reason && (
                <p className="mt-2 text-xs text-muted">{demoInputs.data[kind].reason}</p>
              )}
            </div>
          ))}
          <div className="rounded-control border border-border bg-white p-4">
            <p className="text-sm font-bold">스크린샷</p>
            <p className="mt-1 min-h-10 text-xs leading-5 text-muted">
              보험 가입 과정의 샘플 화면 5장
            </p>
            <Button
              className="mt-3 w-full"
              disabled={pending}
              type="button"
              variant="outline"
              onClick={loadSampleScreens}
            >
              {loadingSamples ? (
                <LoaderCircle className="animate-spin" size={16} />
              ) : (
                <Play size={16} />
              )}
              샘플 5장 불러오기
            </Button>
          </div>
        </div>
        {demoInputs.isPending && (
          <p className="mt-3 text-xs text-muted">데모 연결을 확인하고 있습니다.</p>
        )}
        {demoInputs.isError && (
          <p className="mt-3 text-xs text-danger">
            데모 연결을 확인하지 못했습니다.
            <button
              className="ml-2 underline"
              type="button"
              onClick={() => void demoInputs.refetch()}
            >
              다시 확인
            </button>
          </p>
        )}
        {sampleError && (
          <p role="alert" className="mt-3 text-xs text-danger">
            {sampleError}
          </p>
        )}
        {demoNotice && (
          <p role="status" className="mt-3 text-xs text-brand-900">
            {demoNotice}
          </p>
        )}
      </Card>
      <form
        className="mt-8 grid gap-6 lg:grid-cols-[0.68fr_1.32fr]"
        onSubmit={handleSubmit(submit)}
      >
        <Card className="h-fit p-6">
          <h2 className="font-bold">진단 정보</h2>
          <label className="mt-6 block text-sm font-semibold" htmlFor="audit-name">
            진단 이름
          </label>
          <input
            className="mt-2 w-full rounded-control border border-border px-4 py-3 text-sm outline-none focus:border-brand-500"
            id="audit-name"
            placeholder="예: 보험 가입 Flow v1"
            {...register("name")}
          />
          {errors.name && <p className="mt-2 text-xs text-danger">{errors.name.message}</p>}
          <div className="mt-4 rounded-control border border-border p-4 text-xs leading-6 text-muted">
            자동 탐색은 결제·가입 완료·개인정보 제출과 같은 위험 동작을 수행하지 않습니다.
          </div>
        </Card>
        <div>
          <Card className="p-6">
            <SourcePicker value={source} onChange={setSource} />
            {source === "website" && (
              <WebsiteFields
                url={url}
                setUrl={setUrl}
                profiles={profiles}
                toggleProfile={toggleProfile}
                scanMode={scanMode}
                setScanMode={setScanMode}
                goal={websiteGoal}
                setGoal={setWebsiteGoal}
              />
            )}
            {source === "figma" && (
              <FigmaFields
                fileUrl={figmaUrl}
                setFileUrl={setFigmaUrl}
                target={figmaTarget}
                setTarget={setFigmaTarget}
                selectionMode={figmaSelection}
                setSelectionMode={setFigmaSelection}
                flowName={figmaFlow}
                setFlowName={setFigmaFlow}
              />
            )}
            {source === "android" && (
              <AndroidFields
                appFile={appFile}
                setAppFile={setAppFile}
                goal={androidGoal}
                setGoal={setAndroidGoal}
                inputRef={appInputRef}
              />
            )}
            {source === "screenshots" && (
              <ScreenshotFields
                screens={screens}
                setScreens={setScreens}
                platform={uploadPlatform}
                setPlatform={setUploadPlatform}
                inputRef={screenInputRef}
                dragOver={dragOver}
                setDragOver={setDragOver}
                addFiles={addFiles}
                removeScreen={removeScreen}
              />
            )}
          </Card>
          {requestFailed && (
            <p className="mt-4 rounded-control bg-danger/10 p-4 text-sm text-danger">
              진단 요청을 처리하지 못했습니다:{" "}
              {requestError instanceof Error
                ? requestError.message
                : "입력값과 연동 설정을 확인해주세요."}
            </p>
          )}
          <div className="mt-5 flex justify-end">
            <Button disabled={!canSubmit() || pending} type="submit">
              {pending ? <LoaderCircle className="animate-spin" size={16} /> : <Play size={16} />}{" "}
              분석 시작하기
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
