import { useEffect, useMemo } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { updateUser } from "@/features/user/services/user-service";
import { PageEditMode } from "@/features/user/types/user.types";
import { useSetAtom } from "jotai";
import { userAtom } from "@/features/user/atoms/current-user-atom";
import useCurrentUser from "@/features/user/hooks/use-current-user";

type RequestReadyPayload =
  | { pageId: string }
  | { scope: "template"; templateKey: string; mode?: string };

type BridgeMsg =
  | { type: "REQUEST_READY"; payload: RequestReadyPayload }
  | { type: "COVIWIKI_NAVIGATE"; payload: { slug: string; pageId: string } }
  | { type: "SET_PAGE_EDIT_MODE"; payload: PageEditMode }
  | { type: "SET_FULL_PAGE_WIDTH"; payload: boolean }
  | { type: "COVIWIKI_RESTORE_PAGE"; payload: { title: any; content: any } }
  | { type: "COVIWIKI_TEMPLATE_USE"; payload: { title: any; content: any } }
  | { type: "REQUEST_HEADINGS" }
  | { type: "SCROLL_TO_HEADING"; payload: number | string }
  | { type: "COVIWIKI_SET_COMMENT"; payload: { commentId: string } }
  | { type: "COVIWIKI_REMOVE_COMMENT"; payload: { commentId: string } }
  | { type: "SCROLL_TO_COMMENT_MARK"; payload: { commentId: string } }
  | { type: "TEMPLATE_CREATE"; payload: string };

declare global {
  interface Window {
    __CoviWikiListenerReady?: boolean;
  }
}

