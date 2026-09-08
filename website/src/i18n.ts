export type Lang = "zh" | "en";

export type Dictionary = Record<string, string>;

export const strings: Record<Lang, Dictionary> = {
  zh: {
    "meta.title": "Vibenote — 沉浸式、顺手、AI Native 的纯文本笔记",
    "meta.description":
      "面向 macOS Apple Silicon 的本地纯文本笔记应用。一条持续的 note stream，用 block 划分节奏，打开就能写。",
    "nav.features": "功能",
    "nav.feel": "手感",
    "nav.download": "下载",
    "nav.github": "GitHub",
    "nav.lang": "English",
    "nav.theme.light": "浅色",
    "nav.theme.dark": "深色",
    "hero.brand": "Vibenote",
    "hero.tagline": "沉浸式、顺手、AI Native 的纯文本笔记。",
    "hero.value":
      "一条 note stream，打开就能写。不先想目录、文件或格式——block 只是节奏，不是整理工作。",
    "hero.cta.primary": "下载 macOS 版",
    "hero.cta.secondary": "在 GitHub 查看",
    "hero.platform": "仅限 macOS Apple Silicon（arm64）",
    "mock.title": "写作台面",
    "mock.status": "已自动保存 · stream.txt",
    "mock.lang": "纯文本",
    "mock.block1.title": "今早想到的",
    "mock.block1.line1": "把发布说明改成「先写，再整理」的口吻。",
    "mock.block1.line2": "安装提示要诚实：未公证，右键打开即可。",
    "mock.block2.title": "片段",
    "mock.block2.line1": "shasum -a 256 -c SHA256SUMS",
    "mock.block2.line2": "open Vibenote.app",
    "mock.block3.title": "备忘",
    "mock.block3.line1": "AI 可以建议，但不重写我的原文。",
    "features.kicker": "功能",
    "features.title": "少一点界面，多一点书写。",
    "features.lead": "设计目标是安静、精确、就绪——足够用心，但不会打断记录。",
    "features.immersive.title": "沉浸式记录",
    "features.immersive.body":
      "没有侧边栏目录树、没有 tab、没有多 buffer 切换。打开就是唯一的 note stream。",
    "features.blocks.title": "Block 是节奏",
    "features.blocks.body":
      "用边界分隔想法与片段，而不是把内容塞进文件夹。跳转、拆分、删除都围绕书写节奏。",
    "features.plain.title": "纯文本优先",
    "features.plain.body":
      "内容保存在本地 stream.txt：可读、可移植、容易备份，长期仍然是你的文字。",
    "features.shortcuts.title": "快捷键不抢戏",
    "features.shortcuts.body":
      "新增、拆分、选择、跳转——快捷键服务于输入，而不是把应用变成第二套 IDE。",
    "features.ai.title": "AI 辅助，不改写原文",
    "features.ai.body":
      "围绕 block 边界提供非破坏性协助。AI 是旁观者，不是接管整理的编辑器。",
    "features.local.title": "本地，可选 Git 备份",
    "features.local.body":
      "数据留在本机。需要时开启单向 Git 快照，备份内部笔记与引用图片。",
    "feel.kicker": "手感",
    "feel.title": "打开 → 书写 → 自动保存",
    "feel.lead": "成功的标准很简单：进入写作台面，可靠地保存，block 边界刚好够导航。",
    "feel.step1.title": "打开",
    "feel.step1.body": "没有欢迎向导，没有先建文件夹。窗口就绪，光标已在书写位置。",
    "feel.step2.title": "书写",
    "feel.step2.body": "想法、日志、代码片段直接落入同一条流。需要时再按 block 切开。",
    "feel.step3.title": "自动保存",
    "feel.step3.body": "边写边存；退出前同步落盘。系统状态可见，但不会抢走注意力。",
    "download.kicker": "下载",
    "download.title": "下载 Vibenote",
    "download.lead": "最新版本提供 DMG 与 SHA256SUMS。当前仅支持 macOS Apple Silicon。",
    "download.cta": "获取最新发布",
    "download.sums": "同时下载 SHA256SUMS 并校验",
    "download.note":
      "当前构建未签名、未公证。若 macOS 拦截首次启动，请在 Finder 中右键 Vibenote.app → 打开，并确认对话框。",
    "download.tip": "安装提示",
    "download.tip.body":
      "打开 DMG，将应用拖入「应用程序」。校验：shasum -a 256 -c SHA256SUMS",
    "footer.docs": "使用指南",
    "footer.product": "产品说明",
    "footer.github": "GitHub",
    "footer.releases": "发布页",
    "footer.copy": "© elliotxx. 本地纯文本笔记。",
    "footer.site": "官网源码位于仓库 website/ 目录。",
  },
  en: {
    "meta.title": "Vibenote — Immersive, effortless, AI-native plain text notes",
    "meta.description":
      "A local plain-text notes app for macOS Apple Silicon. One continuous note stream, blocks as rhythm, open and write.",
    "nav.features": "Features",
    "nav.feel": "Feel",
    "nav.download": "Download",
    "nav.github": "GitHub",
    "nav.lang": "中文",
    "nav.theme.light": "Light",
    "nav.theme.dark": "Dark",
    "hero.brand": "Vibenote",
    "hero.tagline": "Immersive, effortless, AI-native plain text notes.",
    "hero.value":
      "One note stream. Open and write. No folders, files, or formatting first — blocks are rhythm, not filing work.",
    "hero.cta.primary": "Download for macOS",
    "hero.cta.secondary": "View on GitHub",
    "hero.platform": "macOS Apple Silicon (arm64) only",
    "mock.title": "Writing surface",
    "mock.status": "Autosaved · stream.txt",
    "mock.lang": "Plain text",
    "mock.block1.title": "This morning",
    "mock.block1.line1": "Rewrite the release notes in a write-first voice.",
    "mock.block1.line2": "Be honest about unsigned builds — right-click Open.",
    "mock.block2.title": "Snippet",
    "mock.block2.line1": "shasum -a 256 -c SHA256SUMS",
    "mock.block2.line2": "open Vibenote.app",
    "mock.block3.title": "Note to self",
    "mock.block3.line1": "AI can suggest — it must not rewrite my source notes.",
    "features.kicker": "Features",
    "features.title": "Less chrome. More writing.",
    "features.lead":
      "Quiet, precise, and ready — enough craft to feel intentional, not enough weight to interrupt capture.",
    "features.immersive.title": "Immersive capture",
    "features.immersive.body":
      "No sidebar tree, tabs, or buffer switching. The only surface is your note stream.",
    "features.blocks.title": "Blocks as rhythm",
    "features.blocks.body":
      "Boundaries separate ideas and snippets — they are not folders. Split, jump, and delete around the writing beat.",
    "features.plain.title": "Plain text first",
    "features.plain.body":
      "Stored as local stream.txt: readable, portable, easy to back up. Your words stay your words.",
    "features.shortcuts.title": "Shortcuts that stay out of the way",
    "features.shortcuts.body":
      "Add, split, select, navigate — shortcuts serve input, not a second IDE.",
    "features.ai.title": "AI assist without rewriting",
    "features.ai.body":
      "Non-destructive help around block boundaries. AI is secondary, never a cleanup takeover.",
    "features.local.title": "Local + optional Git backup",
    "features.local.body":
      "Data stays on your Mac. Optionally enable one-way Git snapshots for notes and referenced images.",
    "feel.kicker": "How it feels",
    "feel.title": "Open → write → autosave",
    "feel.lead":
      "Success is simple: open into a focused surface, save reliably, keep block boundaries just visible enough to navigate.",
    "feel.step1.title": "Open",
    "feel.step1.body":
      "No onboarding tour, no create-a-folder first. The window is ready; the caret is waiting.",
    "feel.step2.title": "Write",
    "feel.step2.body":
      "Thoughts, logs, and snippets land in one stream. Split into blocks when the rhythm asks for it.",
    "feel.step3.title": "Autosave",
    "feel.step3.body":
      "Save as you type; sync on quit. System state is available without stealing attention.",
    "download.kicker": "Download",
    "download.title": "Get Vibenote",
    "download.lead":
      "Latest release includes the DMG and SHA256SUMS. macOS Apple Silicon only for now.",
    "download.cta": "Latest release",
    "download.sums": "Also grab SHA256SUMS and verify",
    "download.note":
      "Builds are currently unsigned and not notarized. If macOS blocks the first launch, right-click Vibenote.app in Finder → Open, then confirm.",
    "download.tip": "Install tip",
    "download.tip.body":
      "Open the DMG and drag the app into Applications. Verify with: shasum -a 256 -c SHA256SUMS",
    "footer.docs": "User guide",
    "footer.product": "Product",
    "footer.github": "GitHub",
    "footer.releases": "Releases",
    "footer.copy": "© elliotxx. Local plain text notes.",
    "footer.site": "Site source lives in the website/ folder of the repo.",
  },
};
