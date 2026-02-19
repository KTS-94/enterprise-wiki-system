/**
 * @modified from Docmost (AGPL-3.0)
 * @see https://github.com/docmost/docmost
 *
 * 그룹웨어 연동 타이틀 에디터
 */
import "@/features/editor/styles/index.css";
import React, { useCallback, useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Document } from "@tiptap/extension-document";
import { Heading } from "@tiptap/extension-heading";
import { Text } from "@tiptap/extension-text";
import { Placeholder } from "@tiptap/extension-placeholder";
import { useAtomValue } from "jotai";
import {
  pageEditorAtom,
  titleEditorAtom,
} from "@/features/editor/atoms/editor-atoms";
import {
  updatePageData,
  useUpdateTitlePageMutation,
} from "@/features/page/queries/page-query";
import { useDebouncedCallback, getHotkeyHandler } from "@mantine/hooks";
import { useAtom } from "jotai";
import { useQueryEmit } from "@/features/websocket/use-query-emit.ts";
import { History } from "@tiptap/extension-history";
import { buildPageUrl } from "@/features/page/page.utils.ts";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import EmojiCommand from "@/features/editor/extensions/emoji-command.ts";
import { UpdateEvent } from "@/features/websocket/types";
import localEmitter from "@/lib/local-emitter.ts";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom.ts";
import { PageEditMode } from "@/features/user/types/user.types.ts";
import { useEditorModeSync, useEditorRestoreSync, useEditorTemplateUseSync } from "@/features/editor/hooks/use-coviwiki-editor";
import { useIsAdminPage } from "@/hooks/use-gw-mode";

export interface TitleEditorProps {
  pageId: string;
  slugId: string;
  title: string;
  spaceSlug: string;
  editable: boolean;
}

