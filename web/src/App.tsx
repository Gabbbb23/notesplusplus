import { Route, Routes } from "react-router";
import { Layout } from "@/components/layout";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CheckPage } from "@/pages/check";
import { FilesPage } from "@/pages/files";
import { HomePage } from "@/pages/home";
import { InboxPage } from "@/pages/inbox";
import { NotFoundPage } from "@/pages/not-found";
import { NotePage } from "@/pages/note";
import { PrintNotePage } from "@/pages/print-note";
import { SearchPage } from "@/pages/search";
import { TagPage } from "@/pages/tag";
import { TagsPage } from "@/pages/tags";

export function App() {
  return (
    <TooltipProvider>
      <Routes>
        {/* The page the server prints to PDF: the note alone, without the sidebar, top bar, menus, or toasts. */}
        <Route path="print/notes/:slug" element={<PrintNotePage />} />
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="notes/:slug" element={<NotePage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="tags" element={<TagsPage />} />
          <Route path="tags/:tag" element={<TagPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="files" element={<FilesPage />} />
          <Route path="check" element={<CheckPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </TooltipProvider>
  );
}
