-- Duração do frasco V1: aplicação e retirada gravadas na mesma transação.
-- O frasco é sempre opcional; quando escolhido, dose e volume são abatidos
-- somente se ambos os saldos comportarem a aplicação.

begin;

create or replace function public.create_application_with_optional_vial(
  p_application_date date,
  p_medicine text,
  p_vial_mg numeric,
  p_vial_ml numeric,
  p_dose_mg numeric,
  p_syringe_capacity integer,
  p_application_notes text default '',
  p_medication_vial_id uuid default null
)
returns table (
  application_id uuid,
  vial_usage_id uuid
)
language plpgsql
security invoker
set search_path = pg_catalog, public, auth
as $function$
declare
  v_user_id uuid := auth.uid();
  v_inventory public.medication_vials%rowtype;
  v_used_mg numeric := 0;
  v_used_ml numeric := 0;
  v_volume_ml numeric;
  v_units numeric;
  v_application_id uuid;
  v_vial_usage_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_application_date is null or p_application_date > current_date then
    raise exception using errcode = '22007', message = 'Application date must be current or past';
  end if;
  if char_length(btrim(coalesce(p_medicine, ''))) not between 1 and 100
    or p_vial_mg is null or p_vial_mg <= 0 or p_vial_ml is null or p_vial_ml <= 0
    or p_dose_mg is null or p_dose_mg <= 0 then
    raise exception using errcode = '22003', message = 'Medicine, dose and vial values must be valid';
  end if;
  if p_syringe_capacity is null or p_syringe_capacity not in (30, 50, 100) then
    raise exception using errcode = '22023', message = 'Unsupported syringe capacity';
  end if;
  if char_length(btrim(coalesce(p_application_notes, ''))) > 500 then
    raise exception using errcode = '22001', message = 'Application notes must contain at most 500 characters';
  end if;

  v_volume_ml := p_dose_mg / (p_vial_mg / p_vial_ml);
  v_units := v_volume_ml * 100;

  if p_medication_vial_id is not null then
    select mv.* into v_inventory
      from public.medication_vials mv
      where mv.id = p_medication_vial_id and mv.user_id = v_user_id and mv.status = 'active'
      for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Selected vial is not available';
    end if;
    select coalesce(sum(vu.used_mg), 0), coalesce(sum(vu.used_ml), 0)
      into v_used_mg, v_used_ml
      from public.vial_usages vu where vu.vial_id = v_inventory.id;
    if v_used_mg + p_dose_mg > v_inventory.initial_mg
      or v_used_ml + v_volume_ml > v_inventory.initial_ml then
      raise exception using errcode = '23514', message = 'Selected vial does not have enough remaining medication';
    end if;
  end if;

  insert into public.applications (
    user_id, application_date, medicine, vial_mg, vial_ml, dose_mg, volume_ml, units,
    syringe_capacity, source, calculation_version, notes
  ) values (
    v_user_id, p_application_date, btrim(p_medicine), p_vial_mg, p_vial_ml, p_dose_mg,
    v_volume_ml, v_units, p_syringe_capacity, 'simulator', 1, btrim(coalesce(p_application_notes, ''))
  ) returning id into v_application_id;

  if p_medication_vial_id is not null then
    insert into public.vial_usages (user_id, vial_id, application_id, used_mg, used_ml)
    values (v_user_id, v_inventory.id, v_application_id, p_dose_mg, v_volume_ml)
    returning id into v_vial_usage_id;
  end if;

  return query select v_application_id, v_vial_usage_id;
end;
$function$;

