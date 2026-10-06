import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Images, LoaderCircle, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { z } from "zod";

import { AnalysisProgress } from "@/pages/audit-create/AnalysisProgress";
import { usePersistedJob } from "@/features/audit-create/usePersistedJob";
import { DemoJourney } from "@/features/audit-create/DemoJourney";

import { PageHeading } from "@/components/common/PageHeading";
import "./audit-create.css";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { warmUpApi } from "@/api/client";
import { dashboardKeys } from "@/features/audit-dashboard/useDashboardSummary";
import { demoVariantLabels, getDemoApk, getDemoInputs, getDemoScreens } from "@/api/demo";
import type { AuditDto, DemoPreset, DemoVariant } from "@/entities/audit/types";
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
  productType: z.enum(["", "insurance", "deposit", "loan", "investment", "other"]),
  name: z.string().trim().min(2, "진단 이름을 2자 이상 입력해주세요."),
});
type AuditForm = z.infer<typeof auditSchema>;

export function AuditCreatePage() {
  const queryClient = useQueryClient();
  const demoVariant = "risky";
  const [activeDemo, setActiveDemo] = useState<DemoPreset>();
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
  const executionLock = useRef(false);
  const demoInputs = useQuery({ queryKey: ["demo-inputs"], queryFn: getDemoInputs, retry: false });
  const selectedDemo = demoInputs.data?.cases.find((item) => item.id === "pet");
  const selectedVariant = selectedDemo?.variants.find((item) => item.id === demoVariant);
  const [jobId, setJobId] = usePersistedJob();
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
  useEffect(() => {
    if (analysis.data?.status === "completed" || analysis.data?.status === "failed") {
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    }
  }, [analysis.data?.status, queryClient]);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<AuditForm>({
    resolver: zodResolver(auditSchema),
    defaultValues: { name: "", productType: "" },
  });

  async function runSampleDemo() {
    if (executionLock.current) return;
    executionLock.current = true;
    const samples = [
      ["01-product-intro.png", "보장 소개"],
      ["02-preselected-addon.png", "특약 선택"],
      ["03-consent-pressure.png", "개인정보 동의"],
      ["04-emotional-pressure.png", "특약 재권유"],
      ["05-hidden-conditions.png", "면책 조건"],
      ["06-final-price.png", "최종 보험료"],
    ] as const;

    setLoadingSamples(true);
    setSampleError(undefined);

    try {
      const loaded = selectedVariant
        ? (await getDemoScreens(selectedVariant)).map((screen) => ({
            ...screen,
            previewUrl: URL.createObjectURL(screen.file),
          }))
        : await Promise.all(
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
      const name = `스크린샷 데모 · ${selectedDemo?.name ?? "모루 반려동물 보험"} · ${demoVariantLabels[demoVariant]}`;
      setValue("name", name, { shouldValidate: true });
      const productType = selectedDemo?.productType ?? "insurance";
      setValue("productType", productType);
      await runAudit(
        { name, productType },
        {
          ...currentInput(),
          source: "screenshots",
          uploadPlatform: "mobile-web",
          screens: loaded,
        },
        { scenario: "pet", source: "screenshots" },
        demoVariant,
      );
    } catch (error) {
      setSampleError(error instanceof Error ? error.message : "샘플 화면을 불러오지 못했습니다.");
    } finally {
      setLoadingSamples(false);
      executionLock.current = false;
    }
  }

  async function runDemo(kind: "website" | "figma" | "android") {
    const config = demoInputs.data;
    if (!config?.[kind].available || executionLock.current) return;
    executionLock.current = true;
    setLoadingDemo(kind);
    setSampleError(undefined);

    try {
      const input = { ...currentInput(), source: kind };
      const websiteDemo = config.cases.find((item) => item.id === "travel");
      let name: string;
      if (kind === "website") {
        const demoUrl =
          websiteDemo?.variants.find((item) => item.id === "risky")?.websiteUrl ??
          config.website.url;
        setUrl(demoUrl);
        setScanMode("smart");
        setProfiles(["mobile"]);
        setWebsiteGoal(
          "다음 버튼으로 6개 화면의 최종 이용료까지 확인하세요. 거절 버튼이 있으면 거절하고 계속하세요. 실제 계약이나 결제는 하지 마세요.",
        );
        name = `URL 데모 · ${websiteDemo?.name ?? "로밍 패스 환전 멤버십"} · ${demoVariantLabels[demoVariant]}`;
        input.url = demoUrl;
        input.scanMode = "smart";
        input.profiles = ["mobile"];
        input.websiteGoal =
          "다음 버튼으로 6개 화면의 최종 이용료까지 확인하세요. 거절 버튼이 있으면 거절하고 계속하세요. 실제 계약이나 결제는 하지 마세요.";
      } else if (kind === "figma") {
        const selected =
          config.figma.variants.find((item) => item.id === demoVariant) ??
          (demoVariant === "risky" && config.figma.flowName
            ? { flowName: config.figma.flowName, available: config.figma.available }
            : undefined);
        if (!selected?.available) throw new Error("선택한 Figma 데모 흐름이 준비되지 않았습니다.");
        setFigmaUrl(config.figma.fileUrl);
        setFigmaTarget("mobile-web");
        setFigmaSelection("prototype-flow");
        setFigmaFlow(selected.flowName);
        name = `Figma 데모 · 릿 크레딧 · ${demoVariantLabels[demoVariant]}`;
        input.figmaUrl = config.figma.fileUrl;
        input.figmaTarget = "mobile-web";
        input.figmaSelection = "prototype-flow";
        input.figmaFlow = selected.flowName;
      } else {
        const selected = config.android.variants.find((item) => item.id === demoVariant);
        if (!selected?.available) throw new Error("선택한 APK 데모 파일이 준비되지 않았습니다.");
        const file = await getDemoApk(selected.downloadUrl);
        setAppFile(file);
        setAndroidGoal("다음 버튼으로 6단계 최종 이용료까지 확인");
        name = `APK 데모 · 모아 소액투자 · ${demoVariantLabels[demoVariant]}`;
        input.appFile = file;
        input.androidGoal = "다음 버튼으로 6단계 최종 이용료까지 확인";
      }
      setSource(kind);
      setValue("name", name, { shouldValidate: true });
      const productType =
        kind === "android"
          ? "investment"
          : kind === "website"
            ? (websiteDemo?.productType ?? "other")
            : "";
      setValue("productType", productType);
      await runAudit(
        { name, productType },
        input,
        kind === "website"
          ? { scenario: "travel", source: "website" }
          : { scenario: kind === "figma" ? "credit" : "moa", source: kind },
        demoVariant,
      );
    } catch (error) {
      setSampleError(error instanceof Error ? error.message : "데모를 실행하지 못했습니다.");
    } finally {
      setLoadingDemo(undefined);
      executionLock.current = false;
    }
  }

  function addFiles(files: FileList | File[]) {
    const images = Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, 6 - screens.length);
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

  function currentInput() {
    return {
      source,
      url,
      scanMode,
      profiles,
      websiteGoal,
      figmaUrl,
      figmaTarget,
      figmaSelection,
      figmaFlow,
      appFile,
      androidGoal,
      uploadPlatform,
      screens,
    };
  }

  async function submit(values: AuditForm) {
    if (!canSubmit() || executionLock.current) return;
    executionLock.current = true;
    setSampleError(undefined);
    try {
      await runAudit(values, currentInput());
    } catch {
      // Mutation errors are displayed below the form.
    } finally {
      executionLock.current = false;
    }
  }

  async function runAudit(
    values: AuditForm,
    input: ReturnType<typeof currentInput>,
    demoPreset?: DemoPreset,
    variant?: DemoVariant,
  ) {
    setActiveDemo(demoPreset);
    const {
      source,
      url,
      scanMode,
      profiles,
      websiteGoal,
      figmaUrl,
      figmaTarget,
      figmaSelection,
      figmaFlow,
      appFile,
      androidGoal,
      uploadPlatform,
      screens,
    } = input;
    const platform =
      source === "figma"
        ? figmaTarget
        : source === "android"
          ? "app"
          : source === "screenshots"
            ? uploadPlatform
            : profiles.length === 1 && profiles[0] === "desktop"
              ? "desktop-web"
              : "mobile-web";
    mutations.forEach((mutation) => mutation.reset());
    const audit = await createAudit.mutateAsync({
      name: values.name,
      platform,
      productType: values.productType || null,
      demoPreset,
    });
    setAuditId(audit.id);
    if (source === "website") {
      const job = await captureUrl.mutateAsync({
        auditId: audit.id,
        url: url.trim(),
        demoVariant: variant,
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
        demoVariant: variant,
      });
      setJobId(job.jobId);
    } else if (source === "android" && appFile) {
      const job = await analyzeAndroid.mutateAsync({
        auditId: audit.id,
        appFile,
        goal: androidGoal.trim() || undefined,
        demoVariant: variant,
      });
      setJobId(job.jobId);
    } else if (source === "screenshots") {
      await uploadScreens.mutateAsync({
        auditId: audit.id,
        screens: screens.map(({ id, flowStep, file }) => ({ id, flowStep, file })),
        demoVariant: variant,
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
        source={analysis.data?.source ?? source}
        demo={analysis.data?.demo ?? Boolean(activeDemo)}
        auditId={analysis.data?.auditId ?? auditId}
        progress={analysis.data?.progress ?? 5}
        completed={analysis.data?.status === "completed"}
        failed={analysis.data?.status === "failed" || analysis.isError}
        queued={analysis.data?.status === "queued"}
        error={analysis.data?.error ?? analysis.error?.message}
        exploration={
          (analysis.data?.source ?? source) === "website"
            ? {
                mode: analysis.data?.explorationMode ?? scanMode,
                stage: analysis.data?.explorationStage,
                events: analysis.data?.explorationEvents ?? [],
              }
            : undefined
        }
        onBack={() => setJobId(undefined)}
      />
    );

  return (
    <div className="workspace-page audit-create-page mx-auto max-w-6xl">
      <Link
        className="inline-flex items-center gap-2 text-sm text-muted hover:text-text"
        to="/app/dashboard"
      >
        <ArrowLeft size={15} /> 대시보드
      </Link>
      <PageHeading
        eyebrow="02 / START A REVIEW"
        title="AI UX 진단 시작"
        description="구현 단계에 맞는 입력 소스를 선택하면 필요한 옵션만 안내합니다."
      />
      <Card className="audit-demo p-5" role="region" aria-label="데모 체험">
        <p className="flex items-center gap-2 font-bold text-brand-900">
          <Images size={19} /> 입력 유형별 데모 체험
        </p>
        <p className="mt-1 text-sm leading-6 text-muted">
          준비된 원본을 검사한 뒤, 수정본을 실행하고 전후 변화를 비교해 보세요.
        </p>
        <DemoJourney step={1} />
        <div className="audit-demo-options">
          {(
            [
              ["website", "URL", "로밍 패스 환전 멤버십 · 원본"],
              ["figma", "Figma", "릿 크레딧 · 원본"],
              ["android", "APK", "모아 소액투자 · 원본"],
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
                onClick={() => void runDemo(kind)}
              >
                {loadingDemo === kind ? (
                  <LoaderCircle className="animate-spin" size={16} />
                ) : (
                  <Play size={16} />
                )}
                {label} 데모 실행
              </Button>
              {kind !== "website" && demoInputs.data?.[kind].reason && (
                <p className="mt-2 text-xs text-muted">{demoInputs.data[kind].reason}</p>
              )}
            </div>
          ))}
          <div className="rounded-control border border-border bg-white p-4">
            <p className="text-sm font-bold">스크린샷</p>
            <p className="mt-1 min-h-10 text-xs leading-5 text-muted">
              {selectedDemo?.name ?? "반려동물 보험"} · {demoVariantLabels[demoVariant]} · 6단계
            </p>
            <Button
              className="mt-3 w-full"
              disabled={pending}
              type="button"
              variant="outline"
              onClick={runSampleDemo}
            >
              {loadingSamples ? (
                <LoaderCircle className="animate-spin" size={16} />
              ) : (
                <Play size={16} />
              )}
              스크린샷 데모 실행
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
      </Card>
      <form
        className="audit-create-form grid lg:grid-cols-[0.68fr_1.32fr]"
        onSubmit={(event) => void handleSubmit(submit)(event)}
      >
        <Card className="audit-create-info h-fit p-6">
          <p className="editorial-label">01 / PROJECT</p>
          <h2 className="audit-form-title">진단 정보</h2>
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
          <label className="mt-5 block text-sm font-semibold" htmlFor="product-type">
            상품 유형
          </label>
          <select
            id="product-type"
            className="mt-2 w-full rounded-control border border-border bg-surface px-4 py-3 text-sm"
            {...register("productType")}
          >
            <option value="">미지정</option>
            <option value="insurance">보험</option>
            <option value="deposit">예금·적금</option>
            <option value="loan">대출</option>
            <option value="investment">투자</option>
            <option value="other">기타</option>
          </select>
          <div className="mt-4 rounded-control border border-border p-4 text-xs leading-6 text-muted">
            자동 탐색은 결제·가입 완료·개인정보 제출과 같은 위험 동작을 수행하지 않습니다.
          </div>
        </Card>
        <div>
          <Card className="audit-create-source p-6">
            <p className="editorial-label">02 / SCREEN INPUT</p>
            <h2 className="audit-form-title">검토할 화면</h2>
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
