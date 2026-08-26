import MarkdownIt from "markdown-it";
import multimdTable from "markdown-it-multimd-table";
import {
  EditorSelection,
  EditorState,
  StateField,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import {
  blockField,
  internalBlockEdit,
  markdownBlockPreviewField,
  setMarkdownBlockPreview,
} from "./blocks";
import { imagePreviewSource } from "./imagePreview";

const taskPattern = /^(\s*[-*+]\s+)\[([ xX])]\s+/gm;

function taskListPlugin(markdown: InstanceType<typeof MarkdownIt>) {
  markdown.core.ruler.after(
    "inline",
    "vibenote-preview-tasks",
    (state: any) => {
      const listItems: any[] = [];
      const taskIndexByLine = new Map<number, number>();
      const lineStarts = [0];
      for (let index = 0; index < state.src.length; index += 1) {
        if (state.src[index] === "\n") lineStarts.push(index + 1);
      }
      const lineAt = (offset: number) => {
        let low = 0;
        let high = lineStarts.length;
        while (low + 1 < high) {
          const middle = Math.floor((low + high) / 2);
          if (lineStarts[middle] <= offset) low = middle;
          else high = middle;
        }
        return low;
      };
      [...state.src.matchAll(taskPattern)].forEach((match, index) => {
        const marker = match.index + match[1].length;
        taskIndexByLine.set(lineAt(marker), index);
      });
      for (const token of state.tokens) {
        if (token.type === "list_item_open") {
          listItems.push(token);
          continue;
        }
        if (token.type === "list_item_close") {
          listItems.pop();
          continue;
        }
        if (
          listItems.length === 0 ||
          token.type !== "inline" ||
          !token.children
        )
          continue;

        const match = token.content.match(/^\[([ xX])]\s+/);
        if (!match) continue;
        const taskIndex = taskIndexByLine.get(token.map?.[0]);
        if (taskIndex === undefined) continue;
        let remaining = match[0].length;
        for (const child of token.children) {
          if (remaining === 0 || child.type !== "text") continue;
          const removed = Math.min(remaining, child.content.length);
          child.content = child.content.slice(removed);
          remaining -= removed;
        }
        if (remaining > 0) continue;

        const input = new state.Token("html_inline", "", 0);
        const checked = match[1].toLowerCase() === "x";
        input.content = `<input class="markdown-preview-task" type="checkbox" data-task-index="${taskIndex}" aria-label="Toggle task"${checked ? " checked" : ""}> `;
        token.children.unshift(input);
        listItems[listItems.length - 1].attrJoin(
          "class",
          "markdown-preview-task-item",
        );
      }
    },
  );
}

const markdown = new MarkdownIt({ html: false, linkify: false });
// markdown-it 14+ removed this legacy alias while multimd-table still calls it.
(
  markdown.utils as typeof markdown.utils & { assign: typeof Object.assign }
).assign = Object.assign;
markdown.use(multimdTable).use(taskListPlugin);

class MarkdownBlockPreviewWidget extends WidgetType {
  private readonly anchor: number;
  private readonly source: string;
  private readonly tone: "even" | "odd";
  private readonly isStart: boolean;
  private readonly visualOffset: number;

  constructor(
    anchor: number,
    source: string,
    tone: "even" | "odd",
    isStart: boolean,
    visualOffset: number,
  ) {
    super();
    this.anchor = anchor;
    this.source = source;
    this.tone = tone;
    this.isStart = isStart;
    this.visualOffset = visualOffset;
  }

  eq(other: MarkdownBlockPreviewWidget) {
    return (
      this.anchor === other.anchor &&
      this.source === other.source &&
      this.tone === other.tone &&
      this.isStart === other.isStart &&
      this.visualOffset === other.visualOffset
    );
  }

  toDOM(view: EditorView) {
    const container = document.createElement("section");
    container.className = [
      "markdown-preview",
      this.tone === "even" ? "block-even" : "block-odd",
      this.isStart ? "block-start" : "",
    ]
      .filter(Boolean)
      .join(" ");
    container.dataset.contentAnchor = String(this.anchor);
    if (this.visualOffset > 0) {
      container.style.marginTop = `${this.visualOffset}px`;
    }
    try {
      container.innerHTML = markdown.render(this.source);
      this.prepareImages(container);
      this.bindTasks(container, view);
      this.bindLinks(container);
    } catch (error) {
      container.replaceChildren();
      const message = document.createElement("p");
      message.className = "markdown-preview-error";
      message.textContent = "Unable to render this Markdown block.";
      container.appendChild(message);
      console.error("Failed to render Markdown block preview", error);
    }
    container.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      exitMarkdownPreview(view, this.anchor);
    });
    return container;
  }

  private prepareImages(container: HTMLElement) {
    for (const image of container.querySelectorAll<HTMLImageElement>("img")) {
      const source = imagePreviewSource(image.getAttribute("src") || "");
      if (source) image.src = source;
      else image.removeAttribute("src");
    }
  }

  private bindTasks(container: HTMLElement, view: EditorView) {
    for (const checkbox of container.querySelectorAll<HTMLInputElement>(
      ".markdown-preview-task",
    )) {
      checkbox.addEventListener("mousedown", (event) =>
        event.stopPropagation(),
      );
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => {
        const block = blockFromAnchor(view, this.anchor);
        const index = Number(checkbox.dataset.taskIndex);
        if (!block || !Number.isInteger(index)) return;
        const content = view.state.doc.sliceString(
          block.content.from,
          block.content.to,
        );
        const match = [...content.matchAll(taskPattern)][index];
        if (!match) return;
        const marker = block.content.from + match.index! + match[1].length + 1;
        view.dispatch({
          changes: {
            from: marker,
            to: marker + 1,
            insert: checkbox.checked ? "x" : " ",
          },
          annotations: internalBlockEdit.of(true),
          userEvent: "input",
        });
      });
    }
  }

  private bindLinks(container: HTMLElement) {
    container.addEventListener("click", (event) => {
      const target =
        event.target instanceof Element ? event.target.closest("a") : null;
      if (!(target instanceof HTMLAnchorElement)) return;
      event.preventDefault();
      event.stopPropagation();
      const url = target.getAttribute("href") || "";
      if (!/^https?:\/\//i.test(url)) return;
      void window.vibenote.shell.openExternal(url).catch((error) => {
        console.error("Failed to open external link", error);
      });
    });
  }
}

