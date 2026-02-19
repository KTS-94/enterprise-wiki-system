import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { DOMParser as ProseMirrorDOMParser, Node } from "@tiptap/pm/model";

/**
 * 웹한글(Hancom)에서 복사한 콘텐츠를 처리하는 확장
 * - 박스(테두리 있는 영역) → Callout으로 변환
 * - 특수 서식 요소 처리
 */
export const HancomPasteHandler = Extension.create({
  name: "hancomPasteHandler",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handlePaste(view, event) {
            const clipboard = event.clipboardData;
            if (!clipboard) return false;

            const html = clipboard.getData("text/html");
            if (!html) return false;

            // 웹한글 콘텐츠인지 감지
            const isHancom =
              html.toLowerCase().includes("hwp") ||
              html.includes("xmlns:hwp") ||
              html.includes("hancom") ||
              html.includes("Hancom");

            if (!isHancom) return false;

            // 브라우저 DOMParser로 파싱
            const windowParser = new window.DOMParser();
            const doc = windowParser.parseFromString(html, "text/html");

            // 박스 요소 감지 및 변환 (테두리 있는 div)
            let hasConvertedBox = false;
            const elements = doc.querySelectorAll("div, p, section");

            elements.forEach((el) => {
              const element = el as HTMLElement;
              const style = element.getAttribute("style") || "";
              const computedBorder =
                style.includes("border") ||
                element.style.border ||
                element.style.borderWidth ||
                element.style.borderStyle;

              // 테두리가 있는 요소를 Callout으로 변환
              if (computedBorder) {
                // 박스를 callout div로 변환
                const calloutDiv = doc.createElement("div");
                calloutDiv.setAttribute("data-type", "callout");
                calloutDiv.setAttribute("data-callout-type", "info");

                // 내용 이동
                while (element.firstChild) {
                  calloutDiv.appendChild(element.firstChild);
                }

                // 원래 요소 대체
                element.parentNode?.replaceChild(calloutDiv, element);
                hasConvertedBox = true;
              }
            });

            // 박스 변환이 없었다면 기본 처리로 위임
            if (!hasConvertedBox) {
              return false;
            }

            // 기본 붙여넣기 막기
            event.preventDefault();

            const { state } = view;
            const { schema, tr, selection } = state;
            const { from, to } = selection;

            // HTML → ProseMirror Slice 변환
            const slice = ProseMirrorDOMParser
              .fromSchema(schema)
              .parseSlice(doc.body, {
                preserveWhitespace: true,
              });

            tr.replaceRange(from, to, slice);
            view.dispatch(tr);

            return true;
          },
        },
      }),
    ];
  },
});
