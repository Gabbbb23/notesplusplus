import { Route, Routes } from "react-router";
import { Layout } from "@/components/layout";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CheckPage } from "@/pages/check";
import { FilesPage } from "@/pages/files";
import { HomePage } from "@/pages/home";
import { InboxPage } from "@/pages/inbox";
import { NotFoundPage } from "@/pages/not-found";
import { NotePage } from "@/pages/note";
import { SearchPage } from "@/pages/search";
import { TagPage } from "@/pages/tag";
import { TagsPage } from "@/pages/tags";

export function App() {
  return (
    <TooltipProvider>
      <Routes>
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
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
