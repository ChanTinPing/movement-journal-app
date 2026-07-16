import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import CDP from "chrome-remote-interface";

const packageName = "com.chantinping.movementjournal";
const workspace = process.cwd();
const sdkRoot = process.env.ANDROID_HOME ?? join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk");
const adb = process.env.ADB_PATH ?? join(sdkRoot, "platform-tools", "adb.exe");
const apk = join(workspace, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const devtoolsPort = "9223";

if (!existsSync(adb) || !existsSync(apk)) {
  throw new Error("找不到 adb 或 Debug APK；请先运行 npm run android:apk。");
}

function runAdbGlobal(args, options = {}) {
  return execFileSync(adb, args, {
    cwd: workspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

const connectedDevices = runAdbGlobal(["devices"])
  .split(/\r?\n/)
  .slice(1)
  .map((line) => line.trim().split(/\s+/))
  .filter((parts) => parts.length >= 2 && parts[1] === "device")
  .map(([serial]) => serial);
const requestedSerial = process.env.ANDROID_SERIAL;
const emulatorSerials = connectedDevices.filter((serial) => serial.startsWith("emulator-"));
const deviceSerial = requestedSerial ?? (emulatorSerials.length === 1 ? emulatorSerials[0] : null);

if (
  !deviceSerial ||
  !deviceSerial.startsWith("emulator-") ||
  !connectedDevices.includes(deviceSerial)
) {
  throw new Error(
    "Android 原生 E2E 只允许在已连接的 emulator-* 模拟器上运行；不会操作真实手机。" +
      ` 当前设备：${connectedDevices.join(", ") || "无"}`,
  );
}

function runAdb(args, options = {}) {
  return runAdbGlobal(["-s", deviceSerial, ...args], options);
}

async function waitFor(readValue, accepts, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await readValue();
    if (accepts(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`等待 Android 状态超时：${String(value)}`);
}

async function listWebViewTargets() {
  const response = await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`);
  if (!response.ok) {
    throw new Error(`无法读取 Android WebView 调试目标：HTTP ${response.status}`);
  }
  return response.json();
}

async function waitForWebViewTargets() {
  return waitFor(
    async () => {
      try {
        return await listWebViewTargets();
      } catch {
        return [];
      }
    },
    (targets) => targets.some((target) => target.type === "page"),
  );
}

console.log(`Android E2E: using emulator ${deviceSerial}`);
runAdb(["wait-for-device"]);
runAdb(["install", "-r", apk]);
const clearedAppData = runAdb(["shell", "pm", "clear", packageName]);
if (clearedAppData !== "Success") {
  throw new Error(`无法清空模拟器测试数据：${clearedAppData}`);
}
runAdb(["shell", "am", "force-stop", packageName]);
runAdb([
  "shell",
  "am",
  "start",
  "-W",
  "-a",
  "android.intent.action.MAIN",
  "-c",
  "android.intent.category.LAUNCHER",
  `${packageName}/.MainActivity`,
]);

const pid = await waitFor(
  () => runAdb(["shell", "pidof", packageName]),
  (value) => /^\d+$/.test(value),
);
const socket = `webview_devtools_remote_${pid}`;
await waitFor(
  () => runAdb(["shell", "cat", "/proc/net/unix"]),
  (value) => value.includes(socket),
);

runAdb(["forward", `tcp:${devtoolsPort}`, `localabstract:${socket}`]);

let client;
try {
  console.log("Android E2E: preparing native app data");
  const exportMarker = `深蹲-Android-E2E-${Date.now()}`;
  const seedTargets = await waitForWebViewTargets();
  const seedTarget = seedTargets.find((item) => item.type === "page");
  if (!seedTarget) {
    throw new Error("没有找到用于准备数据的 Android WebView 页面。");
  }
  const seedClient = await CDP({
    target: seedTarget.webSocketDebuggerUrl,
    host: "127.0.0.1",
    port: Number(devtoolsPort),
    local: true,
  });
  console.log("Android E2E: seed WebView connected");
  const sourceRecord = JSON.stringify([
    {
      id: "android-e2e-source",
      date: "2026-03-18",
      title: "拉力日",
      updatedAt: "2026-03-18T10:00:00.000Z",
      exercises: [
        {
          id: "android-e2e-exercise",
          name: "引体向上",
          loadGroups: [{ id: "android-e2e-load", label: "", entries: ["5", "5"] }],
        },
      ],
    },
    {
      id: "android-e2e-older-source",
      date: "2026-02-12",
      title: "腿部日",
      updatedAt: "2026-02-12T10:00:00.000Z",
      exercises: [
        {
          id: "android-e2e-older-exercise",
          name: exportMarker,
          loadGroups: [{ id: "android-e2e-older-load", label: "40kg", entries: ["8"] }],
        },
      ],
    },
  ]);
  await seedClient.Runtime.enable();
  await waitFor(
    async () => {
      const result = await seedClient.Runtime.evaluate({
        expression: "document.readyState",
        returnByValue: true,
      });
      return result.result.value;
    },
    (value) => value === "complete",
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  await seedClient.Runtime.evaluate({
    expression: `localStorage.setItem("movement-journal-records", ${JSON.stringify(sourceRecord)})`,
  });
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const seededRecords = await seedClient.Runtime.evaluate({
    expression: 'localStorage.getItem("movement-journal-records")',
    returnByValue: true,
  });
  if (seededRecords.result.value !== sourceRecord) {
    throw new Error("Android WebView 没有保存测试准备数据。");
  }
  await seedClient.close();
  console.log("Android E2E: restarting app with prepared data");

  runAdb(["forward", "--remove", `tcp:${devtoolsPort}`]);
  runAdb(["shell", "am", "force-stop", packageName]);
  runAdb([
    "shell",
    "am",
    "start",
    "-W",
    "-a",
    "android.intent.action.MAIN",
    "-c",
    "android.intent.category.LAUNCHER",
    `${packageName}/.MainActivity`,
  ]);
  const testPid = await waitFor(
    () => runAdb(["shell", "pidof", packageName]),
    (value) => /^\d+$/.test(value),
  );
  const testSocket = `webview_devtools_remote_${testPid}`;
  await waitFor(
    () => runAdb(["shell", "cat", "/proc/net/unix"]),
    (value) => value.includes(testSocket),
  );
  runAdb(["forward", `tcp:${devtoolsPort}`, `localabstract:${testSocket}`]);

  console.log("Android E2E: connecting test WebView");
  const targets = await waitForWebViewTargets();
  const target = targets.find((item) => item.type === "page");
  if (!target) {
    throw new Error("没有找到 Android WebView 页面。");
  }

  client = await CDP({
    target: target.webSocketDebuggerUrl,
    host: "127.0.0.1",
    port: Number(devtoolsPort),
    local: true,
  });
  console.log("Android E2E: test WebView connected");
  const { Page, Runtime } = client;
  await Promise.all([Page.enable(), Runtime.enable()]);

  async function evaluate(expression) {
    const result = await Runtime.evaluate({ expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? "WebView JavaScript 执行失败。");
    }
    return result.result.value;
  }

  async function waitForWebValue(expression, accepts, timeoutMs = 10_000) {
    return waitFor(() => evaluate(expression), accepts, timeoutMs);
  }

  const targetBounds = JSON.parse(target.description || "{}");
  const viewport = await evaluate(`({ width: window.innerWidth, height: window.innerHeight })`);
  const scaleX = targetBounds.width / viewport.width;
  const scaleY = targetBounds.height / viewport.height;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
    throw new Error("无法把 WebView 坐标换算为 Android 屏幕坐标。");
  }

  function toScreenPoint(cssX, cssY) {
    return {
      x: Math.round((targetBounds.screenX ?? 0) + cssX * scaleX),
      y: Math.round((targetBounds.screenY ?? 0) + cssY * scaleY),
    };
  }

  function tapRect(rect) {
    const point = toScreenPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    runAdb(["shell", "input", "tap", String(point.x), String(point.y)]);
  }

  function swipeRect(rect, deltaCssX) {
    const start = toScreenPoint(rect.x + rect.width * 0.35, rect.y + rect.height / 2);
    const end = toScreenPoint(rect.x + rect.width * 0.35 + deltaCssX, rect.y + rect.height / 2);
    runAdb([
      "shell",
      "input",
      "swipe",
      String(start.x),
      String(start.y),
      String(end.x),
      String(end.y),
      "220",
    ]);
  }

  await waitForWebValue("document.readyState", (value) => value === "complete");
  const preparedState = await evaluate(`(() => {
    const button = [...document.querySelectorAll("button")]
      .find((item) => item.textContent.trim() === "今天（复制）+");
    return {
      records: JSON.parse(localStorage.getItem("movement-journal-records") ?? "[]"),
      copyDisabled: button?.disabled ?? null,
    };
  })()`);
  if (preparedState.records.length !== 2 || preparedState.copyDisabled !== false) {
    throw new Error(`Android 测试数据没有正确载入：${JSON.stringify(preparedState)}`);
  }

  const copyButtonRect = await waitForWebValue(
    `(() => {
      const button = [...document.querySelectorAll("button")]
        .find((item) => item.textContent.trim() === "今天（复制）+");
      return button?.getBoundingClientRect().toJSON() ?? null;
    })()`,
    Boolean,
  );
  tapRect(copyButtonRect);
  await waitForWebValue(
    `document.querySelector(".calendar-panel")?.getBoundingClientRect().toJSON() ?? null`,
    Boolean,
  );
  const calendarTipRect = await waitForWebValue(
    `document.querySelector(".calendar-tip")?.getBoundingClientRect().toJSON() ?? null`,
    Boolean,
  );
  swipeRect(calendarTipRect, 20);

  const firstSourceDateRect = await waitForWebValue(
    `(() => {
      const button = [...document.querySelectorAll(".calendar-day--active")]
        .find((item) => item.querySelector(".calendar-day__number")?.textContent === "18");
      return button?.getBoundingClientRect().toJSON() ?? null;
    })()`,
    Boolean,
  );
  tapRect(firstSourceDateRect);
  await waitForWebValue('document.querySelector("[role=dialog]") === null', (value) => value === true);

  const copiedAfterLightMove = await evaluate(`(() => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    const records = JSON.parse(localStorage.getItem("movement-journal-records") ?? "[]");
    return records.find((record) => record.date === today)?.exercises.map((exercise) => exercise.name) ?? [];
  })()`);
  if (!copiedAfterLightMove.includes("引体向上")) {
    throw new Error("轻微横移后首次点击没有立即复制日期。");
  }

  const copyButtonRectAgain = await waitForWebValue(
    `(() => {
      const button = [...document.querySelectorAll("button")]
        .find((item) => item.textContent.trim() === "今天（复制）+");
      return button?.getBoundingClientRect().toJSON() ?? null;
    })()`,
    Boolean,
  );
  tapRect(copyButtonRectAgain);
  await waitForWebValue('document.querySelector(".calendar-panel") !== null', (value) => value === true);
  const calendarViewportRect = await waitForWebValue(
    `document.querySelector(".calendar-viewport")?.getBoundingClientRect().toJSON() ?? null`,
    Boolean,
  );
  swipeRect(calendarViewportRect, 100);
  await waitForWebValue(
    'document.querySelector(".calendar-nav strong")?.textContent.includes("2 月") === true',
    (value) => value === true,
  );
  await waitForWebValue(
    'document.querySelector(".calendar-grid-shell")?.dataset.calendarMotion === "idle"',
    (value) => value === true,
  );

  const secondSourceDateRect = await waitForWebValue(
    `(() => {
      const button = [...document.querySelectorAll(".calendar-day--active")]
        .find((item) => item.querySelector(".calendar-day__number")?.textContent === "12");
      return button?.getBoundingClientRect().toJSON() ?? null;
    })()`,
    Boolean,
  );
  tapRect(secondSourceDateRect);
  await waitForWebValue('document.querySelector("[role=dialog]") === null', (value) => value === true);

  const copiedTodayNames = await evaluate(`(() => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    const records = JSON.parse(localStorage.getItem("movement-journal-records") ?? "[]");
    return records.find((record) => record.date === today)?.exercises.map((exercise) => exercise.name) ?? [];
  })()`);
  if (!copiedTodayNames.includes("引体向上") || !copiedTodayNames.includes(exportMarker)) {
    throw new Error("完整滑动后首次点击没有立即复制日期。");
  }

  const cacheBeforeExport = runAdb(["shell", "run-as", packageName, "ls", "cache"]);
  if (/movement-journal-backup-.*\.txt/.test(cacheBeforeExport)) {
    throw new Error("导出前发现旧备份缓存，无法验证本次新文件。");
  }

  const exportButtonRect = await waitForWebValue(
    `(() => {
      const button = [...document.querySelectorAll("button")]
        .find((item) => item.textContent.trim() === "导出");
      return button?.getBoundingClientRect().toJSON() ?? null;
    })()`,
    Boolean,
  );
  tapRect(exportButtonRect);
  const backupFile = await waitFor(
    () => runAdb(["shell", "run-as", packageName, "ls", "cache"]),
    (value) => value.split(/\r?\n/).some((name) => /^movement-journal-backup-.*\.txt$/.test(name)),
  ).then((value) =>
    value.split(/\r?\n/).find((name) => /^movement-journal-backup-.*\.txt$/.test(name)),
  );
  const backupContents = runAdb([
    "shell",
    "run-as",
    packageName,
    "cat",
    `cache/${backupFile}`,
  ]);
  if (!backupContents.includes("# 运动日记 TXT v1") || !backupContents.includes(exportMarker)) {
    throw new Error("Android 原生导出的 TXT 内容不完整。");
  }

  const activityDump = await waitFor(
    () => runAdb(["shell", "dumpsys", "activity", "activities"]),
    (value) => {
      const topActivity = value
        .split(/\r?\n/)
        .find((line) => line.includes("topResumedActivity"));
      return /ChooserActivity|ResolverActivity/.test(topActivity ?? "");
    },
  );
  const resumedActivity = activityDump
    .split(/\r?\n/)
    .find((line) => line.includes("topResumedActivity"));

  console.log("Android E2E passed: 单击复制成功，原生 TXT 已生成，系统分享面板已打开。");
  console.log(resumedActivity?.trim() ?? "ChooserActivity detected");
} finally {
  await client?.close();
  try {
    runAdb(["forward", "--remove", `tcp:${devtoolsPort}`]);
  } catch {
    console.warn("Android E2E: failed to remove adb forward");
  }
  try {
    runAdb(["shell", "pm", "clear", packageName]);
  } catch {
    console.warn("Android E2E: failed to clear emulator app data");
  }
}
