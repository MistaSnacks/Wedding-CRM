import { parseSavedDraft, type Draft } from "./model";

export const INTERACTIVE_HTML_URL = "/venue/benavento-interactive.html";
const START = "<!--VENUE_LAYOUT_START-->";
const END = "<!--VENUE_LAYOUT_END-->";

/** Embed data as inert JSON, including names containing HTML or closing script tags. */
export function embedInteractiveDraft(template: string, draft: Draft, id: string) {
  const start = template.indexOf(START);
  const end = template.indexOf(END, start + START.length);
  if (start < 0 || end < 0) throw new Error("The interactive HTML template is unavailable.");
  const json = JSON.stringify({ id, draft: parseSavedDraft(draft) })
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return template.slice(0, start + START.length) +
    `<script id="venue-initial-layout" type="application/json">${json}</script>` +
    template.slice(end);
}

export async function createInteractiveHtml(draft: Draft) {
  let template: string;
  if (document.getElementById("venue-initial-layout")) {
    // A downloaded copy can itself export another copy without a server.
    const html = document.documentElement.cloneNode(true) as HTMLElement;
    html.querySelector("#root")?.replaceChildren();
    template = "<!doctype html>\n" + html.outerHTML;
  } else {
    const response = await fetch(INTERACTIVE_HTML_URL);
    if (!response.ok) throw new Error("Could not load the interactive HTML template.");
    template = await response.text();
  }
  return embedInteractiveDraft(template, draft, crypto.randomUUID());
}
