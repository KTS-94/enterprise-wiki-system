import React from "react";
import { useParams } from "react-router-dom";
import HistoryView from "@/features/template/components/template-history";
import { useCoviWikiBridge } from "@/features/editor/hooks/use-coviwiki-bridge";

export default function HistoryPage() {
  useCoviWikiBridge();
  const { historyId } = useParams();

  React.useEffect(() => {
    document.body.classList.add("docmost_viewer");
    return () => {
      document.body.classList.remove("docmost_viewer");
    };
  }, []);

  if (!historyId) return <div>Invalid history ID</div>;

  return <HistoryView historyId={historyId} />;
}
