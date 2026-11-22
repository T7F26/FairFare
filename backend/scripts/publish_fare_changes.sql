create or replace function publish_changes(f_agency_id VARCHAR)
returns integer as $$
declare
    published_count INTEGER;
begin
    select count(*)::int as total into published_count from compare_fares(f_agency_id);
    perform process_gtfs_records(f_agency_id);
    delete from pending_import where id = 1;
    delete from fare_change_statuses where agency_id=f_agency_id;
    return published_count;
end;
$$ language plpgsql;