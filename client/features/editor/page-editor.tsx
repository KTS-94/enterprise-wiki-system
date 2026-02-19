/**
 * @modified from Docmost (AGPL-3.0)
 * @see https://github.com/docmost/docmost
 *
 * 그룹웨어 Awareness 관리, 접속자 목록, 읽기/편집 모드 오버라이드, Yjs 오류 복구
 */
import "@/features/editor/styles/index.css";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import {
  HocuspocusProvider,
  onAuthenticationFailedParameters,
  WebSocketStatus,
} from "@hocuspocus/provider";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  collabExtensions,
  mainExtensions,
} from "@/features/editor/extensions/extensions";
import { useAtom } from "jotai";
import useCollaborationUrl from "@/features/editor/hooks/use-collaboration-url";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import {
  pageEditorAtom,
  yjsConnectionStatusAtom,
} from "@/features/editor/atoms/editor-atoms";
import { EditorBubbleMenu } from "@/features/editor/components/bubble-menu/bubble-menu";
import TableCellMenu from "@/features/editor/components/table/table-cell-menu.tsx";
import TableMenu from "@/features/editor/components/table/table-menu.tsx";
import ImageMenu from "@/features/editor/components/image/image-menu.tsx";
import CalloutMenu from "@/features/editor/components/callout/callout-menu.tsx";
import VideoMenu from "@/features/editor/components/video/video-menu.tsx";
import {
  handleFileDrop,
  handlePaste,
} from "@/features/editor/components/common/editor-paste-handler.tsx";
import LinkMenu from "@/features/editor/components/link/link-menu.tsx";
import ExcalidrawMenu from "./components/excalidraw/excalidraw-menu";
import DrawioMenu from "./components/drawio/drawio-menu";
import { useCollabToken } from "@/features/auth/queries/auth-query.tsx";
import SearchAndReplaceDialog from "@/features/editor/components/search-and-replace/search-and-replace-dialog.tsx";
import { useDebouncedCallback, useDocumentVisibility } from "@mantine/hooks";
import { useIdle } from "@/hooks/use-idle.ts";
import { queryClient } from "@/main.tsx";
import { IPage } from "@/features/page/types/page.types.ts";
import { useParams } from "react-router-dom";
import { extractPageSlugId } from "@/lib";
import { FIVE_MINUTES } from "@/lib/constants.ts";
import { PageEditMode } from "@/features/user/types/user.types.ts";
import { jwtDecode } from "jwt-decode";
import { 
  useEditorModeSync, 
  useEditorRestoreSync, 
  useEditorTemplateUseSync, 
  useRequestHeadingsSync, 
  useScrollToHeadingSync, 
  useInlineCommentSync, 
  useRemoveInlineCommentSync,
  useScrollToCommentSync 
} from "@/features/editor/hooks/use-coviwiki-editor";
import { useIsAdminPage } from "@/hooks/use-gw-mode";
import { getDisplayName } from "@/lib/utils.tsx";

interface PageEditorProps {
  pageId: string;
  editable: boolean;
  content: any;
}

