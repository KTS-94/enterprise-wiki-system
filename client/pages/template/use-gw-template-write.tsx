import React from "react";
import { useParams } from "react-router-dom";
import TemplateWrite from "@/features/template/components/template-write";
import { useCoviWikiBridge } from "@/features/editor/hooks/use-coviwiki-bridge";

export default function TemplateWriter() {
  useCoviWikiBridge();
  const { templateId } = useParams();

  React.useEffect(() => {
    document.body.classList.add("docmost_viewer");
    return () => {
      document.body.classList.remove("docmost_viewer");
    };
  }, []);

  if (!templateId) return <div>Invalid template ID</div>;

  return <TemplateWrite templateId={templateId} />;
}
