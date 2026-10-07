// README STEP 이미지 위 번호 배지 좌표를 배포 화면 DOM에서 잰다(읽기 전용).
// 원본 캡처와 같은 영역·배율로 다시 찍어 원본과 크기가 같은지도 함께 확인한다.
// 실행: node measure.cjs <frontend 경로> <임시 출력 폴더>
// 버튼은 누르지 않는다. 입력 방식 탭(스크린샷)과 PDF 미리보기만 연다.
const fs = require("fs");
const path = require("path");
const [frontend, tmp] = process.argv.slice(2);
const { chromium } = require(path.join(frontend, "node_modules", "@playwright/test"));
const base = "https://dark-audit-seven.vercel.app";
const SCALE = 2;

// 캡처 영역 안에서 대상 요소들의 합집합 상자(CSS px, 캡처 영역 기준)를 잰다.
const measure = ({ clip, marks }) => {
  const leaf = (label) =>
    [...document.querySelectorAll("body *")].find(
      (n) => [...n.children].every((c) => c.tagName.toLowerCase() === "svg") && n.textContent.trim() === label,
    );
  const find = ([kind, arg, min]) => {
    let el = null;
    if (kind === "sel") el = document.querySelector(arg);
    if (kind === "label") {
      el = leaf(arg);
      while (el && el.getBoundingClientRect().height < (min ?? 0)) el = el.parentElement;
    }
    if (!el) throw new Error(`missing ${kind} ${arg}`);
    return el.getBoundingClientRect();
  };
  return marks.map(({ n, targets }) => {
    const rects = targets.map(find);
    const left = Math.min(...rects.map((r) => r.left)) + scrollX - clip.x;
    const top = Math.min(...rects.map((r) => r.top)) + scrollY - clip.y;
    const right = Math.max(...rects.map((r) => r.right)) + scrollX - clip.x;
    const bottom = Math.max(...rects.map((r) => r.bottom)) + scrollY - clip.y;
    return { n, box: [left, top, right, bottom] };
  });
};
const unionClip = ({ specs, pad }) => {
  const leaf = (label) =>
    [...document.querySelectorAll("main *, [role=dialog] *")].find(
      (n) => [...n.children].every((c) => c.tagName.toLowerCase() === "svg") && n.textContent.trim() === label,
    );
  const boxes = specs.map(([label, minH]) => {
    let el = leaf(label);
    while (el && el.getBoundingClientRect().height < minH) el = el.parentElement;
    return el.getBoundingClientRect();
  });
  const x0 = Math.min(...boxes.map((b) => b.left)) - pad;
  const y0 = Math.min(...boxes.map((b) => b.top)) + scrollY - pad;
  const x1 = Math.max(...boxes.map((b) => b.right)) + pad;
  const y1 = Math.max(...boxes.map((b) => b.bottom)) + scrollY + pad;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};
const elementClip = (sel) => {
  const r = document.querySelector(sel).getBoundingClientRect();
  return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
};
const pdfClip = () => {
  const head = [...document.querySelectorAll("body *")].find(
    (n) => n.children.length === 0 && n.textContent.trim() === "PDF 보고서 미리보기",
  );
  let panel = null;
  for (let el = head; el && el !== document.body; el = el.parentElement) {
    const w = el.getBoundingClientRect().width;
    if (w < window.innerWidth - 4 && (!panel || w > panel.getBoundingClientRect().width)) panel = el;
  }
  const p = panel.getBoundingClientRect();
  const t = document.querySelector(".audit-report-totals").getBoundingClientRect();
  return { x: p.left, y: p.top, width: p.width, height: t.bottom + 20 - p.top };
};

(async () => {
  const browser = await chromium.launch();
  const out = {};
  const run = async ({ image, viewport, url, prepare, clipFn, clipArg, fullPage, marks }) => {
    const page = await browser.newPage({ viewport, deviceScaleFactor: SCALE });
    await page.goto(base + url, { waitUntil: "networkidle", timeout: 120000 });
    await page.addStyleTag({ content: ".workspace-chat-launcher{display:none!important}" });
    await page.waitForFunction(() => [...document.images].every((img) => img.complete));
    await page.waitForTimeout(1500);
    if (prepare) await prepare(page);
    const clip = await page.evaluate(clipFn, clipArg);
    await page.screenshot({ path: path.join(tmp, `${image}.png`), clip, fullPage });
    const measured = await page.evaluate(measure, { clip: fullPage ? clip : { ...clip, x: clip.x - 0, y: clip.y }, marks });
    out[image] = measured.map(({ n, box }) => ({ n, box: box.map((v) => Math.round(v * SCALE)) }));
    console.log(image, JSON.stringify(out[image]));
    await page.close();
  };

  await run({
    image: "step2",
    viewport: { width: 1280, height: 800 },
    url: "/app/audits/new",
    prepare: async (page) => {
      await page.getByRole("tab", { name: /스크린샷/ }).first().click();
      await page.waitForTimeout(800);
    },
    clipFn: unionClip,
    clipArg: { specs: [["검토할 화면", 150], ["분석 시작하기", 30]], pad: 12 },
    fullPage: true,
    marks: [
      { n: 1, targets: [["sel", "[role=tab][aria-selected=true]"]] },
      { n: 2, targets: [["label", "화면 이미지를 드래그하거나 선택하세요", 150]] },
      { n: 3, targets: [["label", "분석 시작하기", 30]] },
    ],
  });
  await run({
    image: "step3-scope",
    viewport: { width: 690, height: 900 },
    url: "/app/overview?audit=audit-41&version=1",
    clipFn: elementClip,
    clipArg: ".analysis-notice",
    fullPage: true,
    marks: [{ n: 3, targets: [["sel", ".analysis-notice h2"], ["sel", ".analysis-notice p.mt-2"]] }],
  });
  await run({
    image: "step4-detail",
    viewport: { width: 1280, height: 800 },
    url: "/app/overview?audit=audit-37&version=1&finding=finding-233",
    prepare: async (page) => {
      await page.addStyleTag({
        content: ".review-findings, .review-findings *{max-height:none!important;overflow:visible!important}",
      });
      await page.waitForTimeout(800);
    },
    clipFn: elementClip,
    clipArg: "article.review-finding.is-selected",
    fullPage: true,
    marks: [
      { n: 2, targets: [["sel", ".is-selected .finding-context"], ["sel", ".is-selected .finding-reason"]] },
      { n: 3, targets: [["sel", ".is-selected .finding-fix"]] },
      { n: 4, targets: [["sel", ".is-selected details.mt-3 > summary"], ["sel", ".is-selected .finding-editorial-body > button:last-of-type"]] },
    ],
  });
  await run({
    image: "step6-summary",
    viewport: { width: 690, height: 900 },
    url: "/app/overview?audit=audit-37&version=1",
    prepare: async (page) => {
      await page.getByRole("button", { name: /PDF 보고서 출력/ }).first().click();
      await page.locator(".audit-report-totals").waitFor();
      await page.waitForTimeout(1200);
    },
    clipFn: pdfClip,
    fullPage: false,
    marks: [
      { n: 1, targets: [["label", "인쇄 / PDF 저장", 0]] },
      { n: 2, targets: [["sel", ".audit-report-summary h2"], ["sel", ".audit-report-totals"]] },
    ],
  });
  fs.writeFileSync(path.join(tmp, "measured.json"), JSON.stringify(out, null, 2));
  await browser.close();
})();
