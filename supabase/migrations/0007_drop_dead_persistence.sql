-- DB-001: remove dead persistence surface.
--
-- bookings was created in 0001 but no application path ever wrote or read it:
-- travel offers and reservations both live on the trip payload. Keeping an
-- empty table (and its permissive RLS policy) only invites drift, so it goes.
drop table if exists bookings;

-- itinerary_items.reservation_id was written on every save but never set on
-- any ItineraryItem: reservations are persisted inside trips.payload
-- (src/schemas/reservation.ts) and linked through Reservation.linkedItemId.
-- The normalized child tables are rebuilt from the payload on every save, so
-- a separate column could never be the source of truth.
alter table itinerary_items drop column if exists reservation_id;
