-- Create staging tables
create unlogged table stage_stops(
stop_id VARCHAR,stop_name VARCHAR,
stop_lat VARCHAR,stop_lon VARCHAR,
zone_id varchar(100));

create unlogged table stage_routes(
route_id VARCHAR,agency_id VARCHAR,
route_short_name VARCHAR,route_long_name VARCHAR,
route_type VARCHAR);

create unlogged table stage_trips(
route_id VARCHAR, service_id VARCHAR,
trip_id VARCHAR, trip_headsign VARCHAR,
shape_id VARCHAR);

create unlogged table stage_stop_times(
trip_id VARCHAR, arrival_time VARCHAR,
departure_time VARCHAR, stop_id VARCHAR,
stop_sequence VARCHAR);

create unlogged table stage_fares(
fare_id VARCHAR, price VARCHAR,
currency_type VARCHAR, payment_method VARCHAR,
transfers VARCHAR, transfer_duration VARCHAR,
agency_id VARCHAR);

create unlogged table stage_fare_rules(
fare_id VARCHAR, route_id VARCHAR,
origin_id VARCHAR, destination_id VARCHAR);

create unlogged table stage_shapes(
shape_id VARCHAR, shape_pt_lat VARCHAR,
shape_pt_lon VARCHAR, shape_pt_sequence VARCHAR,
shape_dist_traveled VARCHAR);

create unlogged table stage_calendar(
service_id VARCHAR, monday VARCHAR,
tuesday VARCHAR, wednesday VARCHAR,
thursday VARCHAR, friday VARCHAR,
saturday VARCHAR, sunday VARCHAR,
start_date VARCHAR, end_date VARCHAR);

CREATE UNLOGGED TABLE stage_calendar_dates(
service_id VARCHAR, date VARCHAR,
exception_type VARCHAR
);

create or replace function process_gtfs_records(agency_prefix VARCHAR)
returns void as $$
begin
    insert into stops(stop_id, stop_name, stop_lat, stop_lon, zone_id)
    select agency_prefix ||'_'|| stop_id, stop_name, CAST(stop_lat AS NUMERIC), CAST(stop_lon AS NUMERIC), agency_prefix ||'_'|| nullif(zone_id,'')
    from stage_stops
    on conflict(stop_id) do nothing;

    insert into routes(route_id, agency_id, route_short_name, route_long_name, route_type)
    select agency_prefix ||'_'|| route_id, agency_prefix ||'_'|| nullif(agency_id,''), route_short_name, route_long_name, CAST(route_type as integer)
    from stage_routes
    on conflict(route_id) do nothing;

    insert into trips(trip_id, route_id, service_id, trip_headsign, shape_id)
    select agency_prefix ||'_'|| trip_id,agency_prefix ||'_'|| route_id, agency_prefix ||'_'|| service_id, trip_headsign,agency_prefix ||'_'|| nullif(shape_id,'')
    from stage_trips
    on conflict(trip_id) do nothing;

    insert into stop_times(trip_id, arrival_time, departure_time, stop_id, stop_sequence)
    select agency_prefix ||'_'||trip_id, arrival_time, departure_time, agency_prefix ||'_'|| stop_id, CAST(stop_sequence as integer)
    from stage_stop_times
    on conflict(trip_id, stop_sequence) do nothing;

    insert into fares(fare_id, price, currency_type, payment_method, transfers, transfer_duration, agency_id)
    select agency_prefix ||'_'|| fare_id, CAST(price as numeric), currency_type, cast(payment_method as integer), cast(nullif(transfers,'') as integer), cast(nullif(transfer_duration,'') as integer), agency_prefix ||'_'|| nullif(agency_id,'')
    from stage_fares
    on conflict(fare_id) do nothing;

    insert into fare_rules(fare_id, route_id, origin_id, destination_id)
    select agency_prefix ||'_'|| fare_id, agency_prefix ||'_'|| nullif(route_id,''), origin_id, destination_id
    from stage_fare_rules;

    insert into shapes(shape_id, shape_pt_lat, shape_pt_lon, shape_pt_sequence, shape_dist_traveled)
    select agency_prefix ||'_'|| shape_id, CAST(shape_pt_lat as numeric), CAST(shape_pt_lon as numeric), CAST(shape_pt_sequence as integer), CAST(nullif(shape_dist_traveled,'') as numeric)
    from stage_shapes
    on conflict(shape_id, shape_pt_sequence) do nothing;

    insert into calendar(service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, start_date, end_date)
    select agency_prefix ||'_'|| service_id, CAST(monday as integer), CAST(tuesday as integer), CAST(wednesday as integer), CAST(thursday as integer), CAST(friday as integer), CAST(saturday as integer), CAST(sunday as integer), to_date(start_date, 'YYYYMMDD'), to_date(end_date, 'YYYYMMDD')
    from stage_calendar
    on conflict(service_id) do nothing;

    insert into calendar_dates(service_id, date, exception_type)
    select agency_prefix ||'_'|| service_id, to_date(date, 'YYYYMMDD'), CAST(exception_type as integer)
    from stage_calendar_dates
    on conflict(service_id, date) do nothing;
    
    truncate stage_stops, stage_routes, stage_trips, stage_stop_times, stage_fares, stage_fare_rules, stage_shapes, stage_calendar,stage_calendar_dates;

    raise notice 'GTFS records have been successfully processed for: %', agency_prefix;
end;
$$ language plpgsql;