export default function PageEditor({
  pageId,
  editable,
  content,
}: PageEditorProps) {
  const collaborationURL = useCollaborationUrl();
  const [currentUser] = useAtom(currentUserAtom);
  const [, setEditor] = useAtom(pageEditorAtom);
  const ydocRef = useRef<Y.Doc | null>(null);
  const [localPageMode, setLocalPageMode] = useState<"edit"|"read"|null>(null);
  if (!ydocRef.current) {
    ydocRef.current = new Y.Doc();
  }
  const ydoc = ydocRef.current;
  const [isLocalSynced, setLocalSynced] = useState(false);
  const [isRemoteSynced, setRemoteSynced] = useState(false);
  const [yjsConnectionStatus, setYjsConnectionStatus] = useAtom(
    yjsConnectionStatusAtom
  );
  const menuContainerRef = useRef(null);
  const documentName = `page.${pageId}`;
  const { data: collabQuery, refetch: refetchCollabToken } = useCollabToken();
  const { isIdle, resetIdle } = useIdle(FIVE_MINUTES, { initialState: false });
  const documentState = useDocumentVisibility();
  const [isCollabReady, setIsCollabReady] = useState(false);
  const { pageSlug } = useParams();
  const slugId = extractPageSlugId(pageSlug);
  const userPageEditMode =
    currentUser?.user?.settings?.pageEditMode ?? PageEditMode.Edit;
  const isAdminPage = useIsAdminPage();

  // Providers only created once per pageId
  const providersRef = useRef<{
    local: IndexeddbPersistence;
    remote: HocuspocusProvider;
  } | null>(null);
  const [providersReady, setProvidersReady] = useState(false);

  const localProvider = providersRef.current?.local;
  const remoteProvider = providersRef.current?.remote;


  // 그룹웨어 화면에 현재 페이지에 접속자 목록 표시
  // 누가 접속했는지/나갔는지를 Hocuspocus가 자동 감지해서 알려줌.
  // 페이지 들어옴, 떠남, 탭 닫음, websocket 재연결등
  /*  
  ===================================================
    온라인 사용자 표시 (최종 안정 버전)
    - awareness 업데이트를 부모(Groupware)로만 전달
    - 자신의 user 정보를 awareness에 직접 주입
  ===================================================
  */

  // 1) 내 user 정보를 awareness에 등록 + 주기적 heartbeat (awareness timeout 방지)
  useEffect(() => {
    if (!remoteProvider || !currentUser?.user) return;

    const awareness = remoteProvider.awareness;

    const setUserAwareness = () => {
      awareness.setLocalStateField("user", {
        pageId: pageId, // 현재 페이지 ID 추가
        workspaceId: currentUser.user.workspaceId,
        usercode: currentUser.user.usercode,
        name: getDisplayName(currentUser.user.multidisplayname),
        photopath: currentUser.user.photopath,
        companycode: currentUser.user.companycode,
        companyname: currentUser.user.companyname,
        deptcode: currentUser.user.deptcode,
        deptname: currentUser.user.deptname,
        joblevel: currentUser.user.joblevel,
        jobtitle: currentUser.user.jobtitle,
        jobposition: currentUser.user.jobposition,
        _heartbeat: Date.now(), // heartbeat timestamp
      });
    };

    // 초기 등록
    setUserAwareness();

    // Yjs awareness 기본 timeout은 30초, 10초마다 heartbeat 전송 (K8s 멀티 Pod Redis 지연 대비)
    const heartbeatInterval = setInterval(setUserAwareness, 10000);

    return () => {
      clearInterval(heartbeatInterval);
    };
  }, [remoteProvider, currentUser, pageId]);

  // 2) 접속자 목록 부모 프레임으로만 전달 (사용자 구성이 변경될 때만)
  useEffect(() => {
    if (!remoteProvider) return;

    const awareness = remoteProvider.awareness;
    let lastUserKeys = "";

    // 접속자 목록이 변경된 경우에만 부모로 전달
    const updateUsersIfChanged = () => {
      const states = Array.from(awareness.getStates().values());
      const users = states
        .map((s) => s.user)
        .filter(Boolean);

      // usercode 기준 변경 감지 (단순 heartbeat는 무시)
      const currentKeys = users.map((u) => u.usercode).sort().join(",");
      if (currentKeys === lastUserKeys) return;
      lastUserKeys = currentKeys;

      try {
        // @ts-ignore
        window.parent?.WIKIInbound?.updateOnlineUsers?.(users, pageId);
      } catch (e) {
        console.warn("updateOnlineUsers call failed", e);
      }
    };

    const handler = ({ added, updated, removed }) => {
      if (added.length > 0 || removed.length > 0 || updated.length > 0) {
        updateUsersIfChanged();
      }
    };

    awareness.on("update", handler);

    // 초기 자기 자신 출력
    updateUsersIfChanged();

    return () => {
      awareness.off("update", handler);
    };
  }, [remoteProvider, pageId]);

  // 3) 그룹웨어에 WebSocket 연결 상태 전달
  useEffect(() => {
    try {
      // @ts-ignore
      window.parent?.WIKIInbound?.updateConnectStatus?.(yjsConnectionStatus, pageId);
    } catch (e) {
      console.warn("updateConnectStatus call failed", e);
    }
  }, [yjsConnectionStatus, pageId]);

  // Track when collaborative provider is ready and synced
  const [collabReady, setCollabReady] = useState(false);
  useEffect(() => {
    if (
      remoteProvider?.status === WebSocketStatus.Connected &&
      isLocalSynced &&
      isRemoteSynced
    ) {
      setCollabReady(true);
    }
  }, [remoteProvider?.status, isLocalSynced, isRemoteSynced]);

  useEffect(() => {
    if (!providersRef.current) {
      const local = new IndexeddbPersistence(documentName, ydoc);
      local.on("synced", () => setLocalSynced(true));
      const remote = new HocuspocusProvider({
        name: documentName,
        url: collaborationURL,
        document: ydoc,
        token: collabQuery?.token,
        connect: true,
        preserveConnection: false,
        onAuthenticationFailed: (auth: onAuthenticationFailedParameters) => {
          const payload = jwtDecode(collabQuery?.token);
          const now = Date.now().valueOf() / 1000;
          const isTokenExpired = now >= payload.exp;
          if (isTokenExpired) {
            refetchCollabToken().then((result) => {
              if (result.data?.token) {
                remote.disconnect();
                setTimeout(() => {
                  remote.configuration.token = result.data.token;
                  remote.connect();
                }, 100);
              }
            });
          }
        },
        onStatus: (status) => {
          if (status.status === "connected") {
            setYjsConnectionStatus(status.status);
          }
        },
      });
      remote.on("synced", () => setRemoteSynced(true));
      remote.on("disconnect", () => {
        setYjsConnectionStatus(WebSocketStatus.Disconnected);
      });
      providersRef.current = { local, remote };
      setProvidersReady(true);
    } else {
      setProvidersReady(true);
    }
    // Only destroy on final unmount
    return () => {
      providersRef.current?.remote.destroy();
      providersRef.current?.local.destroy();
      providersRef.current = null;
    };
  }, [pageId]);

  /*
  useEffect(() => {
    // Handle token updates by reconnecting with new token
    if (providersRef.current?.remote && collabQuery?.token) {
      const currentToken = providersRef.current.remote.configuration.token;
      if (currentToken !== collabQuery.token) {
        // Token has changed, need to reconnect with new token
        providersRef.current.remote.disconnect();
        providersRef.current.remote.configuration.token = collabQuery.token;
        providersRef.current.remote.connect();
      }
    }
  }, [collabQuery?.token]);
   */

  // Only connect/disconnect on tab/idle, not destroy
  useEffect(() => {
    if (!providersReady || !providersRef.current) return;
    const remoteProvider = providersRef.current.remote;
    if (
      isIdle &&
      documentState === "hidden" &&
      remoteProvider.status === WebSocketStatus.Connected
    ) {
      remoteProvider.disconnect();
      setIsCollabReady(false);
      return;
    }
    if (
      documentState === "visible" &&
      remoteProvider.status === WebSocketStatus.Disconnected
    ) {
      resetIdle();
      remoteProvider.connect();
      setTimeout(() => setIsCollabReady(true), 500);
    }
  }, [isIdle, documentState, providersReady, resetIdle]);

  const extensions = useMemo(() => {

    if (!remoteProvider || !currentUser?.user) return mainExtensions;
    return [
      ...mainExtensions,
      ...collabExtensions(remoteProvider, currentUser?.user),
    ];
  }, [remoteProvider, currentUser?.user]);

  const editor = useEditor(
    {
      extensions,
      editable,
      immediatelyRender: true,
      shouldRerenderOnTransaction: true,
      editorProps: {
        scrollThreshold: 80,
        scrollMargin: 80,
        handleDOMEvents: {
          keydown: (_view, event) => {
            if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') {
              event.preventDefault();
              return true;
            }
            if (["ArrowUp", "ArrowDown", "Enter"].includes(event.key)) {
              const slashCommand = document.querySelector("#slash-command");
              if (slashCommand) {
                return true;
              }
            }
            if (
              [
                "ArrowUp",
                "ArrowDown",
                "ArrowLeft",
                "ArrowRight",
                "Enter",
              ].includes(event.key)
            ) {
              const emojiCommand = document.querySelector("#emoji-command");
              if (emojiCommand) {
                return true;
              }
            }
          },
        },
        handlePaste: (view, event, slice) =>
          handlePaste(view, event, pageId, undefined, currentUser?.user.usercode),
        handleDrop: (view, event, _slice, moved) =>
          handleFileDrop(view, event, moved, pageId, undefined),
      },
      onCreate({ editor }) {
        if (editor) {
          // @ts-ignore
          setEditor(editor);
          editor.storage.pageId = pageId;
          const pageData = queryClient.getQueryData<IPage>(["pages", slugId]);
          if (pageData?.spaceId) {
            editor.storage.spaceId = pageData.spaceId;
          }
        }
      },
      onUpdate({ editor }) {
        if (editor.isEmpty) return;
        const editorJson = editor.getJSON();
        //update local page cache to reduce flickers
        debouncedUpdateContent(editorJson);
      },
    },
    [pageId, editable, remoteProvider]
  );

  /*  
  ===================================================
    읽기/편집 모드 “페이지 단위(local override) + 사용자 기본설정(global default)”
    A. 새로 페이지 진입	→ 사용자 기본설정(PageEditMode.Edit/Read) 적용
    B. 사용자가 “읽기/편집” 버튼 클릭	→ 현재 탭의 현재 페이지만 모드 변경 (Local Override)
    C. 다른 탭/다른 브라우저	→ 변경 영향 없음, 여전히 사용자 기본값 적용
    D. 이 페이지에서 다시 클릭 시	→ 현재 탭의 override만 계속 유지
    E. 새로운 페이지 이동	→ 다시 기본값(PageEditMode)을 기준으로 초기화
  ===================================================
  */
  // 페이지 단위 override 저장
  useEffect(() => {
    if (!editor) return;

    const handler = (e: any) => {
      const mode = e.detail as "edit" | "read";
      setLocalPageMode(mode);
    };

    document.addEventListener("COVIWIKI_SET_MODE", handler);
    return () => {
      document.removeEventListener("COVIWIKI_SET_MODE", handler);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    // 0) space member가 read 권한만 있으면 무조건 읽기 모드 고정
    //    (다른 설정에 의해 오버라이드되지 않음)
    if (!editable) {
      editor.setEditable(false);
      return;
    }

    // 1) 페이지 override 최우선 (그룹웨어에서 SET_PAGE_EDIT_MODE 호출 시)
    if (localPageMode) {
      editor.setEditable(localPageMode === "edit");
      return;
    }

    // 2) override 없으면 관리자 페이지는 읽기 모드
    if (isAdminPage) {
      editor.setEditable(false);
      return;
    }

    // 3) 그 외에는 사용자 기본설정(user_settings) 적용
    if (userPageEditMode === PageEditMode.Edit) {
      editor.setEditable(true);
    } else {
      editor.setEditable(false);
    }
  }, [editor, localPageMode, userPageEditMode, editable, isAdminPage]);

  // pageId 바뀔 때 local override 초기화
  useEffect(() => {
    setLocalPageMode(null);
  }, [pageId]);

  // Yjs nodeSize 동기화 오류 감지 → 자동 새로고침 (무한루프 방지 포함)
  useEffect(() => {
    const RELOAD_KEY = `coviwiki_yjs_reload_${pageId}`;

    const handleYjsSyncError = (event: ErrorEvent) => {
      const msg = event.message || event.error?.message || "";
      if (!msg.includes("nodeSize")) return;

      console.warn("[CoviWiki] Yjs sync error detected (nodeSize), attempting auto-reload...");

      // 무한 리로드 방지: 10초 내 재발생이면 새로고침 대신 그룹웨어 알림
      const now = Date.now();
      const lastReload = sessionStorage.getItem(RELOAD_KEY);
      if (lastReload && now - parseInt(lastReload, 10) < 10000) {
        console.error("[CoviWiki] Yjs sync error persists after reload. Notifying groupware.");
        try {
          // @ts-ignore
          window.parent?.WIKIInbound?.warnMessage?.(
            "문서 동기화 오류가 발생했습니다. 페이지를 새로고침해 주세요."
          );
        } catch (e) {
          // ignore
        }
        return;
      }

      sessionStorage.setItem(RELOAD_KEY, now.toString());
      window.location.reload();
    };

    window.addEventListener("error", handleYjsSyncError);
    return () => window.removeEventListener("error", handleYjsSyncError);
  }, [pageId]);

  useEditorModeSync(editor);
  useEditorRestoreSync(editor, false);
  useEditorTemplateUseSync(editor, false);
  useRequestHeadingsSync(editor);
  useScrollToHeadingSync(editor);
  useInlineCommentSync(editor);
  useRemoveInlineCommentSync(editor);
  useScrollToCommentSync();

  const debouncedUpdateContent = useDebouncedCallback((newContent: any) => {
    const pageData = queryClient.getQueryData<IPage>(["pages", slugId]);

    if (pageData) {
      queryClient.setQueryData(["pages", slugId], {
        ...pageData,
        content: newContent,
        updatedAt: new Date(),
      });
    }
  }, 3000);

  const handleActiveCommentEvent = (event) => {
    const { commentId, resolved } = event.detail;

    if (resolved) {
      return;
    }

    // 그룹웨어 쪽 함수 호출 (부모 프레임의 댓글 목록 열기)
        try {
          // @ts-ignore
          window.parent?.WIKIInbound?.openCommentAside?.(commentId);
        } catch (e) {
      console.warn("Failed to call WIKIInbound.openCommentAside", e);
    }
  };

  useEffect(() => {
    document.addEventListener("ACTIVE_COMMENT_EVENT", handleActiveCommentEvent);
    return () => {
      document.removeEventListener(
        "ACTIVE_COMMENT_EVENT",
        handleActiveCommentEvent
      );
    };
  }, []);

  useEffect(() => {
    if (remoteProvider?.status === WebSocketStatus.Connecting) {
      const timeout = setTimeout(() => {
        setYjsConnectionStatus(WebSocketStatus.Disconnected);
      }, 5000);
      return () => clearTimeout(timeout);
    }
  }, [remoteProvider?.status]);

  const isSynced = isLocalSynced && isRemoteSynced;

  useEffect(() => {
    const collabReadyTimeout = setTimeout(() => {
      if (
        !isCollabReady &&
        isSynced &&
        remoteProvider?.status === WebSocketStatus.Connected
      ) {
        setIsCollabReady(true);
      }
    }, 500);
    return () => clearTimeout(collabReadyTimeout);
  }, [isRemoteSynced, isLocalSynced, remoteProvider?.status]);

  /* useEffect(() => {
    // Only honor user default page edit mode preference and permissions
    if (editor) {
      if (userPageEditMode && editable) {
        if (userPageEditMode === PageEditMode.Edit) {
          editor.setEditable(true);
        } else if (userPageEditMode === PageEditMode.Read) {
          editor.setEditable(false);
        }
      } else {
        editor.setEditable(false);
      }
    }
  }, [userPageEditMode, editor, editable]); */

  const hasConnectedOnceRef = useRef(false);
  const [showStatic, setShowStatic] = useState(true);

  useEffect(() => {
    if (
      !hasConnectedOnceRef.current &&
      remoteProvider?.status === WebSocketStatus.Connected
    ) {
      hasConnectedOnceRef.current = true;
      setShowStatic(false);
    }
  }, [remoteProvider?.status]);

  return (
    <div style={{ position: "relative", paddingBottom: "400px" }}>
      {/* 연결 후: 협업 에디터 */}
      {!showStatic && (
        <div ref={menuContainerRef}>
          <EditorContent editor={editor} />

          {editor && (
            <SearchAndReplaceDialog editor={editor} editable={editable} />
          )}

          {editor && editor.isEditable && (
            <div>
              <EditorBubbleMenu editor={editor} />
              <TableMenu editor={editor} />
              <TableCellMenu editor={editor} appendTo={menuContainerRef} />
              <ImageMenu editor={editor} />
              <VideoMenu editor={editor} />
              <CalloutMenu editor={editor} />
              <ExcalidrawMenu editor={editor} />
              <DrawioMenu editor={editor} />
              <LinkMenu editor={editor} appendTo={menuContainerRef} />
            </div>
          )}
          <div onClick={() => editor?.commands.focus("end")} />
        </div>
      )}
    </div>
  );
}