function blockFromAnchor(view: EditorView, anchor: number) {
  return view.state
    .field(blockField)
    .find((block) => block.content.from === anchor);
}

function exitMarkdownPreview(view: EditorView, anchor: number) {
  const block = blockFromAnchor(view, anchor);
  if (!block) return;
  const selection = view.state.selection.main;
  const selectionBelongsToBlock =
    selection.from >= block.content.from && selection.to <= block.content.to;
  view.dispatch({
    effects: setMarkdownBlockPreview.of({
      anchor: block.content.from,
      enabled: false,
    }),
    ...(selectionBelongsToBlock
      ? {}
      : { selection: EditorSelection.cursor(block.content.from) }),
    scrollIntoView: true,
  });
  view.focus();
}

export const markdownBlockPreview = StateField.define<DecorationSet>({
  create(state) {
    return buildPreviewDecorations(state);
  },
  update(decorations, transaction) {
    if (
      transaction.docChanged ||
      transaction.startState.field(markdownBlockPreviewField) !==
        transaction.state.field(markdownBlockPreviewField)
    ) {
      return buildPreviewDecorations(transaction.state);
    }
    return decorations;
  },
  provide(field) {
    return EditorView.decorations.from(field);
  },
});

function buildPreviewDecorations(state: EditorState) {
  const decorations: Range<Decoration>[] = [];
  const previews = new Map(
    state
      .field(markdownBlockPreviewField)
      .map((entry) => [entry.anchor, entry] as const),
  );
  state.field(blockField).forEach((block, index) => {
    const preview = previews.get(block.content.from);
    if (block.language !== "markdown" || !preview) {
      return;
    }
    const source = state.doc.sliceString(block.content.from, block.content.to);
    const widget = new MarkdownBlockPreviewWidget(
      block.content.from,
      source,
      index % 2 === 0 ? "even" : "odd",
      index > 0,
      preview.visualOffset,
    );
    if (block.content.from === block.content.to) {
      decorations.push(
        Decoration.widget({ widget, block: true, side: 1 }).range(
          block.content.from,
        ),
      );
    } else {
      decorations.push(
        Decoration.replace({ widget, block: true }).range(
          block.content.from,
          block.content.to,
        ),
      );
    }
  });
  return Decoration.set(decorations, true);
}
