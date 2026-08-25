import { expect, test, type Page } from "@playwright/test";

const modifier = process.platform === "darwin" ? "Meta" : "Control";
const created = "2026-08-25T08:00:00.000Z";

function note(blocks: string[]) {
  return `${JSON.stringify({ formatVersion: "1.0.0", name: "Preview" })}\n${blocks.join("\n")}`;
}

function block(language: string, content: string, auto = 0) {
  return `---block:${language};auto=${auto};created=${created}\n${content}`;
}

async function loadFixture(page: Page, content: string) {
  await page.addInitScript((value) => {
    localStorage.setItem(
      "vibenote:mock-buffers",
      JSON.stringify([
        {
          path: "preview.txt",
          name: "Preview",
          tags: [],
          isScratch: true,
          content: value,
        },
      ]),
    );
  }, content);
  await page.goto("/");
  await expect(page.locator(".cm-editor")).toBeVisible();
}

async function savedContent(page: Page) {
  return page.evaluate(() => {
    const buffers = JSON.parse(
      localStorage.getItem("vibenote:mock-buffers") || "[]",
    );
    return buffers[0]?.content || "";
  });
}

async function clickLine(page: Page, text: string) {
  const line = page.locator(".cm-line").filter({ hasText: text }).first();
  await expect(line).toBeVisible();
  const box = await line.boundingBox();
  if (!box) throw new Error(`Line not found: ${text}`);
  await page.mouse.click(box.x + 8, box.y + box.height / 2);
}

async function revealToolbar(page: Page, lineText?: string) {
  const point = await page.evaluate((text) => {
    const host = document.querySelector<HTMLElement>(".editor-host");
    const line = text
      ? Array.from(document.querySelectorAll<HTMLElement>(".cm-line")).find(
          (element) => (element.textContent || "").includes(text),
        )
      : Array.from(
          document.querySelectorAll<HTMLElement>(".markdown-preview"),
        ).at(-1) || document.querySelector<HTMLElement>(".cm-line");
    if (!host || !line) return null;
    const hostRect = host.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    return { x: hostRect.right - 24, y: lineRect.top + 12 };
  }, lineText);
  if (!point) throw new Error("Unable to reveal block toolbar");
  await page.mouse.move(point.x, point.y);
  await expect(page.locator(".block-toolbar")).toBeVisible();
}

async function renderCurrentBlock(page: Page, lineText?: string) {
  await revealToolbar(page, lineText);
  await page.getByRole("button", { name: "渲染此块" }).click();
  await expect(page.locator(".markdown-preview").last()).toBeVisible();
}

