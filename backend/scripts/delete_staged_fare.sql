create or replace function delete_staged_fare(agency_prefix varchar,f_fare_id varchar)
returns void as $$
begin
    delete from stage_fares 
    where fare_id = replace(f_fare_id, agency_prefix || '_','');
end;
$$ language plpgsql;
