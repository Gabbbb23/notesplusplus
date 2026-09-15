import { useLocation } from "react-router";
import { NotFoundState } from "@/components/page-state";

export function NotFoundPage() {
  const { pathname } = useLocation();
  return <NotFoundState title="Not found" message="There is no page at" value={pathname} />;
}
