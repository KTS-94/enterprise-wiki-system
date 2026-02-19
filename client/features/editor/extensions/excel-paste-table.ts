import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";

/**
 * 웹한글/Excel/Word 등에서 복사된 테이블을 처리하는 확장
 */
export const ExcelPasteTable = Extension.create({
  name: "excelPasteTable",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handlePaste(view, event) {
            const clipboard = event.clipboardData;
            if (!clipboard) return false;

            const html = clipboard.getData("text/html");
            if (!html) return false;

            // Excel, Word, 웹한글 등에서 복사된 HTML인지 판별
            const isTableSource =
              html.includes("<table") ||
              html.includes("<tr") ||
              html.includes("mso-data-placement") ||
              // 웹한글 지원
              html.toLowerCase().includes("hwp") ||
              html.includes("xmlns:hwp") ||
              // MS Word 지원
              html.includes("xmlns:w=") ||
              html.includes("urn:schemas-microsoft-com:office:word");

            if (!isTableSource) return false;

            // 기본 붙여넣기 막기
            event.preventDefault();

            const { state } = view;
            const { schema, tr, selection } = state;
            const { from, to } = selection;

            // 브라우저 DOMParser 사용 (ProseMirrorDOMParser 아님)
            const windowParser = new window.DOMParser();
            const dom = windowParser.parseFromString(html, "text/html");

            // 테이블이 실제로 있는지 확인
            const tables = dom.querySelectorAll("table");
            if (tables.length === 0) {
              // 테이블이 없으면 기본 처리로 위임
              return false;
            }

            // ================================
            // 테이블 전처리
            // ================================
            tables.forEach((table) => {
              // 웹한글의 테이블 속성 정리
              // width, height 등 인라인 스타일을 제거하여 에디터 스타일 적용
              table.removeAttribute("cellspacing");
              table.removeAttribute("cellpadding");

              // 테이블에 기본 클래스 추가 (필요시)
              if (!table.getAttribute("class")) {
                table.setAttribute("class", "editor-table");
              }
            });

            // ================================
            // 첫 번째 행을 헤더처럼 스타일 강제 적용
            // ================================
            tables.forEach((table) => {
              const firstRow = table.querySelector("tr");
              if (firstRow) {
                const headerCells = firstRow.querySelectorAll("td, th");
                headerCells.forEach((cell) => {
                  const el = cell as HTMLElement;
                  // 스타일 강제 지정
                  el.setAttribute("data-background-color", "#eaecef");
                  el.style.backgroundColor = "#eaecef";
                });
              }
            });

            // ----------------------------------------
            // 셀 스타일을 보존하기 위한 필수 처리
            // style.backgroundColor → data-background-color
            // ----------------------------------------
            const cells = dom.querySelectorAll("td, th");

            cells.forEach((cell) => {
              const el = cell as HTMLElement;

              // 배경색 추출
              let bg = el.getAttribute("data-background-color")
                || el.style.backgroundColor
                || el.style.background
                || el.getAttribute("bgcolor");

              if (bg) {
                el.setAttribute("data-background-color", bg);
              }

              // 웹한글 특수 속성 처리
              // 병합된 셀 처리 (colspan, rowspan)
              const colspan = el.getAttribute("colspan");
              const rowspan = el.getAttribute("rowspan");
              if (colspan) el.setAttribute("colspan", colspan);
              if (rowspan) el.setAttribute("rowspan", rowspan);

              // 셀 내 이미지 처리 (data:image 형식)
              const images = el.querySelectorAll("img");
              images.forEach((img) => {
                const src = img.getAttribute("src");
                // data URI 이미지는 그대로 유지 (별도 처리 필요)
                if (src && src.startsWith("data:image/")) {
                  // 이미지 크기 조정
                  img.style.maxWidth = "100%";
                  img.style.height = "auto";
                }
              });
            });
            // --------------------------------------

            // HTML → ProseMirror Slice 변환
            const slice = ProseMirrorDOMParser
              .fromSchema(schema)
              .parseSlice(dom.body, {
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
