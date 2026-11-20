--this has to run BEFORE process_gtfs_records
create or replace function compare_fares(agency_prefix VARCHAR)
returns table(
    fare_id varchar,
    new_price numeric,
    old_price numeric,
    currency_type varchar,
    transfer_duration varchar,
    changed_type varchar
) as $$
begin 
    return query
    select coalesce(agency_prefix ||'_'|| s.fare_id,f.fare_id)::varchar as fare_id, 
    cast(s.price as numeric) as new_price, 
    f.price as old_price,
    s.currency_type, 
    s.transfer_duration,
    case 
        when f.fare_id is null then 'New fare'
        when s.fare_id is null then 'Fare removed'
        when cast(s.price as numeric)<>f.price then 'Price changed' 
    end::varchar as changed_type
    from stage_fares s full outer join (select * from fares where agency_id = agency_prefix) f on f.fare_id = agency_prefix ||'_'|| s.fare_id
    where f.fare_id is null or s.fare_id is null or cast(s.price as numeric)<>f.price;
end;
$$ language plpgsql;

--when the admin rejects a value run the function in delete_staged_fare.sql