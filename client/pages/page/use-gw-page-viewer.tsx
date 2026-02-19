import React from "react";
import { useParams } from "react-router-dom";
import PageView from "@/features/page/components/page-view";
import { useCoviWikiBridge } from "@/features/editor/hooks/use-coviwiki-bridge";

export default function PageViewer() {
  useCoviWikiBridge();
  const { pageId } = useParams();

  React.useEffect(() => {
    document.body.classList.add("docmost_viewer");
    return () => {
      document.body.classList.remove("docmost_viewer");
    };
  }, []);

  if (!pageId) return <div>Invalid page ID</div>;

  return <PageView pageId={pageId} />;
}
