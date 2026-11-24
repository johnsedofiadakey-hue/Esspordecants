import { useEffect, useMemo, useState } from "react";
import guide from "../../../../docs/ADMIN_GUIDE.md?raw";
import { Button, PageHeader } from "../components/ui.tsx";
import { parseGuide } from "../markdown.tsx";

// The admin guide, read from docs/ADMIN_GUIDE.md so there is one copy to keep up to date.
export function Help() {
  const parsed = useMemo(() => parseGuide(guide), []);
  const [open, setOpen] = useState<string | null>(null);

  // Opening a link such as /help#add-a-fragrance expands and scrolls to that part.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    setOpen(id);
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }, []);

  const jump = (id: string) => {
    setOpen(id);
    window.history.replaceState(null, "", `#${id}`);
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  };

  return (
    <div className="guide">
      <PageHeader
        title="Help"
        subtitle="Everything you need to run the shop on your own. Tap a topic to open it."
        actions={
          <Button
            className="no-print"
            onClick={() => {
              // A closed section would print as just its heading, so open them all first.
              document.querySelectorAll<HTMLDetailsElement>(".guide-section").forEach((section) => (section.open = true));
              window.print();
            }}
          >
            Print this guide
          </Button>
        }
      />
      <nav className="guide-toc no-print" aria-label="Topics">
        {parsed.sections.map((section) => (
          <button key={section.id} type="button" onClick={() => jump(section.id)}>
            {section.title}
          </button>
        ))}
      </nav>
      <div className="guide-intro">{parsed.intro}</div>
      {parsed.sections.map((section) => (
        <details key={section.id} id={section.id} className="guide-section" open={open === section.id || undefined} onToggle={(event) => event.currentTarget.open && open !== section.id && setOpen(section.id)}>
          <summary>{section.title}</summary>
          <div className="guide-body">{section.body}</div>
        </details>
      ))}
    </div>
  );
}