export function TitleEditor({
  pageId,
  slugId,
  title,
  spaceSlug,
  editable,
}: TitleEditorProps) {
  const { t } = useTranslation();
  const { mutateAsync: updateTitlePageMutationAsync } =
    useUpdateTitlePageMutation();
  const pageEditor = useAtomValue(pageEditorAtom);
  const [, setTitleEditor] = useAtom(titleEditorAtom);
  const emit = useQueryEmit();
  const navigate = useNavigate();
  const [activePageId, setActivePageId] = useState(pageId);
  const [currentUser] = useAtom(currentUserAtom);
  const userPageEditMode =
    currentUser?.user?.settings?.pageEditMode ?? PageEditMode.Edit;
  const [localPageMode, setLocalPageMode] = useState<"edit" | "read" | null>(null);
  const isAdminPage = useIsAdminPage(); // 관리자 페이지 여부 확인

  const titleEditor = useEditor({
    extensions: [
      Document.extend({
        content: "heading",
      }),
      Heading.configure({
        levels: [1],
      }),
      Text,
      Placeholder.configure({
        placeholder: t("Untitled"),
        showOnlyWhenEditable: false,
      }),
      History.configure({
        depth: 20,
      }),
      EmojiCommand,
    ],
    onCreate({ editor }) {
      if (editor) {
        // @ts-ignore
        setTitleEditor(editor);
        setActivePageId(pageId);
      }
    },
    onUpdate({ editor }) {
      debounceUpdate();
    },
    editable: editable,
    content: title,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
  });

  // 1) SET_MODE 이벤트 처리
  useEffect(() => {
    const handler = (e: any) => {
      const mode = e.detail as "edit" | "read";
      setLocalPageMode(mode);
    };
    document.addEventListener("COVIWIKI_SET_MODE", handler);
    return () => document.removeEventListener("COVIWIKI_SET_MODE", handler);
  }, []);

  // 2) pageId 바뀌면 override 초기화
  useEffect(() => {
    setLocalPageMode(null);
  }, [pageId]);

  // 3) editable 최종 결정 (override → 관리자 페이지 → 기본설정)
  useEffect(() => {
    if (!titleEditor) return;

    // 1) 페이지 override 최우선 (그룹웨어에서 SET_PAGE_EDIT_MODE 호출 시)
    if (localPageMode) {
      titleEditor.setEditable(localPageMode === "edit");
      return;
    }

    // 2) override 없으면 관리자 페이지는 읽기 모드
    if (isAdminPage) {
      titleEditor.setEditable(false);
      return;
    }

    // 3) 그 외에는 사용자 기본설정 적용
    if (userPageEditMode === PageEditMode.Edit && editable) {
      titleEditor.setEditable(true);
    } else {
      titleEditor.setEditable(false);
    }
  }, [titleEditor, localPageMode, userPageEditMode, editable, isAdminPage]);

  useEditorModeSync(titleEditor);
  useEditorRestoreSync(titleEditor, true);
  useEditorTemplateUseSync(titleEditor, true);

  useEffect(() => {
    const pageSlug = buildPageUrl(spaceSlug, slugId, title);
    navigate(pageSlug, { replace: true });
  }, [title]);

  const saveTitle = useCallback(() => {
    if (!titleEditor || activePageId !== pageId) return;

    if (
      titleEditor.getText() === title ||
      (titleEditor.getText() === "" && title === null)
    ) {
      return;
    }

    updateTitlePageMutationAsync({
      pageId: pageId,
      title: titleEditor.getText(),
    }).then((page) => {
      const event: UpdateEvent = {
        operation: "updateOne",
        spaceId: page.spaceId,
        entity: ["pages"],
        id: page.id,
        payload: {
          title: page.title,
          slugId: page.slugId,
          parentPageId: page.parentPageId,
          icon: page.icon,
        },
      };

      if (page.title !== titleEditor.getText()) return;

      updatePageData(page);

      localEmitter.emit("message", event);
      emit(event);

      // 그룹웨어 LNB 제목 갱신 메시지 전송
      try {
        // @ts-ignore
        window.parent?.WIKIInbound?.setLNBSubject?.({
          title: page.title,
          pageId: page.id,
          slugId: page.slugId,
        });
      } catch (e) {
        console.warn("Failed to call WIKIInbound.setLNBSubject", e);
      }
    });
  }, [pageId, title, titleEditor]);

  const debounceUpdate = useDebouncedCallback(saveTitle, 500);

  useEffect(() => {
    if (titleEditor && title !== titleEditor.getText()) {
      titleEditor.commands.setContent(title);
    }
  }, [pageId, title, titleEditor]);

  useEffect(() => {
    setTimeout(() => {
      titleEditor?.commands.focus("end");
    }, 500);
  }, [titleEditor]);

  useEffect(() => {
    return () => {
      // force-save title on navigation
      saveTitle();
    };
  }, [pageId]);

  /* useEffect(() => {
    // honor user default page edit mode preference
    if (userPageEditMode && titleEditor && editable) {
      if (userPageEditMode === PageEditMode.Edit) {
        titleEditor.setEditable(true);
      } else if (userPageEditMode === PageEditMode.Read) {
        titleEditor.setEditable(false);
      }
    }
  }, [userPageEditMode, titleEditor, editable]); */

  const openSearchDialog = () => {
    const event = new CustomEvent("openFindDialogFromEditor", {});
    document.dispatchEvent(event);
  };

  function handleTitleKeyDown(event: any) {
    if (!titleEditor || !pageEditor || event.shiftKey) return;

    // Prevent focus shift when IME composition is active
    // `keyCode === 229` is added to support Safari where `isComposing` may not be reliable
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
      return;

    const { key } = event;
    const { $head } = titleEditor.state.selection;

    const shouldFocusEditor =
      key === "Enter" ||
      key === "ArrowDown" ||
      (key === "ArrowRight" && !$head.nodeAfter);

    if (shouldFocusEditor) {
      pageEditor.commands.focus("start");
    }
  }

  return (
    <EditorContent
      editor={titleEditor}
      onKeyDown={(event) => {
        // First handle the search hotkey
        getHotkeyHandler([["mod+F", openSearchDialog]])(event);
        
        // Then handle other key events
        handleTitleKeyDown(event);
      }}
    />
  );
}
