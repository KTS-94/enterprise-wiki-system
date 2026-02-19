import { useMemo } from "react";

export function useIsAdminPage() {
  return useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      // @ts-ignore
      return !!window.parent?.WIKIbase?.isAdminPage;
    } catch {
      return false;
    }
  }, []);
}
