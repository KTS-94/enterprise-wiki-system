/**
 * @modified from Docmost (AGPL-3.0)
 * @see https://github.com/docmost/docmost
 *
 * GW 전용 URL 설정, 협업 URL 구성
 */
import bytes from "bytes";
import { castToBoolean } from "@/lib/utils.tsx";

declare global {
  interface Window {
    CONFIG?: Record<string, string>;
  }
}

export function getAppName(): string {
  return "CoviWiki";
}

export function getAppUrl(): string {
  return `${window.location.protocol}//${window.location.host}/coviwiki`;
}

export function getServerAppUrl(): string {
  return getConfigValue("APP_URL");
}

export function getBackendUrl(): string {
  return getAppUrl() + "/api";
}

/**
 * 실시간 협업(WebSocket) 서버 URL을 반환합니다.
 *
 * - .env의 COLLAB_URL이 있으면 그 값을 사용하고,
 * - 없으면 APP_URL을 기반으로 "/coviwiki/collab" 경로를 생성합니다.
 * - protocol은 http → ws / https → wss 로 자동 변환됩니다.
 */
export function getCollaborationUrl(): string {
  // 기본 WebSocket base URL
  const baseUrl = getConfigValue("COLLAB_URL") || (getConfigValue("APP_URL")?.replace(/\/$/, "") || getAppUrl());

  const collabUrl = new URL(baseUrl);

  // /coviwiki/ 가 있든 없든 → 항상 /coviwiki/collab 으로 고정
  collabUrl.pathname = "/coviwiki/collab";
  collabUrl.protocol = collabUrl.protocol === "https:" ? "wss:" : "ws:";
  return collabUrl.toString();
}

export function getAvatarUrl(avatarUrl: string) {
  if (!avatarUrl) return null;
  if (avatarUrl?.startsWith("http")) return avatarUrl;

  return getBackendUrl() + "/attachments/img/avatar/" + avatarUrl;
}

export function getSpaceUrl(spaceSlug: string) {
  return "/s/" + spaceSlug;
}

export function getFileUrl(src: string) {
  if (!src) return src;
  if (src.startsWith("http")) return src;
  if (src.startsWith("/api/")) {
    // Remove the '/api' prefix
    return getBackendUrl() + src.substring(4);
  }
  if (src.startsWith("/files/")) {
    return getBackendUrl() + src;
  }
  return src;
}

export function getFileUploadSizeLimit() {
  const limit = getConfigValue("FILE_UPLOAD_SIZE_LIMIT", "50mb");
  return bytes(limit);
}

export function getFileImportSizeLimit() {
  const limit = getConfigValue("FILE_IMPORT_SIZE_LIMIT", "200mb");
  return bytes(limit);
}

export function getDrawioUrl() {
  return getConfigValue("DRAWIO_URL", "https://embed.diagrams.net");
}

/**
 * 환경변수 값을 가져옵니다.
 * 
 * 운영 환경에서는 서버가 index.html에 삽입한 `window.CONFIG`에서 값을 읽고,
 * 개발 환경(Vite dev server)에서도 동일하게 `window.CONFIG`만 사용하도록 통일합니다.
 * 
 * ※ `process.env`는 빌드 시점에만 존재하며, 런타임에서는 사용할 수 없기 때문에 제거합니다.
 *
 * @param key 환경 변수 키 (예: "APP_URL")
 * @param defaultValue 기본값 (해당 키가 없을 경우 반환할 값)
 * @returns 설정된 환경 변수 값 또는 기본값
 */
function getConfigValue(key: string, defaultValue: string = undefined): string {
  // const rawValue = import.meta.env.DEV ? process?.env?.[key] : window?.CONFIG?.[key];
  // return rawValue ?? defaultValue;
  return window?.CONFIG?.[key] ?? defaultValue;
}
