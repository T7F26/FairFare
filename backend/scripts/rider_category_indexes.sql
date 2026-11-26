
create index if not exists idx_rider_categories_name
on rider_categories(LOWER(category_name));

create index if not exists idx_agency_discounts_agency
on agency_discounts(agency_id);

create index if not exists idx_agency_discounts_category
on agency_discounts(category_id);

create index if not exists idx_users_category
on users(category_id);
