import { createBrowserRouter } from "react-router";
import { MarketingLayout } from "./components/MarketingLayout";
import { LandingPage } from "./pages/LandingPage";
import { GetStartedPage } from "./pages/GetStartedPage";
import { BlogIndexPage } from "./pages/BlogIndexPage";
import { BlogPostPage } from "./pages/BlogPostPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { SupportPage } from "./pages/SupportPage";
import { TermsPage } from "./pages/TermsPage";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: MarketingLayout,
    children: [
      { index: true, Component: LandingPage },
      { path: "get-started", Component: GetStartedPage },
      { path: "blog", Component: BlogIndexPage },
      { path: "blog/:slug", Component: BlogPostPage },
      { path: "privacy", Component: PrivacyPage },
      { path: "terms", Component: TermsPage },
      { path: "support", Component: SupportPage },
    ],
  },
]);
