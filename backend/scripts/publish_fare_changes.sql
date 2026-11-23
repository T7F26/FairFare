create or replace function publish_changes(f_agency_id VARCHAR)
returns integer as $$
declare
    published_count INTEGER;
begin
    select count(*)::int as total into published_count from compare_fares(f_agency_id) cf join fare_change_statuses fcs on fcs.agency_id=f_agency_id and fcs.fare_id = cf.fare_id where fcs.status = 'approved';
    delete from fares f using fare_change_statuses fcs where fcs.agency_id=f_agency_id and fcs.fare_id = f.fare_id and fcs.status = 'approved' and not exists(select 1 from stage_fares sf where f_agency_id ||'_'|| sf.fare_id=f.fare_id);
    delete from stage_fare_rules sfr where sfr.fare_id not in(select sf.fare_id from stage_fares sf join fare_change_statuses fcs on fcs.fare_id= f_agency_id ||'_'|| sf.fare_id where fcs.agency_id=f_agency_id and fcs.status = 'approved');
    delete from stage_fares sf where not exists (select 1 from fare_change_statuses fcs where fcs.agency_id = f_agency_id and fcs.fare_id = f_agency_id || '_' || sf.fare_id and fcs.status = 'approved');
    perform process_gtfs_records(f_agency_id);
    delete from pending_import where id = 1;
    delete from fare_change_statuses where agency_id=f_agency_id;
    return published_count;
end;
$$ language plpgsql;