export function useCoviWikiBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const setUser = useSetAtom(userAtom);
  const { refetch: refetchUser } = useCurrentUser();
  const origin = useMemo(() => window.location.origin, []);

  const applyEditMode = async (mode: PageEditMode) => {
    if (mode !== "edit" && mode !== "read") return;

    try {
      // 커스텀 이벤트 브로드캐스트 (use-coviwiki-editor 수신)
      // CoviWiki 내부에 에디터 모드 변경 이벤트만 전달
      document.dispatchEvent(new CustomEvent("COVIWIKI_SET_MODE", { detail: mode }));
    } catch (e) {
      console.warn("Failed to update pageEditMode:", e);
    }
  };

  useEffect(() => {
    if (window.__CoviWikiListenerReady) return;

    const sendReady = (payload: {
      scope: "page" | "template";
      pageId?: string;
      templateKey?: string;
    }) => {
      window.parent?.postMessage(
        {
          type: "COVIWIKI_READY",
          payload,
        },
        origin,
      );
    };

    // 현재 경로에서 pageId 또는 templateId 추출하는 함수
    const getCurrentContext = (): {
      scope: "page" | "template";
      pageId?: string;
      templateKey?: string;
    } | null => {
      const pathname = location.pathname;

      // 템플릿 경로 체크: /template/write/:templateId 또는 /template/draft
      if (pathname.startsWith("/template/")) {
        const templateId = params.templateId;
        if (templateId) {
          return {
            scope: "template",
            templateKey: templateId,
          };
        }
        // draft 모드
        if (pathname.includes("/template/draft")) {
          return {
            scope: "template",
            templateKey: "draft",
          };
        }
        return null;
      }

      // 페이지 경로 체크: /s/:slug/p/:pageSlug 또는 /s/:slug/p/:pageId
      const pageMatch = pathname.match(/\/s\/[^/]+\/p\/([^/]+)/);
      if (pageMatch) {
        const pageIdOrSlug = pageMatch[1];
        // UUID 형식 체크 (간단한 버전)
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pageIdOrSlug);
        
        if (isUUID) {
          return {
            scope: "page",
            pageId: pageIdOrSlug,
          };
        }
        // pageSlug인 경우, params에서 pageId 확인
        const pageId = params.pageId;
        if (pageId) {
          return {
            scope: "page",
            pageId: pageId,
          };
        }
        // pageSlug만 있는 경우는 실제 pageId를 찾기 어려우므로 null 반환
        // (REQUEST_READY를 기다려야 함)
      }

      return null;
    };

    const onMessage = async (ev: MessageEvent<BridgeMsg>) => {
      if (ev.origin !== origin) return;

      const msg = ev.data;
      switch (msg.type) {
        case "REQUEST_READY": {
          const payload = msg.payload;

          // page
          if ("pageId" in payload && payload.pageId) {
            sendReady({
              scope: "page",
              pageId: payload.pageId,
            });
            return;
          }

          // template
          if ("scope" in payload && payload.scope === "template") {
            sendReady({
              scope: "template",
              templateKey: payload.templateKey,
            });
            return;
          }

          break;
        }

        case "COVIWIKI_NAVIGATE": { // 페이지 변경 
          const { slug, pageId } = msg.payload;
          if (typeof slug === "string" && typeof pageId === "string") {
            await refetchUser(); // navigate 되기전에 유저정보를 다시 가져온다. (Edit/Read)가 바뀌었을 경우 다시 세팅하기 위해.
            navigate(`/s/${slug}/p/${pageId}`);
          }
          break;
        }

        case "SET_PAGE_EDIT_MODE": { // 현재 페이지 설정 : 에디터 모드 변경
          void applyEditMode(msg.payload);
          break;
        }

        case "COVIWIKI_RESTORE_PAGE": { // 페이지 복원
          const { title, content } = msg.payload || {};
          document.dispatchEvent(new CustomEvent("COVIWIKI_RESTORE_PAGE", {
            detail: { title, content },
          }));
          break;
        }

        case "COVIWIKI_TEMPLATE_USE": { // 페이지 복원
          const { title, content } = msg.payload || {};
          document.dispatchEvent(new CustomEvent("COVIWIKI_TEMPLATE_USE", {
            detail: { title, content },
          }));
          break;
        }

        case "SET_FULL_PAGE_WIDTH": { // 페이지 전체폭 설정
          const fullPageWidth = msg.payload;
          if (typeof fullPageWidth === "boolean") {
            try {
              const updatedUser = await updateUser({ fullPageWidth });
              setUser(updatedUser);
            } catch (e) {
              console.warn("Failed to update fullPageWidth:", e);
            }
          }
          break;
        }

        case "REQUEST_HEADINGS": // 페이지 목차데이터 조회
          document.dispatchEvent(new CustomEvent("COVIWIKI_REQUEST_HEADINGS"));
          break;

        case "SCROLL_TO_HEADING": // 선택된 목차로 스크롤
          document.dispatchEvent(new CustomEvent("COVIWIKI_SCROLL_TO_HEADING", {
            detail: msg.payload, // position
          }));
          break;
        
        case "COVIWIKI_SET_COMMENT": { // 생성된 댓글ID를 본문에 매핑
          const { commentId } = msg.payload || {};
          if (typeof commentId === "string") {
            document.dispatchEvent(new CustomEvent("COVIWIKI_SET_COMMENT", {
              detail: commentId,
            }));
          }
          break;
        }

        case "COVIWIKI_REMOVE_COMMENT": { // 삭제된 댓글ID받아 본문의 data-comment-id를 삭제
          const { commentId } = msg.payload || {};
          if (typeof commentId === "string") {
            document.dispatchEvent(new CustomEvent("COVIWIKI_REMOVE_COMMENT", {
              detail: commentId,
            }));
          }
          break;
        }

        case "SCROLL_TO_COMMENT_MARK": { // 매핑된 data-comment-id로 이동
          const { commentId } = msg.payload || {};
          if (typeof commentId === "string") {
            document.dispatchEvent(new CustomEvent("COVIWIKI_SCROLL_TO_COMMENT", {
              detail: commentId,
            }));
          }
          break;
        }

        case "TEMPLATE_CREATE": { // 템플릿 생성
          const params = msg.payload || "";
          if (typeof params === "string") {
            document.dispatchEvent(new CustomEvent("TEMPLATE_CREATE", {
              detail: params,
            }));
          }
          break;
        }

        default:
          console.warn("Unknown bridge message type:", msg);
      }
    };

    window.addEventListener("message", onMessage);
    
    // 자발적 READY: iframe load 시 현재 경로에서 context 추출해서 전송
    const context = getCurrentContext();
    if (context) {
      sendReady(context);
    }
    
    window.__CoviWikiListenerReady = true;

    return () => {
      window.removeEventListener("message", onMessage);
      window.__CoviWikiListenerReady = false;
    };
  }, [navigate, origin, setUser, location.pathname, params]);
}
