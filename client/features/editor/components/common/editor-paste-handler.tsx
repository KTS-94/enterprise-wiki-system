/**
 * @modified from Docmost (AGPL-3.0)
 * @see https://github.com/docmost/docmost
 *
 * HWP/Excel/마크다운 붙여넣기 핸들러
 */
import type { EditorView } from "@tiptap/pm/view";
import { uploadImageAction } from "@/features/editor/components/image/upload-image-action.tsx";
import { uploadVideoAction } from "@/features/editor/components/video/upload-video-action.tsx";
import { uploadAttachmentAction } from "../attachment/upload-attachment-action";
import { createMentionAction } from "@/features/editor/components/link/internal-link-paste.ts";
import { Slice } from "@tiptap/pm/model";
import { INTERNAL_LINK_REGEX } from "@/lib/constants.ts";

/**
 * base64 data URI를 File 객체로 변환
 */
function dataURItoFile(dataURI: string, filename: string): File | null {
  try {
    const arr = dataURI.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch) return null;
    const mime = mimeMatch[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
  } catch (e) {
    console.warn('Failed to convert data URI to file:', e);
    return null;
  }
}

/**
 * HTML에서 base64/data-URI 이미지를 추출하여 업로드 처리
 * 웹한글, MS Word 등에서 복사한 이미지 처리용
 */
async function extractAndUploadImagesFromHtml(
  html: string,
  view: EditorView,
  pageId?: string,
  templateId?: string,
): Promise<boolean> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const images = doc.querySelectorAll('img');

  let hasUploadedImages = false;
  let imageIndex = 0;

  for (const img of images) {
    const src = img.getAttribute('src');
    if (!src) continue;

    // data:image/xxx;base64,... 형식인지 확인
    if (src.startsWith('data:image/')) {
      const mimeMatch = src.match(/data:(image\/[^;]+);/);
      const ext = mimeMatch ? mimeMatch[1].split('/')[1] : 'png';
      const filename = `pasted-image-${Date.now()}-${imageIndex++}.${ext}`;

      const file = dataURItoFile(src, filename);
      if (file) {
        const pos = view.state.selection.from;
        const targetId = pageId || (templateId ? `template:${templateId}` : undefined);
        if (targetId) {
          uploadImageAction(file, view, pos, targetId);
          hasUploadedImages = true;
        }
      }
    }
    // Blob URL 처리 (file:// 또는 blob: 프로토콜)
    else if (src.startsWith('blob:')) {
      try {
        const response = await fetch(src);
        const blob = await response.blob();
        const ext = blob.type.split('/')[1] || 'png';
        const filename = `pasted-image-${Date.now()}-${imageIndex++}.${ext}`;
        const file = new File([blob], filename, { type: blob.type });

        const pos = view.state.selection.from;
        const targetId = pageId || (templateId ? `template:${templateId}` : undefined);
        if (targetId) {
          uploadImageAction(file, view, pos, targetId);
          hasUploadedImages = true;
        }
      } catch (e) {
        console.warn('Failed to fetch blob URL:', e);
      }
    }
  }

  return hasUploadedImages;
}

export const handlePaste = (
  view: EditorView,
  event: ClipboardEvent,
  pageId?: string,
  templateId?: string,
  creatorId?: string,
) => {
  const dt = event.clipboardData;
  const clipboardData = dt.getData("text/plain");
  const html = dt.getData("text/html");
  const hasHtml = dt.types.includes("text/html");
  const hasFiles = dt.files.length > 0;

  //
  // 0. HTML 내 base64 이미지 감지 및 추출 (웹한글, Word 등 지원)
  //
  if (hasHtml && html.includes('data:image/')) {
    event.preventDefault();
    extractAndUploadImagesFromHtml(html, view, pageId, templateId);
    return true;
  }

  //
  // 1. Excel/웹한글 테이블을 감지하면 → TipTap 확장에서 처리하도록 위임
  //
  const isHtmlTable =
    hasHtml &&
    (html.includes("<table") ||
      html.includes("<tr") ||
      html.includes("xmlns:x=\"urn:schemas-microsoft-com:office:excel\"") ||
      // 웹한글 테이블 지원
      html.includes("hwp") ||
      html.includes("HWP"));

  if (isHtmlTable) {
    // allow Tiptap extensions to process HTML table
    return false;
  }

  //
  // 2. 내부 링크 처리
  //

  if (INTERNAL_LINK_REGEX.test(clipboardData)) {
    // we have to do this validation here to allow the default link extension to takeover if needs be
    event.preventDefault();
    const url = clipboardData.trim();
    const { from: pos, empty } = view.state.selection;
    const match = INTERNAL_LINK_REGEX.exec(url);
    const currentPageMatch = INTERNAL_LINK_REGEX.exec(window.location.href);

    // pasted link must be from the same workspace/domain and must not be on a selection
    if (!empty || match[2] !== window.location.host) {
      // allow the default link extension to handle this
      return false;
    }

    // for now, we only support internal links from the same space
    // compare space name
    if (currentPageMatch[4].toLowerCase() !== match[4].toLowerCase()) {
      return false;
    }

    createMentionAction(url, view, pos, creatorId);
    return true;
  }

  //
  // 3. 파일/이미지 붙여넣기
  //
  if (hasFiles) {
    event.preventDefault();
    for (const file of event.clipboardData.files) {
      const pos = view.state.selection.from;
      if(pageId) {
        uploadImageAction(file, view, pos, pageId);
        uploadVideoAction(file, view, pos, pageId);
        uploadAttachmentAction(file, view, pos, pageId);
      } else if(templateId) {
        // @docmost/editor-ext는 onUpload(file, pageId) 형태로만 호출하므로
        // templateId를 pageId 위치에 전달하고, onUpload 함수에서 templateId로 처리
        uploadImageAction(file, view, pos, `template:${templateId}`);
        uploadVideoAction(file, view, pos, `template:${templateId}`);
        uploadAttachmentAction(file, view, pos, `template:${templateId}`);
      }
    }
    return true;
  }
  return false;
};

export const handleFileDrop = (
  view: EditorView,
  event: DragEvent,
  moved: boolean,
  pageId?: string,
  templateId?: string,
) => {
  if (!moved && event.dataTransfer?.files.length) {
    event.preventDefault();

    for (const file of event.dataTransfer.files) {
      const coordinates = view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      });

      if(pageId) {  
        uploadImageAction(file, view, coordinates?.pos ?? 0 - 1, pageId);
        uploadVideoAction(file, view, coordinates?.pos ?? 0 - 1, pageId);
        uploadAttachmentAction(file, view, coordinates?.pos ?? 0 - 1, pageId);
      } else if(templateId) {
        // @docmost/editor-ext는 onUpload(file, pageId) 형태로만 호출하므로
        // templateId를 pageId 위치에 전달하고, onUpload 함수에서 templateId로 처리
        uploadImageAction(file, view, coordinates?.pos ?? 0 - 1, `template:${templateId}`);
        uploadVideoAction(file, view, coordinates?.pos ?? 0 - 1, `template:${templateId}`);
        uploadAttachmentAction(file, view, coordinates?.pos ?? 0 - 1, `template:${templateId}`);
      }
    }
    return true;
  }
  return false;
};
