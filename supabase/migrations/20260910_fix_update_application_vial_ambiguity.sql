-- COR-005: qualifica a coluna application_id no caminho sem frasco da RPC-2.
begin;

create or replace function public.update_application_with_optional_vial(
  p_application_id uuid, p_application_date date, p_medicine text,
  p_vial_mg numeric, p_vial_ml numeric, p_dose_mg numeric,
  p_syringe_capacity integer, p_application_notes text default '',
  p_medication_vial_id uuid default null
) returns table (application_id uuid, vial_usage_id uuid)
language plpgsql security invoker
set search_path = pg_catalog, public, auth
as $function$
declare
  v_user_id uuid := auth.uid(); v_existing public.applications%rowtype;
  v_old_usage public.vial_usages%rowtype; v_target public.medication_vials%rowtype;
  v_used_mg numeric := 0; v_used_ml numeric := 0; v_volume_ml numeric;
  v_units numeric; v_vial_usage_id uuid;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  if p_application_date is null or p_application_date > current_date then raise exception using errcode = '22007', message = 'Application date must be current or past'; end if;
  if char_length(btrim(coalesce(p_medicine, ''))) not between 1 and 100 or p_vial_mg is null or p_vial_mg <= 0 or p_vial_ml is null or p_vial_ml <= 0 or p_dose_mg is null or p_dose_mg <= 0 then raise exception using errcode = '22003', message = 'Medicine, dose and vial values must be valid'; end if;
  if p_syringe_capacity is null or p_syringe_capacity not in (30, 50, 100) then raise exception using errcode = '22023', message = 'Unsupported syringe capacity'; end if;
  if char_length(btrim(coalesce(p_application_notes, ''))) > 500 then raise exception using errcode = '22001', message = 'Application notes must contain at most 500 characters'; end if;
  select a.* into v_existing from public.applications a where a.id = p_application_id and a.user_id = v_user_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Application not found'; end if;
  select vu.* into v_old_usage from public.vial_usages vu where vu.application_id = p_application_id and vu.user_id = v_user_id for update;
  perform 1 from public.medication_vials mv where mv.user_id = v_user_id and mv.id in (p_medication_vial_id, v_old_usage.vial_id) order by mv.id for update;
  v_volume_ml := p_dose_mg / (p_vial_mg / p_vial_ml); v_units := v_volume_ml * 100;
  if p_medication_vial_id is not null then
    select mv.* into v_target from public.medication_vials mv where mv.id = p_medication_vial_id and mv.user_id = v_user_id and mv.status = 'active';
    if not found then raise exception using errcode = 'P0002', message = 'Selected vial is not available'; end if;
    select coalesce(sum(vu.used_mg), 0), coalesce(sum(vu.used_ml), 0) into v_used_mg, v_used_ml from public.vial_usages vu where vu.vial_id = v_target.id and vu.application_id <> p_application_id;
    if v_used_mg + p_dose_mg > v_target.initial_mg or v_used_ml + v_volume_ml > v_target.initial_ml then raise exception using errcode = '23514', message = 'Selected vial does not have enough remaining medication'; end if;
  end if;
  update public.applications set application_date=p_application_date, medicine=btrim(p_medicine), vial_mg=p_vial_mg, vial_ml=p_vial_ml, dose_mg=p_dose_mg, volume_ml=v_volume_ml, units=v_units, syringe_capacity=p_syringe_capacity, notes=btrim(coalesce(p_application_notes, '')) where id=p_application_id and user_id=v_user_id;
  if p_medication_vial_id is null then
    delete from public.vial_usages as vu where vu.application_id = p_application_id and vu.user_id = v_user_id;
  elsif v_old_usage.id is null then
    insert into public.vial_usages (user_id,vial_id,application_id,used_mg,used_ml) values (v_user_id,p_medication_vial_id,p_application_id,p_dose_mg,v_volume_ml) returning id into v_vial_usage_id;
  else
    update public.vial_usages set vial_id=p_medication_vial_id,used_mg=p_dose_mg,used_ml=v_volume_ml where id=v_old_usage.id and user_id=v_user_id returning id into v_vial_usage_id;
  end if;
  return query select p_application_id, v_vial_usage_id;
end;
$function$;

revoke all on function public.update_application_with_optional_vial(uuid,date,text,numeric,numeric,numeric,integer,text,uuid) from public, anon;
grant execute on function public.update_application_with_optional_vial(uuid,date,text,numeric,numeric,numeric,integer,text,uuid) to authenticated;
commit;
