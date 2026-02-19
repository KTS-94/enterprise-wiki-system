/**
 * @modified from Docmost (AGPL-3.0)
 * @see https://github.com/docmost/docmost
 *
 * 그룹웨어 테마/컬러스킴 감지, 다국어 표시명 처리
 */
import { validate as isValidUUID } from "uuid";
import { ActionIcon } from "@mantine/core";
import { IconFileDescription } from "@tabler/icons-react";
import { ReactNode } from "react";
import { TFunction } from "i18next";

export function formatMemberCount(memberCount: number, t: TFunction): string {
  if (memberCount === 1) {
    return `1 ${t("member")}`;
  } else {
    return `${memberCount} ${t("members")}`;
  }
}

export function extractPageSlugId(slug: string): string {
  if (!slug) {
    return undefined;
  }
  if (isValidUUID(slug)) {
    return slug;
  }
  const parts = slug.split("-");
  return parts.length > 1 ? parts[parts.length - 1] : slug;
}

export const computeSpaceSlug = (name: string) => {
  const alphanumericName = name.replace(/[^a-zA-Z0-9\s]/g, "");
  if (alphanumericName.includes(" ")) {
    return alphanumericName
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase())
      .join("");
  } else {
    return alphanumericName.toLowerCase();
  }
};

export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0.0 KB";

  const unitSize = 1024;
  const units = ["KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

  const kilobytes = bytes / unitSize;

  const unitIndex = Math.floor(Math.log(kilobytes) / Math.log(unitSize));
  const adjustedUnitIndex = Math.max(unitIndex, 0);
  const adjustedSize = kilobytes / Math.pow(unitSize, adjustedUnitIndex);

  // Use one decimal for KB and no decimals for MB or higher
  const precision = adjustedUnitIndex === 0 ? 1 : 0;

  return `${adjustedSize.toFixed(precision)} ${units[adjustedUnitIndex]}`;
};

export async function svgStringToFile(
  svgString: string,
  fileName: string,
): Promise<File> {
  const blob = new Blob([svgString], { type: "image/svg+xml" });
  return new File([blob], fileName, { type: "image/svg+xml" });
}

// Convert a string holding Base64 encoded UTF-8 data into a proper UTF-8 encoded string
// as a replacement for `atob`.
// based on: https://developer.mozilla.org/en-US/docs/Glossary/Base64
function decodeBase64(base64: string): string {
  // convert string to bytes
  const bytes = Uint8Array.from(atob(base64), (m) => m.codePointAt(0));
  // properly decode bytes to UTF-8 encoded string
  return new TextDecoder().decode(bytes);
}

export function decodeBase64ToSvgString(base64Data: string): string {
  const base64Prefix = "data:image/svg+xml;base64,";
  if (base64Data.startsWith(base64Prefix)) {
    base64Data = base64Data.replace(base64Prefix, "");
  }

  return decodeBase64(base64Data);
}

export function capitalizeFirstChar(string: string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

export function getPageIcon(icon: string, size = 18): string | ReactNode {
  return (
    icon || (
      <ActionIcon variant="transparent" color="gray" size={size}>
        <IconFileDescription size={size} />
      </ActionIcon>
    )
  );
}

export function castToBoolean(value: unknown): boolean {
  if (value == null) {
    return false;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    const trueValues = ["true", "1"];
    const falseValues = ["false", "0"];

    if (trueValues.includes(trimmed)) {
      return true;
    }
    if (falseValues.includes(trimmed)) {
      return false;
    }
    return Boolean(trimmed);
  }

  return Boolean(value);
}

export function getGWColorScheme(): "light" | "dark" {
  try {
    const raw = (window.parent as any)?.Common?.getSession("PortalOption");
    const parsed = parsePortalOption(raw);
    const mode = parsed?.mode;
    return mode === "dark" ? "dark" : "light";
  } catch (e) {
    console.warn("getGWColorScheme() failed:", e);
    return "light"; // fallback
  }
}

/**
 * 그룹웨어 부모 window에서 Common.getSession("PortalOption")?.theme 값을 가져옵니다.
 * 실패하거나 값이 없으면 "default"를 반환합니다.
 */
export function getGWTheme(): string {
  try {
    const raw = (window.parent as any)?.Common?.getSession("PortalOption");
    const parsed = parsePortalOption(raw);
    return parsed?.theme || "default";
  } catch (e) {
    console.warn("getGWTheme() failed:", e);
    return "default";
  }
}

function parsePortalOption(raw: any): any {
  if (!raw) return null;

  // 이미 객체면 그대로 사용
  if (typeof raw === "object") {
    return raw;
  }

  // 문자열이면 JSON.parse 시도
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  return null;
}

export function getCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined; // SSR 대비
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : undefined;
}

export function normalizeLangCode(lang?: string): string {
  const map: Record<string, string> = {
    ko: "ko-KR",
    en: "en-US",
    ja: "ja-JP",
    zh: "zh-CN",
  };
  return map[lang ?? ""] ?? lang ?? "ko-KR";
}

export function getDisplayName(multiName: string, locale?: string): string {
  const langs = multiName?.split(";") ?? [];

  const langMap: Record<string, number> = {
    ko: 0,
    "ko-KR": 0,
    en: 1,
    "en-US": 1,
    ja: 2,
    "ja-JP": 2,
    zh: 3,
    "zh-CN": 3,
  };

  // 1. 우선순위: 인자로 받은 locale
  // 2. 쿠키(langCode)
  // 3. fallback "ko-KR"
  const cookieLang = normalizeLangCode(getCookie("langCode"));
  const currentLang = locale ?? cookieLang ?? "ko-KR";

  const index = langMap[currentLang] ?? 0;
  return langs[index] ?? langs[0] ?? "";
}
