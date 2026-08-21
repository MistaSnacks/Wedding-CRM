-- Retire the "Will you need the shuttle?" RSVP question from the guest flow.
-- The form only renders rows where is_active = true (lib/data/rsvp.ts), so
-- deactivating keeps any answers already recorded while hiding the question.
update rsvp_questions
   set is_active = false
 where wedding_id = '11111111-1111-1111-1111-111111111111'
   and label->>'en' = 'Will you need the shuttle?';
