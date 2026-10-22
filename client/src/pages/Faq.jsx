import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common";
import FaqList from "@/components/FaqList";
import { useAuth } from "@/lib/auth";
import { EMAILS, FAQ, PUBLIC_PAGES } from "@shared/pages";

/** /faq: every question about trading on Tap to Trade (the server also writes them in, with FAQPage markup). */
export default function Faq() {
  const { user } = useAuth();
  const page = PUBLIC_PAGES["/faq"];
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <PageHeader title={page.heading} description={page.text} />
      <FaqList items={FAQ} />
      <div className="mt-10 flex flex-wrap items-center gap-3 rounded-xl border bg-card p-5">
        <p className="mr-auto font-medium">Still have a question?</p>
        <Button asChild variant="outline">
          <a href={`mailto:${EMAILS.hello}`}>Email us</a>
        </Button>
        {!user && (
          <Button asChild>
            <Link to="/register">Create a free account</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