create or replace function public.update_application_with_optional_vial(
  p_application_id uuid,
  p_application_date date,
  p_medicine text,
  p_vial_mg numeric,
  p_vial_ml numeric,
  p_dose_mg numeric,
  p_syringe_capacity integer,
  p_application_notes text default '',
  p_medication_vial_id uuid default null
)
returns table (
  application_id uuid,
  vial_usage_id uuid
)
language plpgsql
security invoker
set search_path = pg_catalog, public, auth
as $function$
declare
  v_user_id uuid := auth.uid();
  v_existing public.applications%rowtype;
  v_old_usage public.vial_usages%rowtype;
  v_target public.medication_vials%rowtype;
  v_used_mg numeric := 0;
  v_used_ml numeric := 0;
  v_volume_ml numeric;
  v_units numeric;
  v_vial_usage_id uuid;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  if p_application_date is null or p_application_date > current_date then raise exception using errcode = '22007', message = 'Application date must be current or past'; end if;
  if char_length(btrim(coalesce(p_medicine, ''))) not between 1 and 100
    or p_vial_mg is null or p_vial_mg <= 0 or p_vial_ml is null or p_vial_ml <= 0
    or p_dose_mg is null or p_dose_mg <= 0 then raise exception using errcode = '22003', message = 'Medicine, dose and vial values must be valid'; end if;
  if p_syringe_capacity is null or p_syringe_capacity not in (30, 50, 100) then raise exception using errcode = '22023', message = 'Unsupported syringe capacity'; end if;
  if char_length(btrim(coalesce(p_application_notes, ''))) > 500 then raise exception using errcode = '22001', message = 'Application notes must contain at most 500 characters'; end if;

  select a.* into v_existing from public.applications a where a.id = p_application_id and a.user_id = v_user_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Application not found'; end if;
  select vu.* into v_old_usage from public.vial_usages vu where vu.application_id = p_application_id and vu.user_id = v_user_id for update;

  -- Lock every involved vial in one deterministic order before recalculating its balance.
  perform 1 from public.medication_vials mv
    where mv.user_id = v_user_id and mv.id in (p_medication_vial_id, v_old_usage.vial_id)
    order by mv.id for update;

  v_volume_ml := p_dose_mg / (p_vial_mg / p_vial_ml);
  v_units := v_volume_ml * 100;
  if p_medication_vial_id is not null then
    select mv.* into v_target from public.medication_vials mv
      where mv.id = p_medication_vial_id and mv.user_id = v_user_id and mv.status = 'active';
    if not found then raise exception using errcode = 'P0002', message = 'Selected vial is not available'; end if;
    select coalesce(sum(vu.used_mg), 0), coalesce(sum(vu.used_ml), 0)
      into v_used_mg, v_used_ml from public.vial_usages vu where vu.vial_id = v_target.id and vu.application_id <> p_application_id;
    if v_used_mg + p_dose_mg > v_target.initial_mg or v_used_ml + v_volume_ml > v_target.initial_ml then
      raise exception using errcode = '23514', message = 'Selected vial does not have enough remaining medication';
    end if;
  end if;

  update public.applications set
    application_date = p_application_date, medicine = btrim(p_medicine), vial_mg = p_vial_mg,
    vial_ml = p_vial_ml, dose_mg = p_dose_mg, volume_ml = v_volume_ml, units = v_units,
    syringe_capacity = p_syringe_capacity, notes = btrim(coalesce(p_application_notes, ''))
  where id = p_application_id and user_id = v_user_id;

  if p_medication_vial_id is null then
    delete from public.vial_usages where application_id = p_application_id and user_id = v_user_id;
  elsif v_old_usage.id is null then
    insert into public.vial_usages (user_id, vial_id, application_id, used_mg, used_ml)
    values (v_user_id, p_medication_vial_id, p_application_id, p_dose_mg, v_volume_ml)
    returning id into v_vial_usage_id;
  else
    update public.vial_usages set vial_id = p_medication_vial_id, used_mg = p_dose_mg, used_ml = v_volume_ml
      where id = v_old_usage.id and user_id = v_user_id returning id into v_vial_usage_id;
  end if;
  return query select p_application_id, v_vial_usage_id;
end;
$function$;

revoke all on function public.create_application_with_optional_vial(date, text, numeric, numeric, numeric, integer, text, uuid) from public, anon;
revoke all on function public.update_application_with_optional_vial(uuid, date, text, numeric, numeric, numeric, integer, text, uuid) from public, anon;
grant execute on function public.create_application_with_optional_vial(date, text, numeric, numeric, numeric, integer, text, uuid) to authenticated;
grant execute on function public.update_application_with_optional_vial(uuid, date, text, numeric, numeric, numeric, integer, text, uuid) to authenticated;

-- Mantém a RPC validada de confirmação de agendamento e acrescenta uma sobrecarga
-- para vincular o frasco escolhido na mesma transação.
create or replace function public.confirm_scheduled_application(
  p_scheduled_application_id uuid,
  p_application_date date,
  p_vial_mg numeric,
  p_vial_ml numeric,
  p_syringe_capacity integer,
  p_weight_kg numeric,
  p_application_notes text,
  p_medication_vial_id uuid
)
returns table (application_id uuid, weight_record_id uuid, already_completed boolean)
language plpgsql
security invoker
set search_path = pg_catalog, public, auth
as $function$
declare
  v_user_id uuid := auth.uid();
  v_result record;
  v_inventory public.medication_vials%rowtype;
  v_application public.applications%rowtype;
  v_used_mg numeric := 0;
  v_used_ml numeric := 0;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  select * into v_result from public.confirm_scheduled_application(
    p_scheduled_application_id, p_application_date, p_vial_mg, p_vial_ml,
    p_syringe_capacity, p_weight_kg, p_application_notes
  );
  if v_result.already_completed or p_medication_vial_id is null then
    return query select v_result.application_id, v_result.weight_record_id, v_result.already_completed;
    return;
  end if;
  select a.* into v_application from public.applications a where a.id = v_result.application_id and a.user_id = v_user_id;
  if not found then raise exception using errcode = 'P0002', message = 'Application not found'; end if;
  select mv.* into v_inventory from public.medication_vials mv
    where mv.id = p_medication_vial_id and mv.user_id = v_user_id and mv.status = 'active' for update;
  if not found then raise exception using errcode = 'P0002', message = 'Selected vial is not available'; end if;
  select coalesce(sum(vu.used_mg), 0), coalesce(sum(vu.used_ml), 0) into v_used_mg, v_used_ml
    from public.vial_usages vu where vu.vial_id = v_inventory.id;
  if v_used_mg + v_application.dose_mg > v_inventory.initial_mg
    or v_used_ml + v_application.volume_ml > v_inventory.initial_ml then
    raise exception using errcode = '23514', message = 'Selected vial does not have enough remaining medication';
  end if;
  insert into public.vial_usages (user_id, vial_id, application_id, used_mg, used_ml)
  values (v_user_id, v_inventory.id, v_application.id, v_application.dose_mg, v_application.volume_ml);
  return query select v_result.application_id, v_result.weight_record_id, false;
end;
$function$;

revoke all on function public.confirm_scheduled_application(uuid, date, numeric, numeric, integer, numeric, text, uuid) from public, anon;
grant execute on function public.confirm_scheduled_application(uuid, date, numeric, numeric, integer, numeric, text, uuid) to authenticated;

commit;
