import { Decoration, WidgetType, ViewPlugin } from "@codemirror/view";
import type { EditorView, DecorationSet, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

const icon = `<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 24 24" height="200px" width="200px" xmlns="http://www.w3.org/2000/svg"><path fill="none" d="M0 0h24v24H0z"></path><path d="M18 15v3H6v-3H4v3c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-3h-2zM7 9l1.41 1.41L11 7.83V16h2V7.83l2.59 2.58L17 9l-5-5-5 5z"></path></svg>`;

class ButtonWidget extends WidgetType {
  constructor(private fileInput?: HTMLInputElement | null) {
    super();
  }

  toDOM(): HTMLElement {
    const label = document.createElement("span");
    label.className = "PGliteRepl-upload-label";
    const button = document.createElement("button");
    button.className = "PGliteRepl-upload-button";
    button.innerHTML = icon;
    button.title = "Select a file";
    let text;
    if (!this.fileInput?.files?.length) {
      text = "No file selected";
    } else {
      text = this.fileInput.files[0].name;
    }
    button.onclick = () => {
      this.fileInput?.click();
    };
    label.appendChild(document.createTextNode(text));
    button.appendChild(label);
    return button;
  }
}

export const uploadButtonPlugin = (fileInput: React.RefObject<HTMLInputElement>) => {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = getDecorations(view, fileInput.current);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = getDecorations(update.view, fileInput.current);
      }
    }
  }, {
    decorations: v => v.decorations
  });
}

function getDecorations(view: EditorView, fileInput?: HTMLInputElement | null): DecorationSet {
  let widgets = new RangeSetBuilder<Decoration>();
  for (let { from, to } of view.visibleRanges) {
    let text = view.state.doc.sliceString(from, to);
    let index = text.indexOf("from '/dev/blob'");
    while (index !== -1) {
      let deco = Decoration.widget({
        widget: new ButtonWidget(fileInput),
        side: 1
      });
      widgets.add(from + index + 16, from + index + 16, deco); // 15 is the length of "from '/dev/blob'"
      index = text.indexOf("from '/dev/blob'", index + 1);
    }
  }
  return widgets.finish();
}
