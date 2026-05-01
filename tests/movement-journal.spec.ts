import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
}).format(new Date());

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("movement-journal-records"));
  await page.reload();
});

test("手机布局没有横向溢出，并暴露 PWA 安装资源", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "运动日记" })).toBeVisible();
  await expect(page.getByRole("button", { name: "日历" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导入" })).toBeVisible();

  const overflow = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    htmlScrollWidth: document.documentElement.scrollWidth,
    bottomHeight: document.querySelector(".bottom-actions")?.getBoundingClientRect().height ?? 0,
    viewportHeight: window.innerHeight,
  }));
  expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.viewportWidth + 1);
  expect(overflow.htmlScrollWidth).toBeLessThanOrEqual(overflow.viewportWidth + 1);
  expect(overflow.bottomHeight).toBeLessThanOrEqual(overflow.viewportHeight * 0.18);

  const manifestResponse = await page.request.get("manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.map((icon: { src: string }) => icon.src)).toEqual(
    expect.arrayContaining(["icon-192.png", "icon-512.png", "icon.svg"]),
  );

  const serviceWorkerResponse = await page.request.get("sw.js");
  expect(serviceWorkerResponse.ok()).toBeTruthy();
});

test("可以新增、编辑、折叠和删除训练记录", async ({ page }) => {
  await page.getByRole("button", { name: "今天 +" }).click();
  await page.getByPlaceholder("名称").fill("深蹲");
  await page.getByPlaceholder("名称").press("Enter");

  await expect(page.getByText("深蹲")).toBeVisible();
  await page.locator(".history-load-block .entry-add-button--tail").click();
  await page.locator(".entry-inline-input").fill("9");
  await page.locator(".entry-inline-input").press("Enter");
  await expect(page.getByRole("button", { name: "9" })).toBeVisible();

  await page.getByRole("button", { name: "默认" }).click();
  await page.locator(".load-inline-input").fill("10kg");
  await page.locator(".load-inline-input").press("Enter");
  await expect(page.getByRole("button", { name: "10kg" })).toBeVisible();

  await page.getByRole("button", { name: "9" }).click();
  await page.locator(".entry-inline-input").fill("10");
  await page.locator(".entry-inline-input").press("Enter");
  await expect(page.getByRole("button", { name: "10", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "收起" }).first().click();
  await expect(page.getByText("深蹲")).toBeHidden();
  await page.getByRole("button", { name: "展开" }).click();
  await expect(page.getByText("深蹲")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除" }).click();
  await page.getByRole("button", { name: "10", exact: true }).click();
  await expect(page.getByRole("button", { name: "10", exact: true })).toBeHidden();
});

test("可以删除整个动作和负荷行", async ({ page }) => {
  const record = {
    id: "delete-day",
    date: today,
    updatedAt: "2026-04-25T10:00:00.000Z",
    exercises: [
      {
        id: "delete-squat",
        name: "深蹲",
        loadGroups: [
          {
            id: "delete-squat-10",
            label: "10kg",
            entries: ["9", "9"],
          },
          {
            id: "delete-squat-12",
            label: "12kg",
            entries: ["7"],
          },
        ],
      },
      {
        id: "delete-row",
        name: "划船",
        loadGroups: [
          {
            id: "delete-row-default",
            label: "",
            entries: ["10"],
          },
        ],
      },
    ],
  };

  await page.evaluate(
    ({ seedRecord }) => {
      localStorage.setItem("movement-journal-records", JSON.stringify([seedRecord]));
    },
    { seedRecord: record },
  );
  await page.reload();

  await page.getByRole("button", { name: "删除" }).click();

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".history-load-block").filter({ hasText: "12kg" }).locator(".load-delete-button").click();
  await expect(page.getByRole("button", { name: "12kg" })).toBeHidden();

  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem("movement-journal-records") ?? "[]"));
  expect(saved[0].exercises[0].loadGroups.map((group: { label: string }) => group.label)).toEqual(["10kg"]);

  page.once("dialog", (dialog) => dialog.accept());
  await page
    .locator(".history-exercise")
    .filter({ hasText: "划船" })
    .locator(".exercise-delete-button")
    .click();
  await expect(page.getByText("划船")).toBeHidden();

  saved = await page.evaluate(() => JSON.parse(localStorage.getItem("movement-journal-records") ?? "[]"));
  expect(saved[0].exercises.map((exercise: { name: string }) => exercise.name)).toEqual(["深蹲"]);
});

