-- Retire the whole extras step from the guest RSVP flow: song request, hotel
-- recommendations, and the message for the couple. The form only renders rows
-- where is_active = true (lib/data/rsvp.ts) and skips the extras page entirely
-- when none remain (components/guest/RsvpFlow.tsx), so deactivating keeps any
-- answers already recorded while removing the page.
--
-- Note: the hotel-recommendations button in the confirmation email keys off an
-- active hotel question (lib/data/rsvp.ts wantsHotelRecs), so it goes dormant
-- with this change; reactivating the question brings it back.
update rsvp_questions
   set is_active = false
 where wedding_id = '11111111-1111-1111-1111-111111111111'
   and is_active = true;
