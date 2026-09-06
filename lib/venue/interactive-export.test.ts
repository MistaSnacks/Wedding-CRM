import { expect, it } from "vitest";
import { initialDraft, parseSavedDraft } from "./model";
import { embedInteractiveDraft } from "./interactive-export";

const template = '<!doctype html><html><!--VENUE_LAYOUT_START--><script id="venue-initial-layout" type="application/json">null</script><!--VENUE_LAYOUT_END--><div id="root"></div></html>';

it("embeds the current layout and safely round-trips guest names containing HTML", () => {
  const draft = initialDraft();
  draft.tables[0].x = 4.25;
  draft.guests[0].name = '</script><img src=x onerror=alert(1)>';
  const html = embedInteractiveDraft(template, draft, "snapshot-1");
  expect(html.match(/<script /g)).toHaveLength(1);
  expect(html).not.toContain('<img src=x');
  const json = html.match(/type="application\/json">([\s\S]*?)<\/script>/)![1];
  const embedded = JSON.parse(json);
  expect(embedded.id).toBe("snapshot-1");
  expect(parseSavedDraft(embedded.draft)).toEqual(draft);
});

it("replaces a previous snapshot once and refuses an invalid HTML template", () => {
  const first = embedInteractiveDraft(template, initialDraft(), "first");
  const second = embedInteractiveDraft(first, initialDraft(), "second");
  expect(second).not.toContain('"first"');
  expect(second.match(/id="venue-initial-layout"/g)).toHaveLength(1);
  expect(() => embedInteractiveDraft('<html>404</html>', initialDraft(), "x")).toThrow();
});