test.describe("markdown block session preview", () => {
  test("session toggle is markdown-only, read-only, lossless, and reset by reload", async ({
    page,
  }) => {
    const fixture = note([
      block("markdown", "# Title\n\nBody", 1),
      block("json", '{"ok":true}'),
      block("sql", "select 1"),
      block("math", "2 + 2"),
    ]);
    await loadFixture(page, fixture);

    await revealToolbar(page, "# Title");
    await expect(
      page.locator(".block-toolbar .block-action-button"),
    ).toHaveCount(6);
    await expect(page.getByRole("button", { name: "渲染此块" })).toHaveCount(1);
    await page.getByRole("button", { name: "渲染此块" }).click();

    await expect(
      page.locator(".cm-line").filter({ hasText: "# Title" }),
    ).toHaveCount(0);
    await expect(page.locator(".markdown-preview h1")).toHaveText("Title");
    await page.keyboard.type("x");
    await expect.poll(() => savedContent(page)).toBe(fixture);
    expect(await savedContent(page)).not.toContain("preview=");

    await revealToolbar(page);
    await page.getByRole("button", { name: "回到源码" }).click();
    await expect(page.locator(".markdown-preview")).toHaveCount(0);
    await expect(
      page.locator(".cm-line").filter({ hasText: "# Title" }),
    ).toBeVisible();

    await clickLine(page, '{"ok":true}');
    await revealToolbar(page, '{"ok":true}');
    await expect(
      page.locator(".block-toolbar .block-action-button"),
    ).toHaveCount(5);
    await expect(page.getByRole("button", { name: "渲染此块" })).toHaveCount(0);

    await clickLine(page, "# Title");
    await renderCurrentBlock(page, "# Title");
    await page.reload();
    await expect(page.locator(".markdown-preview")).toHaveCount(0);
    await expect.poll(() => savedContent(page)).toBe(fixture);
  });

  test("empty blocks render without changing the buffer", async ({ page }) => {
    const fixture = note([
      block("markdown", ""),
      block("json", '{"next":true}'),
    ]);
    await loadFixture(page, fixture);
    await revealToolbar(page);
    await page.getByRole("button", { name: "渲染此块" }).click();
    await expect(page.locator(".markdown-preview")).toBeVisible();
    await expect.poll(() => savedContent(page)).toBe(fixture);
  });

  test("content anchors distinguish duplicate created values and retire on language change or deletion", async ({
    page,
  }) => {
    const fixture = note([
      block("markdown", "# One"),
      block("markdown", "# Two"),
      block("json", '{"keep":true}'),
    ]);
    await loadFixture(page, fixture);
    await renderCurrentBlock(page, "# One");
    await clickLine(page, "# Two");
    await renderCurrentBlock(page, "# Two");
    await expect(page.locator(".markdown-preview")).toHaveCount(2);

    await page.locator(".markdown-preview").first().dblclick();
    await expect(page.locator(".markdown-preview")).toHaveCount(1);
    await expect(page.locator(".markdown-preview h1")).toHaveText("Two");

    await renderCurrentBlock(page, "# One");
    await page.getByLabel("Current block language").selectOption("json");
    await expect(page.locator(".markdown-preview")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "渲染此块" })).toHaveCount(0);

    await page.locator(".markdown-preview").dblclick();
    await renderCurrentBlock(page, "# Two");
    await revealToolbar(page);
    await page
      .locator(".block-toolbar")
      .getByRole("button", { name: "删除此块" })
      .click();
    await expect(page.locator(".markdown-preview")).toHaveCount(0);
    await expect.poll(() => savedContent(page)).not.toContain("# Two");
  });

  test("tasks, visible copying, links, tables, and images work inside preview", async ({
    context,
    page,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:3344",
    });
    const fixture = note([
      block(
        "markdown",
        [
          "# Title",
          "- [ ] task",
          "[Example](https://example.com)",
          "![image](http://127.0.0.1:3344/favicon.svg)",
          "",
          "| A | B |",
          "| - | - |",
          "| 1 | 2 |",
        ].join("\n"),
      ),
    ]);
    await loadFixture(page, fixture);
    await page.evaluate(() => {
      (window as any).__openedExternal = [];
      (window.vibenote as any).shell = {
        openExternal: async (url: string) => {
          (window as any).__openedExternal.push(url);
          return true;
        },
      };
    });
    await renderCurrentBlock(page, "# Title");

    await page.keyboard.press(`${modifier}+A`);
    await page.keyboard.press(`${modifier}+C`);
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(
        [
          "# Title",
          "- [ ] task",
          "[Example](https://example.com)",
          "![image](http://127.0.0.1:3344/favicon.svg)",
          "",
          "| A | B |",
          "| - | - |",
          "| 1 | 2 |",
        ].join("\n"),
      );
    expect(
      await page.evaluate(() => navigator.clipboard.readText()),
    ).not.toContain("---block:");

    await page.locator(".markdown-preview-task").check();
    await expect.poll(() => savedContent(page)).toContain("- [x] task");

    await page.evaluate(() => {
      const heading = document.querySelector(".markdown-preview h1")!;
      const range = document.createRange();
      range.selectNodeContents(heading);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.press(`${modifier}+C`);
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("Title");

    await page.locator(".markdown-preview a").click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__openedExternal))
      .toEqual(["https://example.com"]);
    await expect(page.locator(".markdown-preview table")).toBeVisible();
    await expect(page.locator(".markdown-preview img")).toBeVisible();
    await expect(
      page.locator(".cm-line").filter({ hasText: "![image](" }),
    ).toHaveCount(0);
  });

  test("double-click exits preview and restores the cursor to block content", async ({
    page,
  }) => {
    await loadFixture(page, note([block("markdown", "# Title\nBody")]));
    await renderCurrentBlock(page, "# Title");
    await page.locator(".markdown-preview").dblclick();
    await expect(page.locator(".markdown-preview")).toHaveCount(0);
    await expect(
      page.locator(".cm-line").filter({ hasText: "# Title" }),
    ).toBeVisible();
    await expect(page.locator(".status-coordinate")).toHaveText("1:1");
  });
});
