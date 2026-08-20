import { describe, expect, it } from "vitest";
import { hotelRecsRequested, isHotelQuestion } from "./rsvp";

const hotelQ = { id: "q-hotel", type: "boolean", label: { en: "Will you need hotel recommendations?", es: "¿Necesitas recomendaciones de hotel?", vi: "Bạn có cần gợi ý khách sạn không?" } };
const songQ = { id: "q-song", type: "text", label: { en: "Song request — what gets you dancing?", es: "", vi: "" } };
const messageQ = { id: "q-msg", type: "text", label: { en: "A message for the couple", es: "", vi: "" } };

describe("isHotelQuestion", () => {
  it("recognises the boolean hotel question by its English label", () => {
    expect(isHotelQuestion(hotelQ)).toBe(true);
  });
  it("does not treat a free-text question that mentions hotels as the hotel question", () => {
    expect(isHotelQuestion({ type: "text", label: { en: "Which hotel are you staying at?" } })).toBe(false);
  });
  it("tolerates a missing label", () => {
    expect(isHotelQuestion({ type: "boolean", label: null })).toBe(false);
  });
});

describe("hotelRecsRequested", () => {
  const questions = [songQ, hotelQ, messageQ];
  it("is true when the household answered yes", () => {
    expect(hotelRecsRequested(questions, [{ question_id: "q-hotel", value: true }])).toBe(true);
  });
  it("accepts a stringified boolean", () => {
    expect(hotelRecsRequested(questions, [{ question_id: "q-hotel", value: "true" }])).toBe(true);
  });
  it("is false when the household answered no or skipped it", () => {
    expect(hotelRecsRequested(questions, [{ question_id: "q-hotel", value: false }])).toBe(false);
    expect(hotelRecsRequested(questions, [])).toBe(false);
  });
  it("ignores a yes-looking value on a different question", () => {
    expect(hotelRecsRequested(questions, [{ question_id: "q-msg", value: true }])).toBe(false);
  });
});
