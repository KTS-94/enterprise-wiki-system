import React from "react";
import { useParams } from "react-router-dom";
import TemplateView from "@/features/template/components/template-view";
import { useCoviWikiBridge } from "@/features/editor/hooks/use-coviwiki-bridge";

export default function TemplateViewer() {
  useCoviWikiBridge();
  const { templateId } = useParams();

  React.useEffect(() => {
    document.body.classList.add("docmost_viewer");
    return () => {
      document.body.classList.remove("docmost_viewer");
    };
  }, []);

  if (!templateId) return <div>Invalid template ID</div>;

  return <TemplateView templateId={templateId} />;
}
