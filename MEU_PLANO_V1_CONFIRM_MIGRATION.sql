-- Emagreça na Dose Certa
-- Meu Plano V1 — Etapa 4
-- PROPOSTA: não executar nesta etapa.

begin;

create or replace function public.confirm_scheduled_application(
  p_scheduled_application_id uuid,
  p_application_date date,
  p_vial_mg numeric,
  p_vial_ml numeric,
  p_syringe_capacity integer,
  p_weight_kg numeric default null,
  p_application_notes text default null
)
returns table (
  application_id uuid,
  weight_record_id uuid,
  already_completed boolean
)
language plpgsql
security invoker
set search_path = pg_catalog, public, auth
as $function$
declare
  v_user_id uuid := auth.uid();
  v_occurrence public.scheduled_applications%rowtype;
  v_medicine text;
  v_dose_mg numeric;
  v_application_id uuid;
  v_weight_record_id uuid;
  v_volume_ml numeric;
  v_units numeric;
  v_today date;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  select sa.*
    into v_occurrence
  from public.scheduled_applications sa
  where sa.id = p_scheduled_application_id
    and sa.user_id = v_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Scheduled application not found';
  end if;

  if v_occurrence.status = 'completed' then
    select wr.id
      into v_weight_record_id
    from public.weight_records wr
    where wr.application_id = v_occurrence.completed_application_id
      and wr.user_id = v_user_id
    limit 1;

    return query
      select
        v_occurrence.completed_application_id,
        v_weight_record_id,
        true;
    return;
  end if;

  if v_occurrence.status <> 'scheduled' then
    raise exception using
      errcode = '23514',
      message = 'Scheduled application is not available for confirmation';
  end if;

  select ap.medicine, ap.dose_mg
    into v_medicine, v_dose_mg
  from public.application_plans ap
  where ap.id = v_occurrence.plan_id
    and ap.user_id = v_user_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Application plan not found';
  end if;

  v_today := (clock_timestamp() at time zone v_occurrence.timezone)::date;

  if p_application_date is null or p_application_date > v_today then
    raise exception using
      errcode = '22007',
      message = 'Application date must be a current or past civil date';
  end if;

  if p_vial_mg is null or p_vial_mg <= 0
    or p_vial_ml is null or p_vial_ml <= 0
    or v_dose_mg is null or v_dose_mg <= 0 then
    raise exception using
      errcode = '22003',
      message = 'Dose and vial values must be positive';
  end if;

  if p_syringe_capacity is null or p_syringe_capacity not in (30, 50, 100) then
    raise exception using
      errcode = '22023',
      message = 'Unsupported syringe capacity';
  end if;

  if p_weight_kg is not null and p_weight_kg <= 0 then
    raise exception using
      errcode = '22003',
      message = 'Weight must be positive';
  end if;

  if length(btrim(coalesce(p_application_notes, ''))) > 500 then
    raise exception using
      errcode = '22001',
      message = 'Application notes must contain at most 500 characters';
  end if;

  v_volume_ml := v_dose_mg / (p_vial_mg / p_vial_ml);
  v_units := v_volume_ml * 100;

  insert into public.applications (
    user_id,
    application_date,
    medicine,
    vial_mg,
    vial_ml,
    dose_mg,
    volume_ml,
    units,
    syringe_capacity,
    source,
    calculation_version,
    notes
  ) values (
    v_user_id,
    p_application_date,
    v_medicine,
    p_vial_mg,
    p_vial_ml,
    v_dose_mg,
    v_volume_ml,
    v_units,
    p_syringe_capacity,
    'simulator',
    1,
    btrim(coalesce(p_application_notes, ''))
  )
  returning id into v_application_id;

  if p_weight_kg is not null then
    insert into public.weight_records (
      user_id,
      record_date,
      weight_kg,
      notes,
      source,
      application_id
    ) values (
      v_user_id,
      p_application_date,
      p_weight_kg,
      'Peso registrado junto à aplicação',
      'application',
      v_application_id
    )
    returning id into v_weight_record_id;
  end if;

  update public.scheduled_applications
  set
    status = 'completed',
    completed_application_id = v_application_id
  where id = v_occurrence.id
    and user_id = v_user_id
    and status = 'scheduled';

  if not found then
    raise exception using
      errcode = '40001',
      message = 'Scheduled application changed during confirmation';
  end if;

  return query
    select v_application_id, v_weight_record_id, false;
end;
$function$;

revoke all on function public.confirm_scheduled_application(
  uuid, date, numeric, numeric, integer, numeric, text
) from public;

revoke all on function public.confirm_scheduled_application(
  uuid, date, numeric, numeric, integer, numeric, text
) from anon;

grant execute on function public.confirm_scheduled_application(
  uuid, date, numeric, numeric, integer, numeric, text
) to authenticated;

comment on function public.confirm_scheduled_application(
  uuid, date, numeric, numeric, integer, numeric, text
) is 'Confirma uma ocorrência própria, cria aplicação e peso opcional atomicamente e é idempotente para retry.';

commit;
