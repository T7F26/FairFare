create table if not exists rider_categories(
    category_id serial primary key,
    category_name varchar(50) unique not null
);
create table if not exists users(
    user_id serial primary key,
    category_id integer references rider_categories(category_id) on delete set null, 
    user_role varchar(50) default 'customer',
    username varchar(50) unique not null,  
    email varchar(255) unique not null,
    password_hash varchar(255) not null
);
create table if not exists agency_discounts(
    discount_id serial primary key,
    agency_id varchar(100) references agencies(agency_id) on delete cascade,
    category_id integer references rider_categories(category_id) on delete cascade,
    discount_percentage NUMERIC(5,2)
);
create table if not exists routes(
    route_id varchar(100) primary key,
    agency_id varchar(100) references agencies(agency_id) on delete cascade,
    route_short_name varchar(50),
    route_long_name varchar(255),
    route_type integer
);
create table if not exists fares(
    fare_id varchar(100) primary key,
    price numeric(10,2),
    currency_type varchar(3),
    payment_method integer,
    transfers integer,
    transfer_duration integer,
    agency_id varchar(100) references agencies(agency_id) on delete cascade
);
create table if not exists fare_rules(
    fare_id varchar(100) references fares(fare_id) on delete cascade,
    route_id varchar(100) references routes(route_id) on delete cascade,
    origin_id varchar(100),
    destination_id varchar(100),
    primary key(fare_id,route_id)
);
create table if not exists stops(
    stop_id varchar(100) primary key,
    stop_name varchar(255),
    stop_lat numeric(9,6),
    stop_lon numeric(9,6)
);
create table if not exists shapes(
    shape_id varchar(100),
    shape_pt_lat numeric(9,6),
    shape_pt_lon numeric(9,6),
    shape_pt_sequence integer,
    shape_dist_traveled numeric(10,2),
    primary key(shape_id,shape_pt_sequence)
);
create table if not exists calendar(
    service_id varchar(100) primary key,
    monday integer,
    tuesday integer,
    wednesday integer,
    thursday integer,
    friday integer,
    saturday integer,
    sunday integer,
    start_date date,
    end_date date
);
create table if not exists trips(
    trip_id varchar(100) primary key,
    route_id varchar(100) references routes(route_id) on delete cascade,
    service_id varchar(100) references calendar(service_id) on delete cascade,
    trip_headsign varchar(255),
    shape_id varchar(100)
);
create table if not exists stop_times(
    trip_id varchar(100) references trips(trip_id )on delete cascade,
    arrival_time varchar(20),
    departure_time varchar(20),
    stop_id varchar(100) references stops(stop_id) on delete cascade,
    stop_sequences integer,
    primary key(trip_id, stop_sequences)
);
create table if not exists favorites(
    journey_id serial primary key,
    user_id integer references users(user_id) on delete cascade,
    origin_stop_id varchar(100) references stops(stop_id) on delete cascade,
    destination_stop_id varchar(100) references stops(stop_id) on delete cascade,
    name varchar(255),
    added_at timestamp with time zone default current_timestamp
);
create table if not exists fare_test(
    test_id serial primary key,
    category_id integer references rider_categories(category_id),
    origin_stop_id varchar(100) references stops(stop_id),
    destination_stop_id varchar(100) references stops(stop_id),
    payment_method integer,
    official_fare numeric(10,2),
    calculated_fare numeric(10,2),
    result varchar(20),
    tested_at timestamp
);
create table if not exists login_attempts(
    attempt_id serial primary key,
    outcome varchar(50),
    user_id integer,
    email_attempted varchar(255),
    attempted_at timestamp
);
create table if not exists fares_log(
    log_id serial primary key,
    ddl_type varchar(255),
    fare_id varchar(100),
    price numeric(10,2),
    currency_type varchar(3),
    payment_method integer,
    transfers integer,
    transfer_duration integer,
    agency_id varchar(100)
    changed_at timestamp
)