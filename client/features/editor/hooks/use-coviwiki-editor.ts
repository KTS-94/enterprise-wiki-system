import { useEffect, useMemo } from "react";
import { PageEditMode } from "@/features/user/types/user.types";
import { TextSelection } from "@tiptap/pm/state";
import { createTemplate } from '@/features/template/services/template-service';

export function useEditorModeSync(editor: any) {
  useEffect(() => {
    if (!editor) return;

    const handler = (e: Event) => {
      const mode = (e as CustomEvent<PageEditMode>).detail;
      editor.setEditable(mode === "edit");
    };

    document.addEventListener("COVIWIKI_SET_MODE", handler as EventListener);
    return () => {
      document.removeEventListener("COVIWIKI_SET_MODE", handler as EventListener);
    };
  }, [editor]);
}

export function useEditorRestoreSync(editor: any, isTitle = false) {
  useEffect(() => {
    if (!editor) return;

    const handler = (e: Event) => {
      const { title, content } = (e as CustomEvent).detail;
      const data = isTitle ? title : content;

      editor.commands.clearContent();
      editor.commands.setContent(data, isTitle); // isTitle이면 parseHTML
    };

    document.addEventListener("COVIWIKI_RESTORE_PAGE", handler);
    return () => {
      document.removeEventListener("COVIWIKI_RESTORE_PAGE", handler);
    };
  }, [editor, isTitle]);
}

export function useEditorTemplateUseSync(editor: any, isTitle = false) {
  useEffect(() => {
    if (!editor) return;

    const handler = (e: Event) => {
      const { title, content } = (e as CustomEvent).detail;
      const data = isTitle ? title : content;

      editor.commands.clearContent();
      editor.commands.setContent(data, isTitle); // isTitle이면 parseHTML
    };

    document.addEventListener("COVIWIKI_TEMPLATE_USE", handler);
    return () => {
      document.removeEventListener("COVIWIKI_TEMPLATE_USE", handler);
    };
  }, [editor, isTitle]);
}

export function useRequestHeadingsSync(editor: any) {
  useEffect(() => {
    if (!editor) return;

    const handler = () => {
      const headings: { label: string; level: number; position: number }[] = [];

      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading") {
          headings.push({
            label: node.textContent,
            level: node.attrs?.level ?? 1,
            position: pos,
          });
        }
      });

      try {
        // @ts-ignore
        window.parent?.WIKIInbound?.receiveHeadings?.(headings);
      } catch (e) {
        console.warn("WIKIInbound.receiveHeadings 호출 실패", e);
      }
    };

    document.addEventListener("COVIWIKI_REQUEST_HEADINGS", handler);
    return () => document.removeEventListener("COVIWIKI_REQUEST_HEADINGS", handler);
  }, [editor]);
}

export function useScrollToHeadingSync(editor: any) {
  useEffect(() => {
    if (!editor) return;

    const handler = (e: Event) => {
      let pos = (e as CustomEvent).detail;
      if (typeof pos === "string") pos = parseInt(pos, 10);
      if (typeof pos !== "number" || isNaN(pos)) return;

      try {
        const { view } = editor;
        const headings = view.dom.querySelectorAll("h1, h2, h3");
        let targetEl: HTMLElement | null = null;

        headings.forEach((el) => {
          const posEl = view.posAtDOM(el, 0);
          if (posEl === pos + 1 && !targetEl) {
            targetEl = el;
          }
        });

        if (!targetEl) return;

        const offset = 90;
        const scrollTop = targetEl.getBoundingClientRect().top + window.scrollY - offset;
        // @ts-ignore
        window.parent?.WIKIInbound?.scrollToHeading?.(scrollTop);
        view.focus();
      } catch (err) {
        console.warn("SCROLL_TO_HEADING failed:", err);
      }
    };

    document.addEventListener("COVIWIKI_SCROLL_TO_HEADING", handler);
    return () => document.removeEventListener("COVIWIKI_SCROLL_TO_HEADING", handler);
  }, [editor]);
}

/**
 * 그룹웨어 postMessage로 전달받은 commentId를 에디터에 적용하고 후처리까지 수행
 */
export function useInlineCommentSync(editor: any) {

  useEffect(() => {
    if (!editor) return;

    const handler = (e: Event) => {
      const commentId = (e as CustomEvent<string>).detail;
      if (typeof commentId !== "string") return;

      try {
        // 1. 선택된 영역에 comment-id 마크 적용
        editor
          .chain()
          .focus()
          .setComment(commentId)
          .unsetCommentDecoration()
          .run();

        // 2. 선택 해제 (버블메뉴 닫힘 등)
        editor.commands.setTextSelection({
          from: editor.state.selection.from,
          to: editor.state.selection.from,
        });

      } catch (err) {
        console.warn("Inline comment apply failed:", err);
      }
    };

    document.addEventListener("COVIWIKI_SET_COMMENT", handler);
    return () => {
      document.removeEventListener("COVIWIKI_SET_COMMENT", handler);
    };
  }, [editor]);
}

export function useRemoveInlineCommentSync(editor: any) {
  useEffect(() => {
    if (!editor) return;

    const handler = (e: Event) => {
      const commentId = (e as CustomEvent<string>).detail;
      if (typeof commentId !== "string") return;

      try {
        editor.chain().focus().unsetComment(commentId).run();
      } catch (err) {
        console.warn("Failed to remove inline comment:", err);
      }
    };

    document.addEventListener("COVIWIKI_REMOVE_COMMENT", handler);
    return () => {
      document.removeEventListener("COVIWIKI_REMOVE_COMMENT", handler);
    };
  }, [editor]);
}

export function useScrollToCommentSync() {
  useEffect(() => {
    const handler = (e: Event) => {
      const commentId = (e as CustomEvent<string>).detail;
      if (typeof commentId !== "string") return;

      const el = document.querySelector(`.comment-mark[data-comment-id="${commentId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("comment-highlight");
        setTimeout(() => el.classList.remove("comment-highlight"), 3000);
      }
    };

    document.addEventListener("COVIWIKI_SCROLL_TO_COMMENT", handler);
    return () => document.removeEventListener("COVIWIKI_SCROLL_TO_COMMENT", handler);
  }, []);
}

export function useTemplateCreate(pageEditor: any, templateId: string) {
  useEffect(() => {
    if (!pageEditor) return;

    const handler = async (e: Event) => { 
      const params = (e as CustomEvent<string>).detail;
      if (typeof params !== "string") return;

      const payload = JSON.parse(params);
      payload.content = pageEditor.getJSON();
      payload.templateId = templateId;
      const saved = await createTemplate(payload); // POST /templates

      try {
        // @ts-ignore
        window.parent?.WIKIInbound?.saveDraftTemplate?.({
          title: saved.title,
          templateId: saved.templateId,
        });
      } catch (e) {
        console.warn("Failed to call WIKIInbound.saveDraftTemplate", e);
      }
    };

    document.addEventListener("TEMPLATE_CREATE", handler);
    return () => {
      document.removeEventListener("TEMPLATE_CREATE", handler);
    };
  }, [pageEditor]);
}