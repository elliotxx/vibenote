import { strings, type Lang } from "./i18n";

const LANG_KEY = "vibenote-lang";
const THEME_KEY = "vibenote-theme";

function preferLang(): Lang {
  const stored = localStorage.getItem(LANG_KEY);
  if (stored === "zh" || stored === "en") return stored;
  return "zh";
}

function preferTheme(): "light" | "dark" {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyLang(lang: Lang) {
  const dict = strings[lang];
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.title = dict["meta.title"];

  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute("content", dict["meta.description"]);

  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (!key || !(key in dict)) return;
    el.textContent = dict[key];
  });

  document.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((el) => {
    const key = el.dataset.i18nAria;
    if (!key || !(key in dict)) return;
    el.setAttribute("aria-label", dict[key]);
  });

  const docs = document.querySelector<HTMLAnchorElement>("[data-docs-link]");
  if (docs) {
    docs.href =
      lang === "zh"
        ? "https://github.com/elliotxx/vibenote/blob/main/docs/guides/using-vibenote.zh-CN.md"
        : "https://github.com/elliotxx/vibenote/blob/main/docs/guides/using-vibenote.md";
  }

  localStorage.setItem(LANG_KEY, lang);
}

function applyTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute("content", theme === "dark" ? "#0e141d" : "#eef3f8");
  }
  const toggle = document.querySelector<HTMLButtonElement>("[data-theme-toggle]");
  if (toggle) {
    toggle.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
    toggle.textContent =
      theme === "dark"
        ? strings[preferLangStored()]["nav.theme.light"]
        : strings[preferLangStored()]["nav.theme.dark"];
  }
}

function preferLangStored(): Lang {
  const stored = localStorage.getItem(LANG_KEY);
  return stored === "en" ? "en" : "zh";
}

function setupReveal() {
  const nodes = document.querySelectorAll<HTMLElement>("[data-reveal]");
  if (!nodes.length) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    nodes.forEach((n) => n.classList.add("is-visible"));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
  );

  nodes.forEach((n) => io.observe(n));
}

function setupNav() {
  const header = document.querySelector<HTMLElement>(".site-header");
  if (!header) return;

  const onScroll = () => {
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

function main() {
  const lang = preferLang();
  const theme = preferTheme();
  applyLang(lang);
  applyTheme(theme);

  document.querySelector("[data-lang-toggle]")?.addEventListener("click", () => {
    const next: Lang = preferLangStored() === "zh" ? "en" : "zh";
    applyLang(next);
    // Refresh theme toggle label in new language
    applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  });

  document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    applyTheme(current === "dark" ? "light" : "dark");
  });

  setupNav();
  setupReveal();
}

main();
