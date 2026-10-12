import { lazy, useEffect } from "react";
import { NOT_FOUND_TITLE } from "@shared/pages";
import { Link, Route, Routes, useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { PageMessage } from "@/components/common";
import Layout from "@/components/Layout";
import { RequireAuth } from "@/lib/auth";
import Home from "@/pages/Home";

// Every page except the home page downloads its code the first time it's visited, so the first visit doesn't
// carry the whole site (admin, moderation, settings…). Layout shows a spinner while a page loads.
const page = (load, name = "default") => lazy(() => load().then((m) => ({ default: m[name] })));
const auth = () => import("@/pages/Auth");
const trades = () => import("@/pages/Trades");
const stores = () => import("@/pages/Stores");
const legal = () => import("@/pages/Legal");
const Login = page(auth, "Login");
const Register = page(auth, "Register");
const GoogleSignup = page(auth, "GoogleSignup");
const ForgotPassword = page(auth, "ForgotPassword");
const ResetPassword = page(auth, "ResetPassword");
const VerifyEmail = page(auth, "VerifyEmail");
const Privacy = page(legal, "Privacy");
const Terms = page(legal, "Terms");
const Search = page(() => import("@/pages/Search"));
const Cards = page(() => import("@/pages/Cards"));
const Stores = page(stores, "Stores");
const StorePage = page(stores, "StorePage");
const CityPage = page(() => import("@/pages/City"));
const Profile = page(() => import("@/pages/Profile"));
const Dashboard = page(() => import("@/pages/Dashboard"));
const Inventory = page(() => import("@/pages/Inventory"));
const Wants = page(() => import("@/pages/Wants"));
const TradesPage = page(trades, "TradesPage");
const NewTrade = page(trades, "NewTrade");
const TradeDetail = page(trades, "TradeDetail");
const CounterTrade = page(trades, "CounterTrade");
const Settings = page(() => import("@/pages/Settings"));
const Suggestions = page(() => import("@/pages/Suggestions"));
const ModerationPage = page(() => import("@/pages/Moderation"), "ModerationPage");
const AdminPage = page(() => import("@/pages/Admin"), "AdminPage");

/** Mockup 5 direction: a calm missing-page message with a clear route back. */
export function NotFound() {
  useEffect(() => {
    document.title = NOT_FOUND_TITLE;
  }, []);
  return (
    <PageMessage
      code="404"
      title={
        <>
          <span className="sr-only">Page not found. </span>I guess the trade failed to happen
        </>
      }
      body="The cause is a mystery, you could say. This page doesn't exist, or it has moved somewhere else."
      action={
        <Button asChild>
          <Link to="/search">Search cards</Link>
        </Button>
      }
    />
  );
}

// Jump back to the top whenever the path changes, like a normal page load would. A link with a #section
// (e.g. /terms#accessibility) scrolls to that section instead.
export function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    const target = hash && document.getElementById(decodeURIComponent(hash.slice(1)));
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0); // newer Chromium returns a Promise here; never hand it to React as a cleanup
  }, [pathname, hash]);
  return null;
}

// Every page shares Layout (header + footer). Search, profiles, stores and the card browser are public, so anyone can
// look before signing up. Pages inside RequireAuth need a login, and moderation/admin also check the role.
export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="register/google" element={<GoogleSignup />} />
          <Route path="forgot-password" element={<ForgotPassword />} />
          <Route path="reset-password" element={<ResetPassword />} />
          <Route path="verify-email" element={<VerifyEmail />} />
          <Route path="privacy" element={<Privacy />} />
          <Route path="terms" element={<Terms />} />
          <Route path="search" element={<Search />} />
          <Route path="cards" element={<Cards />} />
          <Route path="stores" element={<Stores />} />
          <Route path="stores/:slug" element={<StorePage />} />
          <Route path="trade/:slug" element={<CityPage />} />
          <Route path="u/:username" element={<Profile />} />
          <Route element={<RequireAuth />}>
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="wants" element={<Wants />} />
            <Route path="trades" element={<TradesPage />} />
            <Route path="trades/new" element={<NewTrade />} />
            <Route path="trades/:id" element={<TradeDetail />} />
            <Route path="trades/:id/counter" element={<CounterTrade />} />
            <Route path="settings" element={<Settings />} />
            <Route path="suggestions" element={<Suggestions />} />
          </Route>
          <Route element={<RequireAuth roles={["moderator", "admin"]} />}>
            <Route path="moderation" element={<ModerationPage />} />
          </Route>
          <Route element={<RequireAuth roles={["admin"]} />}>
            <Route path="admin" element={<AdminPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}