test("可以在同一天拖动动作排序", async ({ page }) => {
  const record = {
    id: "sort-day",
    date: today,
    updatedAt: "2026-04-25T10:00:00.000Z",
    exercises: ["深蹲", "划船", "硬拉"].map((name, index) => ({
      id: `sort-exercise-${index}`,
      name,
      loadGroups: [
        {
          id: `sort-load-${index}`,
          label: "",
          entries: [`${index + 1}`],
        },
      ],
    })),
  };

  await page.evaluate(
    ({ seedRecord }) => {
      localStorage.setItem("movement-journal-records", JSON.stringify([seedRecord]));
    },
    { seedRecord: record },
  );
  await page.reload();

  const firstHandle = page.locator(".history-exercise .exercise-drag-handle").first();
  const lastExercise = page.locator(".history-exercise").nth(2);
  const start = await firstHandle.boundingBox();
  const end = await lastExercise.boundingBox();
  expect(start).toBeTruthy();
  expect(end).toBeTruthy();

  const startX = start!.x + start!.width / 2;
  const startY = start!.y + start!.height / 2;
  const endX = end!.x + end!.width / 2;
  const endY = end!.y + end!.height / 2;

  await firstHandle.dispatchEvent("pointerdown", {
    clientX: startX,
    clientY: startY,
    pointerId: 1,
    pointerType: "touch",
  });
  await firstHandle.dispatchEvent("pointermove", {
    clientX: endX,
    clientY: endY,
    pointerId: 1,
    pointerType: "touch",
  });
  await firstHandle.dispatchEvent("pointerup", {
    clientX: endX,
    clientY: endY,
    pointerId: 1,
    pointerType: "touch",
  });

  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("movement-journal-records") ?? "[]")[0].exercises.map(
      (exercise: { name: string }) => exercise.name,
    ),
  );
  expect(saved).toEqual(["划船", "硬拉", "深蹲"]);
});

test("可以把历史记录复制到今天", async ({ page }) => {
  const sourceRecord = {
    id: "source-2026-03-18",
    date: "2026-03-18",
    updatedAt: "2026-03-18T10:00:00.000Z",
    exercises: [
      {
        id: "exercise-pull",
        name: "引体向上",
        loadGroups: [
          {
            id: "load-default",
            label: "",
            entries: ["5", "5"],
          },
        ],
      },
    ],
  };

  await page.evaluate(
    ({ record }) => {
      localStorage.setItem("movement-journal-records", JSON.stringify([record]));
    },
    { record: sourceRecord },
  );
  await page.reload();

  await page.getByRole("button", { name: "今天（复制）+" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "18" }).click();

  await expect(page.getByText("引体向上")).toHaveCount(2);
  const savedDates = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("movement-journal-records") ?? "[]").map(
      (record: { date: string }) => record.date,
    ),
  );
  expect(savedDates).toContain(today);
});

test("可以查看运动日历，并导出导入本地备份", async ({ page }) => {
  const backupRecord = {
    id: "backup-day",
    date: "2026-04-18",
    updatedAt: "2026-04-18T10:00:00.000Z",
    exercises: [
      {
        id: "backup-exercise",
        name: "硬拉",
        loadGroups: [
          {
            id: "backup-load",
            label: "60kg",
            entries: ["5", "5"],
          },
        ],
      },
    ],
  };

  await page.evaluate(
    ({ record }) => {
      localStorage.setItem("movement-journal-records", JSON.stringify([record]));
    },
    { record: backupRecord },
  );
  await page.reload();

  await page.getByRole("button", { name: "日历" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "18" })).toHaveClass(/calendar-day--active/);
  await page.getByRole("button", { name: "18" }).click();
  await expect(page.getByText("硬拉")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(download.suggestedFilename()).toContain("movement-journal-backup");
  expect(downloadPath).toBeTruthy();

  const exported = await readFile(downloadPath!, "utf8");
  expect(download.suggestedFilename()).toContain(".txt");
  expect(exported).toContain("# 运动日记 TXT v1");
  expect(exported).toContain("2026-04-18 | 硬拉 | 60kg | 5 / 5");

  const importedRecord = {
    ...backupRecord,
    id: "imported-day",
    date: today,
    exercises: [
      {
        id: "imported-exercise",
        name: "卧推",
        loadGroups: [
          {
            id: "imported-load",
            label: "40kg",
            entries: ["8"],
          },
        ],
      },
    ],
  };

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('input[type="file"]').setInputFiles({
    name: "movement-journal-backup.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      [
        "# 运动日记 TXT v1",
        "日期 | 动作 | 类型 | 数字",
        `${importedRecord.date} | 卧推 | 40kg | 8`,
      ].join("\n"),
    ),
  });

  await expect(page.getByText("卧推")).toBeVisible();
  await expect(page.getByText("硬拉")).toBeHidden();
});
