import React from "react";
import TemplateDraft from "@/features/template/components/template-draft";
import { useCoviWikiBridge } from "@/features/editor/hooks/use-coviwiki-bridge";

export default function TemplateDrafter() {
  useCoviWikiBridge();

  React.useEffect(() => {
    document.body.classList.add("docmost_viewer");
    return () => {
      document.body.classList.remove("docmost_viewer");
    };
  }, []);

  return <TemplateDraft />;
}
