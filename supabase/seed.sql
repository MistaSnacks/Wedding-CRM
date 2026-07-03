-- Seed: Juliet & Juan wedding with fixture households covering all three
-- invitation types. Invite codes / tokens are fixed for e2e testing.

insert into weddings (id, slug, couple_names, wedding_date, timezone, default_locale, rsvp_deadline, theme)
values ('11111111-1111-1111-1111-111111111111', 'juliet-juan', 'Juliet & Juan',
        '2027-06-12', 'America/Los_Angeles', 'en', '2027-04-12T23:59:00-07:00',
        '{"video": "/video/hero-v5.mp4", "poster": "/video/hero-v5-poster.jpg"}');

insert into events (id, wedding_id, name, starts_at, venue_name, sort_order) values
  ('22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111111', 'Ceremony',  '2027-06-12T16:00:00-07:00', 'Eden Benavento', 0),
  ('22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111111', 'Reception', '2027-06-12T17:30:00-07:00', 'Eden Benavento', 1);

insert into meal_options (id, wedding_id, name, is_kids_meal, sort_order) values
  ('33333333-3333-3333-3333-333333333301', '11111111-1111-1111-1111-111111111111', 'Chicken', false, 0),
  ('33333333-3333-3333-3333-333333333302', '11111111-1111-1111-1111-111111111111', 'Beef', false, 1),
  ('33333333-3333-3333-3333-333333333303', '11111111-1111-1111-1111-111111111111', 'Fish', false, 2),
  ('33333333-3333-3333-3333-333333333304', '11111111-1111-1111-1111-111111111111', 'Vegetarian', false, 3),
  ('33333333-3333-3333-3333-333333333305', '11111111-1111-1111-1111-111111111111', 'Vegan', false, 4),
  ('33333333-3333-3333-3333-333333333306', '11111111-1111-1111-1111-111111111111', 'Kids Meal', true, 5);

insert into rsvp_questions (wedding_id, label, type, scope, sort_order) values
  ('11111111-1111-1111-1111-111111111111',
   '{"en":"Song request — what gets you dancing?","es":"Pide una canción — ¿qué te hace bailar?","vi":"Yêu cầu bài hát — bài nào khiến bạn muốn nhảy?"}',
   'text', 'guest', 0),
  ('11111111-1111-1111-1111-111111111111',
   '{"en":"Will you need hotel recommendations?","es":"¿Necesitas recomendaciones de hotel?","vi":"Bạn có cần gợi ý khách sạn không?"}',
   'boolean', 'household', 1),
  ('11111111-1111-1111-1111-111111111111',
   '{"en":"Will you need the shuttle?","es":"¿Necesitarás el transporte?","vi":"Bạn có cần xe đưa đón không?"}',
   'boolean', 'household', 2),
  ('11111111-1111-1111-1111-111111111111',
   '{"en":"A message for the couple","es":"Un mensaje para los novios","vi":"Lời nhắn gửi cô dâu chú rể"}',
   'text', 'household', 3);

-- Household 1: named-guests-only couple
insert into households (id, wedding_id, display_name, primary_contact_name, email, invite_code, access_token, max_party_size, plus_one_slots) values
  ('44444444-4444-4444-4444-444444444401', '11111111-1111-1111-1111-111111111111',
   'Linh & Minh Nguyen', 'Linh Nguyen', 'linh.test@example.com', 'TEST-AAA1',
   'e2e-token-aaaaaaaaaaaaaaaaaaaaaaaa1', 2, 0);
insert into guests (id, wedding_id, household_id, first_name, last_name, age_type) values
  ('55555555-5555-5555-5555-555555555501', '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444401', 'Linh', 'Nguyen', 'adult'),
  ('55555555-5555-5555-5555-555555555502', '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444401', 'Minh', 'Nguyen', 'child');

-- Household 2: plus-one allowed
insert into households (id, wedding_id, display_name, primary_contact_name, email, invite_code, access_token, max_party_size, plus_one_slots, preferred_locale) values
  ('44444444-4444-4444-4444-444444444402', '11111111-1111-1111-1111-111111111111',
   'Jane Doe', 'Jane Doe', 'jane.test@example.com', 'TEST-AAA2',
   'e2e-token-aaaaaaaaaaaaaaaaaaaaaaaa2', 2, 1, 'es');
insert into guests (id, wedding_id, household_id, first_name, last_name) values
  ('55555555-5555-5555-5555-555555555503', '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444402', 'Jane', 'Doe');

-- Household 3: family invitation
insert into households (id, wedding_id, display_name, primary_contact_name, email, invite_code, access_token, max_party_size, plus_one_slots, preferred_locale) values
  ('44444444-4444-4444-4444-444444444403', '11111111-1111-1111-1111-111111111111',
   'The Smith Family', 'Sarah Smith', 'sarah.test@example.com', 'TEST-AAA3',
   'e2e-token-aaaaaaaaaaaaaaaaaaaaaaaa3', 4, 0, 'vi');
insert into guests (id, wedding_id, household_id, first_name, last_name, age_type, relationship) values
  ('55555555-5555-5555-5555-555555555504', '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444403', 'John',  'Smith', 'adult',  'Uncle of the groom'),
  ('55555555-5555-5555-5555-555555555505', '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444403', 'Sarah', 'Smith', 'adult',  'Aunt of the groom'),
  ('55555555-5555-5555-5555-555555555506', '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444403', 'Emma',  'Smith', 'child',  'Cousin'),
  ('55555555-5555-5555-5555-555555555507', '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444403', 'Oliver','Smith', 'infant', 'Cousin');

-- Everyone is invited to both events
insert into household_event_invites (household_id, event_id, wedding_id)
select h.id, e.id, h.wedding_id
from households h cross join events e
where h.wedding_id = '11111111-1111-1111-1111-111111111111'
  and e.wedding_id = '11111111-1111-1111-1111-111111111111';

-- Pending response rows for every guest × invited event
insert into guest_event_responses (guest_id, event_id, wedding_id)
select g.id, e.id, g.wedding_id
from guests g
join household_event_invites hei on hei.household_id = g.household_id
join events e on e.id = hei.event_id
where g.wedding_id = '11111111-1111-1111-1111-111111111111';
